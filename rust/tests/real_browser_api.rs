use browser_commander::{
    build_real_browser_args, launch_and_connect_real_browser, launch_real_browser,
    RealBrowserOptions,
};

#[test]
fn real_browser_api_builds_a_clean_command_line() {
    let options = RealBrowserOptions::playwright()
        .channel("chrome")
        .user_data_dir("dedicated-profile")
        .remote_debugging_port(9333)
        .headless(true)
        .with_args(vec!["--lang=en-US".to_string()]);

    let arguments = build_real_browser_args(&options).unwrap();

    assert_eq!(
        arguments,
        [
            "--user-data-dir=dedicated-profile",
            "--remote-debugging-port=9333",
            "--headless=new",
            "--lang=en-US",
        ]
    );

    let _short_helper = launch_real_browser;
    let _compatible_helper = launch_and_connect_real_browser;
}

#[test]
fn real_browser_api_adds_restrictions_only_on_request() {
    let options = RealBrowserOptions::chromiumoxide()
        .user_data_dir("dedicated-profile")
        .remote_debugging_port(9333)
        .restrictions(["basic-password-store"])
        .with_args(vec!["--legacy-arg".to_string()])
        .with_extra_args(vec!["--lang=en-US".to_string()]);

    let arguments = build_real_browser_args(&options).unwrap();
    assert_eq!(
        arguments,
        [
            "--user-data-dir=dedicated-profile",
            "--remote-debugging-port=9333",
            "--password-store=basic",
            "--legacy-arg",
            "--lang=en-US",
        ]
    );
}

#[test]
fn real_browser_api_rejects_managed_arguments() {
    let options = RealBrowserOptions::chromiumoxide()
        .user_data_dir("dedicated-profile")
        .remote_debugging_port(9333)
        .with_args(vec!["--user-data-dir=other-profile".to_string()]);

    let error = build_real_browser_args(&options).unwrap_err();
    assert!(error.to_string().contains("managed by launch_real_browser"));
}

#[test]
fn real_browser_api_refuses_an_ephemeral_port() {
    let options = RealBrowserOptions::chromiumoxide()
        .user_data_dir("dedicated-profile")
        .remote_debugging_port(0);

    let error = build_real_browser_args(&options).unwrap_err();
    assert!(error.to_string().contains("AutomationControlled"));
}
