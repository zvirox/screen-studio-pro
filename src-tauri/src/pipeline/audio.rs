//! Audio handoff — the 2.1 counterpart of the video [`FrameBus`]:
//! one capture producer (mic or desktop stream callback) → one consumer
//! (the recording session's audio mixer/encoder thread).
//!
//! §6 laws implemented (mirroring pipeline/mod.rs):
//! - "Buses, not copies": one bounded SpSc ring, lock-free — producer owns
//!   the write cursor, consumer the read cursor, Release-publish /
//!   Acquire-observe, no std Mutex on the media path.
//! - Backpressure: the ring is FIXED capacity; try_push drops NEWEST and
//!   counts (the producer cannot wait — it runs on a PipeWire/cpal
//!   real-time callback).
//! - API §6 standing flag: samples stay in this process; only counters
//!   reach the stats layer.

use std::cell::UnsafeCell;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};

/// Default capacity in SAMPLES (interleaved stereo f32): 2^16 samples =
/// 32 Ki stereo frames ≈ 683 ms at 48 kHz. Roomy enough to ride out a
/// scheduler hiccup on the mixer thread, small enough that a stalled
/// consumer never balloons memory (§6).
pub const DEFAULT_RING_CAPACITY: usize = 1 << 16;

/// The audio SpSc ring. All cursor/counter invariants are the FrameBus
/// ones (pipeline/mod.rs); this ring moves f32 SAMPLES in frame-aligned
/// calls instead of owned frames.
pub struct AudioRing {
    /// Interleaved stereo sample slots; length = capacity, power of two
    /// (index masking, same law as the video bus).
    buf: UnsafeCell<Box<[f32]>>,
    /// Producer-owned write cursor (monotonic, NOT masked; video: head).
    head: AtomicUsize,
    /// Consumer-owned read cursor (monotonic, NOT masked; video: tail).
    tail: AtomicUsize,
    /// Capacity mask — `capacity - 1`.
    mask: usize,
    /// Producer-lost latch (device gone mid-take): the consumer stops
    /// treating emptiness as a stall and pads silence instead.
    disabled: AtomicBool,
    /// §6 stats discipline: samples dropped at the full-ring boundary.
    dropped: AtomicU64,
}

// SAFETY: classic SPSC — `head` and `dropped` are written ONLY by the
// single producer thread, `tail` ONLY by the single consumer thread;
// `disabled` is a one-way AtomicBool latch. Slot access is mutually
// exclusive: the producer writes only positions the consumer has already
// published as free (tail-advanced), the consumer reads only positions
// the producer has published as ready (head-advanced), both arriving via
// Release/Acquire on the published cursor. Samples are plain f32 (no
// interior mutability beyond the slot handoff). Send+Sync are therefore
// sound: one producer, one consumer is enforced by construction sites
// (capture callbacks → session mixer), the same discipline FrameBus uses.
unsafe impl Send for AudioRing {}
unsafe impl Sync for AudioRing {}

impl AudioRing {
    /// `capacity` is in SAMPLES and must be a power of two.
    pub fn new(capacity: usize) -> Self {
        assert!(
            capacity.is_power_of_two() && capacity >= 2,
            "audio ring capacity must be a power of two (samples)"
        );
        Self {
            buf: UnsafeCell::new(vec![0.0f32; capacity].into_boxed_slice()),
            head: AtomicUsize::new(0),
            tail: AtomicUsize::new(0),
            mask: capacity - 1,
            disabled: AtomicBool::new(false),
            dropped: AtomicU64::new(0),
        }
    }

