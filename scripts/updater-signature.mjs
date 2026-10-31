#!/usr/bin/env node
// updater 签名（.sig）校验（技术方案第 3.3.4、3.6 节）：按 tauri-plugin-updater 的规则校验 tauri signer
// 生成的 minisign 签名，签名不通过的安装包不能发布。
//
//   公钥：TAURI_SIGNING_PUBLIC_KEY / tauri.conf.json plugins.updater.pubkey 的格式，即 minisign 公钥文件
//         （"untrusted comment: …\n<base64>"）整体再做一次 base64；base64 解出 42 字节：
//         算法 "Ed"(2) + 密钥 ID(8) + Ed25519 公钥(32)
//   签名：<文件>.sig 的内容，即 minisign 签名文件整体 base64；解出四行：untrusted comment、
//         签名（算法 "Ed" 或预哈希 "ED"(2) + 密钥 ID(8) + Ed25519 签名(64)）、trusted comment、
//         全局签名（对 签名 64 字节 + trusted comment 文本 的 Ed25519 签名）
//   "ED" 签的是文件的 BLAKE2b-512 摘要，"Ed" 签的是文件原文。tauri signer 默认 "ED"。
//
// 用法：node scripts/updater-signature.mjs <文件> [--pubkey <公钥>] [--version <应用版本>]
//       公钥默认取环境变量 TAURI_SIGNING_PUBLIC_KEY；给了 --version 时要求 trusted comment 里的
//       version: 与之一致（tauri signer sign --app-version 写入，updater 的 requireSignedVersion 据此校验）
import { createHash, createPublicKey, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

/** Ed25519 公钥的 SPKI DER 前缀（RFC 8410），后接 32 字节原始公钥 */
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function decodeBase64Text(value, what) {
  const text = String(value ?? "").trim();
  if (!text || !/^[A-Za-z0-9+/]+={0,2}$/.test(text)) throw new Error(`${what}不是 base64`);
  return Buffer.from(text, "base64");
}

/** minisign 文本里第一行非注释的 base64 载荷（及其后各行） */
function payloadLines(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** 解析 updater 公钥（tauri 格式：minisign 公钥文件整体 base64） */
export function parsePublicKey(pubkey) {
  const lines = payloadLines(decodeBase64Text(pubkey, "updater 公钥").toString("utf8"));
  const body = lines.find((line) => !line.startsWith("untrusted comment:"));
  if (!body) throw new Error("updater 公钥缺少密钥内容");
  const raw = decodeBase64Text(body, "updater 公钥内容");
  if (raw.length !== 42 || raw.subarray(0, 2).toString("latin1") !== "Ed")
    throw new Error("updater 公钥格式不对（应为 minisign Ed25519 公钥）");
  return { keyId: raw.subarray(2, 10), key: raw.subarray(10, 42) };
}

/** 解析 .sig 内容（tauri 格式：minisign 签名文件整体 base64） */
export function parseSignature(sig) {
  const lines = payloadLines(decodeBase64Text(sig, "updater 签名").toString("utf8"));
  if (lines.length !== 4 || !lines[0].startsWith("untrusted comment:"))
    throw new Error("updater 签名格式不对（应为 4 行的 minisign 签名）");
  if (!lines[2].startsWith("trusted comment: "))
    throw new Error("updater 签名缺少 trusted comment");
  const raw = decodeBase64Text(lines[1], "updater 签名内容");
  const algorithm = raw.subarray(0, 2).toString("latin1");
  if (raw.length !== 74 || (algorithm !== "Ed" && algorithm !== "ED"))
    throw new Error("updater 签名格式不对（应为 minisign Ed25519 签名）");
  const globalSignature = decodeBase64Text(lines[3], "updater 全局签名");
  if (globalSignature.length !== 64) throw new Error("updater 全局签名长度不对");
  return {
    prehashed: algorithm === "ED",
    keyId: raw.subarray(2, 10),
    signature: raw.subarray(10, 74),
    trustedComment: lines[2].slice("trusted comment: ".length),
    globalSignature,
  };
}

/** trusted comment 里以制表符分隔的 key:value（tauri signer 写 timestamp、file、version） */
export function trustedCommentFields(comment) {
  const fields = {};
  for (const part of comment.split("\t")) {
    const at = part.indexOf(":");
    if (at > 0) fields[part.slice(0, at)] = part.slice(at + 1);
  }
  return fields;
}

/**
 * 校验 updater 签名；不通过时抛出说明原因的错误，通过时返回 trusted comment 字段。
 * @param {Buffer} data 被签名的文件内容
 * @param {string} sig .sig 文件内容
 * @param {string} pubkey updater 公钥
 * @param {{ version?: string }} [options] 给了 version 时要求签名绑定同一版本
 */
export function verifyUpdaterSignature(data, sig, pubkey, { version } = {}) {
  const pk = parsePublicKey(pubkey);
  const s = parseSignature(sig);
  if (!pk.keyId.equals(s.keyId))
    throw new Error(
      `updater 签名的密钥 ID ${Buffer.from(s.keyId).reverse().toString("hex").toUpperCase()} ` +
        `与公钥 ${Buffer.from(pk.keyId).reverse().toString("hex").toUpperCase()} 不一致`,
    );
  const key = createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, pk.key]),
    format: "der",
    type: "spki",
  });
  const message = s.prehashed ? createHash("blake2b512").update(data).digest() : data;
  if (!verify(null, message, key, s.signature)) throw new Error("updater 签名与文件内容不符");
  const signedComment = Buffer.concat([s.signature, Buffer.from(s.trustedComment, "utf8")]);
  if (!verify(null, signedComment, key, s.globalSignature))
    throw new Error("updater 签名的 trusted comment 被篡改");
  const fields = trustedCommentFields(s.trustedComment);
  if (version !== undefined && fields.version !== version)
    throw new Error(
      `updater 签名绑定的版本 ${fields.version ?? "（无）"} 与安装包版本 ${version} 不一致`,
    );
  return fields;
}

function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { pubkey: { type: "string" }, version: { type: "string" } },
  });
  const [file] = positionals;
  const pubkey = values.pubkey ?? process.env.TAURI_SIGNING_PUBLIC_KEY;
  if (!file || positionals.length !== 1 || !pubkey) {
    console.error(
      "用法：node scripts/updater-signature.mjs <文件> [--pubkey <公钥>] [--version <版本>]（公钥默认取 TAURI_SIGNING_PUBLIC_KEY）",
    );
    process.exit(2);
  }
  try {
    const fields = verifyUpdaterSignature(
      readFileSync(file),
      readFileSync(`${file}.sig`, "utf8"),
      pubkey,
      { version: values.version },
    );
    console.log(`✓ updater 签名有效：${file}（version ${fields.version ?? "未绑定"}）`);
  } catch (error) {
    console.error(`✗ ${error.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
