//! Windows 系统代理 → Core 进程的代理环境变量（第 4.4 节、ADR 0015）。
//!
//! Core 的 HTTP 客户端（undici `EnvHttpProxyAgent`）只认 `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY`，
//! 不读 Windows 的“代理服务器”设置。薄壳每次拉起 Core 时读一次当前用户的系统代理
//! （`HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings` 的 `ProxyEnable`、
//! `ProxyServer`、`ProxyOverride`），开着就设置这三个变量，关着就不设：有代理走代理，没代理直连。
//!
//! - 用户环境里已经设置了 `HTTP_PROXY` / `HTTPS_PROXY`（任一大小写）时原样保留，不用系统代理覆盖。
//! - 只支持 HTTP(S) 代理；只配了 `socks=` 的系统代理视为没有代理。自动配置脚本（PAC）与“自动检测设置”不支持。
//! - 回环地址（`localhost`、`127.0.0.1`、`::1`）总在 `NO_PROXY` 里。
//! - 系统代理在 Core 运行中切换，对之后新拉起的 Core 生效。
//! - 代理是本机地址（Clash 一类代理软件）但端口没有进程监听时视为没有代理：代理软件退出或崩溃后
//!   系统代理设置常常还留着，照设会让 Core 的所有请求都连不上（Core 的 web 工具另有连不上代理时改直连的兜底）。

use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::process::Command;
use std::time::Duration;

/// Windows“代理服务器”设置的原始值。
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct SystemProxy {
    pub enabled: bool,
    /// `ProxyServer`：`host:port`，或 `http=host:port;https=host:port;socks=host:port`
    pub server: String,
    /// `ProxyOverride`：`;` 分隔的例外列表，`<local>` 表示不含点的本地主机名
    pub bypass: String,
}

/// 设置给 Core 的代理环境变量。
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ProxyEnv {
    pub http: Option<String>,
    pub https: Option<String>,
    pub no_proxy: String,
}

const PROXY_VARS: [&str; 4] = ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"];
const LOOPBACK: [&str; 3] = ["localhost", "127.0.0.1", "::1"];

/// 给 Core 启动命令设置代理环境变量：用户环境已有代理变量时不动，否则按当前系统代理设置。
pub(crate) fn apply_core_proxy_env(cmd: &mut Command) {
    let system = read_system_proxy().filter(|s| loopback_proxy_alive(s, port_listening));
    apply_with(cmd, |k| std::env::var(k).ok(), system);
}

/// 本机代理的端口是否有进程在监听（连本机端口，很快返回）。
fn port_listening(addr: SocketAddr) -> bool {
    TcpStream::connect_timeout(&addr, Duration::from_millis(300)).is_ok()
}

/// 系统代理可用：没开、或代理不是本机地址时照常返回 true（远程代理不探测，避免拖慢启动）；
/// 本机代理只要有一个地址能连上就算可用。
fn loopback_proxy_alive(system: &SystemProxy, listening: impl Fn(SocketAddr) -> bool) -> bool {
    let Some(env) = proxy_env(system) else {
        return true;
    };
    let mut addrs = env
        .http
        .iter()
        .chain(env.https.iter())
        .filter_map(|u| loopback_addr(u));
    match addrs.next() {
        None => true,
        Some(first) => std::iter::once(first).chain(addrs).any(listening),
    }
}

/// 代理 URL 指向本机时返回要连的地址（`localhost`、`127.x`、`::1`）；其他主机返回 `None`。
fn loopback_addr(url: &str) -> Option<SocketAddr> {
    let rest = url.split_once("://").map_or(url, |(_, r)| r);
    let host_port = rest.rsplit_once('@').map_or(rest, |(_, h)| h);
    let host_port = host_port.split('/').next().unwrap_or(host_port);
    let (host, port) = match host_port.rsplit_once(':') {
        Some((h, p)) if !h.is_empty() && !p.contains(']') => (h, p.parse::<u16>().ok()?),
        _ => (
            host_port,
            if url.starts_with("https://") { 443 } else { 80 },
        ),
    };
    let host = host.trim_start_matches('[').trim_end_matches(']');
    let ip = if host.eq_ignore_ascii_case("localhost") {
        std::net::IpAddr::from([127, 0, 0, 1])
    } else {
        host.parse::<std::net::IpAddr>().ok()?
    };
    if !ip.is_loopback() {
        return None;
    }
    (ip, port).to_socket_addrs().ok()?.next()
}

