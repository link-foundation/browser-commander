//! Attaching the download manager to a browser (issue #88).
//!
//! Every entry point — [`launch_browser`](crate::browser::launch_browser),
//! [`connect_browser`](crate::browser::connect_browser) and
//! [`launch_real_browser`](crate::browser::launch_real_browser) — goes through
//! this one function, so the managed lifecycle is the same however the browser
//! was obtained. The manager is built from the live CDP connection, never from
//! the way the browser was created.
//!
//! # Example
//!
//! ```rust
//! use browser_commander::core::EngineType;
//! use browser_commander::downloads::{normalize_download_options, DownloadSetting};
//!
//! assert!(normalize_download_options(DownloadSetting::Off).is_none());
//! assert!(normalize_download_options(DownloadSetting::On).is_some());
//!
//! // An engine that cannot manage downloads says so rather than quietly
//! // handing back a manager that would never see a file.
//! use browser_commander::downloads::supported_engine;
//! assert!(supported_engine(EngineType::Chromiumoxide).is_ok());
//! assert!(supported_engine(EngineType::Fantoccini).is_err());
//! ```

use std::sync::Arc;

use crate::core::EngineType;
use crate::downloads::manager::DownloadManager;
use crate::downloads::options::DownloadOptions;
use crate::downloads::DownloadError;
use crate::fingerprint::CdpTransport;

/// The caller's `downloads` option.
///
/// The three-way shape mirrors the `true | false | {…}` the JavaScript and
/// Python packages accept, so the same configuration reads the same way in all
/// three languages.
#[derive(Debug, Clone, Default)]
pub enum DownloadSetting {
    /// Downloads are not managed. The browser's own behavior is untouched.
    #[default]
    Off,
    /// Manage downloads with the defaults.
    On,
    /// Manage downloads with these options.
    Options(Box<DownloadOptions>),
}

impl From<bool> for DownloadSetting {
    fn from(enabled: bool) -> Self {
        if enabled {
            Self::On
        } else {
            Self::Off
        }
    }
}

impl From<DownloadOptions> for DownloadSetting {
    fn from(options: DownloadOptions) -> Self {
        Self::Options(Box::new(options))
    }
}

/// Turn the caller's setting into manager options.
///
/// # Arguments
///
/// * `setting` - What the caller asked for
///
/// # Returns
///
/// Manager options, or `None` when downloads are not managed.
pub fn normalize_download_options(setting: DownloadSetting) -> Option<DownloadOptions> {
    match setting {
        DownloadSetting::Off => None,
        DownloadSetting::On => Some(DownloadOptions::default()),
        DownloadSetting::Options(options) => Some(*options),
    }
}

/// Check that an engine can manage downloads at all.
///
/// Refusing here is the honest answer, and it is what issue #88 asks for:
/// "unsupported engine limitations are explicit rather than silently ignored".
/// A manager attached to an engine with no route to
/// `Browser.setDownloadBehavior` would sit watching an empty directory and
/// report every capture as a timeout.
///
/// # Arguments
///
/// * `engine` - The engine driving the browser
///
/// # Errors
///
/// Returns [`DownloadError::Unsupported`] for every engine but
/// [`EngineType::Chromiumoxide`], naming the engine and what to use instead.
pub fn supported_engine(engine: EngineType) -> Result<(), DownloadError> {
    match engine {
        EngineType::Chromiumoxide => Ok(()),
        EngineType::Fantoccini => Err(DownloadError::Unsupported {
            engine: engine.to_string(),
            reason: "WebDriver has neither download events nor a way to \
                     redirect downloads; use EngineType::Chromiumoxide"
                .to_string(),
        }),
        EngineType::Playwright | EngineType::Puppeteer => Err(DownloadError::Unsupported {
            engine: engine.to_string(),
            reason: "the node bridge speaks its own command protocol rather \
                     than CDP; use EngineType::Chromiumoxide, or manage \
                     downloads from the JavaScript package, which drives \
                     Playwright and Puppeteer directly"
                .to_string(),
        }),
    }
}

