//! 右栏“可运行”的网页预览（附录 B `preview_serve`）：自定义协议 `primus-preview` 把网页所在文件夹以只读方式提供给预览 iframe。
//!
//! 为什么不用 srcdoc：srcdoc / blob 文档继承 App 的 CSP，脚本不能运行，相对路径的样式、脚本、图片也加载不到，
//! Agent 做的动画、交互页面在预览里是静止的。改为由本协议返回页面，响应自带一份宽松的 CSP。
//!
//! 隔离：
//! - 前端 iframe 只给 `sandbox="allow-scripts"`（不给 allow-same-origin）：页面是不透明源，读不到 App 的存储与 DOM，
//!   不能弹窗、不能导航顶层窗口；Tauri 的 IPC 只认 App 自己的源，页面调不到任何命令。
//! - 每个文件夹登记时得到一个随机令牌，URL 形如 `<协议源>/<令牌>/<相对路径>`；只提供该文件夹（含子文件夹）里的
//!   普通文件，解析后的真实路径必须仍在文件夹内（`..`、链接跳出都拒绝）；未登记的令牌一律 404。
//! - 响应的 CSP 允许内联脚本与 https 资源（常见的 CDN 库），不允许连 `ipc.localhost`；不缓存。
//! - 只读不写，单个文件最多 [`MAX_FILE_BYTES`]。
//!
//! 与在浏览器里打开网页相同，页面可以加载、发送网络请求；它能读到的本机文件仅限所在文件夹。

use std::collections::HashMap;
use std::collections::hash_map::RandomState;
use std::hash::{BuildHasher, Hasher};
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};

use tauri::http::{Request, Response, StatusCode, header};

/// 协议名
pub(crate) const SCHEME: &str = "primus-preview";

/// 单个文件最多提供的字节数（64 MiB，与音频视频预览一致）
pub(crate) const MAX_FILE_BYTES: u64 = 64 * 1024 * 1024;

/// 预览页面的 CSP：脚本、样式、图片、字体、媒体可来自本协议、https、data / blob；不允许连 ipc
fn page_csp() -> String {
    let own = origin();
    format!(
        "default-src {own} https: data: blob:; \
         script-src {own} https: data: blob: 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'; \
         style-src {own} https: data: 'unsafe-inline'; \
         img-src {own} https: http: data: blob:; \
         media-src {own} https: data: blob:; \
         font-src {own} https: data:; \
         connect-src {own} https: wss: data: blob:; \
         worker-src {own} blob: data:; \
         frame-src {own} https: data: blob:; \
         form-action 'none'; \
         base-uri {own}"
    )
}

/// 协议在 WebView 里的源：Windows / Android 上 Tauri 把自定义协议映射为 `http://<协议>.localhost`
pub(crate) fn origin() -> String {
    if cfg!(any(windows, target_os = "android")) {
        format!("http://{SCHEME}.localhost")
    } else {
        format!("{SCHEME}://localhost")
    }
}

/// 已登记的文件夹：令牌 → 文件夹真实路径
pub(crate) struct PreviewRoots {
    roots: Mutex<HashMap<String, PathBuf>>,
    hasher: RandomState,
    counter: AtomicU64,
}

impl Default for PreviewRoots {
    fn default() -> Self {
        Self {
            roots: Mutex::new(HashMap::new()),
            hasher: RandomState::new(),
            counter: AtomicU64::new(0),
        }
    }
}

impl PreviewRoots {
    /// 随机令牌：两次带进程随机种子的哈希（128 位），只在本进程内有效
    fn token(&self, dir: &Path) -> String {
        let n = self.counter.fetch_add(1, Ordering::Relaxed);
        let part = |salt: u64| {
            let mut h = self.hasher.build_hasher();
            h.write_u64(salt);
            h.write_u64(n);
            h.write(dir.as_os_str().as_encoded_bytes());
            h.finish()
        };
        format!("{:016x}{:016x}", part(1), part(2))
    }

