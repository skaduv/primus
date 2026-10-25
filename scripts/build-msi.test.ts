import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error 纯 JS 脚本，无类型声明
import { msiFileName, msiProductVersion, signtoolArgs, WXS, wixBuildArgs } from "./build-msi.mjs";

const SCRIPT = fileURLToPath(new URL("./build-msi.mjs", import.meta.url));

describe("build-msi", () => {
  it("SemVer 按第 3.3.3 节映射为 MSI ProductVersion", () => {
    expect(msiProductVersion("1.2.3")).toBe("1.2.3.0");
    expect(msiProductVersion("0.0.0")).toBe("0.0.0.0");
    expect(msiProductVersion("1.3.0-beta.2")).toBe("1.3.0.2");
    expect(msiProductVersion("2.0.0-rc.1+build.7")).toBe("2.0.0.1");
    expect(msiProductVersion("255.255.65535")).toBe("255.255.65535.0");
  });

  it("非法版本与越界版本直接失败", () => {
    expect(() => msiProductVersion("1.2")).toThrow();
    expect(() => msiProductVersion("v1.2.3")).toThrow();
    expect(() => msiProductVersion("256.0.0")).toThrow();
    expect(() => msiProductVersion("1.0.65536")).toThrow();
    expect(() => msiProductVersion("1.0.0-beta")).toThrow();
  });

  it("交付物文件名", () => {
    expect(msiFileName("1.2.3")).toBe("Primus_1.2.3_x64_zh-CN.msi");
  });

  it("wix build 参数与技术方案第 3.3.1 节一致", () => {
    const args = wixBuildArgs({
      appDir: "C:/t/release",
      coreDir: "C:/r/dist/agent-core",
      runtimeDir: "C:/r/dist/runtime",
      productVersion: "1.2.3.0",
      out: "C:/r/out/Primus_1.2.3_x64_zh-CN.msi",
    });
    expect(args).toEqual([
      "build",
      WXS,
      "-arch",
      "x64",
      "-culture",
      "zh-CN",
      "-acceptEula",
      "wix7",
      "-ext",
      "WixToolset.UI.wixext",
      "-ext",
      "WixToolset.Util.wixext",
      "-bindpath",
      "app=C:/t/release",
      "-bindpath",
      "core=C:/r/dist/agent-core",
      "-bindpath",
      "runtime=C:/r/dist/runtime",
      "-d",
      "ProductVersion=1.2.3.0",
      "-o",
      "C:/r/out/Primus_1.2.3_x64_zh-CN.msi",
    ]);
  });

  it("只有同时配置证书指纹与时间戳服务器才签名", () => {
    expect(signtoolArgs("a.msi", {})).toBeNull();
    expect(signtoolArgs("a.msi", { PRIMUS_SIGN_CERT_SHA1: "AB" })).toBeNull();
    expect(
      signtoolArgs("a.msi", { PRIMUS_SIGN_CERT_SHA1: "AB", PRIMUS_SIGN_TIMESTAMP_URL: "http://t" }),
    ).toEqual([
      "sign",
      "/fd",
      "sha256",
      "/tr",
      "http://t",
      "/td",
      "sha256",
      "/sha1",
      "AB",
      "a.msi",
    ]);
  });

  it("Primus.wxs 引用的 bindpath 都由脚本传入，UpgradeCode 已固定", () => {
    const wxs = readFileSync(WXS, "utf8");
    const used = new Set([...wxs.matchAll(/!\(bindpath\.(\w+)\)/g)].map((m) => m[1]));
    const passed = new Set(
      wixBuildArgs({ appDir: "a", coreDir: "c", runtimeDir: "r", productVersion: "1", out: "o" })
        .filter((a: string) => /^\w+=/.test(a) && !a.startsWith("ProductVersion="))
        .map((a: string) => a.split("=")[0]),
    );
    expect([...used].sort()).toEqual([...passed].sort());
    const upgradeCode = /UpgradeCode="([^"]+)"/.exec(wxs)?.[1];
    expect(upgradeCode).toBe("5B4199DD-C352-459A-AEB0-7119A884608F");
    expect(wxs).toContain('Version="$(ProductVersion)"');
  });

  it.skipIf(process.platform === "win32")("非 Windows 上拒绝真实构建，--dry-run 列出命令", () => {
    const real = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" });
    expect(real.status).toBe(1);
    expect(real.stderr).toContain("WiX 只能在 Windows 上运行");
    const dry = spawnSync(process.execPath, [SCRIPT, "--dry-run", "--version", "1.3.0-beta.2"], {
      encoding: "utf8",
    });
    expect(dry.status).toBe(0);
    expect(dry.stdout).toContain("ProductVersion 1.3.0.2");
    expect(dry.stdout).toContain("-acceptEula wix7");
    expect(dry.stdout).toContain("Primus_1.3.0-beta.2_x64_zh-CN.msi");
  });
});