    /// Producer side: pushes interleaved samples (caller keeps them
    /// FRAME-ALIGNED — even count). Returns the number of FRAMES pushed;
    /// when the ring fills mid-call, the remainder of THIS window is
    /// dropped NEWEST and counted (§6: the producer never blocks; a
    /// full ring means the mixer stalled, so all newly arriving audio
    /// is lost the way OBS loses capture on XRUN).
    pub fn try_push(&self, samples: &[f32]) -> usize {
        let head = self.head.load(Ordering::Relaxed);
        let tail = self.tail.load(Ordering::Acquire);
        let free = capacity_of(self.mask) - head.wrapping_sub(tail);
        let fit = (samples.len() / 2).min(free / 2);
        if self.disabled.load(Ordering::Acquire) {
            return 0;
        }
        // SAFETY: the producer is the ONLY writer of positions in
        // [tail+capacity, head) — i.e. slots the consumer has released.
        // Each slot index below is strictly free per the `fit` bound.
        let buf = unsafe { &mut *self.buf.get() };
        for frame in 0..fit {
            buf[(head.wrapping_add(frame * 2)) & self.mask] = samples[frame * 2];
            buf[(head.wrapping_add(frame * 2 + 1)) & self.mask] = samples[frame * 2 + 1];
        }
        // Publish AFTER the samples are in their slots — the consumer
        // observing head must never read a half-written window.
        self.head
            .store(head.wrapping_add(fit * 2), Ordering::Release);
        // Samples of this call's tail that did not fit are dropped newest.
        let dropped_frames = samples.len() / 2 - fit;
        if dropped_frames > 0 {
            self.dropped
                .fetch_add(dropped_frames as u64, Ordering::Relaxed);
        }
        fit
    }

    /// Consumer side: drains up to `out.len()` samples into `out`,
    /// returning how many were copied (caller keeps windows frame-aligned;
    /// the returned count will be even for even windows). Empty ring → 0.
    pub fn pop(&self, out: &mut [f32]) -> usize {
        let tail = self.tail.load(Ordering::Relaxed);
        let head = self.head.load(Ordering::Acquire);
        let avail = head.wrapping_sub(tail);
        let take = out.len().min(avail);
        if take == 0 {
            return 0;
        }
        // SAFETY: positions [tail, tail+take) are published-ready (the
        // producer advanced head past them, Release above proves the
        // writes completed) and only the consumer reads them. Masked
        // indices wrap past `capacity` onto slots already consumed —
        // still owned by this side.
        let buf = unsafe { &*self.buf.get() };
        for (i, slot) in out.iter_mut().take(take).enumerate() {
            *slot = buf[(tail.wrapping_add(i)) & self.mask];
        }
        self.tail.store(tail.wrapping_add(take), Ordering::Release);
        take
    }

