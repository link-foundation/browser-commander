//! Safari's unencrypted, mixed-endian binarycookies store. Layout reference:
//! <https://github.com/libyal/dtformats/blob/main/documentation/Safari%20Cookies.asciidoc>

use std::collections::BTreeMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use anyhow::{anyhow, Result};

use super::browser_cookies::BrowserCookie;
use super::browser_sources::Environment;

fn invalid(detail: &str) -> anyhow::Error {
    anyhow!("Invalid Safari binarycookies: {detail}")
}

fn bounded(data: &[u8], offset: usize, size: usize) -> Result<&[u8]> {
    let end = offset
        .checked_add(size)
        .ok_or_else(|| invalid("overflow"))?;
    data.get(offset..end)
        .ok_or_else(|| invalid("truncated or out-of-range data"))
}

fn uint(data: &[u8], offset: usize, big_endian: bool) -> Result<usize> {
    let bytes = bounded(data, offset, 4)?.try_into()?;
    Ok(if big_endian {
        u32::from_be_bytes(bytes)
    } else {
        u32::from_le_bytes(bytes)
    } as usize)
}

fn string(record: &[u8], field: usize) -> Result<String> {
    let offset = uint(record, field, false)?;
    if offset < 56 || offset >= record.len() {
        return Err(invalid("string offset"));
    }
    let tail = &record[offset..];
    let end = tail
        .iter()
        .position(|byte| *byte == 0)
        .ok_or_else(|| invalid("unterminated string"))?;
    std::str::from_utf8(&tail[..end])
        .map(str::to_string)
        .map_err(|_| invalid("invalid UTF-8"))
}

fn records(data: &[u8]) -> Result<Vec<&[u8]>> {
    if bounded(data, 0, 4)? != b"cook" {
        return Err(invalid("file signature"));
    }
    let pages = uint(data, 4, true)?;
    let table_size = pages.checked_mul(4).ok_or_else(|| invalid("overflow"))?;
    bounded(data, 8, table_size)?;
    let mut page_start = 8 + table_size;
    let mut records = Vec::new();
    for index in 0..pages {
        let page = bounded(data, page_start, uint(data, 8 + index * 4, true)?)?;
        page_start += page.len();
        if uint(page, 0, false)? != 0x00010000 {
            return Err(invalid("page signature"));
        }
        let count = uint(page, 4, false)?;
        let header_size = count
            .checked_mul(4)
            .and_then(|size| size.checked_add(8))
            .ok_or_else(|| invalid("overflow"))?;
        bounded(page, 0, header_size)?;
        let mut previous_end = header_size;
        for cookie in 0..count {
            let start = uint(page, 8 + cookie * 4, false)?;
            if start < previous_end {
                return Err(invalid("overlapping record"));
            }
            let size = uint(page, start, false)?;
            if size < 56 {
                return Err(invalid("short record"));
            }
            let record = bounded(page, start, size)?;
            previous_end = start + size;
            records.push(record);
        }
    }
    // Safari's optional checksum/plist trailer is not cookie data.
    Ok(records)
}

pub(crate) fn parse_safari_cookies(
    data: &[u8],
    domain_filter: Option<&str>,
) -> Result<Vec<BrowserCookie>> {
    let mut cookies = Vec::new();
    for record in records(data)? {
        let domain = string(record, 16)?;
        if domain_filter
            .is_some_and(|filter| !domain.to_lowercase().contains(&filter.to_lowercase()))
        {
            continue;
        }
        let expiry = f64::from_le_bytes(record[40..48].try_into()?) + 978_307_200.0;
        if !expiry.is_finite() || expiry.abs() > 9_007_199_254_740_991.0 {
            return Err(invalid("expiry"));
        }
        let flags = uint(record, 8, false)?;
        let path = string(record, 24)?;
        cookies.push(BrowserCookie {
            name: string(record, 20)?,
            value: string(record, 28)?,
            domain,
            path: if path.is_empty() { "/".into() } else { path },
            expires: expiry.floor() as i64,
            http_only: flags & 4 != 0,
            secure: flags & 1 != 0,
            same_site: "Lax".into(),
        });
    }
    Ok(cookies)
}

