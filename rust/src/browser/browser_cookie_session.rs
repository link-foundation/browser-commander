//! Cookie-only snapshots and explicit live validation of installed/engine sessions.
use super::snapshot::{launch_snapshot, SnapshotOptions};
use super::storage_state::save_storage_state;
use super::{BrowserCookie, BrowserCookieReadOptions, BrowserProfileOptions, RealBrowserOptions};
use crate::core::engine::{EngineAdapter, EngineType};
use futures::future::BoxFuture;
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Arc;

enum SessionLaunch {
    Real(Box<super::snapshot::SnapshotLaunchResult>),
    Engine(super::LaunchResult, Box<super::snapshot::OwnedCopy>),
}
impl SessionLaunch {
    fn page(&self) -> Arc<dyn EngineAdapter> {
        match self {
            Self::Real(result) => result.page.clone(),
            Self::Engine(result, _) => result.page.clone(),
        }
    }
    async fn close(&self) -> anyhow::Result<()> {
        match self {
            Self::Real(result) => result.close().await,
            Self::Engine(result, copy) => {
                let stopped = result.close().await;
                let removed = std::fs::remove_dir_all(&copy.report.target);
                stopped?;
                removed?;
                Ok(())
            }
        }
    }
}

async fn launch_source(
    source: &SessionSource,
    snapshot: SnapshotOptions,
    options: RealBrowserOptions,
) -> anyhow::Result<SessionLaunch> {
    if source.launch != super::LaunchMode::Engine {
        return launch_snapshot(snapshot, options)
            .await
            .map(|result| SessionLaunch::Real(Box::new(result)));
    }
    let copy = super::snapshot::copy_owned_snapshot(snapshot).await?;
    let mut engine = engine_options(source.engine, options);
    engine.args.push(format!(
        "--profile-directory={}",
        copy.report.source.profile
    ));
    engine.user_data_dir = Some(copy.report.target.clone());
    let result = super::launch_browser(engine).await?;
    Ok(SessionLaunch::Engine(result, Box::new(copy)))
}

fn engine_options(engine: EngineType, options: RealBrowserOptions) -> super::LaunchOptions {
    super::LaunchOptions {
        engine,
        launch: super::LaunchMode::Engine,
        executable_path: options.executable_path,
        headless: options.headless,
        args: options.args,
        extra_args: options.extra_args,
        node_working_dir: options.node_working_dir,
        node_executable: options.node_executable,
        env: options.env,
        ..Default::default()
    }
}

#[derive(Debug, Clone)]
pub struct SessionSource {
    pub browser: String,
    pub path: PathBuf,
    pub engine: EngineType,
    pub launch: super::launcher::LaunchMode,
}
#[derive(Debug)]
pub struct SiteSession {
    pub source: SessionSource,
    pub cookies: Vec<Value>,
    pub logged_in: Option<bool>,
    pub error: Option<String>,
}
pub type SessionValidator = Arc<
    dyn Fn(
            Arc<dyn EngineAdapter>,
            SessionSource,
            Vec<Value>,
        ) -> BoxFuture<'static, anyhow::Result<bool>>
        + Send
        + Sync,
>;

async fn read_database_session(
    source: &SessionSource,
    domains: &[String],
    options: RealBrowserOptions,
    validate: Option<&SessionValidator>,
) -> anyhow::Result<SiteSession> {
    let mut read_options = BrowserCookieReadOptions::new(&source.browser)
        .profile_dir(&source.path)
        .cache(false);
    read_options.via = Some("database".into());
    let cookies =
        tokio::task::spawn_blocking(move || super::read_browser_cookies(read_options)).await??;
    let cookies = cookies
        .into_iter()
        .filter(|cookie| super::migration::domains::matches_domains(&cookie.domain, domains))
        .map(serde_json::to_value)
        .collect::<Result<Vec<_>, _>>()?;
    let mut session = SiteSession {
        source: source.clone(),
        cookies,
        logged_in: None,
        error: None,
    };
    if let Some(validate) = validate {
        let launched = super::launch_browser(engine_options(source.engine, options)).await?;
        let observed = async {
            super::set_cookies(launched.page.as_ref(), session.cookies.clone()).await?;
            validate(
                launched.page.clone(),
                source.clone(),
                session.cookies.clone(),
            )
            .await
        }
        .await;
        let closed = launched.close().await;
        session.logged_in = Some(observed?);
        closed?;
    }
    Ok(session)
}

