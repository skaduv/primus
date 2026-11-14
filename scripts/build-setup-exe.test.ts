import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error 纯 JS 脚本，无类型声明
import {
  BUNDLE_ARCH,
  BUNDLE_EXTENSION,
  BUNDLE_WXL,
  BUNDLE_WXS,
  checkMsiInput,
  setupExeFileName,
  wixBundleArgs,
} from "./build-setup-exe.mjs";

describe("setupExeFileName", () => {
  it("按版本与架构命名，且与旧 NSIS 版的 -setup.exe 区分", () => {
    expect(setupExeFileName("0.1.2", "x64")).toBe("PrimusSetup_0.1.2_x64_zh-CN.exe");
    expect(setupExeFileName("0.1.2", "arm64")).toBe("PrimusSetup_0.1.2_arm64_zh-CN.exe");
    expect(setupExeFileName("1.2.0-beta.1", "x64")).toBe("PrimusSetup_1.2.0-beta.1_x64_zh-CN.exe");
    expect(setupExeFileName("0.1.2", "x64")).not.toMatch(/-setup\.exe$/);
  });

  it("拒绝无法映射为 MSI 版本的版本号与未知架构", () => {
    expect(() => setupExeFileName("1.0", "x64")).toThrow();
    expect(() => setupExeFileName("1.0.0-preview.1", "x64")).toThrow();
    expect(() => setupExeFileName("0.1.2", "x86")).toThrow();
    expect(() => setupExeFileName("0.1.2", undefined)).toThrow();
  });
});

describe("wixBundleArgs", () => {
  const base = {
    productVersion: "0.1.299.0",
    arch: "arm64",
    msi: "a/arm64.msi",
    out: "out/s.exe",
    shellDir: "s",
  };

  it("x86 引擎、BootstrapperApplications 扩展、架构与一个 MSI", () => {
    const args = wixBundleArgs(base);
    expect(args.slice(0, 2)).toEqual(["build", BUNDLE_WXS]);
    expect(args).toContain(BUNDLE_EXTENSION);
    expect(args[args.indexOf("-arch") + 1]).toBe(BUNDLE_ARCH);
    expect(BUNDLE_ARCH).toBe("x86");
    expect(args).toContain("ProductVersion=0.1.299.0");
    expect(args).toContain("Arch=arm64");
    expect(args).toContain("Msi=a/arm64.msi");
    expect(args.slice(-2)).toEqual(["-o", "out/s.exe"]);
  });

  it("缺少必需参数或架构不对时抛错", () => {
    expect(() => wixBundleArgs({ ...base, msi: undefined })).toThrow();
    expect(() => wixBundleArgs({ ...base, arch: "x86" })).toThrow();
  });
});

describe("checkMsiInput", () => {
  const yes = () => true;
  it("文件名须与版本、架构一致", () => {
    expect(checkMsiInput("d/Primus_0.1.2_x64_zh-CN.msi", "0.1.2", "x64", yes)).toBeNull();
    expect(checkMsiInput("d/Primus_0.1.2_arm64_zh-CN.msi", "0.1.2", "arm64", yes)).toBeNull();
    expect(checkMsiInput("d/Primus_0.1.2_arm64_zh-CN.msi", "0.1.2", "x64", yes)).toMatch(
      /x64_zh-CN/,
    );
    expect(checkMsiInput("d/Primus_0.1.1_x64_zh-CN.msi", "0.1.2", "x64", yes)).toMatch(/0\.1\.2/);
    expect(checkMsiInput(undefined, "0.1.2", "arm64", yes)).toMatch(/--msi/);
    expect(checkMsiInput("d/Primus_0.1.2_x64_zh-CN.msi", "0.1.2", "x64", () => false)).toMatch(
      /未找到/,
    );
  });
});

describe("Bundle.wxs", () => {
  const wxs = readFileSync(BUNDLE_WXS, "utf8");

  it("只内嵌一个 MSI，Permanent 且可见：exe 不登记自己的卸载条目，装好的就是 MSI", () => {
    const packages = wxs.match(/<MsiPackage[^>]*>/g) ?? [];
    expect(packages).toHaveLength(1);
    const p = packages[0];
    expect(p).toContain('SourceFile="$(Msi)"');
    expect(p).toContain('Permanent="yes"');
    expect(p).toContain('Visible="yes"');
    expect(p).toContain('Cache="remove"');
    expect(p).toContain('bal:DisplayInternalUICondition="WixBundleAction = 6"');
  });

  it("下错架构时拒绝安装（0xAA64 = 43620 为 ARM64），并拦下 32 位系统", () => {
    expect(0xaa64).toBe(43620);
    expect(wxs).toMatch(/<bal:Condition Condition="VersionNT64"/);
    const x64 = /<\?if \$\(Arch\) = "x64" \?>([\s\S]*?)<\?elseif/.exec(wxs)?.[1] ?? "";
    const arm64 = /<\?elseif \$\(Arch\) = "arm64" \?>([\s\S]*?)<\?else\?>/.exec(wxs)?.[1] ?? "";
    expect(x64).toContain('Condition="NOT (NativeMachine = 43620)"');
    expect(x64).toMatch(/arm64/);
    expect(arm64).toContain('Condition="NativeMachine = 43620"');
    expect(arm64).toMatch(/x64/);
    expect(wxs).toMatch(/<\?else\?>\s*<\?error /);
  });

  it("经 exe 安装时告诉 MSI 不要在提权进程中启动 Primus", () => {
    expect(wxs.match(/<MsiProperty Name="PRIMUS_BUNDLE" Value="1" \/>/g)).toHaveLength(1);
    const msi = readFileSync(BUNDLE_WXS.replace("Bundle.wxs", "Primus.wxs"), "utf8");
    expect(msi).toContain('Condition="NOT Installed AND NOT PRIMUS_BUNDLE"');
    expect(msi).toContain("AND NOT Installed AND NOT PRIMUS_BUNDLE");
  });

  it("UpgradeCode 与 MSI 不同", () => {
    const bundleCode = /<Bundle[^>]*UpgradeCode="([^"]+)"/.exec(wxs)?.[1];
    expect(bundleCode).toBe("FD216D87-9A80-4208-A28D-FA4B80241F96");
    expect(bundleCode).not.toBe("5B4199DD-C352-459A-AEB0-7119A884608F");
  });
});

describe("bundle-zh-CN.wxl", () => {
  const wxl = readFileSync(BUNDLE_WXL, "utf8");
  const ids = [...wxl.matchAll(/<String Id="([^"]+)"/g)].map((m) => m[1]);

  it("简体中文，覆盖主题用到的字符串", () => {
    expect(wxl).toContain('Culture="zh-CN" Language="2052"');
    for (const id of [
      "Caption",
      "InstallMessage",
      "InstallInstallButton",
      "ProgressHeader",
      "SuccessInstallHeader",
      "FailureHyperlinkLogText",
      "FilesInUseExitButton",
    ])
      expect(ids).toContain(id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
