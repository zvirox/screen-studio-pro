//! Recording-session meters and the event cadence law.
//!
//! ARCHITECTURE §6: "Event throttling is a contract: meters ≤30Hz, stats
//! 2s, ticks 1s — coalesced in Rust before emit; the webview never
//! receives per-frame events." This module owns the two halves of that
//! law: the GATE that decides when an event is due, and the METERS that
//! fill the `recording/stats` payload.
//!
//! Layering (ARCHITECTURE §2 tree law): the pipeline stays Tauri-agnostic.
//! The session pushes domain events ([`SessionEvent`]) into an injected
//! [`EventSink`]; the IPC layer owns the wire mapping (API §3 payloads)
//! and the Tauri emission.

use crate::util::error::IpcError;
use std::time::{Duration, Instant};

/// A cadence gate: at most one emission per period.
///
/// The first `due` call SEEDS the window (no emission) — the first event
/// lands one full period later, so "1 Hz" means one event per second,
/// not a burst at t=0 plus one per second afterwards.
pub struct Throttle {
    period: Duration,
    last: Option<Instant>,
}

impl Throttle {
    /// A gate with the given period (API §3: ticks 1 s, stats 2 s).
    pub fn new(period: Duration) -> Self {
        Self { period, last: None }
    }

    /// True when the period has elapsed since the last emission. A true
    /// result restarts the window — the cadence is a RATE, never a burst.
    pub fn due(&mut self, now: Instant) -> bool {
        match self.last {
            // First call: seed the window, emit nothing yet.
            None => {
                self.last = Some(now);
                false
            }
            Some(last) if now.saturating_duration_since(last) < self.period => false,
            Some(_) => {
                self.last = Some(now);
                true
            }
        }
    }
}

/// The `recording/stats` payload values (API §3).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct StatsSnapshot {
    /// Frames encoded per second over the window.
    pub fps: f64,
    /// Frames the capture tier dropped (the bus's own counter).
    pub dropped_frames: u64,
    /// Encoded bitrate over the window, kbps.
    pub bitrate_kbps: u64,
    /// Mean encode time per frame over the window, milliseconds.
    pub encode_time_ms: f64,
}

/// The fps/drop/bitrate meters (ARCHITECTURE §2 tree: "fps/drop/bitrate
/// meters → throttled events").
///
/// Pure accumulator: the caller owns the window clock, so the rates are
/// computed over an explicit [`Duration`] and stay testable.
#[derive(Debug, Default, Clone, Copy)]
pub struct StatsMeter {
    frames: u64,
    bytes: u64,
    encode_ns: u64,
}

impl StatsMeter {
    pub fn new() -> Self {
        Self::default()
    }

    /// One frame encoded and muxed: `bytes` of encoded payload and the
    /// time the encoder spent on it.
    pub fn record_frame(&mut self, bytes: usize, encode_time: Duration) {
        self.frames += 1;
        self.bytes += bytes as u64;
        self.encode_ns += encode_time.as_nanos() as u64;
    }

    /// The meters over a window of `window` length. `dropped_frames` is
    /// the capture tier's counter (it is cumulative, not per-window).
    pub fn snapshot(&self, dropped_frames: u64, window: Duration) -> StatsSnapshot {
        let secs = window.as_secs_f64();
        // A zero-length window has no rate to report (the first tick can
        // land in the same instant the window opened).
        let (fps, bitrate_kbps) = if secs > 0.0 {
            (
                self.frames as f64 / secs,
                ((self.bytes as f64 * 8.0) / secs / 1000.0).round() as u64,
            )
        } else {
            (0.0, 0)
        };
        let encode_time_ms = if self.frames > 0 {
            (self.encode_ns as f64 / self.frames as f64) / 1_000_000.0
        } else {
            0.0
        };
        StatsSnapshot {
            fps,
            dropped_frames,
            bitrate_kbps,
            encode_time_ms,
        }
    }

    /// Starts a fresh window (the caller restarts its clock too).
    pub fn reset(&mut self) {
        self.frames = 0;
        self.bytes = 0;
        self.encode_ns = 0;
    }
}

/// The domain events a recording session pushes (ARCHITECTURE §3.2 steps
/// 3–7). The IPC layer maps them onto the API §3 wire payloads.
#[derive(Debug, Clone)]
pub enum SessionEvent {
    /// `recording/tick` — 1 Hz. The phase is not carried: `recording_pause`
    /// has not landed, so every tick is a `recording` one.
    Tick {
        recording_id: String,
        elapsed_ms: u64,
    },
    /// `recording/stats` — 0.5 Hz.
    Stats(StatsSnapshot),
    /// `recording/error` — the API §1 standard error shape.
    Error(IpcError),
}

/// Where a session's events go.
///
/// The IPC layer injects a Tauri-backed sink; tests inject a recording
/// one. Emission failures never break the take — the sink decides.
pub trait EventSink: Send + Sync {
    fn emit(&self, event: SessionEvent);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn throttle_fires_once_per_period() {
        let mut gate = Throttle::new(Duration::from_secs(1));
        let t0 = Instant::now();
        // The first call seeds the window — no burst at t=0.
        assert!(!gate.due(t0), "the first window seeds the cadence");
        assert!(!gate.due(t0 + Duration::from_millis(999)));
        assert!(gate.due(t0 + Duration::from_secs(1)));
        // The window restarts at the emission: no second event inside it.
        assert!(!gate.due(t0 + Duration::from_millis(1_999)));
        assert!(gate.due(t0 + Duration::from_secs(2)));
    }

    #[test]
    fn meter_reports_fps_bitrate_and_encode_time_over_the_window() {
        let mut meter = StatsMeter::new();
        for _ in 0..60 {
            meter.record_frame(1_000, Duration::from_millis(5));
        }
        let snapshot = meter.snapshot(3, Duration::from_secs(1));
        assert_eq!(snapshot.fps, 60.0);
        assert_eq!(snapshot.dropped_frames, 3);
        // 60 × 1000 bytes/s = 480 000 bit/s = 480 kbps.
        assert_eq!(snapshot.bitrate_kbps, 480);
        // Mean encode time per frame.
        assert_eq!(snapshot.encode_time_ms, 5.0);

        meter.reset();
        let empty = meter.snapshot(0, Duration::from_secs(1));
        assert_eq!(empty.fps, 0.0);
        assert_eq!(empty.bitrate_kbps, 0);
        assert_eq!(empty.encode_time_ms, 0.0);
    }

    #[test]
    fn meter_survives_a_zero_length_window_without_dividing_by_zero() {
        let mut meter = StatsMeter::new();
        meter.record_frame(100, Duration::from_millis(1));
        let snapshot = meter.snapshot(0, Duration::ZERO);
        assert!(snapshot.fps.is_finite());
        assert_eq!(snapshot.bitrate_kbps, 0);
    }
}
