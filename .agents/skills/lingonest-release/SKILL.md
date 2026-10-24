---
name: lingonest-release
description: 默认 LingoNest 代码已经完成测试，准备版本并复用现有 GitHub CI 校验在线更新产物、签名发布，确认 CI 成功及对应 Release 已公开；用于发版、发布检查和失败排查，普通代码修改无需使用。
---

# LingoNest 版本发布

本 skill 安装在仓库 `.agents/skills/lingonest-release/`，不安装到个人全局目录。从仓库根目录执行项目命令；脚本路径相对于仓库根目录。

默认发布以 CI 全部成功、对应 GitHub Release 已公开且预期产物齐全为完成条件。签名、清单和摘要验证复用 CI；本地下载复验仅用于用户要求的额外检查或失败排查。

发布默认代码已经完成测试，不收集测试证明，也不因为没有本地测试记录而补跑。发布阶段不主动运行本地单测、浏览器测试、类型检查、生产构建、Android 同步或 Gradle 任务；这些检查继续由现有 CI 自动执行。用户另行明确要求本地验证时，才执行其要求的检查。

## 发布范围与授权

先检查工作区、分支、远端、最新稳定 Release 和对应 tag。比较上个稳定 tag 到候选提交的完整差异，并单独列出尚未提交的拟发布修改。不要把本机已有修改视作自动纳入发布范围。

用户仅说“发个版本”时，形成一次发布确认：变更范围、建议的稳定版本号、严格递增的 Android versionCode、目标分支，以及本次将提交/推送代码、创建/推送 tag 并公开发布 Release。用户确认后连续完成，不逐步重复询问。已有明确版本、范围及发布授权时直接沿用；范围发生实质变化才重新确认。仅做发布检查或草案时不触发这些远端操作。

版本必须是稳定 `MAJOR.MINOR.PATCH`；`versionName` 与 `versionCode` 均严格超过 GitHub 当前 latest。通常修复用 patch、功能用 minor，结合项目既有版本策略给出建议，不擅自改为预发布渠道。

## 准备与发布

执行时读取 [项目发布约定](references/project-release.md)，以当前 CI 和项目源码为准；发现约定漂移时修正 skill，不另建发布流水线。

1. 同步 `package.json`、`package-lock.json` 的两处版本，以及 `android/app/build.gradle` 的 `versionName`、`versionCode`。按根目录 `AGENTS.md` 在 `docs/` 创建唯一的 `_<版本>版本说明.md`，记录功能、修复、兼容性及已知限制。
2. 只做快速的发布元数据和文档一致性核对：`node scripts/release-metadata.mjs`、`node scripts/check-doc-links.mjs --allow-missing-artifacts`。这些脚本仅检查版本、说明和链接，不构建应用或运行测试；不为发布重复安装依赖或准备本地测试环境。
3. 核对暂存差异仅包含确认范围，提交并推送到确认的分支；以该确切提交创建 `v<版本>` tag 并推送。不要重写已有远端 tag。记录提交 SHA 和 tag。
4. 跟踪现有 `.github/workflows/release.yml` 的 verify、android、publish。CI 负责正式密钥签名、产物生成、递增检查及 GitHub Release 发布。不要在本机导出 CI 密钥或用 debug APK 替代，不另行 `gh release create` 绕过 CI。
5. 确认该 tag、提交对应的 Release workflow 全部必需 job 成功，且对应 Release 为已公开稳定版、四项预期产物齐全。随后简要告知版本、Release 链接及 CI 链接，即完成发布。默认不下载复验、不另查在线更新入口、不生成 `issues/` 验证报告；额外验收按用户要求执行。

## 失败处理与边界

- 发布元数据不符或 CI 检查失败就停止发布链路并根据错误修复；默认已测试不代表忽略已知失败。优先使用 CI 日志定位，不自动补跑本地测试。仅明确的网络/runner 暂时失败可对相同提交自动重试一次；重复失败时报告阻塞原因。源码修改需新提交，已推送的 tag 不强行移动；已公开的坏包用更高版本修复，不覆盖公开资产或回退 latest。
- CI 成功但对应 Release 仍为草稿或缺少预期产物时，报告发布异常；若按需复验发现问题，明确报告“已发布、复验失败”，不再次发布同版本。`check-update-release.mjs` 是发布前递增检查，不能在发布后对同版本重跑并据此判失败。
- 不默认安装、卸载或清空真实设备。覆盖安装和学习数据保留只有实际设备测试后才能宣称通过；首次引入更新功能时，旧版若无更新入口，应提示手动安装同证书新包。
- 用户临时要求只检查、只准备或停止时，以本次范围为准；skill 自身不授予发布权限。
