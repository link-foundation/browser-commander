//! Abandoning a browser during runtime shutdown must still terminate its group.
#[cfg(target_os = "linux")]
#[test]
fn process_drop_stops_children_before_runtime_shutdown() {
    let runtime = tokio::runtime::Runtime::new().unwrap();
    let child = runtime
        .block_on(browser_commander::utilities::start_process(
            "sh",
            &["-c", "sleep 20"],
            Default::default(),
        ))
        .unwrap();
    let pid = child.pid().unwrap();
    drop(runtime);
    drop(child);
    let path = format!("/proc/{pid}/stat");
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(1);
    loop {
        let alive = std::fs::read_to_string(&path).is_ok_and(|stat| {
            !stat
                .split(')')
                .nth(1)
                .unwrap()
                .trim_start()
                .starts_with('Z')
        });
        if !alive {
            break;
        }
        if std::time::Instant::now() >= deadline {
            // Bound the failing regression too: never leave the finite probe running.
            let _ = std::process::Command::new("kill")
                .args(["-KILL", "--", &format!("-{pid}")])
                .status();
            panic!("managed process {pid} survived runtime shutdown");
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
}
