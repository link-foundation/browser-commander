//! Native driver serialization and launch parameter tests.
use super::*;

#[test]
fn json_round_trips_through_serialized_values() {
    let value = json!({ "a": [1, 2.5, "x", null, true], "b": { "c": false } });
    assert_eq!(deserialize_value(&serialize_value(&value)), value);
}

#[test]
fn values_json_cannot_hold_take_their_json_stringify_shape() {
    let parse = |raw: Value| deserialize_value(&serde_json::from_value(raw).unwrap());
    assert_eq!(parse(json!({ "v": "undefined" })), Value::Null);
    assert_eq!(parse(json!({ "v": "NaN" })), Value::Null);
    assert_eq!(parse(json!({ "v": "-0" })), json!(0));
    assert_eq!(
        parse(json!({ "d": "2020-01-01T00:00:00.000Z" })),
        "2020-01-01T00:00:00.000Z"
    );
    assert_eq!(
        parse(json!({ "bi": "12345678901234567890" })),
        "12345678901234567890"
    );
    assert_eq!(parse(json!({ "r": { "p": "a+", "f": "g" } })), "/a+/g");
    assert_eq!(
        parse(json!({ "e": { "n": "TypeError", "m": "boom", "s": "at x" } })),
        json!({ "name": "TypeError", "message": "boom", "stack": "at x" })
    );
    // Int16Array [1, -2]
    assert_eq!(
        parse(json!({ "ta": { "b": "AQD+/w==", "k": "i16" } })),
        json!([1, -2])
    );
}

#[test]
fn launch_params_follow_the_bridge() {
    let options = PlaywrightLaunch {
        user_data_dir: PathBuf::from("/tmp/profile"),
        headless: true,
        args: vec!["--disable-blink-features=AutomationControlled".to_string()],
        env: Some(HashMap::from([("TZ".to_string(), "UTC".to_string())])),
        ignore_default_args: vec!["--enable-automation".to_string()],
        color_scheme: Some("dark".to_string()),
        sandbox: false,
        executable_path: Some(PathBuf::from("/opt/chrome")),
        ..Default::default()
    };
    let params = serde_json::to_value(launch_params(&options).unwrap()).unwrap();

    assert_eq!(params["userDataDir"], "/tmp/profile");
    assert_eq!(params["headless"], true);
    assert_eq!(params["chromiumSandbox"], false);
    assert_eq!(params["noDefaultViewport"], true);
    assert_eq!(params["colorScheme"], "dark");
    assert_eq!(params["executablePath"], "/opt/chrome");
    assert_eq!(params["ignoreDefaultArgs"], json!(["--enable-automation"]));
    assert!(params.get("ignoreAllDefaultArgs").is_none());
    assert!(params.get("slowMo").is_none());
    let args = params["args"].as_array().unwrap();
    assert!(args.contains(&json!("--no-sandbox")));
    assert!(args.contains(&json!("--disable-setuid-sandbox")));
    let env = params["env"].as_array().unwrap();
    assert!(env.contains(&json!({ "name": "TZ", "value": "UTC" })));
    assert!(env.len() > 1, "the driver's own environment is kept");
}

#[test]
fn ignoring_every_default_switch_sends_the_flag_alone() {
    let options = PlaywrightLaunch {
        ignore_all_default_args: true,
        ignore_default_args: vec!["--x".to_string()],
        sandbox: true,
        ..Default::default()
    };
    let params = serde_json::to_value(launch_params(&options).unwrap()).unwrap();
    assert_eq!(params["ignoreAllDefaultArgs"], true);
    assert!(params.get("ignoreDefaultArgs").is_none());
    assert!(params.get("env").is_none());
    assert_eq!(params["args"], json!([]));
}
