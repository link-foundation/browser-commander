//! Prepare password writes privately and preserve compatible target stores.
use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use anyhow::{anyhow, Result};
use rusqlite::{params_from_iter, types::Value, Connection};

use super::{ClassOutcome, MigrationEntry};
use crate::browser::browser_cookie_crypto::decrypt_chromium_cookie;
use crate::utilities::subprocess::{run_command_blocking, RunCommandOptions};

const IDENTITY: &[&str] = &[
    "origin_url",
    "username_element",
    "username_value",
    "password_element",
    "signon_realm",
];
const TABLES: &[&str] = &[
    "logins",
    "meta",
    "password_notes",
    "insecure_credentials",
    "stats",
    "sync_entities_metadata",
    "sync_model_metadata",
    "incoming_sharing_invitation_sync_entities_metadata",
    "incoming_sharing_invitation_sync_model_metadata",
];
const LOGIN_COLUMNS: &str = "id origin_url action_url username_element username_value password_element password_value submit_element signon_realm date_created blacklisted_by_user scheme password_type times_used form_data display_name icon_url federation_url skip_zero_click generation_upload_status possible_username_pairs date_last_used moving_blocked_for date_password_modified date_synced preferred ssl_valid possible_usernames use_additional_auth sender_email sender_name date_received sharing_notification_displayed sender_profile_image_url keychain_identifier date_last_filled actor_login_approved";

fn refusal(reason: &str) -> anyhow::Error {
    anyhow!("Password refresh refused ({reason}). Close the target browser and retry. For unsupported stores use a fresh dedicated profile; refresh cookies through the running browser cookie API.")
}

fn active_sidecar(path: &Path, suffix: &str) -> Result<bool> {
    if !super::fs_utils::path_exists(path) {
        return Ok(false);
    }
    if suffix != "-journal" || fs::symlink_metadata(path)?.file_type().is_symlink() {
        return Ok(true);
    }
    // SQLite PERSIST leaves a zeroed rollback header after a clean close.
    let mut header = Vec::new();
    fs::File::open(path)?.take(8).read_to_end(&mut header)?;
    Ok(header.iter().any(|byte| *byte != 0))
}

pub(super) fn assert_target_closed(target: &Path) -> Result<()> {
    let target = crate::browser::browser_profile_files::physical_path(target)?;
    let parent = target.parent().unwrap_or(&target);
    for dir in [&target, parent] {
        for name in [
            "SingletonLock",
            "SingletonCookie",
            "SingletonSocket",
            "lockfile",
        ] {
            if super::fs_utils::path_exists(&dir.join(name)) {
                return Err(refusal("target-active"));
            }
        }
    }
    for suffix in ["-wal", "-shm", "-journal"] {
        if active_sidecar(&target.join(format!("Login Data{suffix}")), suffix)? {
            return Err(refusal("target-active"));
        }
    }
    let output = if cfg!(windows) {
        run_command_blocking(
            "powershell.exe",
            &[
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "Get-CimInstance Win32_Process | Select-Object -ExpandProperty CommandLine",
            ],
            RunCommandOptions::default(),
        )
    } else {
        run_command_blocking(
            "ps",
            &["-axww", "-o", "args="],
            RunCommandOptions::default(),
        )
    }
    .map_err(|_| refusal("target-state-unavailable"))?;
    let pattern = regex::Regex::new(
        r#"(?:^|\s)(?:"--user-data-dir(?:=|\s+)([^"]+)"|--user-data-dir(?:=|\s+)(?:"([^"]+)"|'([^']+)'|(.+)))"#,
    )?;
    for line in output.stdout.lines() {
        let Some(found) = pattern.captures(line) else {
            continue;
        };
        // ps drops quoting. Resolve each possible boundary to handle spaces and
        // symlink aliases, including macOS /var, before comparing profile paths.
        let candidates: Vec<&str> =
            if let Some(quoted) = found.iter().skip(1).take(3).flatten().next() {
                vec![quoted.as_str()]
            } else {
                let value = found.get(4).unwrap().as_str();
                value
                    .char_indices()
                    .filter(|(_, ch)| ch.is_whitespace())
                    .map(|(at, _)| &value[..at])
                    .chain(std::iter::once(value))
                    .collect()
            };
        for value in candidates.into_iter().filter(|value| !value.is_empty()) {
            let path = crate::browser::browser_profile_files::physical_path(Path::new(value))?;
            if path == target || path == parent {
                return Err(refusal("target-active"));
            }
        }
    }
    Ok(())
}

