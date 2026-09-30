//! Plain command-stream reference process with deterministic/cancellation cleanup.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use anyhow::{bail, Result};
use serde_json::Value;

use super::{server::ProbeServer, MeasureParityOptions};
use crate::browser::profile_directory::{create_temporary_user_data_dir, remove_user_data_dir};
use crate::utilities::{start_process, ManagedProcess, StartProcessOptions};

struct Reference {
    directory: PathBuf,
    child: Option<ManagedProcess>,
}

/// Arguments for a plain reference browser, with no implicit automation or CDP switches.
pub fn build_reference_args(
    directory: &Path,
    url: &str,
    headless: bool,
    extra_args: &[String],
) -> Vec<String> {
    let mut args = vec![format!("--user-data-dir={}", directory.display())];
    if headless {
        args.push("--headless=new".into());
    }
    args.extend_from_slice(extra_args);
    args.push(url.into());
    args
}

impl Reference {
    async fn close(&mut self) -> Result<()> {
        if let Some(child) = self.child.take() {
            child.kill();
            child.wait_timeout(Duration::from_secs(6)).await;
        }
        remove_user_data_dir(&self.directory).await
    }
}

impl Drop for Reference {
    fn drop(&mut self) {
        let directory = self.directory.clone();
        if let Some(child) = self.child.take() {
            child.kill();
            if let Ok(runtime) = tokio::runtime::Handle::try_current() {
                runtime.spawn(async move {
                    child.wait_timeout(Duration::from_secs(6)).await;
                    let _ = remove_user_data_dir(&directory).await;
                });
                return;
            }
        }
        let _ = std::fs::remove_dir_all(directory);
    }
}

pub(super) async fn capture(
    server: &ProbeServer,
    executable: &Path,
    options: &MeasureParityOptions,
) -> Result<Value> {
    let mut reference = Reference {
        directory: create_temporary_user_data_dir(None)?,
        child: None,
    };
    let args = build_reference_args(
        &reference.directory,
        &server.reference_url,
        options.launch.headless,
        &options.reference_args,
    );
    let stderr = Arc::new(Mutex::new(Vec::<u8>::new()));
    let tail = stderr.clone();
    reference.child = Some(
        start_process(
            &executable.to_string_lossy(),
            &args,
            StartProcessOptions {
                kill_grace: Duration::from_secs(3),
                on_stderr: vec![Arc::new(move |chunk| {
                    if let Ok(mut tail) = tail.lock() {
                        tail.extend_from_slice(chunk);
                        let remove = tail.len().saturating_sub(4000);
                        tail.drain(..remove);
                    }
                })],
                ..Default::default()
            },
        )
        .await?,
    );
    let child = reference.child.as_ref().unwrap();
    let exited = async {
        let code = child.wait().await;
        if code == 0 {
            std::future::pending::<()>().await;
        }
        bail!(
            "reference browser {} exited with code {code} before reporting",
            executable.display()
        );
    };
    let captured = tokio::select! {
        report = server.report(true, options.timeout) => report,
        result = exited => result,
    };
    let captured = captured.map_err(|error| {
        let tail = stderr
            .lock()
            .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
            .unwrap_or_default();
        anyhow::anyhow!("{error}\nbrowser stderr:\n{tail}")
    });
    let closed = reference.close().await;
    let report = captured?;
    closed?;
    Ok(report)
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[tokio::test]
    async fn reports_early_reference_exit_with_stderr() -> Result<()> {
        let server = ProbeServer::start().await?;
        // sh rejects the browser's arguments immediately: a bounded startup failure.
        let error = tokio::time::timeout(
            Duration::from_secs(3),
            capture(
                &server,
                Path::new("/bin/sh"),
                &MeasureParityOptions::default(),
            ),
        )
        .await?
        .unwrap_err();
        let text = error.to_string();
        assert!(text.contains("exited with code"), "{text}");
        assert!(text.contains("browser stderr:"), "{text}");
        Ok(())
    }

    #[tokio::test]
    async fn cancellation_reaps_reference_before_removing_its_profile() -> Result<()> {
        let directory = create_temporary_user_data_dir(None)?;
        let path = directory.clone();
        let (ready, started) = tokio::sync::oneshot::channel();
        let task = tokio::spawn(async move {
            let reference = Reference {
                directory,
                child: Some(
                    start_process(
                        "/bin/sh",
                        &["-c", "exec sleep 30"],
                        StartProcessOptions {
                            kill_grace: Duration::from_millis(50),
                            ..Default::default()
                        },
                    )
                    .await
                    .unwrap(),
                ),
            };
            ready
                .send(reference.child.as_ref().unwrap().pid().unwrap())
                .unwrap();
            std::future::pending::<()>().await;
            drop(reference);
        });
        let pid = started.await?;
        task.abort();
        let _ = task.await;
        tokio::time::timeout(Duration::from_secs(7), async {
            while path.exists() {
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        })
        .await?;
        let result = crate::utilities::run_command(
            "/bin/kill",
            &["-0".to_owned(), pid.to_string()],
            crate::utilities::RunCommandOptions {
                check: false,
                ..Default::default()
            },
        )
        .await?;
        assert_ne!(
            result.code, 0,
            "reference process {pid} survived cancellation"
        );
        Ok(())
    }
}
