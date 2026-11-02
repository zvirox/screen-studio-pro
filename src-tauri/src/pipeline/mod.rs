#![allow(dead_code)]

/* Recording-session submodules need system ffmpeg dev libs (SETUP §3.1);
they default on since task 1.3. `--no-default-features` still builds the
capture/settings/library paths without them. */
#[cfg(feature = "encode")]
pub mod muxer;
#[cfg(feature = "encode")]
pub mod session;

use std::cell::UnsafeCell;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};

/* Video frame bus — ARCHITECTURE §2 tree: this module is the capture →
encode handoff. §6 laws implemented here:
- "Buses, not copies": one SpScQueue-style ring, single producer (the
  PipeWire consumer thread, capture/pipewire.rs) → single consumer (the
  recording session's encoder thread, task 1.3).
- "Memory / bounded channels": the ring is fixed-capacity — length cannot
  grow, ever (the §6 test backstop lives in the tests below).
- Backpressure PRECEDENCE (§6): preview-grade frames drop before encode
  frames. The preview stills channel (latest-frame mailbox, 1.5) is the
  drop-oldest tier; THIS bus is the protected encode tier — when the
  encoder falls behind, `try_push` hands the NEWEST frame back and the
  producer decides (retry = no loss; give up = count it via
  `mark_dropped`). Dropping newest keeps the surviving sequence
  contiguous for the muxer's pts. The PipeWire data thread can never
  block, so its 1.3 wiring gives up immediately and marks — OBS's
  "lagged frames" policy.
- Frames NEVER cross the IPC (API §6 standing flag): payloads stay in
  this process; stats counters (pushed/dropped) feed pipeline/stats.rs.

Lock-free by design (the "mutex-less" bit of PLAN 1.2): producer and
consumer each own one ring index; ordering is Release-publish on write,
Acquire-observe on read. No std Mutex touches the frame path. The
encoder wiring lands with task 1.3; until then dead_code is anticipated,
same as ipc/events.rs. */

/// Pixel layout of a raw frame from the capture stream. Mirrors the spa
/// VideoFormat ids we offer in capture/pipewire.rs; the sw encoder (1.3)
/// maps these to source pix_fmts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FrameLayout {
    /// 32 bpp BGRX (4th byte unused) — the KWin default offer.
    Bgrx,
    /// 32bpp BGRA — KWin's alternate offer.
    Bgra,
}

impl FrameLayout {
    /// Bytes per pixel for packed raw frames.
    pub fn bpp(&self) -> usize {
        4
    }
}

/// One raw video frame. `stride` is the row pitch in bytes — PipeWire
/// chunks may pad rows, so reading pixels must skip `stride - width*bpp`
/// per row (lesson from the portal capture runs).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Frame {
    pub width: u32,
    pub height: u32,
    pub stride: u32,
    pub layout: FrameLayout,
    /// Monotonic microseconds at capture time — muxer pts (task 1.3).
    pub pts_us: u64,
    /// Packed pixel data, `stride * height` bytes expected.
    pub data: Vec<u8>,
}

/* ---------- the SpSC ring ---------- */

/// Result variants of [`FrameBus::try_push`]; `Full` hands the frame BACK
/// to the producer so the caller decides (count → tracing) and the frame's
/// allocation can be recycled by the capture loop (§6: one alloc per frame
/// max, pooling joins with the encoder consumer in 1.3).
#[derive(Debug)]
pub enum Push {
    Pushed,
    /// Ring full — frame NOT enqueued. See the module docs for the
    /// encode-tier policy (drop newest, claim via counters).
    Full(Frame),
}

/// Capacity must be a power of two (index masking); tiny on purpose —
/// 1080p BGRx frames are ~8 MB, so 60 slots ≈ 500 MB, and §6 caps RSS at
/// ~150 MB. 8 slots ≈ 133 ms of buffered video at 60 fps — enough to
/// ride out a scheduler hiccup while keeping the worst-case stall bounded.
pub const DEFAULT_CAPACITY: usize = 8;

pub struct FrameBus {
    slots: UnsafeCell<Vec<Option<Frame>>>,
    capacity: usize,
    /// Producer-owned write cursor (monotonic, NOT masked).
    head: AtomicUsize,
    /// Consumer-owned read cursor (monotonic, NOT masked).
    tail: AtomicUsize,
    /// Set once from the recording-session side; the consumer pops
    /// remaining frames, then observes shutdown.
    closed: AtomicBool,
    /// §6 stats discipline: total frames ever enqueued + ever dropped.
    pushed: AtomicU64,
    dropped: AtomicU64,
}

