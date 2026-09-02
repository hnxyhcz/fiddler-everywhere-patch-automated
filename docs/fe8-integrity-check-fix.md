# FE 8.x 检查补丁说明

## 背景

Fiddler Everywhere 8.x 在后端程序集 `Fiddler.WebUi.dll` 中增加了完整性检查服务。应用启动并运行一段时间后，该服务会周期性检查 `resources/app.asar` 等主应用文件是否仍然存在。

本自动化补丁需要解包 `resources/app.asar` 到 `resources/app`，再修改 `resources/app/out/main.js`。FE 8.1.0 还会在启动时检查主脚本，并由后台服务周期性检查完整性；只删除或解包 `app.asar` 而不处理这些检查，会导致启动失败或运行一段时间后退出。

已确认的关键位置：

- 文件：`resources/app/out/WebServer/Fiddler.WebUi.dll`
- 类型：`Fiddler.WebUi.Services.IntegrityCheckService`
- 方法：`ExecuteAsync(CancellationToken)`
- 典型日志：`Integrity check failed: Missing main app file!`

## 修改目标

针对 FE 8.x，自动化流程需要比旧版本多做两件事：

1. 在修改 `main.js` 前，把 `resources/app.asar` 解包到 `resources/app`，然后删除原 `app.asar`。
2. 在产物打包前，补丁 `Fiddler.WebUi.dll`，让 `IntegrityCheckService.ExecuteAsync` 直接返回 `Task.CompletedTask`，不再执行周期性完整性检查。

## 本仓库应修改的文件

### 1. 使用通用补丁脚本

路径：

```text
utils/patch_integrity_check.py
```

脚本不依赖固定 RVA 或固定文件偏移，而是自动解析 `.NET metadata`：

- 自动定位 `Fiddler.WebUi.Services.IntegrityCheckService`
- 自动定位 `ExecuteAsync`
- 自动定位 `System.Threading.Tasks.Task::get_CompletedTask`
- 自动定位 `Fiddler.WebUi.Helpers.ScriptHelper` 的两个启动检查方法
- 把完整性检查方法改成：

```il
call System.Threading.Tasks.Task::get_CompletedTask
ret
```

实现方式是把原方法体头部改成 tiny method body：

```text
tiny-header(size=6) + call Task.CompletedTask + ret
```

不要只在原 fat method body 的 IL 区域写入 `call + ret`。保留旧 fat header / local signature 时，FE 8.0.1 后端启动阶段可能出现：

```text
System.InvalidProgramException: Common Language Runtime detected an invalid program.
   at Fiddler.WebUi.Services.IntegrityCheckService.ExecuteAsync(CancellationToken stoppingToken)
```

tiny body 版本会丢弃旧方法体头部信息，避免这个启动失败问题。

同时，两个启动检查方法：

```text
TryOpenClientMainScript
TryOpenElectronMainScript
```

会被改成清空 `out string` 并返回 `true`，避免解包后因缺少 `app.asar` 返回退出码 252。

本地手动测试命令：

```powershell
python -m pip install dnfile
python utils/patch_integrity_check.py --dry-run "FE/resources/app/out/WebServer/Fiddler.WebUi.dll"
python utils/patch_integrity_check.py "FE/resources/app/out/WebServer/Fiddler.WebUi.dll"
```

恢复备份：

```powershell
python utils/patch_integrity_check.py --restore "FE/resources/app/out/WebServer/Fiddler.WebUi.dll"
```

### 2. 修改 Custom Version 工作流

路径：

```text
.github/workflows/cp_dispatch.yml
```

需要加入这些逻辑：

- 使用本仓库内置的 `server/` 目录，不再依赖外部 `msojocs` server checkout
- `patch_fe` 任务开头 checkout 当前仓库，确保能访问 `utils/patch_integrity_check.py`
- 在复制 server 文件和修改 `main.js` 前，执行 `Prepare Electron app directory`
- 在修改 `main.js` 后，执行 `Patch FE 8.x WebUi checks`

关键执行顺序：

```text
Checkout repository scripts
Download FE
Rename main FE folder
Patch fiddler.dll / libfiddler.dll
Clean Yui-patch
Prepare Electron app directory
Copy Server Folder
Set patch server port
Set user credentials
Patch main.js to main.original.js
Patch FE 8.x WebUi checks
Rename FE
Upload Artifact
```

### 3. 修改 Latest Version 工作流

路径：

```text
.github/workflows/cp_latest_dispatch.yml
```

逻辑与 Custom Version 一致，只是版本变量使用 `SCRAPED_VERSION`。

### 4. 更新 README

路径：

```text
README.md
README_CN.md
```

需要说明 FE 8.x 自动化已支持，但需要：

- 解包 `resources/app.asar`
- 补丁 `Fiddler.WebUi.dll` 中的启动检查和周期完整性检查

## 验证方式

提交后在 GitHub Actions 手动运行：

1. `Custom Version - Workflow Dispatch`
   - 版本填写：`8.0.1`
   - 系统选择：`Windows (x86_64)`
2. 下载生成的 artifact。
3. 启动 patched FE。
4. 保持运行超过 15 分钟。
5. 检查应用是否不再退出，并确认日志里不再出现启动脚本检查失败或完整性检查失败。

## 常见不一致原因

如果你发现：

- `D:\Downloads\Fiddler-Everywhere-V8.0.1-Patched\resources\app\out\main.js`
- 和 `D:\Program Files\Fiddler Everywhere\resources\app\out\main.js`

内容不一样，通常是工作流里使用的 `server/index.js` 版本和你当前本地修改不一致。

检查点：

- 仓库内的 `server/index.js` 是否已经同步到最新补丁
- workflow 是否仍在引用旧的外部 server 目录
- `Patch main.js to main.original.js` 是否在 `Set patch server port` 之后执行

辅助检查：

```powershell
python -m py_compile utils/patch_integrity_check.py
```

```powershell
@'
from pathlib import Path
import yaml
for path in [".github/workflows/cp_dispatch.yml", ".github/workflows/cp_latest_dispatch.yml"]:
    yaml.safe_load(Path(path).read_text(encoding="utf-8"))
    print(path, "YAML OK")
'@ | python -
```