/// [`apply_core_proxy_env`] 的实现：继承的环境与系统代理可替换，便于测试。
pub(crate) fn apply_with(
    cmd: &mut Command,
    inherited: impl Fn(&str) -> Option<String>,
    system: Option<SystemProxy>,
) {
    let user_set = PROXY_VARS
        .iter()
        .any(|k| inherited(k).is_some_and(|v| !v.trim().is_empty()));
    if user_set {
        return;
    }
    let Some(env) = system.as_ref().and_then(proxy_env) else {
        return;
    };
    if let Some(http) = &env.http {
        cmd.env("HTTP_PROXY", http);
    }
    if let Some(https) = &env.https {
        cmd.env("HTTPS_PROXY", https);
    }
    // 用户环境里的 NO_PROXY 与系统例外合并，不丢用户的设置
    let mut no_proxy = env.no_proxy;
    for key in ["NO_PROXY", "no_proxy"] {
        if let Some(v) = inherited(key).filter(|v| !v.trim().is_empty()) {
            no_proxy = merge_lists(&v, &no_proxy);
        }
    }
    // Windows 的环境变量名不分大小写：只设大写一份（undici 也读大写）
    cmd.env("NO_PROXY", no_proxy);
}

/// 系统代理 → 环境变量；没开、或 HTTPS 没有可用的代理时为 `None`。
pub(crate) fn proxy_env(system: &SystemProxy) -> Option<ProxyEnv> {
    if !system.enabled {
        return None;
    }
    let (http, https) = parse_server(&system.server);
    // undici 在没有 HTTPS_PROXY 时让 HTTPS 回退到 HTTP_PROXY，表达不了“HTTP 走代理、HTTPS 直连”。
    // 模型请求都是 HTTPS：系统代理不管 HTTPS（只配了 `http=`）时整体直连，保证 HTTPS 与系统设置一致。
    https.as_ref()?;
    Some(ProxyEnv {
        http,
        https,
        no_proxy: no_proxy_list(&system.bypass),
    })
}

/// 解析 `ProxyServer`：返回 (HTTP 用的代理, HTTPS 用的代理)。
///
/// 不带协议前缀的条目对所有协议生效；`http=` / `https=` 只对对应协议生效（与 WinINet 一致：
/// 只配了 `http=` 时 HTTPS 直连）；`socks=`、`ftp=` 忽略。
fn parse_server(server: &str) -> (Option<String>, Option<String>) {
    let mut all = None;
    let mut http = None;
    let mut https = None;
    // 条目以 `;` 或空白分隔（WinINet 两种都接受）
    for entry in server
        .split(|c: char| c == ';' || c.is_whitespace())
        .filter(|e| !e.is_empty())
    {
        match entry.split_once('=') {
            None => all = all.or_else(|| proxy_url(entry)),
            Some((scheme, addr)) => match scheme.trim().to_ascii_lowercase().as_str() {
                "http" => http = http.or_else(|| proxy_url(addr)),
                "https" => https = https.or_else(|| proxy_url(addr)),
                _ => {}
            },
        }
    }
    (http.or_else(|| all.clone()), https.or(all))
}

/// 代理地址 → URL：已带 `http://` / `https://` 的保留，没有协议的补 `http://`，其他协议（socks 等）不用。
fn proxy_url(addr: &str) -> Option<String> {
    let addr = addr.trim().trim_end_matches('/');
    let (scheme, rest) = match addr.split_once("://") {
        Some((s, r)) => (s.to_ascii_lowercase(), r),
        None => ("http".to_owned(), addr),
    };
    if !matches!(scheme.as_str(), "http" | "https") {
        return None;
    }
    let host = rest.rsplit_once('@').map_or(rest, |(_, h)| h);
    if host.is_empty() || host.starts_with(':') || host.contains(char::is_whitespace) {
        return None;
    }
    Some(format!("{scheme}://{rest}"))
}

