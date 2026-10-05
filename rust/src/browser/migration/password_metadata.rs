//! Filter Login Data associations and re-key notes after pruning logins.

use anyhow::Result;
use rusqlite::{params, Connection};

use super::domains::matches_domains;
use super::passwords::{reencrypt_secret, to_bytes, PasswordKeys, SecretRewrite};
use super::{ClassOutcome, MigrationEntry};

pub(super) fn migrate_password_metadata(
    database: &Connection,
    keys: &PasswordKeys<'_>,
    domains: &[String],
    outcome: &mut ClassOutcome,
) -> Result<()> {
    let tables: Vec<String> = database
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")?
        .query_map([], |row| row.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    let has = |name: &str| tables.iter().any(|table| table == name);
    for table in ["password_notes", "insecure_credentials"] {
        if has(table) {
            database.execute(&format!("DELETE FROM {table} WHERE NOT EXISTS (SELECT 1 FROM logins WHERE logins.id={table}.parent_id)"), [])?;
        }
    }
    if has("password_notes") {
        let rows: Vec<(i64, Option<String>, Vec<u8>)> = database.prepare("SELECT password_notes.rowid,logins.origin_url,password_notes.value FROM password_notes JOIN logins ON logins.id=password_notes.parent_id")?.query_map([], |row| Ok((row.get(0)?, row.get(1)?, to_bytes(row.get(2)?))))?.collect::<rusqlite::Result<_>>()?;
        for (id, origin, value) in rows {
            match reencrypt_secret(&value, origin.as_deref(), keys)? {
                SecretRewrite::Encrypted(value) => {
                    database.execute(
                        "UPDATE password_notes SET value=? WHERE rowid=?",
                        params![value, id],
                    )?;
                }
                SecretRewrite::Skipped(mut entry) => {
                    database.execute("DELETE FROM password_notes WHERE rowid=?", [id])?;
                    entry.item = format!("password_notes/{id}");
                    outcome.skipped.push(entry);
                }
            }
        }
    }
    let sync_tables = [
        "sync_entities_metadata",
        "sync_model_metadata",
        "incoming_sharing_invitation_sync_entities_metadata",
        "incoming_sharing_invitation_sync_model_metadata",
    ];
    for table in sync_tables {
        if has(table) {
            reset_metadata(database, table, "sync-metadata-reset", outcome)?;
        }
    }
    if domains.is_empty() {
        return Ok(());
    }
    if has("stats") {
        let rows: Vec<(i64, Option<String>)> = database
            .prepare("SELECT rowid,origin_domain FROM stats")?
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect::<rusqlite::Result<_>>()?;
        for (id, origin) in rows {
            if !matches_domains(origin.as_deref().unwrap_or_default(), domains) {
                database.execute("DELETE FROM stats WHERE rowid=?", [id])?;
            }
        }
    }
    let known = [
        "logins",
        "meta",
        "password_notes",
        "insecure_credentials",
        "stats",
    ];
    for table in &tables {
        if !known.contains(&table.as_str())
            && !sync_tables.contains(&table.as_str())
            && !table.starts_with("sqlite_")
        {
            reset_metadata(database, table, "unsupported-password-metadata", outcome)?;
        }
    }
    Ok(())
}

fn reset_metadata(
    database: &Connection,
    table: &str,
    reason: &str,
    outcome: &mut ClassOutcome,
) -> Result<()> {
    let quoted = format!("\"{}\"", table.replace('"', "\"\""));
    let count = database.execute(&format!("DELETE FROM {quoted}"), [])?;
    if count > 0 {
        outcome.warnings.push(
            MigrationEntry::new("passwords", table, reason)
                .with_detail(format!("{count} copied metadata rows removed")),
        );
    }
    Ok(())
}
