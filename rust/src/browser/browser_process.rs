//! The spawned browser process handle shared by the real-browser launcher and
//! [`LaunchResult`](super::launcher::LaunchResult).
//!
//! The process itself is a [`ManagedProcess`] from
//! [`utilities::subprocess`](crate::utilities::subprocess), so the browser is
//! started through command-stream like every other subprocess in the crate
//! (issue #104). [`BrowserProcess`] is a cheap, clonable view of it; the
//! browser is stopped once the last clone is dropped.

use std::fmt;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

use crate::utilities::ManagedProcess;

/// A future resolving with a process's exit code.
pub(crate) type ExitFuture = Pin<Box<dyn Future<Output = i32> + Send + 'static>>;

/// What the launcher needs from a spawned process. Implemented by
/// [`ManagedProcess`] and by the fakes in the launcher's unit tests.
pub(crate) trait ProcessControl: Send + Sync {
    fn pid(&self) -> Option<u32>;
    fn exit_code(&self) -> Option<i32>;
    fn kill(&self) -> bool;
    fn exited(&self) -> ExitFuture;
}

impl ProcessControl for ManagedProcess {
    fn pid(&self) -> Option<u32> {
        ManagedProcess::pid(self)
    }

    fn exit_code(&self) -> Option<i32> {
        ManagedProcess::exit_code(self)
    }

    fn kill(&self) -> bool {
        ManagedProcess::kill(self)
    }

    fn exited(&self) -> ExitFuture {
        Box::pin(ManagedProcess::exited(self))
    }
}

/// Shuts down whatever a launch started: the browser and, for a temporary
/// profile, its directory. Idempotent.
#[async_trait::async_trait]
pub(crate) trait BrowserCloser: Send + Sync {
    async fn close(&self) -> anyhow::Result<()>;
}

/// A spawned installed-browser process.
///
/// Clones share the same process. Dropping the last clone stops the browser;
/// call [`LaunchResult::close`](super::launcher::LaunchResult::close) or
/// [`RealBrowserLaunchResult::close`](super::real_browser::RealBrowserLaunchResult::close)
/// for a graceful shutdown that also removes a temporary profile.
#[derive(Clone)]
pub struct BrowserProcess {
    inner: Arc<dyn ProcessControl>,
}

impl BrowserProcess {
    pub(crate) fn from_control(inner: Arc<dyn ProcessControl>) -> Self {
        Self { inner }
    }

    pub(crate) fn from_managed(process: ManagedProcess) -> Self {
        Self::from_control(Arc::new(process))
    }

    /// Operating-system process identifier (`0` if it is not known).
    pub fn id(&self) -> u32 {
        self.pid().unwrap_or(0)
    }

    /// Operating-system process identifier.
    pub fn pid(&self) -> Option<u32> {
        self.inner.pid()
    }

    /// Exit code once the browser has exited (`128 + signal` for a signal).
    pub fn exit_code(&self) -> Option<i32> {
        self.inner.exit_code()
    }

    /// Whether the browser is still running.
    pub fn is_running(&self) -> bool {
        self.exit_code().is_none()
    }

    /// Ask the browser to stop (`SIGTERM`, then `SIGKILL` after a grace
    /// period). Returns whether a running process was signalled; it does not
    /// wait - use [`wait`](Self::wait) for that.
    pub fn kill(&self) -> bool {
        if !self.is_running() {
            return false;
        }
        self.inner.kill()
    }

    /// Wait for the browser to exit and return its exit code.
    pub async fn wait(&self) -> i32 {
        self.exited().await
    }

    /// Wait up to `timeout` for the browser to exit; `None` if it is still
    /// running afterwards.
    pub async fn wait_timeout(&self, timeout: Duration) -> Option<i32> {
        if let Some(code) = self.exit_code() {
            return Some(code);
        }
        tokio::time::timeout(timeout, self.exited()).await.ok()
    }

    /// A `'static` future resolving with the exit code, for use in tasks.
    pub fn exited(&self) -> impl Future<Output = i32> + Send + 'static {
        self.inner.exited()
    }
}

impl fmt::Debug for BrowserProcess {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("BrowserProcess")
            .field("pid", &self.pid())
            .field("exit_code", &self.exit_code())
            .finish()
    }
}

#[cfg(test)]
pub(crate) mod fake {
    //! A scripted process for launcher tests.

    use super::{BrowserProcess, ExitFuture, ProcessControl};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use tokio::sync::watch;

    /// A process that exits when killed, or when the test says so.
    pub(crate) struct FakeProcess {
        exit: watch::Sender<Option<i32>>,
        pub(crate) kills: AtomicUsize,
        /// Whether `kill` makes the process exit (a stuck browser does not).
        pub(crate) exits_on_kill: bool,
    }

    impl FakeProcess {
        pub(crate) fn new() -> Arc<Self> {
            Arc::new(Self {
                exit: watch::channel(None).0,
                kills: AtomicUsize::new(0),
                exits_on_kill: true,
            })
        }

        pub(crate) fn exit(&self, code: i32) {
            self.exit.send_replace(Some(code));
        }

        pub(crate) fn kill_count(&self) -> usize {
            self.kills.load(Ordering::SeqCst)
        }

        pub(crate) fn handle(self: &Arc<Self>) -> BrowserProcess {
            BrowserProcess::from_control(Arc::clone(self) as Arc<dyn ProcessControl>)
        }
    }

    impl ProcessControl for FakeProcess {
        fn pid(&self) -> Option<u32> {
            Some(4242)
        }

        fn exit_code(&self) -> Option<i32> {
            *self.exit.borrow()
        }

        fn kill(&self) -> bool {
            self.kills.fetch_add(1, Ordering::SeqCst);
            if self.exits_on_kill {
                self.exit(143);
            }
            true
        }

        fn exited(&self) -> ExitFuture {
            let mut exit = self.exit.subscribe();
            Box::pin(async move {
                match exit.wait_for(Option::is_some).await {
                    Ok(code) => code.unwrap_or(1),
                    Err(_) => 1,
                }
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::utilities::{start_process, StartProcessOptions};

    #[tokio::test]
    async fn wraps_a_managed_process() {
        let process = start_process("sleep", &["30"], StartProcessOptions::default())
            .await
            .unwrap();
        let browser = BrowserProcess::from_managed(process);
        assert!(browser.is_running());
        assert_ne!(browser.id(), 0);
        assert!(browser
            .wait_timeout(Duration::from_millis(50))
            .await
            .is_none());
        assert!(browser.kill());
        let code = browser.wait_timeout(Duration::from_secs(5)).await;
        assert_eq!(code, Some(128 + 15));
        assert!(!browser.kill());
    }

    #[tokio::test]
    async fn fake_process_exits_when_killed() {
        let fake = fake::FakeProcess::new();
        let process = fake.handle();
        let exited = process.exited();
        process.kill();
        assert_eq!(exited.await, 143);
        assert_eq!(fake.kill_count(), 1);
    }
}
