//! stdin 写队列（背压）、stdout 只按 LF 分帧并去 \r、16ms 合批、Channel 推送、64MB 缓冲。第 5.4、7 章。
//!
//! 目前只落地分帧器 [`LineFramer`]；Core 进程监管接入后由 stdout 读取循环调用。

// 读取循环尚未接入（后续任务），非测试构建先放行未使用告警；接入后删除此属性。
#![cfg_attr(not(test), allow(dead_code))]

/// Core stdout 的 JSONL 分帧器。
///
/// 只按 `\n`（LF）切分，并去掉行尾的一个 `\r`；`U+2028`、`U+2029` 等字符原样留在帧内
/// （它们在 JSON 字符串里合法，把它们当换行的通用行读取器会把一条记录切断）。
/// 不完整的尾部留在缓冲区，与下一块数据拼接；空行跳过。按字节处理，
/// 因为 UTF-8 多字节字符的任何字节都不会是 `0x0A`，块边界落在字符中间也不影响分帧。
#[derive(Debug, Default)]
pub(crate) struct LineFramer {
    buf: Vec<u8>,
    /// `buf` 开头已确认不含 LF 的字节数：下次只扫描新追加的部分，
    /// 大帧分成许多小块到达时总扫描量保持线性。
    scanned: usize,
}

impl LineFramer {
    /// 追加一块原始字节，返回其中所有完整的帧（不含行尾）。
    pub(crate) fn push(&mut self, chunk: &[u8]) -> Vec<Vec<u8>> {
        self.buf.extend_from_slice(chunk);
        let mut frames = Vec::new();
        let mut start = 0;
        let mut search_from = self.scanned;
        while let Some(offset) = self.buf[search_from..].iter().position(|&b| b == b'\n') {
            let end = search_from + offset;
            let line = &self.buf[start..end];
            let line = line.strip_suffix(b"\r").unwrap_or(line);
            if !line.is_empty() {
                frames.push(line.to_vec());
            }
            start = end + 1;
            search_from = start;
        }
        self.buf.drain(..start);
        // 剩下的都是不含 LF 的不完整尾部
        self.scanned = self.buf.len();
        frames
    }

    /// 缓冲区中尚未成帧的字节数（供 64MB 缓冲上限判断）。
    pub(crate) fn pending_len(&self) -> usize {
        self.buf.len()
    }
}

#[cfg(test)]
mod tests {
    use super::LineFramer;

    fn push_str(framer: &mut LineFramer, chunk: &str) -> Vec<String> {
        framer
            .push(chunk.as_bytes())
            .into_iter()
            .map(|frame| String::from_utf8(frame).expect("帧应为合法 UTF-8"))
            .collect()
    }

    #[test]
    fn splits_on_lf_and_strips_trailing_cr() {
        let mut framer = LineFramer::default();
        let frames = push_str(&mut framer, "{\"a\":1}\r\n{\"b\":2}\n");
        assert_eq!(frames, vec!["{\"a\":1}", "{\"b\":2}"]);
        assert_eq!(framer.pending_len(), 0);
    }

    #[test]
    fn keeps_unicode_line_separators_inside_frame() {
        let mut framer = LineFramer::default();
        let record = "{\"text\":\"a\u{2028}b\u{2029}c\u{0085}d\"}";
        let frames = push_str(&mut framer, &format!("{record}\n"));
        assert_eq!(frames, vec![record]);
    }

    #[test]
    fn buffers_partial_frame_across_chunks() {
        let mut framer = LineFramer::default();
        assert!(push_str(&mut framer, "{\"type\":\"mess").is_empty());
        assert_eq!(framer.pending_len(), 13);
        // CR 与 LF 落在两块数据里，CR 仍应被去掉
        assert!(push_str(&mut framer, "age\"}\r").is_empty());
        assert_eq!(push_str(&mut framer, "\n"), vec!["{\"type\":\"message\"}"]);
        assert_eq!(framer.pending_len(), 0);
    }

    #[test]
    fn handles_multibyte_char_split_between_chunks() {
        let mut framer = LineFramer::default();
        let bytes = "{\"text\":\"乾元\"}\n".as_bytes();
        // "乾" 占 3 字节，从它中间切开
        let split = "{\"text\":\"".len() + 1;
        assert!(framer.push(&bytes[..split]).is_empty());
        let frames = framer.push(&bytes[split..]);
        assert_eq!(
            frames,
            vec![b"{\"text\":\"\xE4\xB9\xBE\xE5\x85\x83\"}".to_vec()]
        );
    }

    #[test]
    fn scans_only_new_bytes_across_many_small_chunks() {
        let mut framer = LineFramer::default();
        for _ in 0..1000 {
            assert!(framer.push(b"ab").is_empty());
        }
        assert_eq!(framer.pending_len(), 2000);
        // 一块里同时有上一帧的结尾、LF 与下一帧的开头
        let frames = framer.push(b"c\n{\"x\"");
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].len(), 2001);
        assert_eq!(framer.pending_len(), 5);
        assert_eq!(push_str(&mut framer, ":1}\n"), vec!["{\"x\":1}"]);
        assert_eq!(framer.pending_len(), 0);
    }

    #[test]
    fn skips_empty_lines() {
        let mut framer = LineFramer::default();
        let frames = push_str(&mut framer, "\n\r\n{}\n\n");
        assert_eq!(frames, vec!["{}"]);
    }
}