/// `ProxyOverride` → `NO_PROXY`（逗号分隔）：`<local>` 换成 `localhost`（`NO_PROXY` 表达不了“所有不含点的主机名”，
/// 这类内网短名需在系统例外里逐个写出）；`*.example.com` 换成
/// `.example.com`（undici 的后缀匹配）；中间带通配符的条目（如 `10.*`、`192.168.*`）`NO_PROXY` 表达不了，跳过。
/// 回环地址总在列表里。
fn no_proxy_list(bypass: &str) -> String {
    let mut out: Vec<String> = LOOPBACK.iter().map(|s| (*s).to_owned()).collect();
    for entry in bypass.split(';').map(str::trim).filter(|e| !e.is_empty()) {
        let item = if entry.eq_ignore_ascii_case("<local>") {
            "localhost".to_owned()
        } else if let Some(suffix) = entry.strip_prefix("*.") {
            format!(".{suffix}")
        } else {
            entry.to_owned()
        };
        // 去掉 http:// 一类前缀（WinINet 允许），NO_PROXY 只认主机
        let item = item
            .split_once("://")
            .map_or(item.as_str(), |(_, h)| h)
            .to_ascii_lowercase();
        // 单独的 `*`：全部直连（undici 同样支持）
        if item == "*" {
            return "*".to_owned();
        }
        if item.is_empty() || item.contains('*') {
            continue;
        }
        if !out.contains(&item) {
            out.push(item);
        }
    }
    out.join(",")
}

/// 合并两个逗号分隔的列表，去重，保持先后顺序；任一边有单独的 `*`（全部直连）时结果就是 `*`。
fn merge_lists(first: &str, second: &str) -> String {
    let mut out: Vec<String> = Vec::new();
    for item in first.split(',').chain(second.split(',')) {
        let item = item.trim();
        if item == "*" {
            return "*".to_owned();
        }
        if !item.is_empty() && !out.iter().any(|o| o.eq_ignore_ascii_case(item)) {
            out.push(item.to_owned());
        }
    }
    out.join(",")
}

/// 读当前用户的系统代理设置；读不到（非 Windows、键不存在）时为 `None`。
#[cfg(windows)]
pub(crate) fn read_system_proxy() -> Option<SystemProxy> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use std::ptr::null_mut;
    use windows_sys::Win32::Foundation::ERROR_SUCCESS;
    use windows_sys::Win32::System::Registry::{
        HKEY_CURRENT_USER, RRF_RT_REG_DWORD, RRF_RT_REG_SZ, RegGetValueW,
    };

    const KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Internet Settings";
    fn wide(s: &str) -> Vec<u16> {
        OsStr::new(s)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }
    let key = wide(KEY);

    let dword = |name: &str| -> Option<u32> {
        let value = wide(name);
        let mut data = 0u32;
        let mut size = size_of::<u32>() as u32;
        // SAFETY: 缓冲区与大小如实传入
        let code = unsafe {
            RegGetValueW(
                HKEY_CURRENT_USER,
                key.as_ptr(),
                value.as_ptr(),
                RRF_RT_REG_DWORD,
                null_mut(),
                (&raw mut data).cast(),
                &mut size,
            )
        };
        (code == ERROR_SUCCESS).then_some(data)
    };
    let string = |name: &str| -> String {
        let value = wide(name);
        let mut size = 0u32;
        // SAFETY: 只查询所需字节数，不写缓冲区
        let code = unsafe {
            RegGetValueW(
                HKEY_CURRENT_USER,
                key.as_ptr(),
                value.as_ptr(),
                RRF_RT_REG_SZ,
                null_mut(),
                null_mut(),
                &mut size,
            )
        };
        if code != ERROR_SUCCESS || size == 0 || size > 64 * 1024 {
            return String::new();
        }
        let mut buf = vec![0u16; (size as usize).div_ceil(2)];
        // SAFETY: 缓冲区大小如实传入
        let code = unsafe {
            RegGetValueW(
                HKEY_CURRENT_USER,
                key.as_ptr(),
                value.as_ptr(),
                RRF_RT_REG_SZ,
                null_mut(),
                buf.as_mut_ptr().cast(),
                &mut size,
            )
        };
        if code != ERROR_SUCCESS {
            return String::new();
        }
        let len = (size as usize / 2).min(buf.len());
        String::from_utf16_lossy(&buf[..len])
            .trim_end_matches('\0')
            .to_owned()
    };

    let enabled = dword("ProxyEnable")? != 0;
    Some(SystemProxy {
        enabled,
        server: if enabled {
            string("ProxyServer")
        } else {
            String::new()
        },
        bypass: if enabled {
            string("ProxyOverride")
        } else {
            String::new()
        },
    })
}

