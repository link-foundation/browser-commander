use std::fs;
use std::sync::Arc;

use rusqlite::{params, Connection};

use super::super::chromium_crypto::{encrypt_chromium_value, random_bytes};
use super::super::passwords::{migrate_passwords_filtered, PasswordKeys};
use super::super::SourceKeyResolver;
use super::fixtures::TempDir;
use crate::browser::browser_cookie_crypto::decrypt_chromium_cookie;

#[test]
#[cfg(unix)]
fn live_target_through_alias_with_spaces_is_refused() {
    use std::process::{Command, Stdio};
    let root = TempDir::new("bc-live-password-target-");
    let target = root.path().join("profile with spaces");
    fs::create_dir(&target).unwrap();
    let alias = root.path().join("alias");
    std::os::unix::fs::symlink(root.path(), &alias).unwrap();
    // read blocks until this test closes stdin; no background grandchildren.
    let mut child = Command::new("sh")
        .args(["-c", "read -r line", "--"])
        .arg(format!(
            "--user-data-dir={}",
            alias.join("profile with spaces").display()
        ))
        .arg(format!("--unused={}", "x".repeat(1024)))
        .stdin(Stdio::piped())
        .spawn()
        .unwrap();
    let unrelated = super::super::password_store::assert_target_closed(&root.path().join("closed"));
    let result = super::super::password_store::assert_target_closed(&target);
    drop(child.stdin.take());
    child.wait().unwrap();
    unrelated.unwrap();
    assert!(result.unwrap_err().to_string().contains("target-active"));
}

fn fixture(source: &TempDir, target: &TempDir, source_key: &[u8], target_key: &[u8]) {
    for (dir, key, records) in [
        (
            source,
            source_key,
            [
                ("https://login.live.com", "shared", "source-conflict"),
                ("https://new.live.com", "new", "new-secret"),
                ("https://notlive.com", "excluded", "excluded-secret"),
            ],
        ),
        (
            target,
            target_key,
            [
                ("https://example.test", "unrelated", "unrelated-secret"),
                ("https://login.live.com", "shared", "target-conflict"),
                ("https://only.live.com", "only", "target-only"),
            ],
        ),
    ] {
        let db = Connection::open(dir.path().join("Login Data")).unwrap();
        db.execute_batch(include_str!(
            "../../../../../tests/fixtures/password-refresh.sql"
        ))
        .unwrap();
        for (index, (origin, username, password)) in records.iter().enumerate() {
            let value =
                encrypt_chromium_value(password.as_bytes(), key, "linux", Some("v11")).unwrap();
            db.execute(
                "INSERT INTO logins VALUES (?,?,?,?,?,?,?,?,?)",
                params![
                    index as i64 + 1,
                    origin,
                    "",
                    username,
                    "",
                    format!("{origin}/"),
                    value,
                    13300000000000001_i64,
                    13300000000000002_i64
                ],
            )
            .unwrap();
        }
        let note = encrypt_chromium_value(
            if dir.path() == source.path() {
                b"source-note"
            } else {
                b"target-note"
            },
            key,
            "linux",
            Some("v11"),
        )
        .unwrap();
        db.execute(
            "INSERT INTO password_notes VALUES (1,2,?,?,123,1)",
            params!["note", note],
        )
        .unwrap();
        db.execute_batch("INSERT INTO insecure_credentials VALUES (2,0); INSERT INTO sync_model_metadata VALUES (1,'private-sync-state')").unwrap();
    }
}