    /// 登记文件所在文件夹（同一文件夹复用令牌），返回该文件的预览 URL
    pub(crate) fn serve(&self, file: &Path) -> Result<String, String> {
        let meta = std::fs::metadata(file).map_err(|e| format!("读取文件失败：{e}"))?;
        if !meta.is_file() {
            return Err("只能预览普通文件".into());
        }
        let real = std::fs::canonicalize(file).map_err(|e| format!("读取文件失败：{e}"))?;
        let dir = real.parent().ok_or("文件没有所在文件夹")?.to_path_buf();
        let name = real
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or("文件名无法用于预览")?
            .to_string();
        let mut roots = self.roots.lock().map_err(|_| "预览状态损坏")?;
        let token = match roots.iter().find(|(_, d)| **d == dir) {
            Some((t, _)) => t.clone(),
            None => {
                let t = self.token(&dir);
                roots.insert(t.clone(), dir);
                t
            }
        };
        Ok(format!("{}/{token}/{}", origin(), percent_encode(&name)))
    }

    fn root(&self, token: &str) -> Option<PathBuf> {
        self.roots.lock().ok()?.get(token).cloned()
    }

    /// 按请求路径（`/<令牌>/<相对路径>`，已百分号编码）找到文件夹内的文件
    pub(crate) fn resolve(&self, uri_path: &str) -> Result<PathBuf, StatusCode> {
        let trimmed = uri_path.trim_start_matches('/');
        let (token, rest) = trimmed.split_once('/').ok_or(StatusCode::NOT_FOUND)?;
        let root = self.root(token).ok_or(StatusCode::NOT_FOUND)?;
        let rel = percent_decode(rest).ok_or(StatusCode::BAD_REQUEST)?;
        resolve_in(&root, &rel)
    }
}

/// 文件夹内的相对路径 → 真实路径；只接受普通的路径段，解析链接后仍须在文件夹内
fn resolve_in(root: &Path, rel: &str) -> Result<PathBuf, StatusCode> {
    let mut path = root.to_path_buf();
    for seg in rel.split('/').filter(|s| !s.is_empty()) {
        let seg_path = Path::new(seg);
        let mut comps = seg_path.components();
        match (comps.next(), comps.next()) {
            (Some(Component::Normal(_)), None) => path.push(seg),
            _ => return Err(StatusCode::FORBIDDEN),
        }
    }
    if path == root {
        return Err(StatusCode::NOT_FOUND);
    }
    let real = std::fs::canonicalize(&path).map_err(|_| StatusCode::NOT_FOUND)?;
    if !real.starts_with(root) {
        return Err(StatusCode::FORBIDDEN);
    }
    if !real.is_file() {
        return Err(StatusCode::NOT_FOUND);
    }
    Ok(real)
}

/// 处理一次协议请求
pub(crate) fn respond(roots: &PreviewRoots, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let status = |code: StatusCode| {
        Response::builder()
            .status(code)
            .header(header::CACHE_CONTROL, "no-store")
            .body(Vec::new())
            .unwrap_or_default()
    };
    if request.method() != tauri::http::Method::GET && request.method() != tauri::http::Method::HEAD
    {
        return status(StatusCode::METHOD_NOT_ALLOWED);
    }
    let path = match roots.resolve(request.uri().path()) {
        Ok(p) => p,
        Err(code) => return status(code),
    };
    match read_capped(&path) {
        Ok(body) => Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, mime_of(&path))
            .header(header::CONTENT_SECURITY_POLICY, page_csp())
            .header(header::CACHE_CONTROL, "no-store")
            .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
            // 页面是不透明源（sandbox 不含 allow-same-origin）：模块脚本、fetch 同文件夹的文件需要 CORS
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .header("Referrer-Policy", "no-referrer")
            .body(if request.method() == tauri::http::Method::HEAD {
                Vec::new()
            } else {
                body
            })
            .unwrap_or_default(),
        Err(code) => status(code),
    }
}

fn read_capped(path: &Path) -> Result<Vec<u8>, StatusCode> {
    use std::io::Read;
    let file = std::fs::File::open(path).map_err(|_| StatusCode::NOT_FOUND)?;
    let mut buf = Vec::new();
    file.take(MAX_FILE_BYTES + 1)
        .read_to_end(&mut buf)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if buf.len() as u64 > MAX_FILE_BYTES {
        return Err(StatusCode::PAYLOAD_TOO_LARGE);
    }
    Ok(buf)
}