#[cfg(not(windows))]
pub(crate) fn read_system_proxy() -> Option<SystemProxy> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::ffi::OsStr;

    fn sys(server: &str, bypass: &str) -> SystemProxy {
        SystemProxy {
            enabled: true,
            server: server.into(),
            bypass: bypass.into(),
        }
    }

    fn env_of(cmd: &Command, key: &str) -> Option<Option<String>> {
        cmd.get_envs()
            .find(|(k, _)| *k == OsStr::new(key))
            .map(|(_, v)| v.map(|v| v.to_string_lossy().into_owned()))
    }

    #[test]
    fn loopback_proxy_must_be_listening() {
        let clash = sys("127.0.0.1:7890", "");
        assert!(!loopback_proxy_alive(&clash, |_| false));
        assert!(loopback_proxy_alive(&clash, |a| a.port() == 7890));
        // 远程代理不探测
        assert!(loopback_proxy_alive(&sys("proxy.corp:8080", ""), |_| false));
        // 没开代理不受影响
        let mut off = clash.clone();
        off.enabled = false;
        assert!(loopback_proxy_alive(&off, |_| false));
        assert_eq!(
            loopback_addr("http://localhost:7890"),
            Some(SocketAddr::from(([127, 0, 0, 1], 7890)))
        );
        assert_eq!(
            loopback_addr("http://u:p@[::1]:1080"),
            Some("[::1]:1080".parse().unwrap())
        );
        assert_eq!(loopback_addr("http://10.0.0.1:8080"), None);
        // 真实端口：监听中可用，关掉后不可用
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        let live = sys(&format!("127.0.0.1:{port}"), "");
        assert!(loopback_proxy_alive(&live, port_listening));
        drop(l);
        assert!(!loopback_proxy_alive(&live, port_listening));
    }

    #[test]
    fn disabled_or_empty_means_no_proxy() {
        let mut off = sys("127.0.0.1:7890", "");
        off.enabled = false;
        assert_eq!(proxy_env(&off), None);
        assert_eq!(proxy_env(&sys("", "")), None);
        assert_eq!(proxy_env(&sys("socks=127.0.0.1:1080", "")), None);
    }

    #[test]
    fn single_server_applies_to_both() {
        let env = proxy_env(&sys("127.0.0.1:7890", "")).unwrap();
        assert_eq!(env.http.as_deref(), Some("http://127.0.0.1:7890"));
        assert_eq!(env.https.as_deref(), Some("http://127.0.0.1:7890"));
        assert_eq!(env.no_proxy, "localhost,127.0.0.1,::1");
    }

    #[test]
    fn per_protocol_servers() {
        let env = proxy_env(&sys(
            "http=10.0.0.1:8080;https=10.0.0.2:8443;socks=10.0.0.3:1080",
            "",
        ))
        .unwrap();
        assert_eq!(env.http.as_deref(), Some("http://10.0.0.1:8080"));
        assert_eq!(env.https.as_deref(), Some("http://10.0.0.2:8443"));
        // 只配 http= 时 HTTPS 应直连：undici 会让 HTTPS 回退到 HTTP_PROXY，所以整体不设
        assert_eq!(proxy_env(&sys("http=10.0.0.1:8080", "")), None);
        // 只配 https= 时 HTTP 直连
        let only_https = proxy_env(&sys("https=10.0.0.2:8443", "")).unwrap();
        assert_eq!(only_https.http, None);
        assert_eq!(only_https.https.as_deref(), Some("http://10.0.0.2:8443"));
    }

    #[test]
    fn whitespace_separated_entries() {
        let env = proxy_env(&sys("http=proxy.corp:8080 https=proxy.corp:8443", "")).unwrap();
        assert_eq!(env.http.as_deref(), Some("http://proxy.corp:8080"));
        assert_eq!(env.https.as_deref(), Some("http://proxy.corp:8443"));
    }

    #[test]
    fn keeps_explicit_scheme_and_rejects_socks() {
        let env = proxy_env(&sys("https://proxy.corp:443/", "")).unwrap();
        assert_eq!(env.https.as_deref(), Some("https://proxy.corp:443"));
        assert_eq!(proxy_env(&sys("socks5://127.0.0.1:1080", "")), None);
        assert_eq!(proxy_env(&sys(":8080", "")), None);
    }

    #[test]
    fn bypass_list_conversion() {
        let env = proxy_env(&sys(
            "127.0.0.1:7890",
            "<local>;*.corp.example;10.*;192.168.*;intranet;HTTP://Wiki.Example;localhost",
        ))
        .unwrap();
        assert_eq!(
            env.no_proxy,
            "localhost,127.0.0.1,::1,.corp.example,intranet,wiki.example"
        );
    }

    #[test]
    fn wildcard_bypass_means_direct_for_all() {
        assert_eq!(no_proxy_list("*"), "*");
        assert_eq!(no_proxy_list("<local>;*"), "*");
        assert_eq!(merge_lists("*", "localhost,127.0.0.1,::1"), "*");
        assert_eq!(merge_lists("git.lan", "*"), "*");
    }

    #[test]
    fn sets_env_from_system_proxy() {
        let mut cmd = Command::new("node");
        apply_with(&mut cmd, |_| None, Some(sys("127.0.0.1:7890", "*.lan")));
        assert_eq!(
            env_of(&cmd, "HTTP_PROXY"),
            Some(Some("http://127.0.0.1:7890".into()))
        );
        assert_eq!(
            env_of(&cmd, "HTTPS_PROXY"),
            Some(Some("http://127.0.0.1:7890".into()))
        );
        assert_eq!(
            env_of(&cmd, "NO_PROXY"),
            Some(Some("localhost,127.0.0.1,::1,.lan".into()))
        );
    }

    #[test]
    fn no_system_proxy_leaves_env_untouched() {
        let mut cmd = Command::new("node");
        let mut off = sys("127.0.0.1:7890", "");
        off.enabled = false;
        apply_with(&mut cmd, |_| None, Some(off));
        apply_with(&mut cmd, |_| None, None);
        assert_eq!(cmd.get_envs().count(), 0);
    }

    #[test]
    fn user_proxy_env_wins() {
        let inherited: HashMap<&str, &str> = HashMap::from([("https_proxy", "http://u:1")]);
        let mut cmd = Command::new("node");
        apply_with(
            &mut cmd,
            |k| inherited.get(k).map(|v| (*v).to_owned()),
            Some(sys("127.0.0.1:7890", "")),
        );
        assert_eq!(cmd.get_envs().count(), 0);
    }

    #[test]
    fn merges_user_no_proxy() {
        let inherited: HashMap<&str, &str> = HashMap::from([("no_proxy", "git.lan, localhost")]);
        let mut cmd = Command::new("node");
        apply_with(
            &mut cmd,
            |k| inherited.get(k).map(|v| (*v).to_owned()),
            Some(sys("127.0.0.1:7890", "")),
        );
        assert_eq!(
            env_of(&cmd, "NO_PROXY"),
            Some(Some("git.lan,localhost,127.0.0.1,::1".into()))
        );
    }
}
