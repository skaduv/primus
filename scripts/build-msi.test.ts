import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error 纯 JS 脚本，无类型声明
import {
  authenticodeEnv,
  checkExeStamp,
  compareMsiVersions,
  exeStamp,
  isTrustedMicrosoftSignature,
  msiFileName,
  msiProductVersion,
  signtoolArgs,
  WXS,
  wixBuildArgs,
} from "./build-msi.mjs";

const SCRIPT = fileURLToPath(new URL("./build-msi.mjs", import.meta.url));

describe("build-msi", () => {
  it("SemVer 按第 3.3.3 节映射为 MSI ProductVersion", () => {
    expect(msiProductVersion("1.2.3")).toBe("1.2.399.0");
    expect(msiProductVersion("0.0.0")).toBe("0.0.99.0");
    expect(msiProductVersion("1.3.0-alpha.1")).toBe("1.3.1.0");
    expect(msiProductVersion("1.3.0-beta.2")).toBe("1.3.32.0");
    expect(msiProductVersion("2.0.0-rc.1+build.7")).toBe("2.0.61.0");
    expect(msiProductVersion("1.0.0+build.7")).toBe("1.0.99.0");
    expect(msiProductVersion("255.255.654")).toBe("255.255.65499.0");
  });

  it("预发布版到稳定版的顺序体现在 MSI 前三个字段（Windows Installer 忽略第四字段）", () => {
    const ordered = [
      "1.2.2",
      "1.2.3-alpha.0",
      "1.2.3-alpha.29",
      "1.2.3-beta.0",
      "1.2.3-beta.2",
      "1.2.3-rc.1",
      "1.2.3-rc.29",
      "1.2.3",
      "1.2.4-alpha.0",
      "1.2.654",
      "1.3.0-beta.1",
      "1.3.0",
      "2.0.0-alpha.0",
    ].map(msiProductVersion);
    for (let i = 1; i < ordered.length; i++) {
      // 后一个严格更高：MajorUpgrade（AllowSameVersionUpgrades=no）可替换前一个
      expect(compareMsiVersions(ordered[i], ordered[i - 1])).toBeGreaterThan(0);
      // 反向替换是降级，被 MajorUpgrade 拒绝
      expect(compareMsiVersions(ordered[i - 1], ordered[i])).toBeLessThan(0);
    }
    for (const v of ordered) expect(v.endsWith(".0")).toBe(true);
    // 比较只看前三个字段
    expect(compareMsiVersions("1.2.3.0", "1.2.3.9")).toBe(0);
  });

  it("非法版本与越界版本直接失败", () => {
    expect(() => msiProductVersion("1.2")).toThrow();
    expect(() => msiProductVersion("v1.2.3")).toThrow();
    expect(() => msiProductVersion("01.2.3")).toThrow();
    expect(() => msiProductVersion("256.0.0")).toThrow();
    expect(() => msiProductVersion("1.0.655")).toThrow("654");
    expect(() => msiProductVersion("1.0.0-beta")).toThrow("alpha.N");
    expect(() => msiProductVersion("1.0.0-preview.1")).toThrow("alpha.N");
    expect(() => msiProductVersion("1.0.0-beta.1.2")).toThrow();
    expect(() => msiProductVersion("1.0.0-rc.30")).toThrow("29");
  });

  it("交付物文件名", () => {
    expect(msiFileName("1.2.3")).toBe("Primus_1.2.3_x64_zh-CN.msi");
  });

  it("wix build 参数与技术方案第 3.3.1 节一致", () => {
    const args = wixBuildArgs({
      appDir: "C:/t/release",
      coreDir: "C:/r/dist/agent-core",
      runtimeDir: "C:/r/dist/runtime",
      shellDir: "C:/r/apps/desktop/src-tauri",
      webview2Setup: "C:/r/w/MicrosoftEdgeWebview2Setup.exe",
      productVersion: "1.2.399.0",
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
      "ProductVersion=1.2.399.0",
      "-d",
      "ShellDir=C:/r/apps/desktop/src-tauri",
      "-d",
      "WebView2Setup=C:/r/w/MicrosoftEdgeWebview2Setup.exe",
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

  it("Primus.wxs 引用的 bindpath 与预处理变量都由脚本传入，UpgradeCode 已固定", () => {
    const wxs = readFileSync(WXS, "utf8");
    const args: string[] = wixBuildArgs({
      appDir: "a",
      coreDir: "c",
      runtimeDir: "r",
      productVersion: "1",
      out: "o",
    });
    const valuesAfter = (flag: string) =>
      args.flatMap((a, i) => (args[i - 1] === flag ? [a.split("=")[0]] : []));
    const usedBindpaths = new Set([...wxs.matchAll(/!\(bindpath\.(\w+)\)/g)].map((m) => m[1]));
    expect([...usedBindpaths].sort()).toEqual(valuesAfter("-bindpath").sort());
    const usedDefines = new Set([...wxs.matchAll(/\$\((\w+)\)/g)].map((m) => m[1]));
    expect([...usedDefines].sort()).toEqual(valuesAfter("-d").sort());
    expect(/UpgradeCode="([^"]+)"/.exec(wxs)?.[1]).toBe("5B4199DD-C352-459A-AEB0-7119A884608F");
  });

  it("Primus.wxs 的关键安装行为（第 3.3.2 节）", () => {
    const wxs = readFileSync(WXS, "utf8");
    expect(wxs).toContain('<ui:WixUI Id="WixUI_InstallDir" InstallDirectory="INSTALLFOLDER" />');
    expect(wxs).toMatch(/<Component Id="DataDir" Permanent="yes"/);
    expect(wxs).toContain('User="[WIX_ACCOUNT_USERS]"');
    expect(wxs).toContain("<util:QueryWindowsWellKnownSIDs />");
    // data 授予 icacls 的 (M)：不得含完全控制、更改权限、取得所有权与通用权限
    const permission = /<util:PermissionEx[^>]*>/.exec(wxs)?.[0] ?? "";
    for (const right of ["Delete", "CreateFile", "CreateChild", "Traverse", "WriteAttributes"])
      expect(permission).toContain(`${right}="yes"`);
    for (const right of ["GenericAll", "GenericWrite", "ChangePermission", "TakeOwnership"])
      expect(permission).not.toContain(right);
    expect(wxs).toContain('Value="com.primus.desktop"');
    const conf = JSON.parse(
      readFileSync(new URL("../apps/desktop/src-tauri/tauri.conf.json", import.meta.url), "utf8"),
    );
    expect(conf.identifier).toBe("com.primus.desktop");
    expect(wxs).toContain("{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}");
    expect(wxs).toMatch(
      /<Custom Action="InstallWebView2"[^>]*Condition="WEBVIEW2_MISSING AND NOT REMOVE"/,
    );
  });

  it("WebView2 引导程序只接受微软签名有效的文件", () => {
    const subject =
      "CN=Microsoft Corporation, O=Microsoft Corporation, L=Redmond, S=Washington, C=US";
    expect(isTrustedMicrosoftSignature({ Status: "Valid", Subject: subject })).toBe(true);
    expect(isTrustedMicrosoftSignature({ Status: "HashMismatch", Subject: subject })).toBe(false);
    expect(
      isTrustedMicrosoftSignature({
        Status: "Valid",
        Subject: "CN=Evil, O=Microsoft Corporation Fake",
      }),
    ).toBe(false);
    expect(isTrustedMicrosoftSignature({ Status: "Valid", Subject: "" })).toBe(false);
  });

  it("读取签名时去掉继承自 pwsh 7 的 PSModulePath", () => {
    const env = authenticodeEnv({ PSModulePath: "C:\\pwsh7", PATH: "/bin" }, "C:\\a.exe");
    expect(env).toEqual({ PATH: "/bin", PRIMUS_VERIFY_FILE: "C:\\a.exe" });
    expect(authenticodeEnv({ PSMODULEPATH: "x" }, "f")).toEqual({ PRIMUS_VERIFY_FILE: "f" });
  });

  it.skipIf(process.platform === "win32")("非 Windows 上拒绝真实构建，--dry-run 列出命令", () => {
    const real = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" });
    expect(real.status).toBe(1);
    expect(real.stderr).toContain("WiX 只能在 Windows 上运行");
    const dry = spawnSync(process.execPath, [SCRIPT, "--dry-run", "--version", "1.3.0-beta.2"], {
      encoding: "utf8",
    });
    expect(dry.status).toBe(0);
    expect(dry.stdout).toContain("ProductVersion 1.3.32.0");
    expect(dry.stdout).toContain("-acceptEula wix7");
    expect(dry.stdout).toContain("Primus_1.3.0-beta.2_x64_zh-CN.msi");
    // 覆盖版本同步给 tauri build，Primus.exe 与 MSI 同一版本
    expect(dry.stdout).toMatch(
      /tauri build --no-bundle --config \S*tauri\.version\.json -- --locked/,
    );
  });

  it.skipIf(process.platform === "win32")(
    "--version 与 tauri.conf.json 一致时不加 --config",
    () => {
      const conf = JSON.parse(
        readFileSync(new URL("../apps/desktop/src-tauri/tauri.conf.json", import.meta.url), "utf8"),
      );
      const dry = spawnSync(process.execPath, [SCRIPT, "--dry-run", "--version", conf.version], {
        encoding: "utf8",
      });
      expect(dry.status).toBe(0);
      expect(dry.stdout).toContain("tauri build --no-bundle -- --locked");
      expect(dry.stdout).not.toContain("--config");
    },
  );

  it("--version 覆盖与 --skip-tauri 同用时拒绝构建", () => {
    const r = spawnSync(
      process.execPath,
      [SCRIPT, "--dry-run", "--skip-tauri", "--version", "9.9.9"],
      { encoding: "utf8" },
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("不能与 --skip-tauri 同用");
  });

  it("--skip-tauri 校验已有 Primus.exe 的构建记录", () => {
    const stat = { size: 1234, mtimeMs: 1700000000123.7 };
    const stamp = exeStamp("1.2.3", stat);
    expect(stamp).toEqual({ version: "1.2.3", size: 1234, mtimeMs: 1700000000123 });
    expect(checkExeStamp(stamp, "1.2.3", stat)).toBeNull();
    // 记录缺失
    expect(checkExeStamp(null, "1.2.3", stat)).toContain("未找到构建记录");
    // 上次以 --version 9.9.9 构建，这次不带 --version 跳过编译
    expect(checkExeStamp(exeStamp("9.9.9", stat), "1.2.3", stat)).toContain("9.9.9");
    // exe 被其他方式重新生成
    expect(checkExeStamp(stamp, "1.2.3", { size: 1234, mtimeMs: 1700000009999 })).toContain(
      "重新生成",
    );
    expect(checkExeStamp(stamp, "1.2.3", { size: 4321, mtimeMs: 1700000000123 })).toContain(
      "重新生成",
    );
  });
});
