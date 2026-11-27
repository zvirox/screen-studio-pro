//! Phase 13.2 — instant replay buffer. A bounded RAM ring of the most recent
//! encoded packets (the last N seconds); "save replay" drains it to a file.
//! The stored packet is encode-independent (just the bytes + pts/stream/key)
//! so the buffer compiles in every build; the session worker fills it and a
//! future `replay_save` muxes a video-only clip from it.

use std::collections::VecDeque;

/// One buffered encoded packet (the bytes + enough to mux a clip).
#[derive(Debug, Clone)]
pub struct ReplayPacket {
    pub pts_us: i64,
    pub stream: u8,
    pub key: bool,
    pub data: Vec<u8>,
}

/// The video stream description captured at take start (primitives, so the
/// buffer compiles in every build); the save rebuilds the wire spec from it.
#[derive(Debug, Clone)]
pub struct ReplayVideo {
    pub codec_id: i32,
    pub width: i32,
    pub height: i32,
    pub pix_fmt: i32,
    pub extradata: Vec<u8>,
}

/// The replay ring: packets within `max_age_us` of the newest.
pub struct ReplayBuffer {
    packets: VecDeque<ReplayPacket>,
    max_age_us: u64,
    enabled: bool,
    video: Option<ReplayVideo>,
}

impl ReplayBuffer {
    /// `max_age_us` is the replay window (e.g. 30 s = 30_000_000 µs).
    /// `enabled` gates the hot-path push (default off so capture is
    /// unchanged until replay is armed).
    pub fn new(max_age_us: u64, enabled: bool) -> Self {
        Self {
            packets: VecDeque::new(),
            max_age_us,
            enabled,
            video: None,
        }
    }

    pub fn set_enabled(&mut self, enabled: bool) {
        self.enabled = enabled;
    }

    /// 13.2: record the video stream description (for the save mux).
    pub fn set_video(&mut self, video: ReplayVideo) {
        self.video = Some(video);
    }

    pub fn video(&self) -> Option<&ReplayVideo> {
        self.video.as_ref()
    }

    /// Push one packet, evicting anything older than the window (measured
    // against the newest pts). No-op when disabled. Packets arrive in
    /// non-decreasing pts order.
    pub fn push(&mut self, packet: ReplayPacket) {
        if !self.enabled {
            return;
        }
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
    pub fn packets(&self) -> impl Iterator<Item = &ReplayPacket> {
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
    pub fn drain(&mut self) -> Vec<ReplayPacket> {
        self.packets.drain(..).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pkt(pts: i64) -> ReplayPacket {
        ReplayPacket {
            pts_us: pts,
            stream: 0,
            key: false,
            data: vec![0u8; 4],
        }
    }

    #[test]
    fn evicts_packets_older_than_the_window() {
        let mut b = ReplayBuffer::new(1_500, true);
        b.push(pkt(0));
        b.push(pkt(500));
        b.push(pkt(2_000)); // evicts pts 0 (age 2000 > 1500); 500 stays
        let pts: Vec<i64> = b.packets().map(|p| p.pts_us).collect();
        assert_eq!(pts, vec![500, 2_000]);
    }

    #[test]
    fn drain_returns_oldest_first_and_empties() {
        let mut b = ReplayBuffer::new(10_000, true);
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
        let mut b = ReplayBuffer::new(10_000, true);
        b.push(pkt(100));
        b.push(pkt(900));
        assert_eq!(b.span_us(), 800);
    }
}
