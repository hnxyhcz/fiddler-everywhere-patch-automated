# Fiddler Everywhere 补丁（自动化版）
指导您在 Windows 系统上自动为 Fiddler Everywhere 打补丁。
> 父仓库：https://github.com/msojocs/fiddler-everywhere-enhance

> [!IMPORTANT]
> FE `v8.x.x` 自动化需要额外处理：先解包 `resources/app.asar` 再修改 `main.js`，然后补丁 `Fiddler.WebUi.dll` 的启动检查和周期完整性检查。详见 [FE 8.x 检查补丁说明](docs/fe8-integrity-check-fix.md)。
>
> 当前仓库已内置 `server/` 补丁文件，GitHub Actions 不再依赖外部 `msojocs` server checkout，而是直接使用仓库内的 `server/index.js` 和 `server/file/`。

## 特别说明：您也可以手动打补丁。请访问 [此仓库](https://github.com/sipsuru/fiddler-everywhere-patch-manual)

## 什么是补丁？如何使用？
这是一个适用于 Telerik Fiddler Everywhere 的补丁工具，可以为您提供永不过期的试用期，并解锁所有功能。  
以下是自动应用补丁的操作指南。

![无限试用期](https://github.com/user-attachments/assets/e9c83778-27fa-456a-96e6-07bb0cd7f4ad)

---

### 功能更新
> [!TIP]
> 补丁更新速度更快。
>  - 之前：2分25秒
>  - 现在：1分30秒

> [!TIP]
> 现已支持更改补丁服务器端口（用于解决端口冲突问题）。

> [!TIP]
> 现已支持为前端（FE）更改默认的虚拟用户配置（包括：电子邮箱、名字、姓氏、国家代码、提供商）。

---

> [!IMPORTANT]
> Linux 自动补丁现已支持！

> [!WARNING]
> 新补丁需要向前端（FE）应用目录内写入文件，因此您需要在 Linux 系统中授予相应的写入权限。更多详情请参阅议题 #27。如果您有任何关于自动化该流程的建议，也欢迎随时提出。

---

## 快速开始
* 自动化打补丁是如何工作的？
  - 该自动化补丁工具实现了与手动补丁相同的功能：它会下载 Fiddler Everywhere，解压缩、删除、替换、编辑、移动文件，最后生成已打补丁的应用程序。

* Workflow Dispatch 和 Workflow Dispatch Latest 有什么区别？
  - 最新版本 - Workflow Dispatch：补丁最新版本，并作为工作流工件上传。
  - 自定义版本 - Workflow Dispatch：允许您选择一个兼容的版本（5.9.0 及以上）进行补丁，并作为工作流工件上传。

> [!TIP]
> 我们强烈推荐您使用 **最新版本 - Workflow Dispatch**，以补丁最新可用版本。
> **自定义版本 - Workflow Dispatch** 同样支持从 5.9.0 及以上版本选择特定版本。

---

### 使用最新版本 - Workflow Dispatch 
[![](https://github.com/sipsuru/fiddler-everywhere-patch-automated/actions/workflows/cp__latest_dispatch.yml/badge.svg)](https://github.com/sipsuru/fiddler-everywhere-patch-automated/actions/workflows/cp__latest_dispatch.yml)

  - Fork 此仓库。
  - 打开 Actions 标签页，选择 Latest Version - Workflow Dispatch 工作流。
  - 使用 Workflow Dispatch 触发工作流。
  - 触发成功后，下载名为 `Fiddler-Everywhere-VX.X.X-Patched` 的工件。
  - 解压并运行。

  * *以下是操作示例...*

    https://github.com/user-attachments/assets/437c3448-1ea2-4c99-9123-e56b1665a37b

### 使用自定义版本 - Workflow Dispatch 
[![](https://github.com/sipsuru/fiddler-everywhere-patch-automated/actions/workflows/cp_dispatch.yml/badge.svg)](https://github.com/sipsuru/fiddler-everywhere-patch-automated/actions/workflows/cp_dispatch.yml)

  - Fork 此仓库。
  - 打开 Actions 标签页，选择 Custom Version - Workflow Dispatch 工作流。
  - 提供您想要补丁的版本号并触发 Workflow Dispatch。
  - 触发成功后，下载名为 `Fiddler-Everywhere-VX.X.X-Patched` 的工件。
  - 解压并运行。

  > [!WARNING]
  > 请注意，只有版本 5.9.0 及以上版本（5.9.0+）受支持。
  
  > 可在此处找到版本列表 - [版本历史](https://www.telerik.com/support/whats-new/fiddler-everywhere/release-history)

  * *以下是操作示例...*

    https://github.com/user-attachments/assets/1e9fa214-b9c9-469c-83f0-e5ae4527d2f7

---

> [!NOTE]
> 对于通用 Linux 和 MacOS 的操作说明，请使用 [源仓库](https://github.com/msojocs/fiddler-everywhere-enhance)

> [!CAUTION]
> 请不要将此补丁用于非法目的。如果可以，请支持官方：[支持官方](https://www.telerik.com/purchase/fiddler)