pub async fn read_browser_cookie_session(
    options: BrowserCookieReadOptions,
    mut launch_options: RealBrowserOptions,
) -> anyhow::Result<Vec<BrowserCookie>> {
    let browser = super::resolve_source_browser(
        &options.browser,
        &options.platform,
        &options.environment,
        options.run_command.as_ref(),
    )?;
    let profile = match options.profile_dir {
        Some(path) => path,
        None => {
            super::browser_profiles::resolve_browser_profile(
                browser,
                options.profile.as_deref(),
                &BrowserProfileOptions::default()
                    .browser(browser)
                    .home_dir(options.home_dir)
                    .platform(&options.platform)
                    .environment(options.environment),
            )?
            .path
        }
    };
    launch_options.channel = browser.into();
    let launched = launch_snapshot(
        SnapshotOptions {
            browser: browser.into(),
            profile: profile
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned(),
            user_data_dir: profile.parent().map(PathBuf::from),
            include: Some(vec!["cookies".into()]),
        },
        launch_options,
    )
    .await?;
    let read = save_storage_state(launched.page.as_ref(), None).await;
    let closed = launched.close().await;
    let state = read?;
    closed?;
    state
        .cookies
        .into_iter()
        .filter(|cookie| {
            options.domain_filter.as_ref().is_none_or(|domain| {
                super::migration::domains::matches_domains(
                    cookie["domain"].as_str().unwrap_or(""),
                    std::slice::from_ref(domain),
                )
            })
        })
        .map(|mut value| {
            if let Some(expires) = value["expires"].as_f64() {
                value["expires"] = serde_json::json!(expires as i64);
            }
            serde_json::from_value(value)
        })
        .collect::<Result<_, _>>()
        .map_err(Into::into)
}

pub async fn find_site_sessions(
    domains: &[String],
    sources: &[SessionSource],
    launch_options: RealBrowserOptions,
    is_logged_in: Option<SessionValidator>,
) -> anyhow::Result<Vec<SiteSession>> {
    if domains.is_empty() {
        anyhow::bail!("find_site_sessions requires domains")
    }
    let discovered;
    let sources = if sources.is_empty() {
        let profile_options = BrowserProfileOptions::default();
        discovered = super::list_cookie_sources(
            domains,
            &profile_options.platform,
            &profile_options.home_dir,
            &profile_options.environment,
        )?
        .into_iter()
        .map(|source| SessionSource {
            browser: source.browser,
            path: source.path,
            engine: launch_options.engine,
            launch: super::launcher::LaunchMode::Real,
        })
        .collect::<Vec<_>>();
        &discovered
    } else {
        sources
    };
    let mut sessions = Vec::new();
    for source in sources {
        if super::browser_family(&source.browser)? != "chromium" {
            let session = read_database_session(
                source,
                domains,
                launch_options.clone(),
                is_logged_in.as_ref(),
            )
            .await
            .unwrap_or_else(|error| SiteSession {
                source: source.clone(),
                cookies: vec![],
                logged_in: None,
                error: Some(error.to_string()),
            });
            sessions.push(session);
            continue;
        }
        let snapshot = SnapshotOptions {
            browser: source.browser.clone(),
            profile: source
                .path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned(),
            user_data_dir: source.path.parent().map(PathBuf::from),
            include: Some(vec!["cookies".into()]),
        };
        let mut options = launch_options.clone();
        options.engine = source.engine;
        let mut session = SiteSession {
            source: source.clone(),
            cookies: vec![],
            logged_in: None,
            error: None,
        };
        match launch_source(source, snapshot, options).await {
            Ok(launched) => {
                let read = async {
                    let state = save_storage_state(launched.page().as_ref(), None).await?;
                    session.cookies = state
                        .cookies
                        .into_iter()
                        .filter(|cookie| {
                            super::migration::domains::matches_domains(
                                cookie["domain"].as_str().unwrap_or(""),
                                domains,
                            )
                        })
                        .collect();
                    if let Some(validate) = &is_logged_in {
                        session.logged_in = Some(
                            validate(launched.page(), source.clone(), session.cookies.clone())
                                .await?,
                        );
                    }
                    Ok::<(), anyhow::Error>(())
                }
                .await;
                let closed = launched.close().await;
                if let Err(error) = read.and(closed) {
                    session.error = Some(error.to_string());
                }
            }
            Err(error) => session.error = Some(error.to_string()),
        }
        sessions.push(session);
    }
    Ok(sessions)
}
