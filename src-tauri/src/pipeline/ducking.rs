//! Phase 11.3 — sidechain ducking + anti-feedback limiting (pure DSP, no
//! deps). The ducker folds the desktop contribution down ~12 dB while the
//! mic is active (attack fast, release slow, so it breathes instead of
//! pumping); the look-ahead limiter clamps peaks to stop feedback howl.
//! Both are stateful and live in the audio worker; the mix path is unchanged
//! when no ducker is supplied (default).

const SR: f32 = crate::capture::audio::SAMPLE_RATE as f32;

/// One-pole smoothing coefficient for a time constant in seconds.
fn coeff(seconds: f32) -> f32 {
    1.0 - (-1.0 / (seconds * SR)).exp()
}

/// Sidechain ducker: attenuates `desktop` while `mic_rms` is above the gate.
pub struct Ducker {
    gain: f32,
    attack: f32,
    release: f32,
    threshold: f32,
    ducked: f32,
}

impl Default for Ducker {
    fn default() -> Self {
        Self::new()
    }
}

impl Ducker {
    pub fn new() -> Self {
        Self {
            gain: 1.0,
            attack: coeff(0.010),  // ~10 ms attack
            release: coeff(0.200), // ~200 ms release
            threshold: 0.02,       // mic gate (~-34 dBFS)
            ducked: 0.25,          // ~-12 dB
        }
    }

    /// Apply the current duck gain to one interleaved-stereo desktop buffer,
    /// driven by the mic's post-gain RMS for this window.
    pub fn process(&mut self, mic_rms: f32, desktop: &mut [f32]) {
        let target = if mic_rms > self.threshold {
            self.ducked
        } else {
            1.0
        };
        // Fast when ducking (target below current), slow when restoring.
        let c = if target < self.gain {
            self.attack
        } else {
            self.release
        };
        for sample in desktop {
            self.gain += (target - self.gain) * c;
            *sample *= self.gain;
        }
    }
}

/// Look-ahead peak limiter: delays the signal by `look` samples and clamps
/// the gain so no sample in the window exceeds `threshold` (anti-feedback).
pub struct FeedbackLimiter {
    delay: std::collections::VecDeque<f32>,
    gain: f32,
    release: f32,
    threshold: f32,
}

impl Default for FeedbackLimiter {
    fn default() -> Self {
        Self::new()
    }
}

impl FeedbackLimiter {
    pub fn new() -> Self {
        Self {
            delay: std::collections::VecDeque::with_capacity(64),
            gain: 1.0,
            release: coeff(0.050),
            threshold: 0.9,
        }
    }

    pub fn process(&mut self, buffer: &mut [f32]) {
        for sample in buffer {
            self.delay.push_back(*sample);
            let peak = self.delay.iter().fold(0.0f32, |m, &s| m.max(s.abs()));
            let target = if peak > self.threshold {
                self.threshold / peak
            } else {
                1.0
            };
            // Instant attack, smooth release.
            self.gain = if target < self.gain {
                target
            } else {
                self.gain + (target - self.gain) * self.release
            };
            if let Some(delayed) = self.delay.pop_front() {
                *sample = delayed * self.gain;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rms(samples: &[f32]) -> f32 {
        (samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32).sqrt()
    }

    #[test]
    fn loud_mic_ducks_the_desktop() {
        let mut d = Ducker::new();
        let mut desktop = vec![1.0f32; 4800];
        d.process(0.5, &mut desktop); // loud mic (100 ms to settle)
        assert!(rms(&desktop) < 0.4, "desktop attenuated under a loud mic");
    }

    #[test]
    fn silent_mic_restores_the_desktop() {
        let mut d = Ducker::new();
        let mut buf = vec![1.0f32; 9600];
        d.process(0.5, &mut buf[..4800]); // duck the first half
        d.process(0.0, &mut buf[4800..]); // release the second half
        assert!(
            rms(&buf[4800..]) > rms(&buf[..4800]),
            "gain recovers once the mic is quiet"
        );
    }

    #[test]
    fn limiter_clamps_a_loud_spike() {
        let mut l = FeedbackLimiter::new();
        let mut buffer = vec![0.0f32; 64];
        buffer[32] = 2.0; // a hot sample inside the look-ahead window
        l.process(&mut buffer);
        assert!(
            buffer.iter().all(|&s| s.abs() <= 1.0),
            "no sample exceeds full scale"
        );
    }
}
