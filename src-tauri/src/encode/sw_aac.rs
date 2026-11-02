//! Software AAC encoder — PLAN 2.1's audio leg, the counterpart of
//! `sw_x264` behind the narrower [`AudioEncoder`] seam.
//!
//! Frame path (ARCHITECTURE §2): the pipeline mixer hands one chunk of
//! frame-size stereo f32 (48 kHz, gain applied) → deinterleaved to FLTP
//! planes → AAC packets, all on the AUDIO worker thread (never on a
//! capture callback — same law as sw_x264's scaler note).
//!
//! Time bases: the codec context runs in the SAMPLE clock (1/48 kHz,
//! set by `MuxerBuilder::add_audio`); frame pts count SAMPLES. Packets
//! are re-stamped into the contract's µs time base
//! ([`crate::encode::EncodedPacket`]) before returning.

use super::{AudioEncoder, EncodedPacket, EncoderInfo};
use crate::util::error::CoreError;
use ffmpeg_next as ff;

/// MVP audio target bitrate (API §2.2 notes AAC as the composition
/// codec; 192 kbps stereo is the "indistinguishable" tier OBS simple
/// mode ships around). Not user-visible until the audio settings land.
#[cfg_attr(not(test), allow(dead_code))]
pub const AAC_BIT_RATE: usize = 192_000;

/// AVERROR(EAGAIN) = "codec queue full, come back later" — same mapping
/// as sw_x264 (libc is not a direct dep; the Linux ABI value is pinned).
const LINUX_EAGAIN: std::ffi::c_int = 11;

/* Pre-wiring: session Phase E constructs SwAac; tests exercise it now.
Same anticipated-dead state as the file that anchors it (encode/mod.rs). */
#[cfg_attr(not(test), allow(dead_code))]
pub struct SwAac {
    audio: ff::encoder::Audio,
    /// The codec's fixed input chunk (AAC: 1024 samples per channel).
    frame_size: usize,
    sample_rate: u32,
    /// Static facts surfaced by `info()` once the session worker (Phase E)
    /// reports the encoder chip per take.
    #[cfg_attr(not(test), allow(dead_code))]
    info: EncoderInfo,
}

/// pts (µs) → codec-context sample stamp, rounded to nearest sample.
fn pts_us_to_samples(pts_us: i64, sample_rate: u32) -> i64 {
    ((i128::from(pts_us) * i128::from(sample_rate) + 500_000) / 1_000_000) as i64
}

/// packet sample stamp → µs, rounded to the nearest microsecond.
fn samples_to_pts_us(samples: i64, sample_rate: u32) -> i64 {
    ((i128::from(samples) * 1_000_000 + i128::from(sample_rate) / 2) / i128::from(sample_rate))
        as i64
}

impl SwAac {
    /// Wraps an ALREADY-OPENED libavcodec context (the muxer opens it so
    /// the container's GLOBAL_HEADER hint applies before `avcodec_open2` —
    /// pipeline/muxer.rs owns that dance, same as the video leg).
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn from_open(audio: ff::encoder::Audio) -> Self {
        // AAC's frame size is fixed (1024); `.max(1)` keeps a hypothetical
        // variable-rate codec from zero-dividing the pts math.
        let frame_size = (audio.frame_size() as usize).max(1);
        let sample_rate = audio.rate().max(1);
        Self {
            audio,
            frame_size,
            sample_rate,
            info: EncoderInfo {
                backend: "aac",
                is_hardware: false,
            },
        }
    }

    /// The codec's fixed input chunk (AAC: 1024 samples) — the mixer's
    /// accumulator law (Phase E); unused until then in every build.
    #[allow(dead_code)]
    pub fn frame_size(&self) -> usize {
        self.frame_size
    }

    /// Pulls everything the codec has queued, converting sample stamps →
    /// µs. Queue-boundary semantics identical to sw_x264's drain.
    fn drain(&mut self) -> Result<Vec<EncodedPacket>, CoreError> {
        let mut packets = Vec::new();
        let mut packet = ff::Packet::empty();
        loop {
            match self.audio.receive_packet(&mut packet) {
                Ok(()) => {
                    let pts_samples = packet.pts().unwrap_or(0);
                    packets.push(EncodedPacket {
                        // The audio stream is index 1 in the two-stream take
                        // (the muxer builder adds video first).
                        stream: 1,
                        pts_us: samples_to_pts_us(pts_samples, self.sample_rate),
                        dts_us: packet
                            .dts()
                            .map(|dts| samples_to_pts_us(dts, self.sample_rate)),
                        key: packet.is_key(),
                        data: packet
                            .data()
                            .expect("a received packet always carries data")
                            .to_vec(),
                    });
                }
                Err(err) => {
                    let queue_boundary = match &err {
                        ff::Error::Eof => true,
                        ff::Error::Other { errno } => *errno == LINUX_EAGAIN,
                        _ => false,
                    };
                    if !queue_boundary {
                        tracing::error!(error = %err, "aac receive failed");
                        return Err(encode_failed());
                    }
                    break;
                }
            }
        }
        Ok(packets)
    }
}

