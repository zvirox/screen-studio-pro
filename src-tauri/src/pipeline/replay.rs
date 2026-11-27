//! Phase 13.2 — instant replay buffer. A bounded RAM ring of the most recent
//! encoded packets (the last N seconds); "save replay" drains it to a file.
//! Pure accumulator over [`EncodedPacket`]: the caller pushes every encoded
//! packet and the buffer evicts anything older than the age window, so the
//! memory stays bounded by time, not by take length.

use std::collections::VecDeque;

use crate::encode::EncodedPacket;

/// The replay ring: encoded packets within `max_age_us` of the newest.
pub struct ReplayBuffer {
    packets: VecDeque<EncodedPacket>,
    max_age_us: u64,
}

impl ReplayBuffer {
    /// `max_age_us` is the replay window (e.g. 30 s = 30_000_000 µs).
    pub fn new(max_age_us: u64) -> Self {
        Self {
            packets: VecDeque::new(),
            max_age_us,
        }
    }

    /// Push one encoded packet, evicting anything older than the window
    /// (measured against the newest packet's pts). Packets must arrive in
    /// non-decreasing pts order (the encode loop guarantees it).
    pub fn push(&mut self, packet: EncodedPacket) {
        let newest = packet.pts_us.max(0) as u64;
        while let Some(front) = self.packets.front() {
            let age = newest.saturating_sub(front.pts_us.max(0) as u64);
            if age > self.max_age_us {
                self.packets.pop_front();
            } else {
                break;
            }
        }
        self.packets.push_back(packet);
    }

    /// Buffered packets, oldest first (the replay clip, in order).
    pub fn packets(&self) -> impl Iterator<Item = &EncodedPacket> {
        self.packets.iter()
    }

    pub fn len(&self) -> usize {
        self.packets.len()
    }

    pub fn is_empty(&self) -> bool {
        self.packets.is_empty()
    }

    /// Span of the buffered packets (newest pts − oldest pts), µs.
    pub fn span_us(&self) -> u64 {
        match (self.packets.front(), self.packets.back()) {
            (Some(a), Some(b)) => (b.pts_us.max(0) as u64).saturating_sub(a.pts_us.max(0) as u64),
            _ => 0,
        }
    }

    /// Drain the buffer (the "save replay" hand-off to the muxer).
    pub fn drain(&mut self) -> Vec<EncodedPacket> {
        self.packets.drain(..).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pkt(pts: i64) -> EncodedPacket {
        EncodedPacket {
            stream: 0,
            pts_us: pts,
            dts_us: Some(pts),
            key: false,
            data: vec![0u8; 4],
            latency: Default::default(),
        }
    }

    #[test]
    fn evicts_packets_older_than_the_window() {
        let mut b = ReplayBuffer::new(1_500); // 1.5 ms window
        b.push(pkt(0));
        b.push(pkt(500));
        b.push(pkt(2_000)); // evicts pts 0 (age 2000 > 1500); 500 (age 1500) stays
        let pts: Vec<i64> = b.packets().map(|p| p.pts_us).collect();
        assert_eq!(pts, vec![500, 2_000]);
    }

    #[test]
    fn drain_returns_oldest_first_and_empties() {
        let mut b = ReplayBuffer::new(10_000);
        b.push(pkt(0));
        b.push(pkt(100));
        let out = b.drain();
        assert_eq!(
            out.iter().map(|p| p.pts_us).collect::<Vec<_>>(),
            vec![0, 100]
        );
        assert!(b.is_empty());
    }

    #[test]
    fn span_is_newest_minus_oldest() {
        let mut b = ReplayBuffer::new(10_000);
        b.push(pkt(100));
        b.push(pkt(900));
        assert_eq!(b.span_us(), 800);
    }
}
