//! Quality presets (PRD M11 / API §2.5 `presets_list`).
//!
//! The four static presets are plain-language targets ("For YouTube —
//! 1080p60" per PRD §7.5), not raw encoder jargon. `recording_start`
//! consumes the SETTINGS SNAPSHOT's `capture.quality_preset` (the
//! config-snapshot law — the take resolves its target at start time,
//! from the app's settings state), so this table is the single source
//! of truth for what each id means.

/// One quality preset. `height == 0` means "native resolution" (no cap).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Preset {
    pub id: &'static str,
    pub label: &'static str,
    pub description: &'static str,
    pub fps: u32,
    pub height: u32,
    pub container: &'static str,
}

pub fn list() -> &'static [Preset] {
    &[
        Preset {
            id: "youtube",
            label: "For YouTube",
            description: "1080p60, ~12 Mbps",
            fps: 60,
            height: 1080,
            container: "mp4",
        },
        Preset {
            id: "discord",
            label: "For Discord",
            description: "720p30, ~6 Mbps",
            fps: 30,
            height: 720,
            container: "mp4",
        },
        Preset {
            id: "lossless",
            label: "Lossless local",
            description: "native resolution, visually lossless",
            fps: 60,
            height: 0,
            container: "mkv",
        },
        Preset {
            id: "smallest",
            label: "Smallest file",
            description: "720p30, ~2 Mbps",
            fps: 30,
            height: 720,
            container: "mp4",
        },
    ]
}

/// Unknown ids (e.g. a hand-edited TOML that predates validation, or a
/// corrupted settings value that slipped past `validate`) fall back to
/// the YouTube target — the record-ready default (PRD G3) — never to
/// zero-values that would produce a silent 0×0 take.
pub fn resolve(id: &str) -> Preset {
    list()
        .iter()
        .find(|p| p.id == id)
        .copied()
        .unwrap_or_else(|| list()[0])
}

/// Output geometry for a take: the preset's height cap wins, aspect is
/// preserved, the source is never upscaled, and the result is even-dim
/// clamped (yuv420p is 2×2-subsampled — the same KWin geometry law the
/// encoder applies; the clamp lives here so the muxer header and the
/// scaled frames agree by construction).
pub fn output_size(source: (u32, u32), preset: &Preset) -> (u32, u32) {
    if preset.height == 0 || source.1 <= preset.height {
        return (source.0 & !1, source.1 & !1);
    }
    let scale = preset.height as f64 / source.1 as f64;
    let w = (source.0 as f64 * scale).round() as u32;
    let h = preset.height;
    (w & !1, h & !1)
}

/// x264 options for a preset (the muxer passes these to `avcodec_open2`).
/// GOP = one second of the preset's fps (crash-loss bound per PLAN 1.3).
pub fn x264_options(preset: &Preset) -> Vec<(String, String)> {
    let g = preset.fps;
    let quality: &[(&str, &str)] = match preset.id {
        "youtube" => &[
            ("preset", "medium"),
            ("crf", "23"),
            ("maxrate", "12000"),
            ("bufsize", "12000"),
        ],
        "discord" => &[
            ("preset", "medium"),
            ("crf", "28"),
            ("maxrate", "6000"),
            ("bufsize", "6000"),
        ],
        "lossless" => &[("preset", "slow"), ("qp", "0")],
        "smallest" => &[
            ("preset", "veryfast"),
            ("crf", "32"),
            ("maxrate", "2000"),
            ("bufsize", "4000"),
        ],
        _ => &[],
    };
    let mut opts: Vec<(String, String)> = quality
        .iter()
        .map(|(k, v)| ((*k).to_string(), (*v).to_string()))
        .collect();
    opts.push(("g".to_string(), g.to_string()));
    opts
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_ids_resolve_and_unknown_falls_back_to_youtube() {
        for id in ["youtube", "discord", "lossless", "smallest"] {
            assert_eq!(resolve(id).id, id, "{id} must resolve to itself");
        }
        assert_eq!(resolve("bogus").id, "youtube");
    }

    #[test]
    fn height_cap_preserves_aspect_and_never_upscales() {
        let youtube = resolve("youtube");
        // 1440p monitor caps to 1080p, keeping 16:9.
        assert_eq!(output_size((2560, 1440), &youtube), (1920, 1080));
        // 720p source is never upscaled to a 1080p cap.
        assert_eq!(output_size((1280, 720), &youtube), (1280, 720));
    }

    #[test]
    fn discord_cap_yields_720p_and_odd_widths_clamp_even() {
        let discord = resolve("discord");
        // Odd widths clamp down to even (yuv420p).
        assert_eq!(output_size((1919, 1079), &discord), (1280, 720));
    }

    #[test]
    fn lossless_never_caps_and_smallest_does() {
        assert_eq!(
            output_size((2560, 1440), &resolve("lossless")),
            (2560, 1440)
        );
        assert_eq!(output_size((2560, 1440), &resolve("smallest")), (1280, 720));
    }

    #[test]
    fn lossless_uses_qp0_and_gop_matches_each_fps() {
        for id in ["youtube", "discord", "lossless", "smallest"] {
            let preset = resolve(id);
            let opts = x264_options(&preset);
            let g = opts
                .iter()
                .find(|(k, _)| k == "g")
                .map(|(_, v)| v.clone())
                .expect("g is always present");
            assert_eq!(g, preset.fps.to_string(), "{id}: gop = one second");
        }
        let lossless = x264_options(&resolve("lossless"));
        assert!(lossless.iter().any(|(k, v)| k == "qp" && v == "0"));
    }
}
