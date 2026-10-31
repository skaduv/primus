import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
// @ts-expect-error 纯 JS 脚本，无类型声明
import {
  parsePublicKey,
  parseSignature,
  trustedCommentFields,
  verifyUpdaterSignature,
} from "./updater-signature.mjs";

// tauri signer 2.12 实际生成的公钥与签名（仅供测试的一次性密钥，私钥已丢弃）：
// 对内容 "hello\n" 执行 tauri signer sign --app-version 1.2.3
const TAURI_PUBKEY =
  "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDg5MUM5RTJDM0IzMEFCNzIKUldSeXF6QTdMSjRjaWRMejQ1Wi9vcGF3MS9GRTFJTE0wS3V6a0ZIUGljcWtmQUgwMVVuVW1rQzQK";
const TAURI_SIG =
  "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVSeXF6QTdMSjRjaWRhcW1GNFVHRHFUZHI3SHdMQU90a3hGaEFGUENlY1MyR0JZVjdEOUprb0dOTER5WTVqamw4Z0JxcHlzYXNVaWRWTytRUjhxWm9Nc2FBazcvQ2J1TWdnPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzkzNDUxMzgwCWZpbGU6aAl2ZXJzaW9uOjEuMi4zCkxORFRMdTVIREZaZThkaWpVdHkrUTk0N0RBVHljNll4SVc1V2lIWmRJanB6aDVGQndpZ3NaeGFjeVY4T0lWWTNEaHd5S1NvL3JyLzhCNFZwanJBS0NRPT0K";
const HELLO = Buffer.from("hello\n");

const b64 = (value: Buffer | string) => Buffer.from(value).toString("base64");

/** 用 Node 生成同格式的 minisign 公钥与签名（可选不预哈希、篡改 trusted comment、换密钥 ID） */
function makeKeyAndSigner(keyId = Buffer.from("0102030405060708", "hex")) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(12);
  const pubkey = b64(
    `untrusted comment: minisign public key\n${b64(Buffer.concat([Buffer.from("Ed"), keyId, raw]))}\n`,
  );
  const signFile = (
    data: Buffer,
    { prehashed = true, comment = "timestamp:1\tfile:a.msi\tversion:1.0.0", id = keyId } = {},
  ) => {
    const message = prehashed ? createHash("blake2b512").update(data).digest() : data;
    const signature = sign(null, message, privateKey);
    const global = sign(null, Buffer.concat([signature, Buffer.from(comment)]), privateKey);
    const body = b64(Buffer.concat([Buffer.from(prehashed ? "ED" : "Ed"), id, signature]));
    return {
      sig: b64(
        `untrusted comment: signature\n${body}\ntrusted comment: ${comment}\n${b64(global)}\n`,
      ),
      signature,
      global,
      body,
    };
  };
  return { pubkey, signFile };
}

describe("updater-signature", () => {
  it("校验 tauri signer 实际生成的签名，并读出绑定的版本", () => {
    const fields = verifyUpdaterSignature(HELLO, TAURI_SIG, TAURI_PUBKEY, { version: "1.2.3" });
    expect(fields).toMatchObject({ file: "h", version: "1.2.3" });
    expect(parseSignature(TAURI_SIG).prehashed).toBe(true);
    expect(parsePublicKey(TAURI_PUBKEY).key).toHaveLength(32);
  });

  it("文件被改动、版本不符或公钥不对时拒绝", () => {
    expect(() => verifyUpdaterSignature(Buffer.from("hello!\n"), TAURI_SIG, TAURI_PUBKEY)).toThrow(
      "与文件内容不符",
    );
    expect(() =>
      verifyUpdaterSignature(HELLO, TAURI_SIG, TAURI_PUBKEY, { version: "1.2.4" }),
    ).toThrow("绑定的版本 1.2.3 与安装包版本 1.2.4 不一致");
    const other = makeKeyAndSigner(parsePublicKey(TAURI_PUBKEY).keyId);
    expect(() => verifyUpdaterSignature(HELLO, TAURI_SIG, other.pubkey)).toThrow("与文件内容不符");
  });

  it("trusted comment 含多个 version 字段时取第一个，与 updater 一致", () => {
    const { pubkey, signFile } = makeKeyAndSigner();
    const data = Buffer.from("x");
    const { sig } = signFile(data, {
      comment: "timestamp:1\tfile:a.msi\tversion:1.2.2\tversion:1.2.3",
    });
    expect(() => verifyUpdaterSignature(data, sig, pubkey, { version: "1.2.3" })).toThrow(
      "绑定的版本 1.2.2 与安装包版本 1.2.3 不一致",
    );
    expect(verifyUpdaterSignature(data, sig, pubkey, { version: "1.2.2" }).version).toBe("1.2.2");
  });

  it("支持预哈希（ED）与原文（Ed）两种算法", () => {
    const { pubkey, signFile } = makeKeyAndSigner();
    const data = Buffer.from("msi bytes");
    expect(verifyUpdaterSignature(data, signFile(data).sig, pubkey).version).toBe("1.0.0");
    expect(verifyUpdaterSignature(data, signFile(data, { prehashed: false }).sig, pubkey)).toEqual({
      timestamp: "1",
      file: "a.msi",
      version: "1.0.0",
    });
  });

  it("密钥 ID 不一致时拒绝", () => {
    const { pubkey, signFile } = makeKeyAndSigner();
    const data = Buffer.from("x");
    const sig = signFile(data, { id: Buffer.from("0807060504030201", "hex") }).sig;
    expect(() => verifyUpdaterSignature(data, sig, pubkey)).toThrow(
      "密钥 ID 0102030405060708 与公钥 0807060504030201 不一致",
    );
  });

  it("trusted comment 被篡改（例如改版本号）时拒绝", () => {
    const { pubkey, signFile } = makeKeyAndSigner();
    const data = Buffer.from("x");
    const { body, global } = signFile(data);
    const forged = b64(
      `untrusted comment: s\n${body}\ntrusted comment: timestamp:1\tfile:a.msi\tversion:9.9.9\n${b64(global)}\n`,
    );
    expect(() => verifyUpdaterSignature(data, forged, pubkey)).toThrow("trusted comment 被篡改");
  });

  it("格式错误给出明确原因", () => {
    const { pubkey } = makeKeyAndSigner();
    expect(() => verifyUpdaterSignature(HELLO, "", pubkey)).toThrow("updater 签名不是 base64");
    expect(() => verifyUpdaterSignature(HELLO, b64("a\nb\n"), pubkey)).toThrow("应为 4 行");
    expect(() => verifyUpdaterSignature(HELLO, TAURI_SIG, b64("untrusted comment: x\n"))).toThrow(
      "缺少密钥内容",
    );
    expect(() => verifyUpdaterSignature(HELLO, TAURI_SIG, b64("c\nAAAA\n"))).toThrow(
      "minisign Ed25519 公钥",
    );
  });

  it("trusted comment 按制表符拆成字段", () => {
    expect(trustedCommentFields("timestamp:1\tfile:a b.msi\tversion:1.3.0-beta.2")).toEqual({
      timestamp: "1",
      file: "a b.msi",
      version: "1.3.0-beta.2",
    });
  });
});