type DomainCounts = (u64, Option<BTreeMap<String, u64>>);

/// Counts decode only host strings. Never decode cookie names or values.
pub(crate) fn count_safari_cookies(data: &[u8], domains: &[String]) -> Result<DomainCounts> {
    let mut counts: BTreeMap<String, u64> =
        domains.iter().map(|domain| (domain.clone(), 0)).collect();
    let mut total = 0;
    for record in records(data)? {
        let host = string(record, 16)?.to_lowercase();
        total += 1;
        for (domain, count) in &mut counts {
            if host.contains(&domain.to_lowercase()) {
                *count += 1;
            }
        }
    }
    Ok((total, (!domains.is_empty()).then_some(counts)))
}

fn protected(error: &io::Error) -> bool {
    error.kind() == io::ErrorKind::PermissionDenied || error.raw_os_error() == Some(1)
}

pub(crate) fn find_safari_cookie_file(profile_dir: &Path) -> Option<PathBuf> {
    for candidate in [
        profile_dir.join("Cookies/Cookies.binarycookies"),
        profile_dir.join("Cookies.binarycookies"),
    ] {
        match fs::metadata(&candidate) {
            Ok(metadata) if metadata.is_file() => return Some(candidate),
            Err(error) if protected(&error) => return Some(candidate),
            _ => (),
        }
    }
    None
}

fn access_error(file_path: &Path, error: io::Error, environment: &Environment) -> anyhow::Error {
    if !protected(&error) {
        return error.into();
    }
    let executable = std::env::current_exe().unwrap_or_else(|_| PathBuf::from("browser-commander"));
    let app = environment
        .get("__CFBundleIdentifier")
        .or_else(|| environment.get("TERM_PROGRAM"))
        .cloned()
        .unwrap_or_else(|| executable.display().to_string());
    anyhow!("Safari cookie access denied at {}. Grant Full Disk Access to {}, the app running Browser Commander, then retry: x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles ({})", file_path.display(), app, error)
}

pub(crate) fn read_safari_cookie_file(
    file_path: &Path,
    environment: &Environment,
) -> Result<Vec<u8>> {
    fs::read(file_path).map_err(|error| access_error(file_path, error, environment))
}

#[cfg(test)]
mod tests {
    use super::*;
    const DATA: &[u8] = include_bytes!("../../../tests/fixtures/safari/Cookies.binarycookies");

    #[test]
    fn rejects_truncated_records_counts_offsets_strings_and_expiry() {
        for end in 0..DATA.len() - 8 {
            assert!(parse_safari_cookies(&DATA[..end], None)
                .unwrap_err()
                .to_string()
                .contains("Invalid Safari binarycookies"));
        }
        for (offset, value) in [
            (4, u32::MAX),
            (24, u32::MAX),
            (28, u32::MAX),
            (40, u32::MAX),
            (56, 0),
        ] {
            let mut broken = DATA.to_vec();
            broken[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
            assert!(parse_safari_cookies(&broken, None).is_err());
        }
        let mut broken = DATA.to_vec();
        broken[80..88].copy_from_slice(&f64::NAN.to_le_bytes());
        assert!(parse_safari_cookies(&broken, None).is_err());
    }

    #[test]
    fn protection_errors_name_the_running_application_and_settings() {
        let environment = Environment::from([("TERM_PROGRAM".into(), "TestTerminal".into())]);
        let error = access_error(
            Path::new("Cookies.binarycookies"),
            io::ErrorKind::PermissionDenied.into(),
            &environment,
        )
        .to_string();
        assert!(error.contains("Full Disk Access to TestTerminal"));
        assert!(error
            .contains("x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"));
    }
}
