param([Parameter(ValueFromRemainingArguments = $true)][string[]]$LaunchArguments)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
if ($PSVersionTable.PSEdition -eq 'Desktop') {
    # A PowerShell 7 parent can otherwise shadow Windows PowerShell's bundled cmdlets.
    $env:PSModulePath = (Join-Path $PSHOME 'Modules') + ';' + (Join-Path $env:ProgramFiles 'WindowsPowerShell/Modules') + ';' + $env:PSModulePath
}
$lectureRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$lectureTools = Join-Path $lectureRoot '.sites-runtime/toolchain'

function Test-LectureNode([string]$Candidate) {
    if (-not (Test-Path -LiteralPath $Candidate)) { return $false }
    try {
        $lectureVersion = (& $Candidate --version).Trim()
        if ($LASTEXITCODE -ne 0 -or $lectureVersion -notmatch '^v(\d+)\.(\d+)\.(\d+)$') { return $false }
        if ([int]$Matches[1] -lt 22 -or ([int]$Matches[1] -eq 22 -and [int]$Matches[2] -lt 13)) { return $false }
        # The pinned workerd distribution has a Windows x64 binary only.
        if ((& $Candidate -p 'process.arch').Trim() -ne 'x64') { return $false }
        return Test-Path -LiteralPath (Join-Path (Split-Path $Candidate) 'node_modules/npm/bin/npm-cli.js')
    } catch { return $false }
}

try {
    $lectureSources = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'download-sources.conf') -Raw | ConvertFrom-StringData
    $lectureMirrors = if ($env:LECTUREFLOW_NODE_MIRROR) { @($env:LECTUREFLOW_NODE_MIRROR.TrimEnd('/')) } else { @($lectureSources.NODE_MIRROR, $lectureSources.NODE_FALLBACK) }
    foreach ($lectureMirror in $lectureMirrors) {
        $lectureUri = [Uri]$lectureMirror
        if (-not $lectureUri.IsAbsoluteUri -or $lectureUri.Scheme -ne 'https' -or $lectureUri.UserInfo -or $lectureUri.Query -or $lectureUri.Fragment) { throw 'LECTUREFLOW_NODE_MIRROR must be an HTTPS URL without credentials or query parameters.' }
    }
    $lectureNode = $null
    $lecturePointer = Join-Path $lectureTools 'node-path.txt'
    if (Test-Path -LiteralPath $lecturePointer) {
        $lectureSaved = (Get-Content -LiteralPath $lecturePointer -Raw).Trim()
        $lectureSavedPath = [IO.Path]::GetFullPath((Join-Path $lectureTools $lectureSaved))
        if ($lectureSavedPath.StartsWith($lectureTools + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -and (Test-LectureNode $lectureSavedPath)) { $lectureNode = $lectureSavedPath }
    }
    if (-not $lectureNode) {
        $lectureSystemNode = Get-Command node.exe -ErrorAction SilentlyContinue
        if ($lectureSystemNode -and (Test-LectureNode $lectureSystemNode.Source)) { $lectureNode = $lectureSystemNode.Source }
    }
    if (-not $lectureNode) {
        [Console]::Error.WriteLine('Installing a project-local Node.js 24 runtime (no administrator rights needed)...')
        New-Item -ItemType Directory -Path $lectureTools -Force | Out-Null
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        $lectureArchValue = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
        $lectureArch = switch ($lectureArchValue) { 'AMD64' { 'x64' }; 'ARM64' { 'x64' }; default { throw 'Windows x64 or Windows 11 ARM64 with x64 emulation is required.' } }
        $lectureDownloaded = $false
        foreach ($lectureMirror in $lectureMirrors) {
            try {
                [Console]::Error.WriteLine('Node.js mirror: ' + ([Uri]$lectureMirror).Host)
                $lectureChecksums = (Invoke-WebRequest -UseBasicParsing -Uri ($lectureMirror + '/latest-v24.x/SHASUMS256.txt') -TimeoutSec 30).Content
                if ($lectureChecksums -is [byte[]]) { $lectureChecksums = [Text.Encoding]::UTF8.GetString($lectureChecksums) }
                $lecturePattern = '(?m)^([a-f0-9]{64})\s+(node-v24\.\d+\.\d+-win-' + $lectureArch + '\.zip)\s*$'
                $lectureMatch = [regex]::Match($lectureChecksums, $lecturePattern)
                if (-not $lectureMatch.Success) { throw 'No compatible Node.js checksum in the mirror manifest.' }
                $lectureZipName = $lectureMatch.Groups[2].Value
                # Pin the version after reading the manifest; do not download through a moving alias.
                $lectureVersion = [regex]::Match($lectureZipName, 'node-(v24\.\d+\.\d+)-').Groups[1].Value
                $lectureZipPath = Join-Path $lectureTools $lectureZipName
                Invoke-WebRequest -UseBasicParsing -Uri ($lectureMirror + '/' + $lectureVersion + '/' + $lectureZipName) -OutFile $lectureZipPath -TimeoutSec 300
                if ((Get-FileHash -LiteralPath $lectureZipPath -Algorithm SHA256).Hash.ToLower() -ne $lectureMatch.Groups[1].Value) { throw 'Node.js download checksum mismatch.' }
                $lectureDownloaded = $true
                break
            } catch {
                [Console]::Error.WriteLine('Mirror failed: ' + $_.Exception.Message)
                [Console]::Error.WriteLine('Mirror unavailable or checksum failed; trying the next source.')
            }
        }
        if (-not $lectureDownloaded) { throw 'All configured Node.js mirrors failed. Please retry or set LECTUREFLOW_NODE_MIRROR.' }
        Expand-Archive -LiteralPath $lectureZipPath -DestinationPath $lectureTools -Force
        $lectureNode = Join-Path $lectureTools ($lectureZipName.Replace('.zip', '') + '/node.exe')
        if (-not (Test-LectureNode $lectureNode)) { throw 'The downloaded runtime could not start.' }
        Set-Content -LiteralPath $lecturePointer -Value ($lectureZipName.Replace('.zip', '') + '/node.exe') -Encoding ascii
        Remove-Item -LiteralPath $lectureZipPath
    }
    $env:LECTUREFLOW_NPM_CLI = Join-Path (Split-Path $lectureNode) 'node_modules/npm/bin/npm-cli.js'
    $env:PATH = (Split-Path $lectureNode) + [IO.Path]::PathSeparator + $env:PATH
    Set-Location -LiteralPath $lectureRoot
    & $lectureNode (Join-Path $PSScriptRoot 'local.mjs') @LaunchArguments
    exit $LASTEXITCODE
} catch {
    [Console]::Error.WriteLine('LectureFlow: ' + $_.Exception.Message)
    [Console]::Error.WriteLine('Check internet access to registry.npmmirror.com and repo.huaweicloud.com, then run start.cmd again.')
    exit 1
}
