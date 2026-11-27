//! Phase 12.3 — empirical hardware auto-configuration (capability core).
//! Given which hardware encoders the machine actually has (the existing
//! `encode::Availability` probe), recommend a concrete encoder + a quality
//! preset so a first-run user gets a record-ready target without guessing.
//! The empirical encode-speed benchmark and the first-run wizard UI build on
//! this; the recommendation is pure and testable.

/// A recommended encoder + preset for this machine.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Recommendation {
    pub encoder: String,
    pub preset_id: String,
    pub reason: String,
}

/// Recommend an encoder and preset from the available hardware encoders.
/// Hardware (VAAPI preferred, then NVENC) → the 1080p60 YouTube target;
/// no hardware → CPU x264 at the lighter 720p30 Discord target so a low-end
/// machine stays responsive.
pub fn recommend(vaapi: bool, nvenc: bool) -> Recommendation {
    if vaapi {
        Recommendation {
            encoder: "vaapi".into(),
            preset_id: "youtube".into(),
            reason: "Hardware VAAPI encoder available".into(),
        }
    } else if nvenc {
        Recommendation {
            encoder: "nvenc".into(),
            preset_id: "youtube".into(),
            reason: "Hardware NVENC encoder available".into(),
        }
    } else {
        Recommendation {
            encoder: "x264".into(),
            preset_id: "discord".into(),
            reason: "No hardware encoder; using CPU x264 at a lighter target".into(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vaapi_is_preferred() {
        let r = recommend(true, true);
        assert_eq!(r.encoder, "vaapi");
        assert_eq!(r.preset_id, "youtube");
    }

    #[test]
    fn nvenc_when_no_vaapi() {
        let r = recommend(false, true);
        assert_eq!(r.encoder, "nvenc");
        assert_eq!(r.preset_id, "youtube");
    }

    #[test]
    fn cpu_falls_back_to_a_lighter_target() {
        let r = recommend(false, false);
        assert_eq!(r.encoder, "x264");
        assert_eq!(r.preset_id, "discord");
    }

    #[test]
    fn recommended_preset_ids_exist() {
        for (v, n) in [(true, false), (false, true), (false, false)] {
            let r = recommend(v, n);
            assert_eq!(
                crate::pipeline::presets::resolve(&r.preset_id).id,
                r.preset_id
            );
        }
    }
}