// SAFETY: the ring is a classic SPSC — `head`, `pushed`, `dropped` are
// written ONLY by the producer (single, per contract), `tail` ONLY by the
// consumer, `closed` is a one-way latch. Slot access is mutually exclusive:
// the producer writes only slots the consumer has already published as
// free (tail-advanced), the consumer reads only slots the producer has
// published as ready (head-advanced), both arriving via Release/Acquire on
// the published cursor. Send+Sync are therefore sound.
unsafe impl Send for FrameBus {}
unsafe impl Sync for FrameBus {}

impl FrameBus {
    pub fn new(capacity: usize) -> Self {
        assert!(
            capacity.is_power_of_two() && capacity >= 1,
            "ring capacity must be a power of two"
        );
        Self {
            slots: UnsafeCell::new((0..capacity).map(|_| None).collect()),
            capacity,
            head: AtomicUsize::new(0),
            tail: AtomicUsize::new(0),
            closed: AtomicBool::new(false),
            pushed: AtomicU64::new(0),
            dropped: AtomicU64::new(0),
        }
    }

    /// Producer side: enqueue one frame, or hand it back if the ring is
    /// full (count it via [`FrameBus::dropped`], then free/reuse it).
    pub fn try_push(&self, frame: Frame) -> Push {
        let head = self.head.load(Ordering::Relaxed);
        let tail = self.tail.load(Ordering::Acquire);
        if head.wrapping_sub(tail) == self.capacity || self.closed.load(Ordering::Acquire) {
            return Push::Full(frame);
        }
        // SAFETY: slot at `head % cap` is free — the consumer has popped a
        // frame from it (tail advanced past it, Acquire above proves the
        // read is complete) and the producer is the only writer of slots
        // not yet consumed... precisely: in-range slots are unwritten or
        // fully consumed; this one is the newest in that set.
        let slots = unsafe { &mut *self.slots.get() };
        slots[head % self.capacity] = Some(frame);
        // Publish AFTER the payload is in the slot — consumers observing
        // head must never see a half-written frame.
        self.head.store(head.wrapping_add(1), Ordering::Release);
        self.pushed.fetch_add(1, Ordering::Relaxed);
        Push::Pushed
    }

    /// Consumer side: dequeue the oldest frame, unless empty. `None` with
    /// `is_closed()` means drained shutdown, not a stall.
    pub fn try_pop(&self) -> Option<Frame> {
        let tail = self.tail.load(Ordering::Relaxed);
        let head = self.head.load(Ordering::Acquire);
        if tail == head {
            return None;
        }
        // SAFETY: slot at `tail % cap` is published-ready (head advanced
        // past it with Release above proving the write completed) and only
        // the consumer reads/pops it.
        let slots = unsafe { &mut *self.slots.get() };
        let frame = slots[tail % self.capacity].take();
        self.tail.store(tail.wrapping_add(1), Ordering::Release);
        frame
    }

    /// Frames currently buffered (drains toward 0; can never exceed the
    /// capacity — the §6 bounded-growth invariant, asserted in tests).
    pub fn len(&self) -> usize {
        let tail = self.tail.load(Ordering::Acquire);
        self.head.load(Ordering::Acquire).wrapping_sub(tail)
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// One-way latch (recording session stop): pushes are refused after
    /// this; the consumer drains what's left, then sees shutdown.
    pub fn close(&self) {
        self.closed.store(true, Ordering::Release);
    }

    /// Producer records a frame as PERMANENTLY lost (backpressure give-up
    /// or close-refusal). Not called by `try_push` — a transient full ring
    /// that the producer retries from must not pollute §6 drop stats.
    pub fn mark_dropped(&self) {
        self.dropped.fetch_add(1, Ordering::Relaxed);
    }

    pub fn is_closed(&self) -> bool {
        self.closed.load(Ordering::Acquire)
    }

    /// Total enqueued since creation (stats.rs feed, §6).
    pub fn pushed(&self) -> u64 {
        self.pushed.load(Ordering::Relaxed)
    }

    /// Total dropped at the full-ring boundary (stats.rs feed, §6; the
    /// recording/stats `dropped_frames` field rides on this).
    pub fn dropped(&self) -> u64 {
        self.dropped.load(Ordering::Relaxed)
    }
}

impl std::fmt::Debug for FrameBus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("FrameBus")
            .field("capacity", &self.capacity)
            .field("len", &self.len())
            .field("pushed", &self.pushed())
            .field("dropped", &self.dropped())
            .field("closed", &self.is_closed())
            .finish()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    /// §6 default: 8 slots — bounded by design, power of two.
    fn frame(n: u64) -> Frame {
        Frame {
            width: 1920,
            height: 1080,
            stride: 1920 * 4,
            layout: FrameLayout::Bgrx,
            pts_us: n * 16_666, // ~60 fps cadence
            data: vec![0u8; 4 * 4],
        }
    }