/// 按扩展名给 Content-Type（nosniff 下脚本、样式必须给对类型）
pub(crate) fn mime_of(path: &Path) -> &'static str {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    match ext.as_str() {
        "html" | "htm" => "text/html; charset=utf-8",
        "xhtml" => "application/xhtml+xml; charset=utf-8",
        "svg" => "image/svg+xml",
        "css" => "text/css; charset=utf-8",
        "js" | "mjs" | "cjs" => "text/javascript; charset=utf-8",
        "json" | "map" => "application/json; charset=utf-8",
        "wasm" => "application/wasm",
        "txt" | "md" | "csv" => "text/plain; charset=utf-8",
        "xml" => "application/xml; charset=utf-8",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "ico" => "image/x-icon",
        "bmp" => "image/bmp",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" | "oga" => "audio/ogg",
        "m4a" => "audio/mp4",
        "mp4" | "m4v" => "video/mp4",
        "webm" => "video/webm",
        "ogv" => "video/ogg",
        "glb" => "model/gltf-binary",
        "gltf" => "model/gltf+json",
        _ => "application/octet-stream",
    }
}

/// URL 路径段的百分号编码（保留非保留字符）
fn percent_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// 百分号解码；结果不是 UTF-8、或含 NUL / 反斜杠（Windows 上会被当作分隔符）时返回 None
fn percent_decode(s: &str) -> Option<String> {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = s.get(i + 1..i + 3)?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    let text = String::from_utf8(out).ok()?;
    if text.contains('\0') || text.contains('\\') {
        return None;
    }
    Some(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("primus-preview-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("site/assets")).unwrap();
        std::fs::write(dir.join("site/index.html"), "<script>1</script>").unwrap();
        std::fs::write(dir.join("site/assets/app.js"), "1").unwrap();
        std::fs::write(dir.join("secret.txt"), "x").unwrap();
        std::fs::canonicalize(dir).unwrap()
    }

    #[test]
    fn serves_files_inside_the_folder_only() {
        let dir = temp_dir("inside");
        let roots = PreviewRoots::default();
        let url = roots.serve(&dir.join("site/index.html")).unwrap();
        let path = url.strip_prefix(&origin()).unwrap();
        assert!(path.ends_with("/index.html"));
        let token = path
            .trim_start_matches('/')
            .split('/')
            .next()
            .unwrap()
            .to_string();
        assert_eq!(token.len(), 32);
        assert_eq!(
            roots.resolve(&format!("/{token}/assets/app.js")).unwrap(),
            dir.join("site/assets/app.js")
        );
        assert_eq!(
            roots
                .resolve(&format!("/{token}/../secret.txt"))
                .unwrap_err(),
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            roots
                .resolve(&format!("/{token}/%2e%2e/secret.txt"))
                .unwrap_err(),
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            roots
                .resolve(&format!("/{token}/..%5csecret.txt"))
                .unwrap_err(),
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            roots.resolve(&format!("/{token}/assets")).unwrap_err(),
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            roots.resolve("/0000/index.html").unwrap_err(),
            StatusCode::NOT_FOUND
        );
        // 同一文件夹复用令牌
        assert_eq!(roots.serve(&dir.join("site/index.html")).unwrap(), url);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn responses_carry_type_and_csp() {
        let dir = temp_dir("respond");
        let roots = PreviewRoots::default();
        let url = roots.serve(&dir.join("site/index.html")).unwrap();
        let req = Request::builder()
            .uri(url.as_str())
            .body(Vec::new())
            .unwrap();
        let res = respond(&roots, &req);
        assert_eq!(res.status(), StatusCode::OK);
        assert_eq!(
            res.headers()[header::CONTENT_TYPE],
            "text/html; charset=utf-8"
        );
        let csp = res.headers()[header::CONTENT_SECURITY_POLICY]
            .to_str()
            .unwrap();
        assert!(csp.contains("'unsafe-inline'") && !csp.contains("ipc"));
        assert_eq!(res.body(), b"<script>1</script>");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn percent_coding_round_trips() {
        assert_eq!(percent_encode("鹈鹕 a.html"), "%E9%B9%88%E9%B9%95%20a.html");
        assert_eq!(
            percent_decode("%E9%B9%88%E9%B9%95%20a.html").unwrap(),
            "鹈鹕 a.html"
        );
        assert!(percent_decode("%zz").is_none());
        assert!(percent_decode("a%00").is_none());
    }
}
