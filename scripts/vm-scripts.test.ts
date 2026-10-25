import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// scripts/vm/ 下的 Hyper-V 脚本只能在 Windows 宿主机上运行；这里做静态约束检查，
// 语法与 PSScriptAnalyzer 检查在本地 pwsh 上执行（见 scripts/vm/README.md）。
const read = (name: string) => readFileSync(new URL(`./vm/${name}`, import.meta.url));
const SCRIPTS = ["New-PrimusTestCheckpoint.ps1", "Reset-PrimusTestVM.ps1"];

describe("安装测试虚拟机脚本", () => {
  it.each(SCRIPTS)(
    "%s：UTF-8 BOM（Windows PowerShell 5.1 才能正确读取中文）、需管理员与 Hyper-V 模块",
    (name) => {
      const bytes = read(name);
      expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
      const text = bytes.toString("utf8");
      expect(text).toMatch(/#requires -RunAsAdministrator/);
      expect(text).toMatch(/#requires -Modules Hyper-V/);
      expect(text).toMatch(/\[Parameter\(Mandatory\)\][^\n]*\$VMName/);
      expect(text).toMatch(/\$CheckpointName = 'clean'/);
      expect(text).toMatch(/SupportsShouldProcess/);
    },
  );

  it("Reset：凭据只来自参数或 Get-Credential，不硬编码、不落盘", () => {
    const text = read("Reset-PrimusTestVM.ps1").toString("utf8");
    expect(text).toMatch(/\[System\.Management\.Automation\.Credential\(\)\]/);
    expect(text).toMatch(/Get-Credential/);
    expect(text).not.toMatch(/ConvertTo-SecureString/i);
    expect(text).not.toMatch(/Export-Clixml/i);
    expect(text).not.toMatch(/-Password\b/);
  });

  it("Reset：还原检查点、等待检测信号、复制 MSI 与冒烟脚本、执行并拉回日志", () => {
    const text = read("Reset-PrimusTestVM.ps1").toString("utf8");
    for (const needle of [
      "Restore-VMCheckpoint",
      "Heartbeat",
      "New-PSSession -VMName",
      "Copy-VMFile",
      "-ToSession",
      "-FromSession",
      "msi-smoke.ps1",
      "data\\shared\\logs",
    ])
      expect(text).toContain(needle);
  });

  it("New：关机后才建立检查点，不强制断电", () => {
    const text = read("New-PrimusTestCheckpoint.ps1").toString("utf8");
    expect(text.indexOf("Stop-VM")).toBeLessThan(text.indexOf("Checkpoint-VM"));
    expect(text).not.toMatch(/Stop-VM[^\n]*-TurnOff/);
  });
});