    #[test]
    fn handoff_is_fifo_and_lossless_below_capacity() {
        let bus = FrameBus::new(4);
        for n in 0..4u64 {
            assert!(matches!(bus.try_push(frame(n)), Push::Pushed));
        }
        assert_eq!(bus.len(), 4);
        for n in 0..4u64 {
            let popped = bus.try_pop().expect("frame present");
            assert_eq!(popped.pts_us, n * 16_666, "_fifo order");
        }
        assert!(bus.is_empty());
        assert_eq!(bus.dropped(), 0);
    }

    #[test]
    fn backpressure_never_grows_beyond_capacity_and_counts_drops() {
        // §6 memory-law backstop: N = 3× capacity pushes with no consumer.
        let bus = FrameBus::new(4);
        let n_total = 12;
        let mut refused = 0u64;
        for n in 0..n_total {
            if let Push::Full(rejected) = bus.try_push(frame(n)) {
                refused += 1;
                // The frame comes back; the producer marks it lost (its
                // policy: no retry in this test).
                bus.mark_dropped();
                assert_eq!(rejected.pts_us, n * 16_666);
                drop(rejected);
            }
        }
        assert_eq!(bus.len(), 4, "len is capped at capacity — never grows");
        assert_eq!(bus.dropped(), refused);
        assert_eq!(bus.pushed() + refused, n_total);
        // Draining yields exactly the capacity survivors, in FIFO order.
        for n in 0..4u64 {
            assert_eq!(bus.try_pop().expect("survivor").pts_us, n * 16_666);
        }
        assert!(bus.try_pop().is_none());
    }

    #[test]
    fn producer_consumer_handoff_across_threads_keeps_order() {
        let bus = Arc::new(FrameBus::new(8));
        const N: u64 = 5_000;
        let producer = {
            let bus = bus.clone();
            std::thread::spawn(move || {
                for n in 0..N {
                    loop {
                        match bus.try_push(frame(n)) {
                            Push::Pushed => break,
                            Push::Full(_f) => std::hint::spin_loop(),
                        }
                    }
                }
            })
        };
        let consumer = {
            let bus = bus.clone();
            std::thread::spawn(move || {
                let mut last_pts = None;
                let mut count = 0u64;
                while count < N {
                    if let Some(frame) = bus.try_pop() {
                        if let Some(prev) = last_pts {
                            assert!(frame.pts_us > prev, "strictly increasing pts");
                        }
                        last_pts = Some(frame.pts_us);
                        count += 1;
                    } else {
                        std::hint::spin_loop();
                    }
                }
                count
            })
        };
        producer.join().expect("producer ok");
        assert_eq!(consumer.join().expect("consumer ok"), N);
        assert_eq!(bus.pushed(), N);
        assert_eq!(bus.dropped(), 0);
        assert!(bus.is_empty());
    }

    #[test]
    fn close_refuses_new_frames_and_signals_drained_shutdown() {
        let bus = FrameBus::new(2);
        assert!(matches!(bus.try_push(frame(0)), Push::Pushed));
        bus.close();
        assert!(bus.is_closed());
        match bus.try_push(frame(1)) {
            Push::Full(_) => {
                // Producer policy after stop: the frame is permanently lost.
                bus.mark_dropped();
            }
            Push::Pushed => panic!("push after close must be refused"),
        }
        assert_eq!(bus.dropped(), 1);
        // Remaining frames still drain; then the consumer sees shutdown.
        assert_eq!(bus.try_pop().expect("drains closure").pts_us, 0);
        assert!(bus.try_pop().is_none());
        assert!(bus.is_closed());
    }

    #[test]
    #[should_panic(expected = "power of two")]
    fn capacity_must_be_a_power_of_two() {
        let _ = FrameBus::new(7);
    }
}
