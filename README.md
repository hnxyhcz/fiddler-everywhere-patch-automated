## [中文翻译版](README_CN.md)

> [!IMPORTANT]
> FE `v8.x.x` automation needs two extra steps: extract `resources/app.asar` before patching `main.js`, then patch `Fiddler.WebUi.dll` startup and periodic integrity checks. See [FE 8.x check patch notes](docs/fe8-integrity-check-fix.md).
>
> This fork now uses the repository's own `server/` files in GitHub Actions; it no longer depends on an external `msojocs` server checkout.

# Fiddler Everywhere Patch (Automated)
Guides you to Patch Fiddler Everywhere on Windows Automatically. 
> Parent Repo: https://github.com/msojocs/fiddler-everywhere-enhance

## What and How?
This's a  a patch for Telerik Fiddler Everywhere. It can grant you a trial that doesn't expire. The trial has all the features. 
This's the guide for applying patch automatically. 

![Unlimited Trial](https://github.com/user-attachments/assets/e9c83778-27fa-456a-96e6-07bb0cd7f4ad)

---

## Feature Updates
> [!TIP]
> Patching is even faster.
>  - Previously &nbsp;&nbsp;&nbsp;:&nbsp;2m 25s
>  - Now &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;:&nbsp;1m 30s

> [!IMPORTANT]
> If you encounter an issue of "Fiddle Everywhere Crashing in Startup", you can follow [this](#fiddler-everywhere-crashing-at-startup).

> [!TIP]
> Now supports changing patch server port (Useful if port conflitcts encountered)

> [!TIP]
> Now supports changing default user profile (fake) for FE (incl - email, fname, lname, country-code, provider)

---

> [!IMPORTANT]
> Linux Automated Patching is Supported Now!

> [!WARNING]
> The new patch want to write files in a directory inside FE app itself. So you need to give write permissions in Linux. See [#27](https://github.com/auto-yui-patch/fiddler-everywhere-patch-automated/issues/27) for more. And feel free to drop your suggestion to automate the process.

## Get Started.
 > [!TIP]
 * How even this Automated Patching Works?
   - Well, this automated patch do the same that you do mannually for patching. It downloads fiddler everywhere extract it. Remove, Replace, Edit, Move files and then, the patched application is ready.

 * Workflow Dispatch? or Workflow Dispatch Latest?
   - Latest Version - Workflow Dispatch - Patch the latest version, and upload as artifact.
   - Custom Version - Workflow Dispatch - Allows you to select a compatible version (5.9.0 +) and patch  and upload as a workflow artifact.

> [!TIP]
> We highly reccomend you to use ***Latest Version - Workflow Dispatch***, which patch the latest available version.
> ***Custon Version - Workflow Dispatch*** allows you to select a version starting from 5.9.0 + too.

---

### With `Latest Version - Workflow Dispatch` 
[![](https://github.com/auto-yui-patch/fiddler-everywhere-patch-automated/actions/workflows/cp_latest_dispatch.yml/badge.svg)](https://github.com/auto-yui-patch/fiddler-everywhere-patch-automated/actions/workflows/cp_latest_dispatch.yml)

  - Fork this repo.
  - Go to actions tab, Select `Latest Version - Workflow Dispatch` workflow.
  - Trigger it with `workflow dispatch`
  - After a successful trigger download artifact that named like `Fiddler-Everywhere-VX.X.X-Patched`
  - Extract it. Run it

  * *Here how you do it...*

    https://github.com/user-attachments/assets/437c3448-1ea2-4c99-9123-e56b1665a37b


### With `Custom Version - WorkFlow Dispatch` 
[![](https://github.com/auto-yui-patch/fiddler-everywhere-patch-automated/actions/workflows/cp_dispatch.yml/badge.svg)](https://github.com/auto-yui-patch/fiddler-everywhere-patch-automated/actions/workflows/cp_dispatch.yml)

  - Fork this repo
  - Go to actions tab, Select `Custom Version - Workflow Dispatch` workflow.
  - Trigger it with `workflow diaptch` providing the version you want to patch
  - After a successful trigger download artifact that named like `Fiddler-Everywhere-VX.X.X-Patched`
  - Extract it. Run it

  > [!WARNING]
  > Please Note that Only Versions Up to 5.9.0 `( 5.9.0 + )` are supported.
  
  > You can find a list of releases here - [Release History](https://www.telerik.com/support/whats-new/fiddler-everywhere/release-history)

  * *Here how you do it...*

    https://github.com/user-attachments/assets/1e9fa214-b9c9-469c-83f0-e5ae4527d2f7

> [!NOTE]
> For Generic `Linux` and `MacOS` instructions, use [source repository](https://github.com/msojocs/fiddler-everywhere-enhance)

> [!CAUTION]
> Please don't use this patch for illegal matters. And we'd love if you can buy and support the officials: [Please Support](https://www.telerik.com/purchase/fiddler)

---

### Fiddler Everywhere Crashing at Startup

If you encounter this issue, it's most likely unrelated to the patch! You should confirm it!

- Check logs by running `Fiddler Everywhere.exe` from the terminal.
  Pay special attention to the following line. (it’s omitted in the official, non-patched version of Fiddler Everywhere.)
  ```bash
  Server error log during start: System.IO.IOException: Failed to bind to address http://localhost:8868.
  ```

  If you see this, it's completely unrelated to the patch. You should see the same issue with the `non-patched official FE`. Confirm this. 

- Check Fiddler Everywhere logs in `%AppData%\Fiddler Everywhere\logs\`

- Check `Administered port exclusions` to see if port `8868` is restricted. 
You can check it with:
  ```bash
  netsh interface ipv4 show excludedportrange protocol=tcp
  ```

- If port `8868` is restricted, 
  - You should also see the same issue with the `non-patched official FE`. Confirm this.
  - You can try removing port `8868` from `Administered port exclusions`. 

You should also follow issue [#44](https://github.com/auto-yui-patch/fiddler-everywhere-patch-automated/issues/44#issuecomment-3497425472) ; Special tnx to [@choneas](https://github.com/choneas). 

If this didn't solve your problem, feel free to open an issue. 
