//! Windows Job Object（`KILL_ON_JOB_CLOSE`），覆盖全部 Core 及其子孙进程（技术方案第 2.2、5.5 节）。
//!
//! 每个 Core 进程一个作业，句柄只由薄壳持有；主进程正常退出、崩溃或被任务管理器强杀时，系统关闭这些句柄，
//! 作业内的所有进程（Core、Core 拉起的 bash / PowerShell 等工具进程）随之结束。
//! 单独结束某个 Core 时 [`Job::terminate`] 连同其子孙进程一起结束。
//! Windows 8 起作业可以嵌套，子进程默认继承父进程所在的作业，因此只需把 Core 进程本身放进作业。
//!
//! 非 Windows 平台没有等价机制，[`Job`] 为空实现，由 `supervisor` 在退出时逐个结束子进程（完整适配见 P3）。

// 由 supervisor 使用；它接入启动流程前非测试构建先放行未使用告警。
#![cfg_attr(not(test), allow(dead_code))]

use std::io;
use std::process::Child;

/// 一个设置了 `KILL_ON_JOB_CLOSE` 的作业对象；drop 时关闭句柄，作业内进程全部结束。
pub(crate) struct Job {
    #[cfg(windows)]
    handle: windows_sys::Win32::Foundation::HANDLE,
}

// SAFETY: 作业句柄是内核对象句柄，可在任意线程上使用与关闭；Job 不暴露可变内部状态。
#[cfg(windows)]
unsafe impl Send for Job {}
// SAFETY: 同上，AssignProcessToJobObject / TerminateJobObject 对同一句柄并发调用是安全的。
#[cfg(windows)]
unsafe impl Sync for Job {}

#[cfg(windows)]
impl Job {
    /// 创建匿名作业并设置 `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`。
    pub(crate) fn new() -> io::Result<Self> {
        use std::ptr::null;
        use windows_sys::Win32::System::JobObjects::{
            CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
            SetInformationJobObject,
        };

        // SAFETY: 两个参数都允许为空（默认安全属性、匿名作业）
        let handle = unsafe { CreateJobObjectW(null(), null()) };
        if handle.is_null() {
            return Err(io::Error::last_os_error());
        }
        let job = Self { handle };
        // SAFETY: 全零是该结构体的合法初值
        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        // SAFETY: 句柄有效，info 指向大小正确的结构体
        let ok = unsafe {
            SetInformationJobObject(
                job.handle,
                JobObjectExtendedLimitInformation,
                (&info as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        };
        if ok == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(job)
    }

    /// 把子进程放进作业。应在拉起后立即调用：Core 在 RPC 握手前不会拉起任何子进程，
    /// 之后它的所有子孙进程都自动继承本作业。
    pub(crate) fn assign(&self, child: &Child) -> io::Result<()> {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::System::JobObjects::AssignProcessToJobObject;

        // SAFETY: 两个句柄都有效；child 在调用期间存活
        if unsafe { AssignProcessToJobObject(self.handle, child.as_raw_handle()) } == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }

    /// 立即结束作业内的全部进程（作业本身保留，可继续放入新进程）。
    pub(crate) fn terminate(&self) -> io::Result<()> {
        use windows_sys::Win32::System::JobObjects::TerminateJobObject;

        // SAFETY: 句柄有效
        if unsafe { TerminateJobObject(self.handle, 1) } == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }
}

#[cfg(windows)]
impl Drop for Job {
    fn drop(&mut self) {
        use windows_sys::Win32::Foundation::CloseHandle;
        // SAFETY: 句柄由 CreateJobObjectW 创建且只关闭一次；关闭即触发 KILL_ON_JOB_CLOSE
        unsafe { CloseHandle(self.handle) };
    }
}

#[cfg(not(windows))]
impl Job {
    pub(crate) fn new() -> io::Result<Self> {
        Ok(Self {})
    }

    pub(crate) fn assign(&self, _child: &Child) -> io::Result<()> {
        Ok(())
    }

    pub(crate) fn terminate(&self) -> io::Result<()> {
        Ok(())
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Write};
    use std::process::{Command, Stdio};
    use std::time::Duration;

    /// 等待指定 pid 的进程结束；超时返回 false。
    fn wait_pid_exit(pid: u32, timeout: Duration) -> bool {
        use windows_sys::Win32::Foundation::{CloseHandle, WAIT_OBJECT_0};
        use windows_sys::Win32::System::Threading::{
            OpenProcess, PROCESS_SYNCHRONIZE, WaitForSingleObject,
        };
        // SAFETY: 只请求 SYNCHRONIZE 权限
        let handle = unsafe { OpenProcess(PROCESS_SYNCHRONIZE, 0, pid) };
        if handle.is_null() {
            // 进程已不存在
            return true;
        }
        // SAFETY: 句柄有效
        let result = unsafe { WaitForSingleObject(handle, timeout.as_millis() as u32) };
        // SAFETY: 句柄有效且只关闭一次
        unsafe { CloseHandle(handle) };
        result == WAIT_OBJECT_0
    }

    /// 子进程收到一行输入后再拉起一个常驻孙进程并打印其 pid：保证孙进程在放入作业之后才创建。
    const PARENT_SCRIPT: &str = r#"
const { spawn } = require("node:child_process");
process.stdin.once("data", () => {
  const g = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  console.log(String(g.pid));
});
setInterval(() => {}, 1000);
"#;

    #[test]
    fn closing_job_kills_child_and_grandchild() {
        let job = Job::new().expect("创建作业");
        let mut child = Command::new("node")
            .args(["-e", PARENT_SCRIPT])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .expect("需要 PATH 中有 node");
        job.assign(&child).expect("放入作业");

        child.stdin.as_mut().unwrap().write_all(b"go\n").unwrap();
        let mut line = String::new();
        BufReader::new(child.stdout.take().unwrap())
            .read_line(&mut line)
            .unwrap();
        let grandchild: u32 = line.trim().parse().expect("孙进程 pid");

        // 模拟主进程退出：关闭作业句柄
        drop(job);
        assert!(
            wait_pid_exit(child.id(), Duration::from_secs(10)),
            "子进程应随作业关闭结束"
        );
        assert!(
            wait_pid_exit(grandchild, Duration::from_secs(10)),
            "孙进程应随作业关闭结束"
        );
        let _ = child.wait();
    }

    #[test]
    fn terminate_kills_members_but_job_stays_usable() {
        let job = Job::new().unwrap();
        let mut first = Command::new("node")
            .args(["-e", "setInterval(() => {}, 1000)"])
            .spawn()
            .unwrap();
        job.assign(&first).unwrap();
        job.terminate().unwrap();
        assert!(wait_pid_exit(first.id(), Duration::from_secs(10)));
        let _ = first.wait();

        let mut second = Command::new("node")
            .args(["-e", "setInterval(() => {}, 1000)"])
            .spawn()
            .unwrap();
        job.assign(&second).expect("作业结束成员后仍可放入新进程");
        drop(job);
        assert!(wait_pid_exit(second.id(), Duration::from_secs(10)));
        let _ = second.wait();
    }
}