fn quote(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}
type Row = HashMap<String, Value>;
fn rows(db: &Connection, sql: &str, values: &[Value]) -> Result<Vec<Row>> {
    let mut statement = db.prepare(sql)?;
    let names: Vec<String> = statement
        .column_names()
        .iter()
        .map(|name| (*name).to_owned())
        .collect();
    let result = statement
        .query_map(params_from_iter(values), |row| {
            names
                .iter()
                .enumerate()
                .map(|(i, name)| Ok((name.clone(), row.get(i)?)))
                .collect()
        })?
        .collect::<rusqlite::Result<_>>()?;
    Ok(result)
}
fn columns(db: &Connection, table: &str) -> Result<Vec<Row>> {
    rows(db, &format!("PRAGMA table_info({})", quote(table)), &[])
}
fn text<'a>(row: &'a Row, name: &str) -> &'a str {
    match row.get(name) {
        Some(Value::Text(value)) => value,
        _ => "",
    }
}

fn validate_schema(source: &Connection, target: &Connection) -> Result<()> {
    for db in [source, target] {
        for row in rows(
            db,
            "SELECT type,name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'",
            &[],
        )? {
            let kind = text(&row, "type");
            if matches!(kind, "trigger" | "view")
                || (kind == "table" && !TABLES.contains(&text(&row, "name")))
            {
                return Err(refusal("unsupported-password-schema"));
            }
        }
        let cols = columns(db, "logins")?;
        let names: Vec<&str> = cols.iter().map(|row| text(row, "name")).collect();
        if IDENTITY
            .iter()
            .chain([&"password_value"])
            .any(|name| !names.contains(name))
            || names
                .iter()
                .any(|name| !LOGIN_COLUMNS.split_whitespace().any(|known| known == *name))
        {
            return Err(refusal("unsupported-password-schema"));
        }
        if names.contains(&"keychain_identifier")
            && !rows(
                db,
                "SELECT 1 FROM logins WHERE length(keychain_identifier)>0 LIMIT 1",
                &[],
            )?
            .is_empty()
        {
            return Err(refusal("unsupported-password-schema"));
        }
    }
    for table in ["logins", "password_notes", "insecure_credentials"] {
        if columns(source, table)? != columns(target, table)? {
            return Err(refusal("unsupported-password-schema"));
        }
    }
    let has_meta = !columns(source, "meta")?.is_empty();
    if has_meta != !columns(target, "meta")?.is_empty() {
        return Err(refusal("unsupported-password-schema"));
    }
    if has_meta {
        let sql = "SELECT key,CAST(value AS TEXT) AS value FROM meta WHERE key IN ('version','last_compatible_version') ORDER BY key";
        if rows(source, sql, &[])? != rows(target, sql, &[])? {
            return Err(refusal("unsupported-password-schema"));
        }
    }
    for (table, allowed) in [
        (
            "password_notes",
            &[
                "id",
                "parent_id",
                "key",
                "value",
                "date_created",
                "confidential",
            ][..],
        ),
        (
            "insecure_credentials",
            &[
                "parent_id",
                "insecurity_type",
                "create_time",
                "is_muted",
                "trigger_notification_from_backend",
            ][..],
        ),
    ] {
        let cols = columns(target, table)?;
        let names: Vec<_> = cols.iter().map(|row| text(row, "name")).collect();
        if !names.is_empty()
            && (!names.contains(&"parent_id")
                || !columns(target, "logins")?
                    .iter()
                    .any(|row| text(row, "name") == "id")
                || names.iter().any(|name| !allowed.contains(name)))
        {
            return Err(refusal("unsupported-password-schema"));
        }
    }
    for table in ["logins", "password_notes"] {
        let cols = columns(target, table)?;
        let pk: Vec<_> = cols
            .iter()
            .filter(|row| row.get("pk") != Some(&Value::Integer(0)))
            .collect();
        if !pk.is_empty()
            && (pk.len() != 1
                || text(pk[0], "name") != "id"
                || !text(pk[0], "type").eq_ignore_ascii_case("INTEGER"))
        {
            return Err(refusal("unsupported-password-schema"));
        }
    }
    Ok(())
}