impl AudioEncoder for SwAac {
    fn info(&self) -> EncoderInfo {
        self.info
    }

    /// `interleaved.len()` MUST equal `frame_size * 2` (the mixer
    /// accumulator owns that law; a violation is a caller bug and fails
    /// the chunk typed rather than silently truncating).
    fn encode(
        &mut self,
        pts_us: i64,
        interleaved: &[f32],
    ) -> Result<Vec<EncodedPacket>, CoreError> {
        if interleaved.len() != self.frame_size * crate::capture::audio::CHANNELS {
            return Err(encode_failed());
        }
        let frames = self.frame_size;
        // FLTP = planar float: two planes (L, R) of `frames` samples.
        // (`frame::audio::Audio` is ff's public constructor type; it
        // derefs to the internal `Frame` that `send_frame` accepts.)
        let mut frame = ff::frame::audio::Audio::new(
            ff::format::Sample::F32(ff::format::sample::Type::Planar),
            frames,
            ff::ChannelLayout::STEREO,
        );
        frame.set_rate(self.sample_rate);
        frame.set_samples(frames);
        // Codec-side pts counts samples from zero; the µs→samples
        // conversion keeps monotonicity (chunk stamps are monotonic µs).
        frame.set_pts(Some(pts_us_to_samples(pts_us, self.sample_rate)));
        // SAFETY: the frame was allocated above with 2 planar f32 planes
        // of exactly `frames` samples; `plane_mut::<f32>` returns the
        // slice over that owned buffer — no lifetime escapes this scope.
        // (Sequential single-plane writes — two simultaneous plane
        // borrows cannot coexist; `as_chunks::<2>` enforces the L/R law.)
        let lanes = interleaved.as_chunks::<2>().0;
        debug_assert_eq!(lanes.len(), frames);
        for (i, &[l, _]) in lanes.iter().enumerate() {
            frame.plane_mut::<f32>(0)[i] = l;
        }
        for (i, &[_, r]) in lanes.iter().enumerate() {
            frame.plane_mut::<f32>(1)[i] = r;
        }
        self.audio.send_frame(&frame).map_err(|err| {
            tracing::error!(error = %err, "aac send_frame failed");
            encode_failed()
        })?;
        self.drain()
    }

    /// EOF flush: any samples the codec buffered behind its frame size
    /// are drained here (AAC buffers at most one partial frame).
    fn finish(&mut self) -> Result<Vec<EncodedPacket>, CoreError> {
        self.audio.send_eof().map_err(|err| {
            tracing::error!(error = %err, "aac send_eof failed");
            encode_failed()
        })?;
        self.drain()
    }
}

fn encode_failed() -> CoreError {
    CoreError::encoder(
        "encoder.encode_failed",
        true,
        "The audio encoder failed while writing the recording.",
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /* pts conversion math — pure, no codec needed (the integration
    round-trip with a REAL muxed file lives in pipeline/session tests,
    which already run ffprobe against takes). */

    #[test]
    fn pts_conversions_round_trip_over_the_chunk_clock() {
        // 1024 samples @48k = 21_333.33… µs — chunk stamps are the
        // ROUNDED exact sample times (truncation would drift the round
        // trip by 1 µs on every other chunk); conversions must be exact
        // inverses over the whole take.
        for chunk in 0..100_i64 {
            let exact_us = chunk * 1_000_000 * 1024;
            let pts_us = (exact_us + 24_000) / 48_000; // nearest-µs stamp
            let samples = pts_us_to_samples(pts_us, 48_000);
            assert_eq!(samples, chunk * 1024);
            assert_eq!(samples_to_pts_us(samples, 48_000), pts_us);
        }
    }

    #[test]
    fn convert_rounds_to_nearest_sample() {
        // 1 µs at 48 kHz ≈ 0.048 samples → rounds to 0; a half-millisecond
        // (500 µs) is exactly 24 samples; half a sample ≈ 10.42 µs sits
        // inside the 0 bucket at that scale.
        assert_eq!(pts_us_to_samples(1, 48_000), 0);
        assert_eq!(pts_us_to_samples(500, 48_000), 24);
        assert_eq!(pts_us_to_samples(5000, 48_000), 240);
        // Boundary: exactly one half sample (10_416.67 µs → rounds up at
        // the first integer above it).
        assert_eq!(pts_us_to_samples(10_417, 48_000), 500);
    }
}
