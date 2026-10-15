param([switch]$LiveGaoding, [switch]$AllUsers, [switch]$DisposableEnvironment, [string]$ArtifactDirectory)
$ErrorActionPreference = 'Stop'
if (-not $DisposableEnvironment) { throw 'Real install/upgrade/uninstall tests require an explicitly disposable VM or dedicated test account. Pass -DisposableEnvironment only there. Use test:desktop:installer:native for no-install checks.' }
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$buildRoot = Join-Path $projectRoot '.desktop-build'
$runId = [guid]::NewGuid().ToString('N')
$oldTarget = [IO.Path]::GetFullPath((Join-Path $buildRoot ("NSIS 旧版 中文 Path $runId")))
$newTarget = [IO.Path]::GetFullPath((Join-Path $buildRoot ("NSIS 新版 中文 Path $runId")))
foreach ($target in @($oldTarget, $newTarget)) {
  if (-not $target.StartsWith($buildRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid NSIS test target' }
}
$version = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
if (-not $ArtifactDirectory) {
  $pointer = Join-Path $projectRoot 'release/latest-candidate.json'
  if (Test-Path -LiteralPath $pointer) { $ArtifactDirectory = Join-Path $projectRoot ((Get-Content -LiteralPath $pointer -Raw | ConvertFrom-Json).directory) }
  else { $ArtifactDirectory = Join-Path $projectRoot 'release' }
}
$ArtifactDirectory = [IO.Path]::GetFullPath($ArtifactDirectory)
$installer = Join-Path $ArtifactDirectory "DesignExtractor-Personal-$version-x64-Setup.exe"
$metadataFile = Join-Path $ArtifactDirectory 'release-metadata.json'
if (Test-Path -LiteralPath $metadataFile) {
  $record = Get-Content -LiteralPath $metadataFile -Raw | ConvertFrom-Json
  $verifyArgs = @((Join-Path $projectRoot 'desktop/scripts/verify-signatures.cjs'), "--output=$ArtifactDirectory")
  if ($record.state -ne 'unsigned_candidate') { throw 'Current install test accepts unsigned candidates only' }
  & node @verifyArgs
  if ($LASTEXITCODE -ne 0) { throw 'Final artifact verification failed; installation test stopped' }
}
$baseline = Join-Path $projectRoot 'release/DesignExtractor-Personal-1.0.0-x64-Setup.exe'
$stateFile = Join-Path $buildRoot "nsis-retention-$runId.json"
$scope = '/currentuser'
$opposite = '/allusers'
if ($AllUsers) {
  $principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'All-users real-install test requires an elevated test session; no UAC automation is attempted.' }
  $scope = '/allusers'
  $opposite = '/currentuser'
}
$registryGuid = (& node -e "const {UUID}=require('builder-util-runtime'); console.log(UUID.v5('com.designextractor.personal',UUID.parse('50e065bc-3134-11e6-9bab-38c9862bdaf3')))" | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $registryGuid -notmatch '^[0-9a-f-]{36}$') { throw 'Could not derive installer registry identity' }
foreach ($hive in @('HKCU:', 'HKLM:')) {
  if (Test-Path -LiteralPath "$hive\Software\$registryGuid") { throw "An existing installation is registered in $hive. Use a disposable test account or uninstall it deliberately before this test." }
}
$installRegistry = "HKCU:\Software\$registryGuid"
if ($AllUsers) { $installRegistry = "HKLM:\Software\$registryGuid" }
function Invoke-Setup([string]$File, [string]$Arguments, [int]$Expected = 0) {
  $process = Start-Process -FilePath $File -ArgumentList $Arguments -WindowStyle Hidden -PassThru
  $null = $process.Handle
  if (-not $process.WaitForExit(120000)) { throw 'NSIS process timed out' }
  if ($process.ExitCode -ne $Expected) { throw "NSIS exit code $($process.ExitCode), expected $Expected" }
}
function Verify-State {
  & node desktop/tests/nsis-state.cjs verify $stateFile
  if ($LASTEXITCODE -ne 0) { throw 'Upgrade/uninstall changed personal data' }
}
Push-Location $projectRoot
try {
  if (-not (Test-Path -LiteralPath $baseline)) { throw 'Preserved 1.0.0 baseline EXE required' }
  if ($AllUsers) {
    # 1.0.0 did not support all-user installation. Test fresh 1.1.0 then
    # reinstall/relocate in that scope without fabricating a 1.0.0 baseline.
    Invoke-Setup $installer "/S $scope /D=$oldTarget"
  } else {
    Invoke-Setup $baseline "/S $scope /D=$oldTarget"
    if (-not (Test-Path -LiteralPath (Join-Path $oldTarget '设计稿提取助手.exe'))) { throw 'Baseline executable missing' }
  }
  & node -e "require('./desktop/config.cjs').loadConfiguration(require('path').join(process.env.APPDATA,'DesignExtractorPersonal'))"
  if ($LASTEXITCODE -ne 0) { throw 'Configuration initialization failed' }
  & node desktop/tests/nsis-state.cjs seed $stateFile
  if ($LASTEXITCODE -ne 0) { throw 'Retention fixture failed' }
  Invoke-Setup $installer "/S $scope /D=$oldTarget"
  # Explicit fixture migration validates the new storage layout. This does not
  # claim acceptance of the first-run native migration confirmation dialog.
  & node desktop/tests/nsis-state.cjs migrate $stateFile $oldTarget
  if ($LASTEXITCODE -ne 0) { throw 'Disposable data migration failed' }
  Verify-State
  $retainedDownloads = Join-Path $oldTarget 'Downloads'
  New-Item -ItemType Directory -Path $retainedDownloads -Force | Out-Null
  $downloadSentinel = Join-Path $retainedDownloads 'retained-download.txt'
  [IO.File]::WriteAllText($downloadSentinel, $runId)
  Invoke-Setup $installer "/S $scope /D=$oldTarget"
  if ([IO.File]::ReadAllText($downloadSentinel) -ne $runId) { throw 'Same-directory upgrade removed Downloads' }
  $nonEmptyTarget = Join-Path $buildRoot "NSIS 非专用 Path $runId"
  New-Item -ItemType Directory -Path $nonEmptyTarget | Out-Null
  $unrelatedFile = Join-Path $nonEmptyTarget 'must-retain.txt'
  [IO.File]::WriteAllText($unrelatedFile, $runId)
  Invoke-Setup $installer "/S $scope /D=$nonEmptyTarget" 87
  if ([IO.File]::ReadAllText($unrelatedFile) -ne $runId) { throw 'Invalid target modified unrelated file' }
  # Root normalization is covered by the no-install native tests. Do not install to a normal drive root here.
  Verify-State
  if (Test-Path -LiteralPath (Join-Path $oldTarget '设计稿提取助手.exe')) { throw 'Old product executable remains after upgrade' }
  Invoke-Setup $installer "/S $opposite /D=$newTarget" 1638
  Verify-State
  if (-not (Test-Path -LiteralPath (Join-Path $oldTarget '去水印下载助手.exe'))) { throw 'Scope conflict removed original application' }
  Invoke-Setup $installer "/S $scope /D=$newTarget"
  Verify-State
  if ([IO.File]::ReadAllText($downloadSentinel) -ne $runId) { throw 'Relocation removed old Downloads' }
  if (Test-Path -LiteralPath (Join-Path $oldTarget '去水印下载助手.exe')) { throw 'Old install remains after relocation' }
  $registeredPath = (Get-ItemProperty -LiteralPath $installRegistry).InstallLocation
  if ($registeredPath -ne $newTarget) { throw "Incorrect registered install directory: $registeredPath" }
  $shell = New-Object -ComObject WScript.Shell
  $programs = $shell.SpecialFolders.Item('Programs')
  $desktopFolder = $shell.SpecialFolders.Item('Desktop')
  if ($AllUsers) { $programs = $shell.SpecialFolders.Item('AllUsersPrograms'); $desktopFolder = $shell.SpecialFolders.Item('AllUsersDesktop') }
  $menuShortcut = Join-Path $programs '去水印下载助手.lnk'
  $desktopShortcut = Join-Path $desktopFolder '去水印下载助手.lnk'
  if (-not (Test-Path -LiteralPath $menuShortcut)) { throw 'Default Start Menu shortcut missing' }
  if (Test-Path -LiteralPath $desktopShortcut) { throw 'Optional desktop shortcut should default off' }
  if ($shell.CreateShortcut($menuShortcut).TargetPath -ne (Join-Path $newTarget '去水印下载助手.exe')) { throw 'Shortcut target not relocated' }
  Invoke-Setup $installer "/S $scope /D=$newTarget"
  Verify-State
  $installedExe = Join-Path $newTarget '去水印下载助手.exe'
  $newDownloads = Join-Path $newTarget 'Downloads'
  New-Item -ItemType Directory -Path $newDownloads -Force | Out-Null
  $newDownloadSentinel = Join-Path $newDownloads 'retained-download.txt'
  [IO.File]::WriteAllText($newDownloadSentinel, $runId)
  if (-not (Test-Path -LiteralPath $installedExe)) { throw 'Installed executable missing' }
  $versionInfo = (Get-Item -LiteralPath $installedExe).VersionInfo
  if ($versionInfo.FileVersion -ne $version -or $versionInfo.ProductName -ne '去水印下载助手') { throw 'Installed metadata mismatch' }
  $arguments = @('desktop/tests/packaged.cjs', "--installed=$newTarget", '--disposable-environment')
  & node desktop/tests/nsis-state.cjs migrate $stateFile $newTarget
  if ($LASTEXITCODE -ne 0) { throw 'Relocated disposable data migration failed' }
  if ($LiveGaoding) { $arguments += '--live-gaoding' }
  & node @arguments
  if ($LASTEXITCODE -ne 0) { throw 'Installed application smoke failed' }
  $uninstallers = @(Get-ChildItem -LiteralPath $newTarget -Filter '*Uninstall*.exe' -File)
  if ($uninstallers.Count -ne 1) { throw 'Expected one uninstaller' }
  $uninstaller = [IO.Path]::GetFullPath($uninstallers[0].FullName)
  if (-not $uninstaller.StartsWith($newTarget + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid uninstaller target' }
  # In-place _?= prevents NSIS's temp relaunch from hiding the child's exit code.
  Invoke-Setup $uninstaller "/S --delete-app-data _?=$newTarget" 87
  Verify-State
  if (-not (Test-Path -LiteralPath $installedExe)) { throw 'Rejected data-delete command removed application' }
  Invoke-Setup $uninstaller "/S $scope _?=$newTarget"
  $deadline = [DateTime]::UtcNow.AddSeconds(15)
  while ((Test-Path -LiteralPath $installedExe) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 200 }
  if (Test-Path -LiteralPath $installedExe) { throw 'Application files remain after uninstall' }
  if ([IO.File]::ReadAllText($newDownloadSentinel) -ne $runId) { throw 'Uninstall removed Downloads' }
  if (Test-Path -LiteralPath $installRegistry) { throw 'Install registry remains after uninstall' }
  if (Test-Path -LiteralPath $menuShortcut) { throw 'Start Menu shortcut remains after uninstall' }
  if (Test-Path -LiteralPath $desktopShortcut) { throw 'Desktop shortcut remains after uninstall' }
  & node desktop/tests/nsis-state.cjs clean $stateFile
  if ($LASTEXITCODE -ne 0) { throw 'Uninstall did not preserve personal database/config/uploads' }
  $result = @{ version = $version; scope = $scope; oldTarget = $oldTarget; installTarget = $newTarget; upgradeFrom100 = 'passed'; relocation = 'passed'; scopeConflict = 'passed'; installedApp = 'passed'; sameVersionReinstall = 'passed'; uninstall = 'passed'; userDataRetained = 'passed'; dataDeleteFlagRejected = 'passed'; actualWizardUI = 'separate verification required'; cleanWindowsVM = 'must be reported separately' }
  if ($AllUsers) { $result.upgradeFrom100 = 'not applicable: 1.0.0 had no all-users install'; $result.freshAllUsersInstall = 'passed' }
  $result.defaultShortcutPolicy = 'passed'
  $result.shortcutRelocationAndRemoval = 'passed'
  $result.invalidAndNonDedicatedPathsRejected = 'passed'
  $result.downloadsRetainedOnUpgradeRelocationUninstall = 'passed'
  $result | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $projectRoot "server/test-artifacts/desktop-nsis-$($scope.TrimStart('/'))-results.json") -Encoding utf8
  $result | ConvertTo-Json
} finally { Pop-Location }