    /// Samples currently buffered (even for frame-aligned use; can never
    /// exceed the capacity — the §6 bounded-growth invariant, asserted
    /// in tests).
    pub fn len(&self) -> usize {
        let tail = self.tail.load(Ordering::Acquire);
        self.head.load(Ordering::Acquire).wrapping_sub(tail)
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Producer-lost latch (channel fails mid-take): future pushes are
    /// refused; the mixer pads silence for this channel. Idempotent.
    pub fn disable(&self) {
        self.disabled.store(true, Ordering::Release);
    }

    pub fn is_disabled(&self) -> bool {
        self.disabled.load(Ordering::Acquire)
    }

    /// Total FRAMES dropped at the full-ring boundary (stats feed).
    pub fn dropped(&self) -> u64 {
        self.dropped.load(Ordering::Relaxed)
    }
}

/// Capacity in samples (the struct's masked width, `mask + 1`) — the
/// producer side computes free space against it.
fn capacity_of(mask: usize) -> usize {
    mask.wrapping_add(1)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frames(values: &[f32]) -> Vec<f32> {
        // Mono helper: duplicate every sample to L/R interleave.
        values.iter().flat_map(|v| [*v, *v]).collect()
    }

    #[test]
    fn push_pop_round_trips_in_order() {
        let ring = AudioRing::new(16);
        let pushed = ring.try_push(&frames(&[0.1, 0.2, 0.3]));
        assert_eq!(pushed, 3, "frames pushed");
        let mut out = [0.0f32; 6];
        assert_eq!(ring.pop(&mut out), 6, "samples popped");
        assert_eq!(out, frames(&[0.1, 0.2, 0.3]).as_slice());
    }

    #[test]
    fn ring_wraps_across_the_mask() {
        // Capacity 16 samples = 8 frames. Push 4, pop 2 frames, push 3
        // more: the write cursor wraps over the mask while the tail
        // follows, proving masked (non-linear) indexing.
        let ring = AudioRing::new(16);
        assert_eq!(ring.try_push(&frames(&[1.0, 2.0, 3.0, 4.0])), 4);
        let mut out = [0.0f32; 4];
        assert_eq!(ring.pop(&mut out), 4);
        assert_eq!(ring.try_push(&frames(&[5.0, 6.0, 7.0])), 3);
        let mut rest = [0.0f32; 10];
        assert_eq!(ring.pop(&mut rest), 10);
        assert_eq!(rest, frames(&[3.0, 4.0, 5.0, 6.0, 7.0]).as_slice());
    }

    #[test]
    fn full_ring_drops_newest_and_counts() {
        let ring = AudioRing::new(8); // 4 frames of room
        assert_eq!(ring.try_push(&frames(&[1.0, 2.0, 3.0, 4.0])), 4);
        // Ring full: the whole 2-frame call is dropped (drop-newest
        // policy) and counted — the mixer stalled, the live tail loses.
        assert_eq!(ring.try_push(&frames(&[5.0, 6.0])), 0);
        assert_eq!(ring.dropped(), 2, "dropped frames counted");
        let mut out = [0.0f32; 10];
        assert_eq!(ring.pop(&mut out), 8, "ring holds exactly its capacity");
        assert_eq!(out[..8].to_vec(), frames(&[1.0, 2.0, 3.0, 4.0]).as_slice());
    }

    #[test]
    fn buffered_len_is_bounded_by_capacity() {
        let ring = AudioRing::new(8);
        // Far more pushed than capacity: len must stay ≤ 8 (§6 invariant).
        let window = vec![0.5f32; 100];
        for _ in 0..10 {
            ring.try_push(&window);
        }
        assert!(ring.len() <= 8, "bounded growth, got {}", ring.len());
        assert!(ring.dropped() > 0);
    }

    #[test]
    fn disabled_ring_refuses_and_reports() {
        let ring = AudioRing::new(8);
        ring.disable();
        assert!(ring.is_disabled());
        assert_eq!(ring.try_push(&frames(&[1.0])), 0, "disabled pushes refused");
        assert!(ring.is_empty());
    }

    #[test]
    fn pop_on_empty_is_zero_not_stall() {
        let ring = AudioRing::new(8);
        let mut out = [0.0f32; 4];
        assert_eq!(ring.pop(&mut out), 0);
    }

    /// The SPSC soundness smoke test: two threads hammer the ring
    /// concurrently (producer pushes sequenced values, consumer pops
    /// and verifies order). Catches cursor/mask races a single-thread
    /// test cannot. Loosely timed — the consumer polling-drains.
    #[test]
    fn concurrent_producer_consumer_stays_ordered() {
        const FRAMES: usize = 20_000;
        let ring = std::sync::Arc::new(AudioRing::new(64));
        let producer_ring = ring.clone();
        let producer = std::thread::spawn(move || {
            for n in 0..FRAMES {
                let v = n as f32;
                while producer_ring.try_push(&[v, v]) == 0 {
                    if producer_ring.is_disabled() {
                        return;
                    }
                    std::hint::spin_loop();
                }
            }
        });
        let mut seen = 0usize;
        let mut buf = vec![0.0f32; 32];
        while seen < FRAMES {
            let got = ring.pop(&mut buf);
            for &[l, r] in buf[..got].as_chunks::<2>().0 {
                assert_eq!(l, r, "frame integrity");
                assert_eq!(l, seen as f32, "FIFO order across the mask (frame {seen})");
                seen += 1;
            }
            std::hint::spin_loop();
        }
        producer.join().expect("producer thread");
    }
}

/* ---------- mix glue (2.1 Phase E) ---------- */

/// One mix pass pulls this many SAMPLES per channel (interleaved stereo
/// @ 48 kHz): 960 = 10 ms — the mixer's hop size. Small enough that the
/// AAC chunk accumulator refills predictably; large enough that per-window
/// overhead is noise.
pub const MIX_WINDOW_SAMPLES: usize = 960;

/// One channel in the pre-mix fold: the ring its producer feeds and the
/// linear gain (level/100) snapshotted from Settings at recording_start.
pub struct MixSource {
    pub ring: Arc<AudioRing>,
    pub gain: f32,
}

use std::sync::Arc;

/// Pops up to `window_samples` from every source ring and folds them
/// through the capture-side mix law (`capture::audio::mix_chunks`): the
/// window length is the LONGEST pop, shorter channels are padded with
/// silence, everything is clipped at 0 dBFS. Empty on all-empty cycles —
/// the caller must NOT encode a chunk from nothing.
///
/// Zero-gain sources are still POPPED (drained) even though they
/// contribute nothing — skipping the pop would let a muted ring fill
/// and record mutes as §6 data loss in the dropped counter.
pub fn mix_rings(sources: &[MixSource], window_samples: usize) -> Vec<f32> {
    let mut popped: Vec<Vec<f32>> = Vec::with_capacity(sources.len());
    let mut max_len = 0usize;
    for source in sources {
        let mut buf = vec![0.0f32; window_samples];
        let got = source.ring.pop(&mut buf);
        buf.truncate(got);
        max_len = max_len.max(got);
        popped.push(buf);
    }
    if max_len == 0 {
        return Vec::new();
    }
    let contribs: Vec<crate::capture::audio::Contribution<'_>> = popped
        .iter()
        .zip(sources.iter())
        .map(|(samples, source)| (source.gain, samples.as_slice()))
        .collect();
    crate::capture::audio::mix_chunks(&contribs, max_len)
}

#[cfg(test)]
mod mix_tests {
    use super::*;

