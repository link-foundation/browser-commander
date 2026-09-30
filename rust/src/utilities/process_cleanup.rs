//! Synchronous final cleanup when the asynchronous pump's runtime is gone.
//! The caller owns a live command-stream child, which leads its process group.

#[cfg(unix)]
pub(super) fn kill_owned_process_tree(pid: u32) {
    if let Ok(pid) = i32::try_from(pid) {
        // SAFETY: these syscalls take only integers. command-stream starts the
        // owned child with process_group(0), so -pid cannot target our group.
        unsafe {
            libc::kill(-pid, libc::SIGKILL);
            libc::kill(pid, libc::SIGKILL);
        }
    }
}

#[cfg(windows)]
pub(super) fn kill_owned_process_tree(pid: u32) {
    use windows_sys::Win32::{
        Foundation::{CloseHandle, INVALID_HANDLE_VALUE},
        System::{
            Diagnostics::ToolHelp::{
                CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
                TH32CS_SNAPPROCESS,
            },
            Threading::{OpenProcess, TerminateProcess, PROCESS_TERMINATE},
        },
    };
    // SAFETY: all handles are checked and closed; PROCESSENTRY32W has its
    // required size. No handle or pointer escapes this scope.
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        let mut parents = Vec::new();
        if snapshot != INVALID_HANDLE_VALUE {
            let mut entry: PROCESSENTRY32W = std::mem::zeroed();
            entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
            if Process32FirstW(snapshot, &mut entry) != 0 {
                loop {
                    parents.push((entry.th32ProcessID, entry.th32ParentProcessID));
                    if Process32NextW(snapshot, &mut entry) == 0 {
                        break;
                    }
                }
            }
            CloseHandle(snapshot);
        }
        let mut owned = vec![pid];
        loop {
            let previous = owned.len();
            for &(child, parent) in &parents {
                if owned.contains(&parent) && !owned.contains(&child) {
                    owned.push(child);
                }
            }
            if owned.len() == previous {
                break;
            }
        }
        for child in owned.into_iter().rev() {
            let handle = OpenProcess(PROCESS_TERMINATE, 0, child);
            if !handle.is_null() {
                TerminateProcess(handle, 1);
                CloseHandle(handle);
            }
        }
    }
}

#[cfg(not(any(unix, windows)))]
pub(super) fn kill_owned_process_tree(_pid: u32) {}
