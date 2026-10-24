# 项目发布约定

此文件按当前实现描述操作依据。执行时先检查这些文件是否变化：

- `.github/workflows/ci.yml`、`.github/workflows/release.yml`
- `scripts/release-metadata.mjs`、`scripts/generate-update-manifest.mjs`、`scripts/check-update-release.mjs`
- `android/app/build.gradle`、`android/variables.gradle`、`android/app/src/main/java/cn/lingonest/app/AppUpdatePolicy.java`
- [GitHub 持续集成与 Android 发布](../../../../docs/00031_20261024215010_GitHub持续集成与Android发布.md)
- [GitHub 在线更新设计与使用](../../../../docs/00033_20261024230133_GitHub在线更新设计与使用.md)

## 唯一发布路径

仓库是 `whoarei/LingoNest`，包名 `cn.lingonest.app`。核对实际 origin 和目标分支，不因复制了本 skill 就向此仓库发布别的项目。

推送 `v<版本>` tag 触发 Release workflow。verify 复用完整 CI（版本/文档/单测/构建/浏览器/Android 验证）；android 构建正式签名 APK、验证签名及打包内容、生成清单和校验文件；publish 串行校验摘要及相对于 latest 的版本递增，上传到草稿后公开并设置 latest。现有 workflow 自动公开，不能把推 tag 描述成仅上传草稿。

发布前默认代码已完成测试。skill 不在本机重复运行测试、类型检查、Web/Android 构建或 Capacitor 同步，也不要求补充测试记录；只核对发布元数据与文档。现有 CI 的自动测试和构建保持原样，发布时等待其完成即可。本地额外验证须有用户明确要求，不能将其隐含为默认发布前置步骤。

正式签名依赖仓库 Secrets `ANDROID_KEYSTORE_BASE64`、`ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD`。只检查名称是否配置，不读取或输出值。固定正式证书 SHA-256：

```text
28c461e4f2f8612f9d7717d727e772177474798fd7c48b03ca3ffbca8c81bf0a
```

CI 固定指纹、原生 `AppUpdatePolicy.CERTIFICATE` 和本 skill 校验器必须一致；不匹配视为问题，不自动接受新证书。密钥轮换需另行设计旧安装升级兼容性。

## 源码与版本

`readReleaseMetadata` 检查四处版本一致、code 有效、tag 匹配，且 `docs/` 恰有一份当前版本说明。直接复用它，不维护第二套版本写入工具。版本说明遵循 docs 的独立编号和上海时区命名。

发布前记录 GitHub latest 的 tag、提交及 Android code；最新版本查询失败不可当作“首次发布”。`check-update-release.mjs` 由 CI 在公开前再次检查；版本名及 code 都必须增加，避免并发旧发布成为 latest。公开之后不再对相同版本做递增检查。

## 默认完成条件

Release 必须是对应 tag 的已公开稳定版，tag 指向记录的提交，完整 workflow 的所有必需 job 成功。通过 GitHub 连接器或 `gh` 查看，读取代码优先工具连接器；连接器缺少 Actions/Release 下载能力时使用 CLI。始终指定仓库和 tag，不依赖当前目录的默认仓库或隐式 latest。

查看 Release 元数据及资产列表，要求恰有以下四项：

```text
lingonest-<版本>-release.apk
update.json
SHA256SUMS.txt
signing-certificate-sha256.txt
```

确认上述条件后，回复版本、Release 链接和 CI 链接即可。签名、APK 信息、更新清单生成、摘要及版本递增检查已在 CI 完成，默认不逐项下载复验、不请求在线更新入口，也不创建验证报告。

## 按需下载复验

仅当用户要求额外验收或排查失败时使用本节。按固定名称下载上述四项到新的 `artifacts/release-verification/<tag>-<唯一后缀>/`，日志写到该目录之外。

`SHA256SUMS.txt` 恰好覆盖 APK、证书文本、update.json。不要从清单中的任意路径下载或读取本机文件，也不执行下载资产。GitHub 自动附带的源码 zip/tar 链接不属于上述资产列表。

使用与 tag 内容一致的源码目录校验。当前工作区若有该版本之后的改动，可导出 tag 的源码到隔离目录，或复用合适的干净检出；不要 reset 用户工作区。校验器只读取，不下载、不签名、不发布。需要 Node.js、Java 和 Android SDK build-tools（含 aapt 与 apksigner.jar）：

```text
node .agents/skills/lingonest-release/scripts/verify-release.mjs --project-root <与tag一致的源码目录> --release-dir <四项下载资产目录> --tag v<版本> --sdk <Android-SDK目录>
```

`--sdk` 可省略并使用 `ANDROID_HOME` / `ANDROID_SDK_ROOT`；`--build-tools` 可选择已安装的稳定版本；`--java` 可指定 Java 可执行文件，否则使用 `JAVA_HOME` / PATH。脚本退出非零表示不通过；缺 SDK/Java 时先定位已有工具，不跳过签名验证后声称全通过。

脚本核对：

- 四项文件集合及每个 SHA-256；清单 schema、包名、版本/code、minSdk、URL、长度、摘要、版本说明及发布时间格式。
- APK 的实际签名和唯一正式证书、非 debuggable、包名、版本/code、minSdk/targetSdk 与 tag 源码一致。
- APK 不含密钥、环境文件和禁入的预打包音频；与 CI 当前禁入规则一致。

若额外验收包含在线更新入口验证，脚本不联网，另行检查：

```text
https://api.github.com/repos/whoarei/LingoNest/releases/latest
https://github.com/whoarei/LingoNest/releases/latest/download/update.json
```

latest API 的 tag 必须为本次 tag、不是 draft/prerelease；在线清单必须与下载的 tag 清单字节一致。允许 GitHub 的 HTTPS 资产重定向，但不要泄露带短期签名的下载地址；用公开 Release/APK 链接交付。短暂传播延迟可做有界重试；持续不一致则报告验收失败，不改写线上内容来掩盖。

## 校验器维护

本节仅适用于修改校验器脚本的开发任务，不是发布步骤。脚本未改动时不运行这些维护验证。改变本 skill 脚本后运行：

```text
node --test .agents/skills/lingonest-release/scripts/verify-release.test.mjs
```

单测覆盖破坏摘要、伪造签名、调试包、清单与源码不符等失败路径；还须用真实正式签名 APK 跑一次完整 CLI。历史旧版若缺 update.json，可在隔离测试目录配合现有生成器合成四项资产测试工具，并明确标注这不代表该历史版本线上已有清单。
