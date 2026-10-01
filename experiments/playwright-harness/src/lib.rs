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
