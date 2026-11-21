//! App 设置（第 18 章）：读写 `users/<SID>/app/settings.json`。
//!
//! - 只存前端与薄壳共用的非敏感偏好（如关闭时最小化到托盘、通知、Agent 偏好、高级开关等）；
//!   密钥与密码绝不写进本文件（安全规则 2.5）。
//! - 原子写盘（临时文件替换），读不到或损坏时回退为空对象，不阻塞启动。

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{RwLock, RwLockReadGuard, RwLockWriteGuard};

use serde_json::{Map, Value};

const FILE_NAME: &str = "settings.json";
const MAX_SETTINGS_BYTES: usize = 128 * 1024;

pub(crate) struct AppSettings {
    path: PathBuf,
    values: RwLock<Map<String, Value>>,
}

impl AppSettings {
    pub(crate) fn load(app_dir: &Path) -> Self {
        let path = app_dir.join(FILE_NAME);
        let values = read_map(&path).unwrap_or_default();
        Self {
            path,
            values: RwLock::new(values),
        }
    }

    fn read_guard(&self) -> RwLockReadGuard<'_, Map<String, Value>> {
        self.values
            .read()
            .unwrap_or_else(|poison| poison.into_inner())
    }

    fn write_guard(&self) -> RwLockWriteGuard<'_, Map<String, Value>> {
        self.values
            .write()
            .unwrap_or_else(|poison| poison.into_inner())
    }

    pub(crate) fn get_all(&self) -> Map<String, Value> {
        self.read_guard().clone()
    }

    pub(crate) fn patch(&self, patch: Map<String, Value>) -> Result<(), String> {
        let mut guard = self.write_guard();
        let mut next = guard.clone();
        for (k, v) in patch {
            if v.is_null() {
                next.remove(&k);
            } else {
                next.insert(k, v);
            }
        }
        let bytes = serde_json::to_vec_pretty(&Value::Object(next.clone()))
            .map_err(|e| format!("序列化设置失败：{e}"))?;
        if bytes.len() > MAX_SETTINGS_BYTES {
            return Err("设置数据超过上限".into());
        }
        atomic_write(&self.path, &bytes).map_err(|e| format!("保存设置失败：{e}"))?;
        *guard = next;
        Ok(())
    }

    /// 关闭主窗口时是否始终最小化到托盘（默认 false）。
    pub(crate) fn minimize_to_tray(&self) -> bool {
        self.read_guard()
            .get("minimizeToTray")
            .and_then(Value::as_bool)
            .unwrap_or(false)
    }
}

fn read_map(path: &Path) -> Option<Map<String, Value>> {
    let text = fs::read_to_string(path).ok()?;
    match serde_json::from_str::<Value>(&text).ok()? {
        Value::Object(map) => Some(map),
        _ => None,
    }
}

fn atomic_write(path: &Path, bytes: &[u8]) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, bytes)?;
    // std::fs::rename 在 Windows 上以 MOVEFILE_REPLACE_EXISTING 替换已有文件；
    // 失败时保留旧设置文件，只清理临时文件并返回错误
    if let Err(err) = fs::rename(&tmp, path) {
        let _ = fs::remove_file(&tmp);
        return Err(err);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    struct TempDir(PathBuf);
    impl TempDir {
        fn new(label: &str) -> Self {
            let p = std::env::temp_dir().join(format!(
                "primus-app-settings-{label}-{}",
                std::process::id()
            ));
            let _ = fs::remove_dir_all(&p);
            fs::create_dir_all(&p).unwrap();
            Self(p)
        }
    }
    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn load_patch_and_reload_persists_settings() {
        let dir = TempDir::new("persist");
        let settings = AppSettings::load(&dir.0);
        assert!(!settings.minimize_to_tray());
        assert!(settings.get_all().is_empty());

        let mut patch = Map::new();
        patch.insert("minimizeToTray".into(), json!(true));
        patch.insert("notifyEnabled".into(), json!(false));
        patch.insert("agentReplyStyle".into(), json!("concise"));
        settings.patch(patch).unwrap();
        assert!(settings.minimize_to_tray());

        let reloaded = AppSettings::load(&dir.0);
        assert!(reloaded.minimize_to_tray());
        assert_eq!(reloaded.get_all().get("notifyEnabled"), Some(&json!(false)));
        assert_eq!(
            reloaded.get_all().get("agentReplyStyle"),
            Some(&json!("concise"))
        );

        // 传 null 删除字段
        let mut remove = Map::new();
        remove.insert("agentReplyStyle".into(), Value::Null);
        reloaded.patch(remove).unwrap();
        assert!(!reloaded.get_all().contains_key("agentReplyStyle"));
    }
}
