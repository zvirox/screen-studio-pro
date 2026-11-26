//! Phase 12.2 — sub-millisecond pipeline latency tracing. Four timestamps
//! ride each encoded packet so the worker can report where time went:
//! CTS (capture/composition), FER (frame encode request), FERC (encode
//! complete), PIR (packet interleaved into the container). All µs on the
//! same monotonic clock; the stage deltas are the diagnostic.

/// The four latency timestamps for one packet (µs, monotonic).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct LatencyTrace {
    pub cts_us: u64,
    pub fer_us: u64,
    pub ferc_us: u64,
    pub pir_us: u64,
}

impl LatencyTrace {
    /// Encode stage: FERC − FER (time in the encoder).
    pub fn encode_us(&self) -> u64 {
        self.ferc_us.saturating_sub(self.fer_us)
    }
    /// Mux stage: PIR − FERC (time waiting to be interleaved).
    pub fn mux_us(&self) -> u64 {
        self.pir_us.saturating_sub(self.ferc_us)
    }
    /// End-to-end: PIR − CTS (capture to container).
    pub fn total_us(&self) -> u64 {
        self.pir_us.saturating_sub(self.cts_us)
    }
}

/// Rolling per-stage averages for the stats emit (µs). Pure accumulator.
#[derive(Debug, Default)]
pub struct LatencyMeter {
    encode_sum: u64,
    mux_sum: u64,
    total_sum: u64,
    n: u64,
}

impl LatencyMeter {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn record(&mut self, trace: &LatencyTrace) {
        self.encode_sum += trace.encode_us();
        self.mux_sum += trace.mux_us();
        self.total_sum += trace.total_us();
        self.n += 1;
    }

    /// Mean (encode, mux, total) latency in µs over the recorded packets.
    pub fn averages_us(&self) -> (u64, u64, u64) {
        if self.n == 0 {
            return (0, 0, 0);
        }
        (
            self.encode_sum / self.n,
            self.mux_sum / self.n,
            self.total_sum / self.n,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stage_deltas_are_ordered() {
        let t = LatencyTrace {
            cts_us: 1_000,
            fer_us: 1_100,
            ferc_us: 1_150,
            pir_us: 1_200,
        };
        assert_eq!(t.encode_us(), 50);
        assert_eq!(t.mux_us(), 50);
        assert_eq!(t.total_us(), 200);
    }

    #[test]
    fn meter_averages_over_packets() {
        let mut m = LatencyMeter::new();
        m.record(&LatencyTrace {
            cts_us: 0,
            fer_us: 10,
            ferc_us: 20,
            pir_us: 30,
        });
        m.record(&LatencyTrace {
            cts_us: 0,
            fer_us: 10,
            ferc_us: 30,
            pir_us: 50,
        });
        assert_eq!(m.averages_us(), (15, 15, 40));
    }

    #[test]
    fn saturating_underflow_is_zero() {
        let t = LatencyTrace {
            cts_us: 100,
            fer_us: 50,
            ferc_us: 50,
            pir_us: 50,
        };
        assert_eq!(t.encode_us(), 0);
        assert_eq!(t.total_us(), 0);
    }
}
