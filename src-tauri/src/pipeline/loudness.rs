//! Phase 11.4 — ITU-R BS.1770 loudness + true-peak metering (pure Rust, no
//! deps). K-weighting (two biquads) → 400 ms gated blocks → integrated LUFS;
//! 4× oversampled true-peak via a windowed-sinc polyphase (catches inter-
//! sample peaks a sample-peak meter misses). Mono in this app (the mix is
//! stereo; the caller measures one channel or a downmix).

const SR: usize = crate::capture::audio::SAMPLE_RATE as usize;
const BLOCK: usize = (SR * 2) / 5; // 400 ms
const STEP: usize = BLOCK / 4; // 75% overlap

/// One biquad (direct form I) with frozen coefficients.
struct Biquad {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
    x1: f32,
    x2: f32,
    y1: f32,
    y2: f32,
}

impl Biquad {
    fn new(b: [f32; 3], a: [f32; 3]) -> Self {
        Self {
            b0: b[0],
            b1: b[1],
            b2: b[2],
            a1: a[1],
            a2: a[2],
            x1: 0.0,
            x2: 0.0,
            y1: 0.0,
            y2: 0.0,
        }
    }

    fn process(&mut self, x: f32) -> f32 {
        let y = self.b0 * x + self.b1 * self.x1 + self.b2 * self.x2
            - self.a1 * self.y1
            - self.a2 * self.y2;
        self.x2 = self.x1;
        self.x1 = x;
        self.y2 = self.y1;
        self.y1 = y;
        y
    }
}

/// K-weighting = a high-shelf then a high-pass (BS.1770, 48 kHz coefficients).
struct KWeight {
    shelf: Biquad,
    hp: Biquad,
}

#[allow(clippy::excessive_precision)]
impl Default for KWeight {
    fn default() -> Self {
        Self {
            shelf: Biquad::new(
                [1.53512485958697, -2.69169618940638, 1.19839281085285],
                [1.0, -1.69065929318241, 0.73248077421585],
            ),
            hp: Biquad::new([1.0, -2.0, 1.0], [1.0, -1.99004745483398, 0.99007225036621]),
        }
    }
}

/// Accumulates K-weighted power and computes gated integrated LUFS.
pub struct LoudnessMeter {
    k: KWeight,
    ring: Vec<f32>,
    blocks: Vec<f32>,
}

impl Default for LoudnessMeter {
    fn default() -> Self {
        Self::new()
    }
}

impl LoudnessMeter {
    pub fn new() -> Self {
        Self {
            k: KWeight::default(),
            ring: Vec::with_capacity(BLOCK),
            blocks: Vec::new(),
        }
    }

    /// Feed one mono sample (any rate already at 48 kHz).
    pub fn push(&mut self, sample: f32) {
        let y = self.k.hp.process(self.k.shelf.process(sample));
        self.ring.push(y * y);
        if self.ring.len() == BLOCK {
            self.blocks
                .push(self.ring.iter().sum::<f32>() / BLOCK as f32);
            self.ring.drain(..STEP);
        }
    }

    /// Gated integrated loudness in LUFS (BS.1770). `None` if no block
    /// passes the absolute gate (silence).
    pub fn integrated_lufs(&self) -> Option<f32> {
        let abs: Vec<f32> = self
            .blocks
            .iter()
            .copied()
            .filter(|&p| -0.691 + 10.0 * p.log10() > -70.0)
            .collect();
        if abs.is_empty() {
            return None;
        }
        let mean = abs.iter().sum::<f32>() / abs.len() as f32;
        let rel_threshold = -0.691 + 10.0 * mean.log10() - 10.0;
        let gated: Vec<f32> = abs
            .iter()
            .copied()
            .filter(|&p| -0.691 + 10.0 * p.log10() > rel_threshold)
            .collect();
        let gmean = gated.iter().sum::<f32>() / gated.len() as f32;
        Some(-0.691 + 10.0 * gmean.log10())
    }
}

/// 4× oversampled true-peak (linear-phase windowed-sinc, 32 taps/phase).
/// Returns the peak in the same scale as the input.
pub fn true_peak(samples: &[f32]) -> f32 {
    const TAPS: usize = 32;
    // Precompute a windowed-sinc low-pass for the 4 fractional phases.
    let mut peak = samples.iter().fold(0.0f32, |m, &s| m.max(s.abs()));
    for phase in 1..4usize {
        let frac = phase as f32 / 4.0;
        let mut acc = 0.0f32;
        for (i, _) in samples.iter().enumerate() {
            // 32-tap windowed sinc centred on the sample.
            let mut sum = 0.0f32;
            for t in 0..TAPS {
                let k = t as f32 - (TAPS as f32 / 2.0 - 1.0);
                let x = k - frac;
                let sinc = if x.abs() < 1e-6 {
                    1.0
                } else {
                    (std::f32::consts::PI * x).sin() / (std::f32::consts::PI * x)
                };
                let window = 0.54
                    - 0.46 * (2.0 * std::f32::consts::PI * t as f32 / (TAPS as f32 - 1.0)).cos();
                let idx = i as isize + t as isize - (TAPS as isize / 2) + 1;
                let s = if idx >= 0 && (idx as usize) < samples.len() {
                    samples[idx as usize]
                } else {
                    0.0
                };
                sum += s * sinc * window;
            }
            acc = acc.max(sum.abs());
            peak = peak.max(acc);
        }
    }
    peak
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sine(freq: f32, amp: f32, n: usize) -> Vec<f32> {
        (0..n)
            .map(|i| amp * (2.0 * std::f32::consts::PI * freq * i as f32 / SR as f32).sin())
            .collect()
    }

    #[test]
    fn silence_has_no_loudness() {
        let mut m = LoudnessMeter::new();
        for _ in 0..SR * 2 {
            m.push(0.0);
        }
        assert!(m.integrated_lufs().is_none(), "silence is gated out");
    }

    #[test]
    fn louder_signal_reads_higher_lufs() {
        let mut quiet = LoudnessMeter::new();
        let mut loud = LoudnessMeter::new();
        let q = sine(1000.0, 0.05, SR * 2);
        let l = sine(1000.0, 0.5, SR * 2);
        for &s in &q {
            quiet.push(s);
        }
        for &s in &l {
            loud.push(s);
        }
        assert!(loud.integrated_lufs().unwrap() > quiet.integrated_lufs().unwrap());
    }

    #[test]
    fn true_peak_is_at_least_the_sample_peak() {
        let s = sine(997.0, 0.9, 4800);
        let sample_peak = s.iter().fold(0.0f32, |m, &x| m.max(x.abs()));
        assert!(true_peak(&s) + 1e-4 >= sample_peak);
    }
}