fn validate_key(db: &Connection, key: &[u8], platform: &str) -> Result<()> {
    for (table, column) in [("logins", "password_value"), ("password_notes", "value")] {
        if columns(db, table)?.is_empty() {
            continue;
        }
        for row in rows(
            db,
            &format!("SELECT {} AS value FROM {}", quote(column), quote(table)),
            &[],
        )? {
            let bytes = super::passwords::to_bytes(row["value"].clone());
            if bytes.is_empty() {
                continue;
            }
            if !bytes.starts_with(b"v10") && !bytes.starts_with(b"v11") {
                return Err(refusal("target-encryption-unsupported"));
            }
            decrypt_chromium_cookie(&bytes, "", 0, platform, key)
                .map_err(|_| refusal("target-key-mismatch"))?;
        }
    }
    Ok(())
}
fn insert(db: &Connection, table: &str, row: &Row) -> Result<i64> {
    let mut names: Vec<_> = row.keys().filter(|name| name.as_str() != "id").collect();
    names.sort();
    let sql = format!(
        "INSERT INTO {} ({}) VALUES ({})",
        quote(table),
        names
            .iter()
            .map(|name| quote(name))
            .collect::<Vec<_>>()
            .join(","),
        vec!["?"; names.len()].join(",")
    );
    db.execute(&sql, params_from_iter(names.iter().map(|name| &row[*name])))?;
    Ok(db.last_insert_rowid())
}
fn merge(
    source: &Connection,
    target: &Connection,
    mut report: ClassOutcome,
    key: &[u8],
    platform: &str,
) -> Result<(ClassOutcome, bool)> {
    validate_schema(source, target)?;
    validate_key(target, key, platform)?;
    let has_id = columns(source, "logins")?
        .iter()
        .any(|row| text(row, "name") == "id");
    let find = format!(
        "SELECT 1 AS found FROM logins WHERE {}",
        IDENTITY
            .iter()
            .map(|name| format!("{} IS ?", quote(name)))
            .collect::<Vec<_>>()
            .join(" AND ")
    );
    report.migrated = 0;
    let mut inserted = false;
    for row in rows(source, "SELECT * FROM logins ORDER BY rowid", &[])? {
        let values: Vec<_> = IDENTITY.iter().map(|name| row[*name].clone()).collect();
        if !rows(target, &find, &values)?.is_empty() {
            report.skipped.push(MigrationEntry::new(
                "passwords",
                "Login Data",
                "target-existing",
            ));
            continue;
        }
        let new_id = insert(target, "logins", &row)?;
        inserted = true;
        if has_id {
            for table in ["password_notes", "insecure_credentials"] {
                if columns(source, table)?.is_empty() {
                    continue;
                }
                for mut child in rows(
                    source,
                    &format!("SELECT * FROM {table} WHERE parent_id=?"),
                    &[row["id"].clone()],
                )? {
                    child.insert("parent_id".into(), Value::Integer(new_id));
                    insert(target, table, &child)?;
                }
            }
        }
        if !super::passwords::to_bytes(row["password_value"].clone()).is_empty() {
            report.migrated += 1;
        }
    }
    Ok((report, inserted))
}

