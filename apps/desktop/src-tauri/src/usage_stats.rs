//! 用量统计（设置·用量）：只读扫描会话目录中的 `.jsonl` 文件，汇总近一年模型调用记录与完成任务数。
//!
//! - 不修改会话文件、不把统计写进新库，直接按行（仅 `\n` 切分并去掉行尾 `\r`）解析助手消息里的 `usage`。
//! - 单文件读不了或单行 JSON 损坏时跳过，不影响其他会话统计。

use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::Value;

use crate::session_index::{is_session_file_name, parse_iso_millis};

/// 最多返回近 366 天内的记录，避免历史累积造成内存膨胀。
const WINDOW_MS: i64 = 366 * 24 * 60 * 60 * 1000;
/// 返回的调用明细上限（按时间倒序保留最新）。
const MAX_CALLS: usize = 5000;

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UsageCost {
    pub(crate) amount: f64,
    pub(crate) currency: String,
    pub(crate) estimated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UsageSessionRef {
    pub(crate) path: String,
    pub(crate) id: String,
    pub(crate) workspace: String,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UsageCall {
    pub(crate) id: String,
    pub(crate) timestamp: i64,
    pub(crate) model: String,
    pub(crate) input: Option<u64>,
    pub(crate) output: Option<u64>,
    pub(crate) total: Option<u64>,
    pub(crate) cost: Option<UsageCost>,
    pub(crate) status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) session: Option<UsageSessionRef>,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UsageStats {
    pub(crate) calls: Vec<UsageCall>,
    pub(crate) completed_at: Vec<i64>,
}

pub(crate) fn collect(sessions_dir: &Path) -> UsageStats {
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    collect_since(sessions_dir, now_ms.saturating_sub(WINDOW_MS))
}

pub(crate) fn collect_since(sessions_dir: &Path, min_timestamp_ms: i64) -> UsageStats {
    let files = session_files_lenient(sessions_dir);
    let mut calls = Vec::new();
    let mut completed_at = Vec::new();
    for file in files {
        parse_session_file(&file, min_timestamp_ms, &mut calls, &mut completed_at);
    }
    calls.sort_by(|a, b| b.timestamp.cmp(&a.timestamp).then_with(|| b.id.cmp(&a.id)));
    if calls.len() > MAX_CALLS {
        calls.truncate(MAX_CALLS);
    }
    completed_at.sort_unstable_by(|a, b| b.cmp(a));
    UsageStats {
        calls,
        completed_at,
    }
}

/// 用量统计专用的遍历：读不了的子目录或目录项单独跳过，其余可读的会话文件照常统计。
/// 不改共享的 `session_files`：`SessionIndex::sync_all` 依赖它完整枚举才能判断哪些索引可删。
fn session_files_lenient(dir: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    let mut dirs = vec![dir.to_path_buf()];
    while let Some(current) = dirs.pop() {
        let Ok(entries) = std::fs::read_dir(&current) else {
            continue;
        };
        for entry in entries.flatten() {
            let Ok(ty) = entry.file_type() else {
                continue;
            };
            let path = entry.path();
            if ty.is_dir() {
                dirs.push(path);
            } else if ty.is_file() && is_session_file_name(&path) {
                files.push(path);
            }
        }
    }
    files
}

fn parse_session_file(
    path: &Path,
    min_timestamp_ms: i64,
    calls: &mut Vec<UsageCall>,
    completed_at: &mut Vec<i64>,
) {
    let Ok(file) = File::open(path) else {
        return;
    };
    let path_str = path.to_string_lossy().into_owned();
    let mut reader = BufReader::new(file);
    let mut buf = Vec::new();
    let mut session_ref: Option<UsageSessionRef> = None;
    let mut line_index: usize = 0;

    loop {
        buf.clear();
        let Ok(n) = reader.read_until(b'\n', &mut buf) else {
            break;
        };
        if n == 0 {
            break;
        }
        line_index += 1;
        if buf.last() == Some(&b'\n') {
            buf.pop();
        }
        if buf.last() == Some(&b'\r') {
            buf.pop();
        }
        if buf.is_empty() {
            continue;
        }
        // 快速预过滤：只解析会话头或 assistant 消息，跳过大体积 toolResult / user 图片行
        let Ok(line) = std::str::from_utf8(&buf) else {
            continue;
        };
        let is_header = line_index == 1 && line.contains("\"session\"");
        let is_assistant = line.contains("\"assistant\"");
        if !is_header && !is_assistant {
            continue;
        }
        let Ok(entry) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        match entry.get("type").and_then(Value::as_str) {
            Some("session") => {
                let id = entry
                    .get("id")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned();
                let workspace = entry
                    .get("cwd")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned();
                if !id.is_empty() {
                    session_ref = Some(UsageSessionRef {
                        path: path_str.clone(),
                        id,
                        workspace,
                    });
                }
            }
            Some("message") => {
                let Some(msg) = entry.get("message").and_then(Value::as_object) else {
                    continue;
                };
                if msg.get("role").and_then(Value::as_str) != Some("assistant") {
                    continue;
                }
                let timestamp = msg
                    .get("timestamp")
                    .and_then(Value::as_i64)
                    .or_else(|| {
                        entry
                            .get("timestamp")
                            .and_then(Value::as_str)
                            .and_then(parse_iso_millis)
                    })
                    .unwrap_or(0);
                if timestamp <= 0 || timestamp < min_timestamp_ms {
                    continue;
                }
                let stop_reason = msg.get("stopReason").and_then(Value::as_str).unwrap_or("");
                let status = match stop_reason {
                    "error" => "failed",
                    "aborted" | "cancelled" => "cancelled",
                    _ => "success",
                };
                if stop_reason == "stop" {
                    completed_at.push(timestamp);
                }
                let model = msg
                    .get("model")
                    .and_then(Value::as_str)
                    .filter(|s| !s.is_empty())
                    .unwrap_or("unknown")
                    .to_owned();
                let (input, output, total, cost) = parse_usage(msg.get("usage"));
                let entry_id = entry
                    .get("id")
                    .and_then(Value::as_str)
                    .map(str::to_owned)
                    .unwrap_or_else(|| format!("{line_index}"));
                let session_id = session_ref
                    .as_ref()
                    .map(|s| s.id.as_str())
                    .unwrap_or("session");
                calls.push(UsageCall {
                    id: format!("{session_id}:{entry_id}"),
                    timestamp,
                    model,
                    input,
                    output,
                    total,
                    cost,
                    status,
                    session: session_ref.clone(),
                });
            }
            _ => {}
        }
    }
}

fn parse_usage(
    usage: Option<&Value>,
) -> (Option<u64>, Option<u64>, Option<u64>, Option<UsageCost>) {
    let Some(u) = usage.and_then(Value::as_object) else {
        return (None, None, None, None);
    };
    let raw_in = u.get("input").and_then(Value::as_u64);
    let cache_read = u.get("cacheRead").and_then(Value::as_u64).unwrap_or(0);
    let cache_write = u.get("cacheWrite").and_then(Value::as_u64).unwrap_or(0);
    let input = raw_in.map(|v| v.saturating_add(cache_read).saturating_add(cache_write));
    let output = u.get("output").and_then(Value::as_u64);
    let total = u
        .get("totalTokens")
        .and_then(Value::as_u64)
        .or_else(|| match (input, output) {
            (Some(i), Some(o)) => Some(i.saturating_add(o)),
            _ => None,
        });
    let cost = u.get("cost").and_then(Value::as_object).and_then(|c| {
        let amount = c.get("total").and_then(Value::as_f64)?;
        let from_provider = c
            .get("totalFromProvider")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        if !amount.is_finite() || (amount <= 0.0 && !from_provider) {
            return None;
        }
        let currency = c
            .get("currency")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .unwrap_or("USD")
            .to_owned();
        Some(UsageCost {
            amount: amount.max(0.0),
            currency,
            estimated: !from_provider,
        })
    });
    (input, output, total, cost)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    struct TempDir(PathBuf);
    impl TempDir {
        fn new(label: &str) -> Self {
            let p = std::env::temp_dir()
                .join(format!("primus-usage-stats-{label}-{}", std::process::id()));
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
    fn parses_real_assistant_usage_and_completed_tasks() {
        let dir = TempDir::new("parse");
        let file = dir.0.join("2026-11-20T01-00-00-000Z_s1.jsonl");
        let content = [
            r#"{"type":"session","version":3,"id":"s1","timestamp":"2026-11-20T01:00:00.000Z","cwd":"E:\\work"}"#,
            r#"{"type":"message","id":"m1","timestamp":"2026-11-20T01:00:05.000Z","message":{"role":"assistant","model":"gemini-4-neon-xhigh","stopReason":"toolUse","timestamp":1795136405000,"usage":{"input":200,"output":100,"cacheRead":300,"cacheWrite":0,"totalTokens":600,"cost":{"total":0,"totalFromProvider":false}}}}"#,
            r#"{"type":"message","id":"m2","timestamp":"2026-11-20T01:00:10.000Z","message":{"role":"assistant","model":"claude-sonnet","stopReason":"stop","timestamp":1795136410000,"usage":{"input":1000,"output":500,"cacheRead":0,"cacheWrite":0,"totalTokens":1500,"cost":{"total":0.015,"totalFromProvider":true}}}}"#,
            r#"{"type":"message","id":"m3","timestamp":"2026-11-20T01:00:15.000Z","message":{"role":"assistant","model":"glm-flash","stopReason":"error","timestamp":1795136415000,"usage":{"input":0,"output":0,"totalTokens":0,"cost":{"total":0,"totalFromProvider":false}}}}"#,
        ]
        .join("\r\n");
        fs::write(&file, content).unwrap();

        let stats = collect_since(&dir.0, 1_795_000_000_000);
        assert_eq!(stats.calls.len(), 3);
        assert_eq!(stats.completed_at, vec![1_795_136_410_000]);
        assert_eq!(stats.calls[0].status, "failed");
        assert_eq!(stats.calls[1].model, "claude-sonnet");
        assert_eq!(stats.calls[1].cost.as_ref().map(|c| c.amount), Some(0.015));
        assert_eq!(
            stats.calls[1].cost.as_ref().map(|c| c.estimated),
            Some(false)
        );
        assert_eq!(stats.calls[2].input, Some(500)); // 200 + 300 cacheRead
        assert_eq!(stats.calls[2].output, Some(100));
        assert_eq!(stats.calls[2].total, Some(600));
        assert!(stats.calls[2].cost.is_none());
        assert_eq!(
            stats.calls[2]
                .session
                .as_ref()
                .map(|s| s.workspace.as_str()),
            Some("E:\\work")
        );
    }
}
