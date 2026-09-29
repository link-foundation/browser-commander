//! The Rust entry point for the shared Browser Commander CLI protocol.
//!
//! The Node CLI implements the generic Playwright/Puppeteer handle bridge. A
//! Rust caller can reach its entire API through `serve --stdio` while normal
//! Rust library launches and CDP operations remain native. Every child here
//! is started through command-stream.

use std::env;
use std::io::{self, Write};
use std::path::PathBuf;
use std::process::ExitCode;

use browser_commander::utilities::subprocess::{run_command, RunCommandOptions};
use command_stream::{quote::quote, ProcessRunner, RunOptions, StdinOption};
use serde_json::json;

fn js_cli_path() -> anyhow::Result<PathBuf> {
    let candidates = if let Some(configured) = env::var_os("BROWSER_COMMANDER_JS_CLI") {
        vec![PathBuf::from(configured)]
    } else {
        vec![
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../js/bin/browser-commander.js"),
            env::current_dir()?.join("node_modules/browser-commander/bin/browser-commander.js"),
        ]
    };
    candidates.into_iter().find(|path| path.is_file()).ok_or_else(|| {
        anyhow::anyhow!(
            "The JavaScript CLI is required for cross-engine commands; install the browser-commander npm package or set BROWSER_COMMANDER_JS_CLI"
        )
    })
}

async fn run_cli(args: &[String]) -> anyhow::Result<i32> {
    if args.first().is_some_and(|arg| arg == "version") {
        println!(
            "{}",
            json!({
                "name": "browser-commander",
                "version": env!("CARGO_PKG_VERSION"),
                "language": "rust"
            })
        );
        return Ok(0);
    }

    let node = env::var("BROWSER_COMMANDER_NODE").unwrap_or_else(|_| "node".to_owned());
    let cli = js_cli_path()?.to_string_lossy().into_owned();
    let command_args = std::iter::once(cli)
        .chain(args.iter().cloned())
        .collect::<Vec<_>>();
    let streaming = is_streaming_command(args);

    if streaming {
        // ProcessRunner can inherit stdin, which lets the JSON-RPC service
        // answer each request as it arrives. Its command takes shell syntax,
        // so quote every argument before constructing that fixed invocation.
        let command = std::iter::once(node.as_str())
            .chain(command_args.iter().map(String::as_str))
            .map(quote)
            .collect::<Vec<_>>()
            .join(" ");
        let mut runner = ProcessRunner::new(
            command,
            RunOptions {
                mirror: true,
                capture: false,
                stdin: StdinOption::Inherit,
                shell_operators: false,
                trace: false,
                ..RunOptions::default()
            },
        );
        return Ok(runner.run().await?.code);
    }

    let output = run_command(
        &node,
        &command_args,
        RunCommandOptions {
            check: false,
            ..RunCommandOptions::default()
        },
    )
    .await?;
    io::stdout().write_all(output.stdout.as_bytes())?;
    io::stderr().write_all(output.stderr.as_bytes())?;
    Ok(output.code)
}

fn is_streaming_command(args: &[String]) -> bool {
    (args.first().is_some_and(|arg| arg == "serve")
        && args.get(1).is_some_and(|arg| arg == "--stdio"))
        || (args.first().is_some_and(|arg| arg == "launch")
            && args.iter().any(|arg| arg == "--keep-open"))
}

#[tokio::main]
async fn main() -> ExitCode {
    let args = env::args().skip(1).collect::<Vec<_>>();
    let code = match run_cli(&args).await {
        Ok(code) => code,
        Err(error) => {
            println!(
                "{}",
                json!({"error": {"name": "Error", "message": error.to_string()}})
            );
            1
        }
    };
    ExitCode::from(u8::try_from(code).unwrap_or(1))
}

#[cfg(test)]
mod tests {
    use super::*;

    // feature-parity: cli.version
    #[tokio::test]
    async fn version_is_native() {
        assert_eq!(run_cli(&["version".to_string()]).await.unwrap(), 0);
    }

    // feature-parity: cli.script cli.serve
    #[test]
    fn stdio_bridge_streams_and_scripts_collect() {
        assert!(is_streaming_command(&[
            "serve".to_string(),
            "--stdio".to_string()
        ]));
        assert!(is_streaming_command(&[
            "launch".to_string(),
            "--keep-open".to_string()
        ]));
        assert!(!is_streaming_command(&[
            "run".to_string(),
            "script.json".to_string()
        ]));
    }
}
