//! Explicit session-cookie persistence for caller-owned dedicated profiles.
use std::path::{Path, PathBuf};
use std::sync::Arc;

use super::browser_process::BrowserCloser;
use super::storage_state::{save_storage_state, write_restricted_state, StorageStateInput};
use crate::core::engine::EngineAdapter;

pub(crate) fn validate(path: Option<&Path>, profile: Option<&Path>) -> anyhow::Result<()> {
    if path.is_some() {
        super::system_browser::assert_dedicated_user_data_dir(profile.ok_or_else(|| {
            anyhow::anyhow!("persist_session_cookies requires an explicit dedicated user_data_dir")
        })?)?;
    }
    Ok(())
}

struct PersistentCloser {
    page: Arc<dyn EngineAdapter>,
    inner: Arc<dyn BrowserCloser>,
    path: PathBuf,
    closed: tokio::sync::Mutex<bool>,
}

#[async_trait::async_trait]
impl BrowserCloser for PersistentCloser {
    async fn close(&self) -> anyhow::Result<()> {
        let mut closed = self.closed.lock().await;
        if *closed {
            return Ok(());
        }
        *closed = true;
        let saved = async {
            let mut state = save_storage_state(self.page.as_ref(), None).await?;
            state.cookies.retain(|cookie| {
                cookie["expires"]
                    .as_f64()
                    .is_none_or(|expires| expires <= 0.0)
            });
            state.origins.clear();
            write_restricted_state(&self.path, &state)
        }
        .await;
        let stopped = self.inner.close().await;
        saved.and(stopped)
    }
}

pub(crate) async fn install(
    page: Arc<dyn EngineAdapter>,
    closer: Arc<dyn BrowserCloser>,
    path: &Path,
) -> anyhow::Result<Arc<dyn BrowserCloser>> {
    if path.exists() {
        let state = StorageStateInput::Path(path.into()).load()?;
        page.restore_storage_state(serde_json::to_value(state)?)
            .await?;
    }
    Ok(Arc::new(PersistentCloser {
        page,
        inner: closer,
        path: path.into(),
        closed: tokio::sync::Mutex::new(false),
    }))
}
