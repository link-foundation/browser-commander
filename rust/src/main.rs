//! Browser Commander CLI
//!
//! A command-line interface for the browser-commander library.

use browser_commander::browser::{launch_browser, LaunchOptions};
use browser_commander::core::logger::{init_logger, LoggerOptions};
use std::env;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Check for verbose flag
    let verbose = env::args().any(|arg| arg == "--verbose" || arg == "-v");

    // Initialize logging
    init_logger(LoggerOptions { verbose });

    println!("Browser Commander v{}", env!("CARGO_PKG_VERSION"));
    println!();

    // Parse command-line arguments
    let args: Vec<String> = env::args().collect();

    if args.len() < 2 || args[1] == "--help" || args[1] == "-h" {
        print_help();
        return Ok(());
    }

    match args[1].as_str() {
        "launch" => {
            let headless = args.iter().any(|a| a == "--headless");

            let options = LaunchOptions::chromiumoxide()
                .headless(headless)
                .verbose(verbose);

            println!("Launching browser...");
            let result = launch_browser(options).await?;
            println!("Browser launched: {:?}", result.browser);
        }
        "version" => {
            println!("browser-commander {}", env!("CARGO_PKG_VERSION"));
        }
        cmd => {
            eprintln!("Unknown command: {}", cmd);
            print_help();
        }
    }

    Ok(())
}

fn print_help() {
    println!("Usage: browser-commander <command> [options]");
    println!();
    println!("Commands:");
    println!("  launch     Launch a browser instance");
    println!("  version    Show version information");
    println!();
    println!("Options:");
    println!("  --headless     Run browser in headless mode");
    println!("  --verbose, -v  Enable verbose logging");
    println!("  --help, -h     Show this help message");
}
