//! A native live-profile snapshot keeps committed WAL data and owns only its copy.

use std::fs;

use browser_commander::browser::profile_directory::{
    create_temporary_user_data_dir, remove_user_data_dir,
};
use browser_commander::{snapshot_user_data_dir, SnapshotOptions};
use rusqlite::{Connection, OpenFlags};
use serde_json::json;

// feature-parity: attach.snapshot@native-typed
#[tokio::test]
async fn live_wal_snapshot_preserves_source_and_selected_profile() -> anyhow::Result<()> {
    let source = create_temporary_user_data_dir(None)?;
    let profile = source.join("Profile 1");
    fs::create_dir(&profile)?;
    let original =
        json!({"browser":{"check_default_browser":true},"profile":{"exit_type":"Crashed"}});
    fs::write(profile.join("Preferences"), serde_json::to_vec(&original)?)?;
    fs::create_dir(profile.join("Cache"))?;
    fs::write(profile.join("LOCK"), "locked")?;
    let database = Connection::open(profile.join("History"))?;
    database.execute_batch(
        "PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;
        CREATE TABLE visits(url TEXT); INSERT INTO visits VALUES ('committed');
        BEGIN IMMEDIATE; INSERT INTO visits VALUES ('uncommitted');",
    )?;
    let report = snapshot_user_data_dir(
        &SnapshotOptions {
            user_data_dir: Some(source.clone()),
            profile: "Profile 1".into(),
            ..Default::default()
        },
        None,
    )?;
    let copied = Connection::open_with_flags(
        report.target.join("Profile 1/History"),
        OpenFlags::SQLITE_OPEN_READ_ONLY,
    )?;
    assert_eq!(
        copied.query_row("SELECT count(*) FROM visits", [], |r| r.get::<_, i64>(0))?,
        1
    );
    drop(copied);
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&fs::read(profile.join("Preferences"))?)?,
        original
    );
    let preferences: serde_json::Value =
        serde_json::from_slice(&fs::read(report.target.join("Profile 1/Preferences"))?)?;
    assert_eq!(
        preferences.pointer("/browser/check_default_browser"),
        Some(&json!(false))
    );
    assert_eq!(
        preferences.pointer("/profile/exit_type"),
        Some(&json!("Normal"))
    );
    assert_eq!(report.copied.databases, 1);
    assert!(!report.target.join("Profile 1/Cache").exists());
    assert!(!report.target.join("Profile 1/History-wal").exists());
    assert!(report.skipped.iter().any(|item| item.reason == "lock"));
    drop(database);
    remove_user_data_dir(&report.target).await?;
    remove_user_data_dir(&source).await?;
    Ok(())
}

#[tokio::test]
async fn snapshot_rejects_traversal_and_target_in_source() -> anyhow::Result<()> {
    let source = create_temporary_user_data_dir(None)?;
    for profile in ["..", "../Default", "Profile/1", "Profile\\1", ".", ""] {
        assert!(snapshot_user_data_dir(
            &SnapshotOptions {
                user_data_dir: Some(source.clone()),
                profile: profile.into(),
                ..Default::default()
            },
            None
        )
        .is_err());
    }
    assert!(snapshot_user_data_dir(
        &SnapshotOptions {
            user_data_dir: Some(source.clone()),
            ..Default::default()
        },
        Some(&source.join("copy"))
    )
    .is_err());
    remove_user_data_dir(&source).await?;
    Ok(())
}

#[tokio::test]
async fn locked_database_snapshot_does_not_wait_for_browser_exit() -> anyhow::Result<()> {
    use std::sync::mpsc;
    use std::time::{Duration, Instant};

    let source = create_temporary_user_data_dir(None)?;
    fs::create_dir_all(source.join("Default"))?;
    let path = source.join("Default/History");
    let database = Connection::open(&path)?;
    database.execute_batch("CREATE TABLE visits(url TEXT); INSERT INTO visits VALUES ('saved')")?;
    drop(database);
    let (ready, locked) = mpsc::channel();
    let lock = std::thread::spawn(move || {
        let writer = Connection::open(path).unwrap();
        writer.execute_batch("BEGIN EXCLUSIVE").unwrap();
        ready.send(()).unwrap();
        // Always release the lock, even when a regression makes the copy wait.
        std::thread::sleep(Duration::from_secs(4));
        writer.execute_batch("ROLLBACK").unwrap();
    });
    locked.recv()?;
    let started = Instant::now();
    let report = snapshot_user_data_dir(
        &SnapshotOptions {
            user_data_dir: Some(source.clone()),
            ..Default::default()
        },
        None,
    )?;
    let elapsed = started.elapsed();
    lock.join().unwrap();
    assert_eq!(report.copied.databases, 0);
    assert!(!report.target.join("Default/History").exists());
    assert!(report
        .skipped
        .iter()
        .any(|entry| entry.item == "Default/History"
            && entry.reason == "unreadable"
            && entry.detail.as_deref().is_some_and(|detail| detail
                .contains("Consistent SQLite snapshot unavailable")
                && detail.contains("close the source browser"))));
    remove_user_data_dir(&report.target).await?;
    remove_user_data_dir(&source).await?;
    assert!(
        elapsed < Duration::from_secs(3),
        "snapshot waited {elapsed:?} for the browser lock"
    );
    Ok(())
}

/// Requires Chrome and the official Playwright/Puppeteer packages in ../js.
#[tokio::test]
#[ignore]
async fn native_snapshot_launches_selected_profile_in_all_cdp_engines() -> anyhow::Result<()> {
    use browser_commander::{launch_real_browser, launch_snapshot, EngineType, RealBrowserOptions};
    let source_path = create_temporary_user_data_dir(None)?;
    let source_options = RealBrowserOptions {
        user_data_dir: Some(source_path.clone()),
        profile_directory: "Profile 1".into(),
        headless: true,
        args: vec![
            "--no-sandbox".into(),
            "--profile-directory=Profile 1".into(),
        ],
        ..Default::default()
    };
    let source = launch_real_browser(source_options).await?;
    source.page.evaluate("document.title = 'original'").await?;
    eprintln!("Source Profile 1 is ready");
    let result = async {
        for engine in [
            EngineType::Chromiumoxide,
            EngineType::Playwright,
            EngineType::Puppeteer,
        ] {
            eprintln!("Copying source for {engine}");
            let copy = launch_snapshot(
                SnapshotOptions {
                    user_data_dir: Some(source_path.clone()),
                    profile: "Profile 1".into(),
                    ..Default::default()
                },
                RealBrowserOptions {
                    engine,
                    headless: true,
                    args: vec!["--no-sandbox".into()],
                    node_working_dir: Some(
                        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../js"),
                    ),
                    ..Default::default()
                },
            )
            .await?;
            let target = copy.user_data_dir.clone();
            let verify = async {
                assert!(copy.temporary_profile);
                assert!(copy
                    .args
                    .iter()
                    .any(|a| a == "--profile-directory=Profile 1"));
                copy.page.evaluate("document.title = 'copy'").await?;
                assert_eq!(copy.page.evaluate("document.title").await?, json!("copy"));
                Ok::<_, anyhow::Error>(())
            }
            .await;
            copy.close().await?;
            verify?;
            assert!(!target.exists());
            eprintln!("{engine}: copy shut down and removed");
            assert_eq!(
                source.page.evaluate("document.title").await?,
                json!("original")
            );
        }
        Ok::<_, anyhow::Error>(())
    }
    .await;
    source.close().await?;
    remove_user_data_dir(&source_path).await?;
    result
}