/// Build and attach a download manager, if the caller asked for one.
///
/// # Arguments
///
/// * `engine` - The engine driving the browser
/// * `transport` - A CDP connection with Browser-domain access
/// * `setting` - The caller's `downloads` option
///
/// # Returns
///
/// An attached manager, or `None` when downloads are not managed.
///
/// # Errors
///
/// Returns [`DownloadError::Unsupported`] when the engine cannot manage
/// downloads, and whatever [`DownloadManager::create`] or
/// [`DownloadManager::attach`] reports otherwise.
pub async fn attach_downloads(
    engine: EngineType,
    transport: &dyn CdpTransport,
    setting: DownloadSetting,
) -> Result<Option<Arc<DownloadManager>>, DownloadError> {
    let Some(options) = normalize_download_options(setting) else {
        return Ok(None);
    };
    supported_engine(engine)?;

    let manager = DownloadManager::create(options)?;
    manager.attach(transport).await?;
    Ok(Some(manager))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::downloads::test_support::{RecordingTransport, TempDir};

    /// Options writing into a directory of this test's own.
    fn options(temp: &TempDir) -> DownloadOptions {
        DownloadOptions::default().directory(temp.path().join("downloads").to_string_lossy())
    }

    #[test]
    fn reads_the_three_shapes_the_other_languages_accept() {
        assert!(normalize_download_options(DownloadSetting::Off).is_none());
        assert!(normalize_download_options(false.into()).is_none());
        assert!(normalize_download_options(DownloadSetting::On).is_some());
        assert!(normalize_download_options(true.into()).is_some());

        let configured = normalize_download_options(
            DownloadOptions::default()
                .directory("/tmp/bc-downloads")
                .into(),
        )
        .expect("configured downloads");
        assert_eq!(configured.directory.as_deref(), Some("/tmp/bc-downloads"));
    }

    #[tokio::test]
    async fn points_the_browser_at_the_staging_directory() {
        let temp = TempDir::new("bc-attach");
        let transport = RecordingTransport::default();

        let manager =
            attach_downloads(EngineType::Chromiumoxide, &transport, options(&temp).into())
                .await
                .expect("attach")
                .expect("a manager");

        let sent = transport.sent();
        assert_eq!(sent.len(), 1);
        assert_eq!(sent[0].0, "Browser.setDownloadBehavior");
        assert_eq!(
            sent[0].1["downloadPath"],
            manager
                .directory
                .join(crate::downloads::STAGING_DIRECTORY)
                .to_string_lossy()
                .as_ref()
        );
        manager.dispose().await;
    }

    #[tokio::test]
    async fn leaves_the_browser_alone_when_downloads_are_off() {
        let transport = RecordingTransport::default();

        let manager = attach_downloads(EngineType::Chromiumoxide, &transport, DownloadSetting::Off)
            .await
            .expect("attach");

        assert!(manager.is_none());
        assert!(
            transport.sent().is_empty(),
            "a browser with downloads off had its download behavior changed"
        );
    }

    #[tokio::test]
    async fn refuses_an_engine_that_cannot_manage_downloads() {
        let temp = TempDir::new("bc-attach-unsupported");
        let transport = RecordingTransport::default();

        for engine in [
            EngineType::Fantoccini,
            EngineType::Playwright,
            EngineType::Puppeteer,
        ] {
            let error = attach_downloads(engine, &transport, options(&temp).into())
                .await
                .unwrap_err();

            assert!(
                error
                    .to_string()
                    .contains("managed downloads are not supported"),
                "unexpected message: {error}"
            );
            assert!(
                error.to_string().contains(&engine.to_string()),
                "the message does not name the engine: {error}"
            );
        }
    }

    #[tokio::test]
    async fn reports_a_browser_that_refuses_to_redirect_its_downloads() {
        let temp = TempDir::new("bc-attach-refused");
        let transport = RecordingTransport::refusing("Browser domain is not available");

        let error = attach_downloads(EngineType::Chromiumoxide, &transport, options(&temp).into())
            .await
            .unwrap_err();

        assert!(
            error
                .to_string()
                .contains("the browser refused to redirect its downloads"),
            "unexpected message: {error}"
        );
    }
}
