param([switch]$Release, [string]$SdkPath = $env:ANDROID_HOME)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not $SdkPath) { $SdkPath = 'E:\Android\sdk' }
$SdkPath = [IO.Path]::GetFullPath($SdkPath)
if (-not (Test-Path -LiteralPath (Join-Path $SdkPath 'platform-tools/adb.exe'))) { throw "Android SDK unavailable: $SdkPath" }
if ($Release) {
  foreach ($variable in @('LINGONEST_KEYSTORE_PASSWORD', 'LINGONEST_KEY_ALIAS', 'LINGONEST_KEY_PASSWORD')) {
    if (-not [Environment]::GetEnvironmentVariable($variable)) { throw "Release signing requires environment variable $variable. Its value will not be printed." }
  }
  if (-not $env:LINGONEST_KEYSTORE_PATH) { $env:LINGONEST_KEYSTORE_PATH = 'E:\Android\libb.keystore' }
  if (-not (Test-Path -LiteralPath $env:LINGONEST_KEYSTORE_PATH)) { throw 'Release keystore file not found.' }
}
$env:ANDROID_HOME = $SdkPath
$sdkProperty = 'sdk.dir=' + $SdkPath.Replace('\', '/')
[IO.File]::WriteAllText((Join-Path $projectRoot 'android/local.properties'), $sdkProperty + "`n", [Text.UTF8Encoding]::new($false))
Push-Location $projectRoot
try {
  $appVersion = (& node -p "require('./package.json').version").Trim()
  if ($LASTEXITCODE -ne 0 -or $appVersion -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid application version in package.json.' }
  & npm.cmd run build
  if ($LASTEXITCODE -ne 0) { throw 'Web build failed.' }
  & npx.cmd cap sync android
  if ($LASTEXITCODE -ne 0) { throw 'Capacitor synchronization failed.' }
  & node scripts/assert-no-bundled-audio.mjs android/app/src/main/assets
  if ($LASTEXITCODE -ne 0) { throw 'Pre-generated audio found in Android assets.' }
  Push-Location (Join-Path $projectRoot 'android')
  try {
    $variant = if ($Release) { 'release' } else { 'debug' }
    $task = if ($Release) { 'assembleRelease' } else { 'assembleDebug' }
    & .\gradlew.bat $task --console=plain
    if ($LASTEXITCODE -ne 0) { throw 'Android build failed.' }
  } finally { Pop-Location }
  $outputDir = Join-Path $projectRoot 'artifacts'
  New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
  $apkPath = Join-Path $outputDir "lingonest-$appVersion-$variant.apk"
  Copy-Item -LiteralPath (Join-Path $projectRoot "android/app/build/outputs/apk/$variant/app-$variant.apk") -Destination $apkPath -Force
  $stream = [IO.File]::OpenRead($apkPath)
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try { $hash = ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
  finally { $stream.Dispose(); $algorithm.Dispose() }
  [IO.File]::WriteAllText($apkPath + '.sha256', $hash + '  ' + [IO.Path]::GetFileName($apkPath) + "`n")
  Write-Output "APK: $apkPath"
  Write-Output "SHA256: $hash"
} finally { Pop-Location }