    fn frames(values: &[f32]) -> Vec<f32> {
        values.iter().flat_map(|v| [*v, *v]).collect()
    }

    #[test]
    fn mixes_two_rings_with_gains() {
        // 10 ms window = 20 samples here (small override for the test);
        // ring A: one mono duplicating frame @ gain 1.0, ring B @ 0.5.
        let window = 4; // 2 stereo frames
        let ring_a = Arc::new(AudioRing::new(64));
        let ring_b = Arc::new(AudioRing::new(64));
        ring_a.try_push(&frames(&[0.5, 0.5]));
        ring_b.try_push(&frames(&[0.4, 0.4]));
        let mix = mix_rings(
            &[
                MixSource {
                    ring: ring_a.clone(),
                    gain: 1.0,
                },
                MixSource {
                    ring: ring_b.clone(),
                    gain: 0.5,
                },
            ],
            window,
        );
        assert_eq!(mix, vec![0.7, 0.7, 0.7, 0.7]);
        // Both rings fully drained by the mix pass.
        assert!(ring_a.is_empty() && ring_b.is_empty());
    }

    #[test]
    fn uneven_pops_pad_shorter_rings_with_silence() {
        let window = 4;
        let ring_a = Arc::new(AudioRing::new(64));
        let ring_b = Arc::new(AudioRing::new(64));
        ring_a.try_push(&frames(&[0.5, 0.5, 0.5, 0.5]));
        ring_b.try_push(&[1.0, 1.0]); // exactly ONE interleaved stereo frame
        let mix = mix_rings(
            &[
                MixSource {
                    ring: ring_a.clone(),
                    gain: 1.0,
                },
                MixSource {
                    ring: ring_b.clone(),
                    gain: 1.0,
                },
            ],
            window,
        );
        // B contributes its frame then silence for the second — the pad
        // law, not truncation (a channel that underruns this cycle
        // contributes zeros for the window it missed). Frame 1 sums to
        // 1.5 and clips at 0 dBFS.
        assert_eq!(mix, vec![1.0, 1.0, 0.5, 0.5]);
    }

    #[test]
    fn all_empty_rings_yield_no_window() {
        let ring_a = Arc::new(AudioRing::new(64));
        let mix = mix_rings(
            &[MixSource {
                ring: ring_a,
                gain: 1.0,
            }],
            MIX_WINDOW_SAMPLES,
        );
        assert!(mix.is_empty(), "an empty mix cycle produces NO chunk");
    }

    #[test]
    fn zero_gain_channel_is_still_drained_but_silent() {
        let ring_a = Arc::new(AudioRing::new(64));
        let ring_muted = Arc::new(AudioRing::new(64));
        ring_a.try_push(&frames(&[0.5, 0.5]));
        ring_muted.try_push(&frames(&[0.9, 0.9]));
        let mix = mix_rings(
            &[
                MixSource {
                    ring: ring_a.clone(),
                    gain: 1.0,
                },
                MixSource {
                    ring: ring_muted.clone(),
                    gain: 0.0,
                },
            ],
            4,
        );
        assert_eq!(mix, vec![0.5, 0.5, 0.5, 0.5]);
        // Drained despite being muted — otherwise the ring would fill
        // and the dropped counter would record MUTES as data loss (§6).
        assert!(ring_muted.is_empty());
    }
}