#[test]
fn scoped_refresh_preserves_credentials_metadata_and_is_idempotent() {
    let source = TempDir::new("bc-refresh-source-");
    let target = TempDir::new("bc-refresh-target-");
    let source_key = random_bytes(16).unwrap();
    let target_key = random_bytes(16).unwrap();
    fixture(&source, &target, &source_key, &target_key);
    let resolver: SourceKeyResolver = Arc::new(move |_| Ok(source_key.clone()));
    let keys = PasswordKeys {
        platform: "linux",
        resolve_source_key: &resolver,
        target_key: &target_key,
        target_prefix: Some("v11"),
    };
    let run =
        || migrate_passwords_filtered(source.path(), target.path(), &keys, &["live.com".into()]);
    let original = fs::read(source.path().join("Login Data")).unwrap();
    let report = run().unwrap();
    assert_eq!(report.migrated, 1);
    assert!(report
        .skipped
        .iter()
        .any(|entry| entry.reason == "target-existing"));
    let db = Connection::open(target.path().join("Login Data")).unwrap();
    let records: Vec<(Vec<u8>, i64)> = db
        .prepare("SELECT password_value,date_created FROM logins ORDER BY origin_url")
        .unwrap()
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap();
    assert_eq!(records.len(), 4);
    assert_eq!(
        records
            .iter()
            .map(|(value, _)| decrypt_chromium_cookie(value, "", 0, "linux", &target_key).unwrap())
            .collect::<Vec<_>>(),
        [
            "unrelated-secret",
            "target-conflict",
            "new-secret",
            "target-only"
        ]
    );
    assert_eq!(records[2].1, 13300000000000001);
    let notes: Vec<(String, Vec<u8>)> = db.prepare("SELECT logins.origin_url,password_notes.value FROM password_notes JOIN logins ON logins.id=password_notes.parent_id ORDER BY logins.origin_url").unwrap().query_map([], |row| Ok((row.get(0)?,row.get(1)?))).unwrap().collect::<rusqlite::Result<_>>().unwrap();
    assert_eq!(
        notes
            .iter()
            .map(|(origin, value)| (
                origin.as_str(),
                decrypt_chromium_cookie(value, "", 0, "linux", &target_key).unwrap()
            ))
            .collect::<Vec<_>>(),
        [
            ("https://login.live.com", "target-note".into()),
            ("https://new.live.com", "source-note".into())
        ]
    );
    for table in ["password_notes", "insecure_credentials"] {
        assert_eq!(
            db.query_row(&format!("SELECT count(*) FROM {table}"), [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            2
        );
    }
    assert_eq!(
        db.query_row(
            "SELECT model_metadata FROM sync_model_metadata",
            [],
            |row| row.get::<_, String>(0)
        )
        .unwrap(),
        "private-sync-state"
    );
    drop(db);
    let before = fs::read(target.path().join("Login Data")).unwrap();
    assert_eq!(run().unwrap().migrated, 0);
    assert_eq!(fs::read(target.path().join("Login Data")).unwrap(), before);
    assert_eq!(
        fs::read(source.path().join("Login Data")).unwrap(),
        original
    );
    let summary = format!("{:?} {:?}", report.skipped, report.warnings);
    for secret in [
        "shared",
        "new-secret",
        "source-note",
        "target-note",
        "private-sync-state",
    ] {
        assert!(!summary.contains(secret));
    }
}

#[test]
fn refusals_leave_target_bytes_unchanged() {
    for kind in [
        "active",
        "schema",
        "metadata",
        "version",
        "trigger",
        "wal",
        "journal",
        "account-source",
        "account-target",
        "key",
    ] {
        let source = TempDir::new("bc-refresh-source-");
        let target = TempDir::new("bc-refresh-target-");
        let source_key = random_bytes(16).unwrap();
        let target_key = random_bytes(16).unwrap();
        fixture(&source, &target, &source_key, &target_key);
        match kind {
            "active" => fs::write(target.path().join("SingletonLock"), b"").unwrap(),
            "wal" | "journal" => fs::write(
                target.path().join(format!("Login Data-{kind}")),
                b"active journal",
            )
            .unwrap(),
            "account-source" => {
                fs::write(source.path().join("Login Data For Account"), b"").unwrap()
            }
            "account-target" => {
                fs::write(target.path().join("Login Data For Account"), b"").unwrap()
            }
            _ => {
                let db = Connection::open(target.path().join("Login Data")).unwrap();
                db.execute_batch(match kind {
                    "schema" => "ALTER TABLE logins ADD COLUMN opaque_secret BLOB",
                    "metadata" => "ALTER TABLE password_notes ADD COLUMN opaque_secret BLOB",
                    "version" => "UPDATE meta SET value='999' WHERE key='version'",
                    "trigger" => "CREATE TRIGGER unexpected AFTER INSERT ON logins BEGIN DELETE FROM password_notes; END",
                    _ => "UPDATE logins SET password_value=X'76313101'",
                })
                .unwrap();
            }
        }
        let before = fs::read(target.path().join("Login Data")).unwrap();
        let resolver: SourceKeyResolver = Arc::new(move |_| Ok(source_key.clone()));
        let error = migrate_passwords_filtered(
            source.path(),
            target.path(),
            &PasswordKeys {
                platform: "linux",
                resolve_source_key: &resolver,
                target_key: &target_key,
                target_prefix: Some("v11"),
            },
            &["live.com".into()],
        )
        .unwrap_err();
        assert!(
            error.to_string().contains("Password refresh refused"),
            "{kind}: {error}"
        );
        assert_eq!(
            fs::read(target.path().join("Login Data")).unwrap(),
            before,
            "{kind}"
        );
    }
}

#[test]
fn empty_account_store_and_persistent_journal_are_preserved() {
    let source = TempDir::new("bc-empty-account-source-");
    let target = TempDir::new("bc-empty-account-target-");
    let source_key = random_bytes(16).unwrap();
    let target_key = random_bytes(16).unwrap();
    fixture(&source, &target, &source_key, &target_key);
    let account = target.path().join("Login Data For Account");
    let db = Connection::open(&account).unwrap();
    db.execute_batch(include_str!(
        "../../../../../tests/fixtures/password-refresh.sql"
    ))
    .unwrap();
    drop(db);
    let before = fs::read(&account).unwrap();
    fs::write(target.path().join("Login Data-journal"), [0; 512]).unwrap();
    let resolver: SourceKeyResolver = Arc::new(move |_| Ok(source_key.clone()));
    let keys = PasswordKeys {
        platform: "linux",
        resolve_source_key: &resolver,
        target_key: &target_key,
        target_prefix: Some("v11"),
    };
    assert_eq!(
        migrate_passwords_filtered(source.path(), target.path(), &keys, &["live.com".into()])
            .unwrap()
            .migrated,
        1
    );
    assert_eq!(fs::read(account).unwrap(), before);
    fs::copy(
        source.path().join("Login Data"),
        source.path().join("Login Data For Account"),
    )
    .unwrap();
    let main_before = fs::read(target.path().join("Login Data")).unwrap();
    assert!(
        migrate_passwords_filtered(source.path(), target.path(), &keys, &["live.com".into()])
            .unwrap_err()
            .to_string()
            .contains("account-store-unsupported")
    );
    assert_eq!(
        fs::read(target.path().join("Login Data")).unwrap(),
        main_before
    );
}

#[test]
fn repeated_translated_password_writes_preserve_target() {
    use super::super::firefox::{write_chromium_passwords, DecryptedLogin, FirefoxPasswordKeys};
    let target = TempDir::new("bc-translated-refresh-");
    let key = random_bytes(16).unwrap();
    let keys = FirefoxPasswordKeys {
        platform: "linux",
        target_key: &key,
        target_prefix: Some("v11"),
        primary_password: &[],
    };
    let write = |password: &str| {
        write_chromium_passwords(
            target.path(),
            &[DecryptedLogin {
                origin: Some("https://login.live.com".into()),
                username: "local-user".into(),
                password: password.into(),
            }],
            &keys,
        )
    };
    assert_eq!(write("first-secret").unwrap().migrated, 1);
    let before = fs::read(target.path().join("Login Data")).unwrap();
    let report = write("second-secret").unwrap();
    assert_eq!(report.migrated, 0);
    assert_eq!(report.skipped[0].reason, "target-existing");
    assert_eq!(fs::read(target.path().join("Login Data")).unwrap(), before);
}
