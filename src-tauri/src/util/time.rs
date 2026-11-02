//! UTC wall-clock formatting — the only place in the core that turns a
//! `SystemTime` into the ISO-8601/RFC-3339 strings the IPC contract emits
//! (`startedAt` in API §2.3/§3). Hand-rolled civil-from-days (Hinnant's
//! algorithm) instead of a date library: the core formats exactly one
//! representation, UTC "YYYY-MM-DDTHH:MM:SSZ", and AGENTS §4.2 asks before
//! new dependencies.

/// Formats "now" as RFC-3339 UTC with second precision, per the API
/// contract examples (`"2026-11-01T14:05:00Z"`). Pre-epoch clocks (broken
/// RTC) degrade to the epoch instant rather than erroring — a recording
/// that starts with a wrong timestamp is still a recording.
#[cfg(feature = "encode")]
pub fn rfc3339_now() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    rfc3339_from_unix(now.as_secs())
}

/// Unix seconds → `"1970-01-01T00:00:00Z"`-style string. Exported for
/// tests; the civil-from-days math below is the one source of truth.
#[cfg(any(feature = "encode", test))]
pub fn rfc3339_from_unix(unix_secs: u64) -> String {
    let days = unix_secs / 86_400;
    let secs_of_day = unix_secs % 86_400;
    let (year, month, day) = civil_from_days(days as i64);
    format!(
        "{year:04}-{month:02}-{day:02}T{h:02}:{m:02}:{s:02}Z",
        h = secs_of_day / 3_600,
        m = (secs_of_day % 3_600) / 60,
        s = secs_of_day % 60
    )
}

/// Howard Hinnant's `civil_from_days`: days since 1970-01-01 proleptic
/// Gregorian → (year, month, day). Epoch-correct for any sane datetime
/// range this app sees (years 1970–9999 fit `u64` Unix seconds).
#[cfg(any(feature = "encode", test))]
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097; // day of era [0, 146096]
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365; // [0, 399]
    let year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let day = doy - (153 * mp + 2) / 5 + 1; // [1, 31]
    let month = if mp < 10 { mp + 3 } else { mp - 9 }; // [1, 12]
    (year + i64::from(month <= 2), month as u32, day as u32)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Anchor points every calendar implementation must get right.
    #[test]
    fn formats_the_unix_epoch() {
        assert_eq!(rfc3339_from_unix(0), "1970-01-01T00:00:00Z");
        assert_eq!(rfc3339_from_unix(59), "1970-01-01T00:00:59Z");
        // First UTC leap-second-adjacent day boundary still normal seconds.
        assert_eq!(rfc3339_from_unix(3_600), "1970-01-01T01:00:00Z");
        assert_eq!(rfc3339_from_unix(86_399), "1970-01-01T23:59:59Z");
        assert_eq!(rfc3339_from_unix(86_400), "1970-01-02T00:00:00Z");
    }

    #[test]
    fn crosses_month_and_leap_year_boundaries() {
        // 1970-01-31 → 02-01 (non-leap month roll)
        assert_eq!(rfc3339_from_unix(31 * 86_400 - 1), "1970-01-31T23:59:59Z");
        assert_eq!(rfc3339_from_unix(31 * 86_400), "1970-02-01T00:00:00Z");
        // 1972-02-29 23:59:59 = 1972-03-01 boundary (leap day;
        // 1972-03-01 is 790 days after the epoch)
        assert_eq!(rfc3339_from_unix(68_255_999), "1972-02-29T23:59:59Z");
        assert_eq!(rfc3339_from_unix(68_256_000), "1972-03-01T00:00:00Z");
        // Century non-leap 2100 (1972-03-01 style anchors) and the
        // known date from the API §2.3 example.
        assert_eq!(rfc3339_from_unix(4_107_542_400), "2100-03-01T00:00:00Z");
        assert_eq!(rfc3339_from_unix(1_793_541_900), "2026-11-01T14:05:00Z");
    }
}
