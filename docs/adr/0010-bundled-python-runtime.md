# 0010 内置 Python 运行时

- 状态：已接受
- 日期：2026-11-13

## 背景

Agent 处理数据、文档和脚本类任务时经常需要 `python` 与 `pip`。Windows 默认没有 Python，`PATH` 里的 `python.exe` 往往只是应用商店的占位程序，运行后弹出商店而不是执行脚本；用户自装的 Python 版本、位置各不相同。Primus 已经内置 Node.js 让 Core 不依赖用户环境，Python 也应开箱即用。

## 决策

- 内置 python.org 官方 Windows embed 包（x64 用 amd64、ARM64 用 arm64），版本选 **3.14** 的最新维护版（当前 3.14.10），不选 3.15：3.14 已发布一年、第三方二进制轮子覆盖最完整，安全支持到 2030 年 10 月；随维护版升级，3.15 成熟后再评估切换。版本与 pip 版本写在版本基线 `toolchain.python` / `toolchain.pip`。
- 附带 pip（当前 26.3）：把 PyPI 上锁定的 `pip-<版本>-py3-none-any.whl` 解到 `Lib\site-packages`，改写 `python3xx._pth` 加入 `Lib\site-packages` 并启用 `import site`，另提供 `pip.cmd` / `pip3.cmd`（bash 中用 `python -m pip`）。
- 下载地址、文件名与 SHA-256 固化在 `scripts/python-runtime.json`（embed 包的哈希与 python.org 下载 API 一致，pip 轮子的哈希与 PyPI 一致），`build-core.mjs` 校验后解到 `dist/runtime/python/`，随 `runtime` 整目录收进 MSI 的 `resources\runtime\python\`，不新增 WiX 绑定路径。`python.exe` 保留 PSF 官方 Authenticode 签名，不重签。
- 薄壳拉起 Core 时，内置 Python 存在就把它与用户包的 `bin\` 放到 `PATH` 最前；`pip install` 通过 `PIP_TARGET` 装到 `data\users\<SID>\python\site-packages`，缓存在同目录的 `cache\`，`sitecustomize.py` 按 `PRIMUS_PYTHON_PACKAGES` 把用户包目录加入 `sys.path`。安装目录保持只读，数据只进 `data`（约束 C2）。
- embed 包的 `._pth` 使 Python 运行在隔离模式：忽略 `PYTHON*` 环境变量与注册表，并启用 `safe_path`。`sitecustomize.py` 补回普通 Python 的行为：只恢复 pip 默认 virtual 隔离构建设置的 `PYTHONPATH`（临时目录下的 `pip-build-env-*\site`），执行其中的 sitecustomize 加载构建后端（否则源码包安装失败），构建环境中不加入用户包；用户环境里的 `PYTHONPATH` 不生效，薄壳启动 Core 时也会清掉继承的 `PYTHONPATH` / `PYTHONHOME`；按标准规则把脚本目录（`-m` 为当前目录、`-c` 为 `''`）放到 `sys.path[0]`；有 `PRIMUS_PYTHON_PACKAGES` 时把 `.pyc` 缓存重定向到数据目录的 `pycache`，否则不写字节码，`pip.cmd` 另加 `-B`，避免在安装目录生成 `__pycache__`。命令行显式给出 `-I` / `-E` / `-P` 时按用户意图不恢复对应行为。

## 后果

- 安装包增大约 30 MB（解压后），两种架构各自打包。
- embed 包不含 tkinter、venv、ensurepip 与 IDLE；需要虚拟环境或 GUI 的任务仍要用户自装完整 Python。
- 内置 Python 在 Core 进程的 `PATH` 中优先于用户自装的 Python；用户需要自己的 Python 时写绝对路径或用 `py` 启动器。
- 每次 Python / pip 维护版发布要同步更新 `python-runtime.json`、版本基线与技术方案；`check-versions.mjs` 在 CI 中校验一致性。
- `pip install` 以 `--target` 语义安装，升级已装的包需加 `--upgrade`。
