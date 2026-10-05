param([switch]$DryRun)
$ErrorActionPreference = 'Stop'
$lectureRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd([IO.Path]::DirectorySeparatorChar)
$lectureBoundary = $lectureRoot + [IO.Path]::DirectorySeparatorChar

function Assert-LecturePath([string]$Target) {
    $lectureFull = [IO.Path]::GetFullPath($Target)
    if (-not $lectureFull.StartsWith($lectureBoundary, [StringComparison]::OrdinalIgnoreCase)) { throw 'Refusing to remove a path outside this project.' }
    $lectureParent = [IO.Path]::GetDirectoryName($lectureFull)
    while ($lectureParent -and $lectureParent.StartsWith($lectureRoot, [StringComparison]::OrdinalIgnoreCase)) {
        if (Test-Path -LiteralPath $lectureParent) {
            if ((Get-Item -LiteralPath $lectureParent -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'A parent folder is a link. Uninstall from the original project folder.' }
        }
        if ($lectureParent -eq $lectureRoot) { break }
        $lectureParent = [IO.Path]::GetDirectoryName($lectureParent)
    }
    return $lectureFull
}

function Remove-LectureTree([string]$Target) {
    # Walk directories without following junctions; delete each link itself.
    # No recursive shell deletion can cross the checked project boundary.
    $lectureStack = [Collections.Generic.Stack[object]]::new()
    $lectureStack.Push(@{ Path = $Target; Visited = $false })
    while ($lectureStack.Count) {
        $lectureFrame = $lectureStack.Pop()
        $lectureFull = Assert-LecturePath $lectureFrame.Path
        if (-not (Test-Path -LiteralPath $lectureFull)) { continue }
        $lectureItem = Get-Item -LiteralPath $lectureFull -Force
        if ($lectureItem.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            if ($lectureItem.PSIsContainer) { [IO.Directory]::Delete($lectureFull) }
            else { [IO.File]::Delete($lectureFull) }
        } elseif (-not $lectureItem.PSIsContainer) {
            Remove-Item -LiteralPath $lectureFull -Force
        } elseif ($lectureFrame.Visited) {
            [IO.Directory]::Delete($lectureFull)
        } else {
            $lectureStack.Push(@{ Path = $lectureFull; Visited = $true })
            foreach ($lectureChild in Get-ChildItem -LiteralPath $lectureFull -Force) {
                $lectureStack.Push(@{ Path = $lectureChild.FullName; Visited = $false })
            }
        }
    }
}

try {
    $lecturePackage = Get-Content -LiteralPath (Join-Path $lectureRoot 'package.json') -Raw | ConvertFrom-Json
    if ($lecturePackage.name -ne 'lectureflow' -or -not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'local.mjs'))) { throw 'This is not a LectureFlow project.' }
    $lecturePaths = @(Get-Content -LiteralPath (Join-Path $PSScriptRoot 'uninstall-targets.txt') | Where-Object { $_.Trim() } | ForEach-Object { Assert-LecturePath (Join-Path $lectureRoot $_.Trim()) })
    if ($DryRun) {
        Write-Output 'Preview only. These generated files/folders would be removed:'
        $lecturePaths | Write-Output
        Write-Output 'Classrooms, .env, backups, source files and browser settings are preserved.'
        exit 0
    }
    $lectureLeases = Join-Path $lectureRoot '.sites-runtime/processes'
    if (Test-Path -LiteralPath $lectureLeases) {
        foreach ($lectureFile in Get-ChildItem -LiteralPath $lectureLeases -Filter '*.json' -File) {
            $lectureLease = Get-Content -LiteralPath $lectureFile.FullName -Raw | ConvertFrom-Json
            $lectureProcess = Get-Process -Id $lectureLease.pid -ErrorAction SilentlyContinue
            if ($lectureProcess -and [Math]::Abs(($lectureProcess.StartTime.ToUniversalTime() - [DateTime]'1970-01-01').TotalMilliseconds - $lectureLease.startedAt) -lt 5000) { throw 'Close this project startup window and its MCP clients before uninstalling.' }
        }
    }
    $lectureLock = Join-Path $lectureRoot '.sites-runtime/local-setup.lock'
    if (Test-Path -LiteralPath $lectureLock) {
        $lectureOwner = Get-Content -LiteralPath $lectureLock -Raw | ConvertFrom-Json
        if (Get-Process -Id $lectureOwner.pid -ErrorAction SilentlyContinue) { throw 'Installation is still running. Close it before uninstalling.' }
    }
    $lectureScripts = @('local.mjs', 'local-worker.mjs', 'bootstrap.ps1') | ForEach-Object { [regex]::Escape((Join-Path $PSScriptRoot $_)) }
    $lecturePattern = '(' + ($lectureScripts -join '|') + ')'
    if (Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -match $lecturePattern }) { throw 'This project has a running process. Close the startup window and MCP clients first.' }
    $lectureHasher = [Security.Cryptography.SHA256]::Create()
    try { $lectureInstance = ([BitConverter]::ToString($lectureHasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($lectureRoot)))).Replace('-', '').ToLowerInvariant().Substring(0, 24) } finally { $lectureHasher.Dispose() }
    $lecturePorts = @(5173)
    $lecturePreferences = Join-Path $lectureRoot '.sites-runtime/local-preferences.json'
    if (Test-Path -LiteralPath $lecturePreferences) { $lecturePorts += (Get-Content -LiteralPath $lecturePreferences -Raw | ConvertFrom-Json).port }
    foreach ($lecturePort in $lecturePorts | Select-Object -Unique) {
        if ("$lecturePort" -notmatch '^\d+$' -or [int]$lecturePort -lt 1024 -or [int]$lecturePort -gt 65535) { continue }
        try { $lectureHealth = Invoke-RestMethod -Uri "http://127.0.0.1:$lecturePort/api/health" -TimeoutSec 2 -MaximumRedirection 0 } catch { continue }
        if ($lectureHealth.application -eq 'lectureflow' -and $lectureHealth.mode -eq 'local' -and $lectureHealth.instance -eq $lectureInstance) { throw 'This local classroom is still running. Stop it before uninstalling.' }
    }
    foreach ($lecturePath in $lecturePaths) {
        if (Test-Path -LiteralPath $lecturePath) {
            Write-Output ('Removing: ' + $lecturePath.Substring($lectureBoundary.Length))
            Remove-LectureTree $lecturePath
        }
    }
    Write-Output 'LectureFlow dependencies, project-local Node.js and generated caches were removed.'
    Write-Output 'Classrooms, .env, backups, source files and browser settings were preserved.'
    Write-Output 'Run start.cmd to reinstall. Remove the lectureflow entry in your Agent settings if no longer needed.'
    exit 0
} catch {
    [Console]::Error.WriteLine('Uninstall stopped: ' + $_.Exception.Message)
    exit 1
}
