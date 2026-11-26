//! Phase 12.1 — frame-drop classification (lag vs skip). The capture tier
//! and the encode tier drop for different reasons; a single "dropped" count
//! hides which side is overloaded. The classifier compares the per-window
//! DELTAS of the two counters and names the dominant cause + its share, so
//! the UI can show a specific overload banner instead of a bare number.

/// Which tier is dropping frames this window.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DropClass {
    /// No drops in the window.
    None,
    /// Capture tier (producer/portal) couldn't keep up — "skip".
    Capture,
    /// Encode tier (bus full / encoder stall) — "lag".
    Encoder,
}

/// Classifies drops from the two cumulative counters. Pure: the caller owns
/// the window clock and feeds the current counter values.
#[derive(Debug, Default)]
pub struct DropClassifier {
    prev_capture: u64,
    prev_encode: u64,
}

impl DropClassifier {
    pub fn new() -> Self {
        Self::default()
    }

    /// Feed the current cumulative (capture_drops, encode_drops); returns the
    /// dominant class over the window and its share of the window's drops.
    pub fn classify(&mut self, capture_drops: u64, encode_drops: u64) -> (DropClass, f32) {
        let dc = capture_drops.saturating_sub(self.prev_capture);
        let de = encode_drops.saturating_sub(self.prev_encode);
        self.prev_capture = capture_drops;
        self.prev_encode = encode_drops;
        let total = dc + de;
        if total == 0 {
            return (DropClass::None, 0.0);
        }
        if de >= dc {
            (DropClass::Encoder, de as f32 / total as f32)
        } else {
            (DropClass::Capture, dc as f32 / total as f32)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_drops_is_none() {
        let mut c = DropClassifier::new();
        assert_eq!(c.classify(0, 0), (DropClass::None, 0.0));
    }

    #[test]
    fn rising_encode_drops_is_lag() {
        let mut c = DropClassifier::new();
        c.classify(0, 0);
        let (class, share) = c.classify(0, 10);
        assert_eq!(class, DropClass::Encoder);
        assert!((share - 1.0).abs() < 1e-6);
    }

    #[test]
    fn rising_capture_drops_is_skip() {
        let mut c = DropClassifier::new();
        c.classify(0, 0);
        let (class, _) = c.classify(5, 0);
        assert_eq!(class, DropClass::Capture);
    }

    #[test]
    fn dominant_side_wins() {
        let mut c = DropClassifier::new();
        c.classify(0, 0);
        let (class, share) = c.classify(2, 8);
        assert_eq!(class, DropClass::Encoder);
        assert!((share - 0.8).abs() < 1e-6);
    }
}
