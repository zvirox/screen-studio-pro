//! Phase 11.2 — real-time RNNoise voice isolation for the mic.
//!
//! `nnnoiseless` is a pure-Rust port of Xiph's RNNoise: 48 kHz mono,
//! 480-sample (10 ms) frames, returns a denoised frame + a VAD score. The
//! wrapper downmixes the interleaved-stereo mic to mono, denoises complete
//! 480-sample blocks, and re-emits stereo (mono duplicated). A partial tail
//! (<480) is carried to the next call, so the added latency is under one
//! 10 ms block (< 15 ms, PRD §8). Behind the `encode` feature (the dep is
//! optional); non-encode builds capture raw.

use crate::capture::audio::CHANNELS;

const FRAME: usize = nnnoiseless::FRAME_SIZE;

/// Per-mic RNNoise state + mono accumulator. Lives in the capture callback
/// thread; never shared.
pub struct Denoise {
    state: Box<nnnoiseless::DenoiseState<'static>>,
    acc: Vec<f32>,
}

impl Denoise {
    pub fn new() -> Self {
        Self {
            state: nnnoiseless::DenoiseState::new(),
            acc: Vec::with_capacity(FRAME * 2),
        }
    }

    /// Consume one interleaved-stereo buffer and return the denoised stereo
    /// samples for every COMPLETE 480-sample block (the tail is carried).
    pub fn process(&mut self, interleaved: &[f32]) -> Vec<f32> {
        for frame in interleaved.as_chunks::<2>().0 {
            self.acc.push((frame[0] + frame[1]) * 0.5);
        }
        let mut out: Vec<f32> = Vec::with_capacity(self.acc.len() / FRAME * FRAME * CHANNELS);
        let mut input = [0.0f32; FRAME];
        let mut output = [0.0f32; FRAME];
        while self.acc.len() >= FRAME {
            input.copy_from_slice(&self.acc[..FRAME]);
            self.acc.drain(..FRAME);
            let _vad = self.state.process_frame(&mut output, &input);
            for &mono in output.iter() {
                out.push(mono);
                out.push(mono);
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn carries_a_partial_tail_until_a_full_frame() {
        let mut d = Denoise::new();
        // 240 stereo frames (half a 480 block) -> no output yet.
        let half = vec![0.1f32; 240 * 2];
        assert!(d.process(&half).is_empty(), "partial block is carried");
        // Another 240 frames completes one block -> 480 stereo samples out.
        let out = d.process(&half);
        assert_eq!(out.len(), FRAME * CHANNELS, "one full denoised block");
    }

    #[test]
    fn output_is_stereo_duplicated_mono() {
        let mut d = Denoise::new();
        let input = vec![0.2f32; FRAME * CHANNELS];
        let out = d.process(&input);
        assert_eq!(out.len(), FRAME * CHANNELS);
        assert!(
            out.as_chunks::<2>().0.iter().all(|c| c[0] == c[1]),
            "L == R"
        );
    }
}
