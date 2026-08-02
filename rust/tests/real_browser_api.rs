use browser_commander::{
    build_real_browser_args, launch_and_connect_real_browser, launch_real_browser,
    RealBrowserOptions,
};

#[test]
fn real_browser_api_builds_protected_launch_arguments() {
    let options = RealBrowserOptions::playwright()
        .channel("chrome")
        .user_data_dir("dedicated-profile")
        .remote_debugging_port(9333)
        .headless(true)
        .with_args(vec!["--lang=en-US".to_string()]);

    let arguments = build_real_browser_args(&options).unwrap();

    assert_eq!(arguments[0], "--remote-debugging-address=127.0.0.1");
    assert_eq!(arguments[1], "--remote-debugging-port=9333");
    assert_eq!(arguments[2], "--user-data-dir=dedicated-profile");
    assert!(arguments.contains(&"--password-store=basic".to_string()));
    assert!(arguments.contains(&"--headless=new".to_string()));
    assert!(arguments.contains(&"--lang=en-US".to_string()));

    let _short_helper = launch_real_browser;
    let _compatible_helper = launch_and_connect_real_browser;
}

#[test]
fn real_browser_api_supports_extra_args_and_per_default_opt_out() {
    let options = RealBrowserOptions::chromiumoxide()
        .user_data_dir("dedicated-profile")
        .with_args(vec!["--legacy-arg".to_string()])
        .with_extra_args(vec!["--lang=en-US".to_string()])
        .ignore_default_args(vec!["--no-first-run".to_string()]);

    let arguments = build_real_browser_args(&options).unwrap();
    assert!(arguments.contains(&"--password-store=basic".to_string()));
    assert!(!arguments.contains(&"--no-first-run".to_string()));
    assert!(arguments.contains(&"--no-default-browser-check".to_string()));
    assert_eq!(
        &arguments[arguments.len() - 2..],
        ["--legacy-arg".to_string(), "--lang=en-US".to_string()]
    );
}

#[test]
fn real_browser_api_rejects_managed_arguments() {
    let options = RealBrowserOptions::chromiumoxide()
        .user_data_dir("dedicated-profile")
        .with_args(vec!["--user-data-dir=other-profile".to_string()]);

    let error = build_real_browser_args(&options).unwrap_err();
    assert!(error.to_string().contains("managed by launch_real_browser"));
}