pub(super) fn preflight(source: Option<&Path>, target: &Path) -> Result<()> {
    assert_target_closed(target)?;
    for dir in source.into_iter().chain([target]) {
        for suffix in ["-wal", "-shm", "-journal"] {
            if active_sidecar(&dir.join(format!("Login Data For Account{suffix}")), suffix)? {
                return Err(refusal("account-store-unsupported"));
            }
        }
        let account = dir.join("Login Data For Account");
        if !super::fs_utils::path_exists(&account) {
            continue;
        }
        let result = (|| -> Result<()> {
            let db =
                Connection::open_with_flags(&account, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
            let names = rows(
                &db,
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
                &[],
            )?;
            if !names.iter().any(|row| text(row, "name") == "logins")
                || names.iter().any(|row| !TABLES.contains(&text(row, "name")))
            {
                return Err(refusal("account-store-unsupported"));
            }
            let cols = columns(&db, "logins")?;
            let login_names: Vec<_> = cols.iter().map(|row| text(row, "name")).collect();
            if IDENTITY
                .iter()
                .chain([&"password_value"])
                .any(|name| !login_names.contains(name))
                || login_names
                    .iter()
                    .any(|name| !LOGIN_COLUMNS.split_whitespace().any(|known| known == *name))
            {
                return Err(refusal("account-store-unsupported"));
            }
            for table in ["logins", "password_notes", "insecure_credentials"] {
                if names.iter().any(|row| text(row, "name") == table)
                    && !rows(&db, &format!("SELECT 1 FROM {table} LIMIT 1"), &[])?.is_empty()
                {
                    return Err(refusal("account-store-unsupported"));
                }
            }
            Ok(())
        })();
        result.map_err(|_| refusal("account-store-unsupported"))?;
    }
    Ok(())
}

struct PasswordLock {
    path: PathBuf,
    file: Option<fs::File>,
}
impl Drop for PasswordLock {
    fn drop(&mut self) {
        self.file.take();
        let _ = fs::remove_file(&self.path);
    }
}

pub(super) fn with_password_store(
    source: Option<&Path>,
    target: &Path,
    key: &[u8],
    platform: &str,
    prepare: impl FnOnce(&Path) -> Result<ClassOutcome>,
) -> Result<ClassOutcome> {
    if let Some(source) = source {
        super::validation::validate_paths(source, target)?;
    }
    preflight(source, target)?;
    let target_path = target.join("Login Data");
    if fs::symlink_metadata(&target_path)
        .map(|stat| stat.file_type().is_symlink())
        .unwrap_or(false)
    {
        return Err(refusal("unsupported-password-schema"));
    }
    let original = if target_path.exists() {
        Some(fs::read(&target_path)?)
    } else {
        None
    };
    fs::create_dir_all(target)?;
    let lock_path = target.join(".password-refresh.lock");
    let file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&lock_path)
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::AlreadyExists {
                refusal("target-busy")
            } else {
                error.into()
            }
        })?;
    let _lock = PasswordLock {
        path: lock_path,
        file: Some(file),
    };
    // A private directory on the same filesystem permits an atomic publication.
    let directory = target.join(format!(
        ".password-refresh-{}-{}",
        std::process::id(),
        super::chromium_crypto::random_bytes(8)?
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>()
    ));
    fs::create_dir(&directory)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&directory, fs::Permissions::from_mode(0o700))?;
    }
    let result = (|| {
        let prepared = directory.join("source");
        let mut report = prepare(&prepared)?;
        let mut publish = prepared.clone();
        let mut changed = true;
        if original.is_some() {
            publish = directory.join("target");
            let db = Connection::open_with_flags(
                &target_path,
                rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
            )?;
            db.backup(rusqlite::MAIN_DB, &publish, None)?;
            drop(db);
            let source_db = Connection::open(&prepared)?;
            let target_db = Connection::open(&publish)?;
            (report, changed) =
                merge(&source_db, &target_db, report, key, platform).map_err(|error| {
                    if error.to_string().starts_with("Password refresh refused") {
                        error
                    } else {
                        refusal("unsupported-password-schema")
                    }
                })?;
        }
        preflight(source, target)?;
        let current = if target_path.exists() {
            Some(fs::read(&target_path)?)
        } else {
            None
        };
        if current != original {
            return Err(refusal("target-changed"));
        }
        if changed {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(&publish, fs::Permissions::from_mode(0o600))?;
            }
            fs::rename(&publish, &target_path)?;
        }
        Ok(report)
    })();
    super::fs_utils::remove_dir_quietly(&directory);
    result
}
