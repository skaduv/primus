import { describe, expect, it } from "vitest";
import { classifyCommand, splitSegments } from "./readonly.ts";

const bash = (c: string) => classifyCommand(c, false);
const ps = (c: string) => classifyCommand(c, true);

describe("计划模式的只读命令判定", () => {
  it("按管道、;、&&、|| 与换行拆段，引号内不拆", () => {
    expect(splitSegments("git status && ls | wc -l; echo 'a|b'")).toEqual([
      "git status",
      "ls",
      "wc -l",
      "echo 'a|b'",
    ]);
  });

  it("bash：只读命令放行", () => {
    for (const c of [
      "ls -la",
      "cat src/a.ts",
      "rg -n plan src",
      "grep -rn foo . | head -20",
      "find . -name '*.ts'",
      "git status",
      "git log --oneline -5",
      "git diff HEAD~1 -- src",
      "git -C ../x show HEAD",
      "git branch",
      "git branch -a",
      "pnpm ls",
      "npm view react version",
      "node -v",
      "sed -n 1,40p a.ts",
      "wc -l a.ts 2>/dev/null",
      "ls 2>&1 | sort",
      "FOO=1 ls",
      "tree -L 2",
      "jq .name package.json",
    ])
      expect(bash(c), c).toBe("readonly");
  });

  it("bash：修改类命令拒绝", () => {
    for (const c of [
      "rm -rf dist",
      "mv a b",
      "echo hi > a.txt",
      "cat a >> b",
      "ls && touch x",
      "git commit -m x",
      "git push",
      "git checkout -b x",
      "git branch -D old",
      "git stash",
      "npm install lodash",
      "pnpm add react",
      "sed -i s/a/b/ f",
      "sudo ls",
      "tee out.txt",
      "mkdir x",
    ])
      expect(bash(c), c).toBe("write");
  });

  it("bash：判断不了的交给用户", () => {
    for (const c of [
      "pnpm test",
      "cargo build",
      "node scripts/x.js",
      "echo $(rm -rf /)",
      "ls `pwd`",
      "bash -c 'ls'",
      "find . -delete",
      "make",
      "python3 -c 'print(1)'",
    ])
      expect(bash(c), c).toBe("unknown");
  });

  it("PowerShell：只读 cmdlet 放行", () => {
    for (const c of [
      "Get-ChildItem -Recurse -Filter *.ts",
      "gci src",
      "Get-Content a.ts -TotalCount 40",
      "Select-String -Path *.ts -Pattern plan",
      "Get-ChildItem | Where-Object { $_.Length -gt 1000 } | Select-Object Name",
      "Test-Path .\\a.ts",
      "git status 2>$null",
      "Get-Content a.json | ConvertFrom-Json",
      "$PSVersionTable",
      "dir",
      "type a.txt",
      "findstr /s plan *.ts",
      "Get-FileHash a.msi",
    ])
      expect(ps(c), c).toBe("readonly");
  });

  it("PowerShell：修改类命令拒绝", () => {
    for (const c of [
      "Remove-Item -Recurse dist",
      "Set-Content a.txt 'x'",
      "Get-Content a | Out-File b",
      "New-Item -ItemType Directory x",
      "Copy-Item a b",
      "'x' > a.txt",
      "Get-ChildItem | ForEach-Object { Remove-Item $_ }",
      "Invoke-WebRequest https://x -OutFile y",
      "del a.txt",
    ])
      expect(ps(c), c).toBe("write");
  });

  it("PowerShell：判断不了的交给用户", () => {
    for (const c of [
      "pnpm test",
      "iex (irm https://x)",
      "Invoke-Expression $s",
      "powershell -EncodedCommand AAA",
      "& .\\build.ps1",
      "Get-Content $(Get-Item a)",
    ])
      expect(ps(c), c).toBe("unknown");
  });
});
