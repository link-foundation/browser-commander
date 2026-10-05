//! Named Safari profiles keep history under Safari and cookies under WebKit.

use super::{browser_profiles::BrowserProfile, safari_cookies::find_safari_cookie_file};
use anyhow::Result;
use rusqlite::{Connection, OpenFlags};
use std::{fs, path::Path};

pub(crate) fn list_safari_profiles(browser: &str, root: &Path) -> Result<Vec<BrowserProfile>> {
    let mut profiles = Vec::new();
    if find_safari_cookie_file(root).is_some()
        || [
            "Safari/History.db",
            "History.db",
            "Safari/Bookmarks.plist",
            "Bookmarks.plist",
        ]
        .iter()
        .any(|name| root.join(name).is_file())
    {
        profiles.push(BrowserProfile {
            browser: browser.into(),
            name: "Default".into(),
            display_name: "Default".into(),
            path: root.into(),
            is_default: true,
        });
    }
    let tabs = [
        root.join("Safari/SafariTabs.db"),
        root.join("SafariTabs.db"),
    ]
    .into_iter()
    .find(|path| match fs::metadata(path) {
        Ok(metadata) => metadata.is_file(),
        Err(error) => error.kind() == std::io::ErrorKind::PermissionDenied,
    });
    let Some(tabs) = tabs else {
        return Ok(profiles);
    };
    let rows = super::migration::safari::with_safari_access(&tabs, || {
        let _ = fs::File::open(&tabs)?;
        let db = Connection::open_with_flags(&tabs, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        let rows = db.prepare("SELECT DISTINCT external_uuid,title FROM bookmarks WHERE subtype=2 AND external_uuid != 'DefaultProfile' ORDER BY external_uuid")?.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)))?.collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    })?;
    for (uuid, title) in rows {
        if uuid.len() != 36
            || !uuid.chars().enumerate().all(|(index, ch)| {
                if [8, 13, 18, 23].contains(&index) {
                    ch == '-'
                } else {
                    ch.is_ascii_hexdigit()
                }
            })
        {
            continue;
        }
        let name = uuid.to_uppercase();
        profiles.push(BrowserProfile {
            browser: browser.into(),
            display_name: title.unwrap_or_else(|| name.clone()),
            path: root.join("Safari/Profiles").join(&name),
            name,
            is_default: false,
        });
    }
    Ok(profiles)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn discovers_named_profiles_and_prefers_modern_cookie_stores() {
        let root = std::env::temp_dir().join(format!("bc-safari-named-{}", std::process::id()));
        let uuid = "11111111-2222-3333-4444-555555555555";
        let named = root.join("Safari/Profiles").join(uuid);
        fs::create_dir_all(&named).unwrap();
        let db = Connection::open(root.join("Safari/SafariTabs.db")).unwrap();
        db.execute_batch(include_str!(
            "../../../tests/fixtures/safari-data/SafariTabs.sql"
        ))
        .unwrap();
        drop(db);
        for location in [
            "Cookies".into(),
            "WebKit/WebsiteData/Default/Cookies".into(),
            format!("WebKit/WebsiteDataStore/{uuid}/Cookies"),
        ] {
            fs::create_dir_all(root.join(&location)).unwrap();
            fs::write(
                root.join(location).join("Cookies.binarycookies"),
                include_bytes!("../../../tests/fixtures/safari/Cookies.binarycookies"),
            )
            .unwrap();
        }
        let profiles = list_safari_profiles("safari", &root).unwrap();
        assert_eq!(
            profiles
                .iter()
                .map(|profile| profile.name.as_str())
                .collect::<Vec<_>>(),
            ["Default", uuid]
        );
        assert_eq!(profiles[1].display_name, "Work");
        assert_eq!(
            find_safari_cookie_file(&root).unwrap(),
            root.join("WebKit/WebsiteData/Default/Cookies/Cookies.binarycookies")
        );
        assert_eq!(
            find_safari_cookie_file(&named).unwrap(),
            root.join(format!(
                "WebKit/WebsiteDataStore/{uuid}/Cookies/Cookies.binarycookies"
            ))
        );
        fs::remove_dir_all(root).unwrap();
    }
}
