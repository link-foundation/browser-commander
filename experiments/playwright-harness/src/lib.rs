//! Harness crate: the real sources, with stand-ins for the rest of the crate.
#![allow(dead_code)]

#[path = "../../../rust/src/playwright/mod.rs"]
pub mod playwright;

pub mod core {
    #[path = "../../../../rust/src/core/engine.rs"]
    pub mod engine;
}

pub mod interactions {
    #[path = "../../../../rust/src/interactions/click_result.rs"]
    pub mod click_result;
}

pub mod utilities {
    pub mod subprocess {
        pub(crate) fn kill_owned_process_tree(pid: u32) {
            unsafe {
                libc::kill(-(pid as i32), libc::SIGKILL);
                libc::kill(pid as i32, libc::SIGKILL);
            }
        }
    }
}

pub mod browser {
    #[path = "../../../../rust/src/browser/playwright_driver_page.rs"]
    pub mod playwright_driver_page;
}

pub mod parity {
    pub(crate) const VERSION_EXPRESSION: &str = r#"(() => {
  const text = id => (document.getElementById(id)?.textContent ?? '').trim();
  if (!text('command_line')) return null;
  return { commandLine:text('command_line'), version:text('version'), executablePath:text('executable_path') };
})()"#;
}
