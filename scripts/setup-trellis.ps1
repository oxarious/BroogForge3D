#requires -Version 5.1
<# Local-only, pinned TRELLIS CUDA + Q4/512 setup. Never runs generation. #>
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$cache = Join-Path $root 'runtime/setup-cache'
$runtime = Join-Path $root 'runtime/trellis-cuda'
$models = Join-Path $root 'models/trellis-q4'
$metadata = Join-Path $cache 'metadata'
$tag = 'v0.6.0'
$hfRevision = 'a57397bd3d351599d9729fc144b3f87c3f87d65b'
$ghApi = "https://api.github.com/repos/pwilkin/trellis.cpp/releases/tags/$tag"
$hfApi = "https://huggingface.co/api/models/ilintar/trellis2-gguf/revision/${hfRevision}?blobs=true"
$headers = @{ 'User-Agent' = 'BroogForge-local-setup'; Accept = 'application/json' }
$curl = (Get-Command curl.exe -ErrorAction Stop).Source
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Write-AtomicText([string]$Path, [string]$Text) {
    $temp = "$Path.tmp"
    [IO.File]::WriteAllText($temp, $Text, (New-Object Text.UTF8Encoding($false)))
    if (Test-Path -LiteralPath $Path) {
        [IO.File]::Replace($temp, $Path, "$Path.previous")
        Remove-Item -LiteralPath "$Path.previous" -Force
    }
    else { [IO.File]::Move($temp, $Path) }
}
function Write-Json([string]$Path, $Value) {
    Write-AtomicText $Path ($Value | ConvertTo-Json -Depth 30)
}
function Test-Artifact([string]$Path, [long]$Size, [string]$Hash) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
    if ((Get-Item -LiteralPath $Path).Length -ne $Size) { return $false }
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash -eq $Hash
}
function Get-VerifiedArtifact($Artifact) {
    $dest = Join-Path $root $Artifact.destination
    $part = "$dest.part"
    if (Test-Path -LiteralPath $dest) {
        if (-not (Test-Artifact $dest $Artifact.bytes $Artifact.sha256)) {
            throw "Existing file fails verification; preserve and inspect it before retrying: $dest"
        }
        Write-Host "Verified existing $($Artifact.destination)"
    } else {
        Write-Host "Downloading $($Artifact.destination) ($($Artifact.bytes) bytes)"
        if ((Test-Path -LiteralPath $part) -and (Get-Item -LiteralPath $part).Length -gt $Artifact.bytes) {
            throw "Oversized partial file; inspect before retrying: $part"
        }
        if (-not ((Test-Path -LiteralPath $part) -and (Get-Item -LiteralPath $part).Length -eq $Artifact.bytes)) {
            # Disable curlrc so credentials/options are not inherited. Retry from the verified source only.
            & $curl --disable --fail --location --silent --show-error --proto '=https' --proto-redir '=https' --connect-timeout 30 --speed-limit 1024 --speed-time 120 --retry 5 --retry-delay 3 --retry-all-errors --continue-at - --output $part $Artifact.url
            if ($LASTEXITCODE -ne 0) { throw "curl failed ($LASTEXITCODE); rerun to resume $part" }
        }
        if (-not (Test-Artifact $part $Artifact.bytes $Artifact.sha256)) {
            throw "SHA256/size mismatch; partial is NOT installed. Inspect/remove only this file before retry: $part"
        }
        # Same-directory rename exposes only fully verified files; it never overwrites a final file.
        [IO.File]::Move($part, $dest)
    }
    $Artifact.verifiedSha256 = $Artifact.sha256
    $Artifact.verifiedBytes = (Get-Item -LiteralPath $dest).Length
    $Artifact.verifiedAtUtc = [DateTime]::UtcNow.ToString('o')
    Write-Json (Join-Path $metadata 'installation-manifest.json') $script:manifest
}

New-Item -ItemType Directory -Force -Path $cache, $metadata, $models | Out-Null
$lock = [IO.File]::Open((Join-Path $cache 'setup.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
try {
    $release = Invoke-RestMethod -Uri $ghApi -Headers $headers
    $hf = Invoke-RestMethod -Uri $hfApi -Headers $headers
    if ($release.tag_name -ne $tag -or $hf.sha -ne $hfRevision) { throw 'Pinned revision mismatch.' }
    if ($hf.gated -ne $false) { throw 'HF repository is gated. No authentication or substitute source will be used.' }
    $assets = @($release.assets | Where-Object name -eq 'trellis-cuda-windows-x64.zip')
    if ($assets.Count -ne 1 -or $assets[0].digest -notmatch '^sha256:([0-9a-f]{64})$') {
        throw 'Expected release asset with GitHub SHA256 digest is missing.'
    }
    $asset = $assets[0]
    $digest = $asset.digest.Substring(7)
    $installerUrl = "https://raw.githubusercontent.com/pwilkin/trellis.cpp/$tag/install/install.ps1"
    $installer = (Invoke-WebRequest -UseBasicParsing -Uri $installerUrl).Content
    # Parse the upstream literal model manifest without executing its AppData-writing installer.
    $tokens = $null; $errors = $null
    $ast = [Management.Automation.Language.Parser]::ParseInput($installer, [ref]$tokens, [ref]$errors)
    if ($errors.Count) { throw 'Upstream installer did not parse.' }
    $assignments = @($ast.FindAll({ param($n)
        $n -is [Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -eq '$Models'
    }, $true))
    if ($assignments.Count -ne 1) { throw 'Upstream model manifest assignment changed.' }
    $official = @($assignments[0].Right.FindAll({ param($n)
        $n -is [Management.Automation.Language.StringConstantExpressionAst]
    }, $true) | ForEach-Object Value)
    $required = @('birefnet.gguf','dinov3.gguf','ss_flow.gguf','ss_dec.gguf','shape_flow_512.gguf','shape_dec.gguf','tex_flow_512.gguf','tex_dec.gguf')
    $selected = @($official | Where-Object { $_ -notmatch '_1024\.gguf$' })
    if (Compare-Object $required $selected) { throw 'Official shared/512 model manifest changed; review required.' }
    $artifacts = @([ordered]@{ kind = 'runtime'; destination = 'runtime/setup-cache/trellis-cuda-v0.6.0-windows-x64.zip'; url = $asset.browser_download_url; bytes = [long]$asset.size; sha256 = $digest })
    foreach ($name in $selected) {
        $files = @($hf.siblings | Where-Object rfilename -eq "q4/$name")
        if ($files.Count -ne 1) { throw "Missing Q4 file: q4/$name. No fallback will be used." }
        $file = $files[0]
        if ($file.lfs.sha256 -notmatch '^[0-9a-f]{64}$' -or $file.lfs.size -ne $file.size -or $file.size -le 0) {
            throw "Missing/invalid LFS SHA256 or size: q4/$name"
        }
        $artifacts += [ordered]@{ kind = 'model'; destination = "models/trellis-q4/$name"; url = "https://huggingface.co/ilintar/trellis2-gguf/resolve/$hfRevision/q4/${name}?download=true"; bytes = [long]$file.size; sha256 = $file.lfs.sha256 }
    }
    $licenseUrl = 'https://raw.githubusercontent.com/facebookresearch/dinov3/main/LICENSE.md'
    Write-AtomicText (Join-Path $metadata 'DINOv3-LICENSE.md') ((Invoke-WebRequest -UseBasicParsing $licenseUrl).Content)
    Write-AtomicText (Join-Path $metadata 'hf-model-card.md') ((Invoke-WebRequest -UseBasicParsing "https://huggingface.co/ilintar/trellis2-gguf/raw/$hfRevision/README.md").Content)
    Write-AtomicText (Join-Path $metadata 'upstream-install.ps1.txt') $installer
    Write-AtomicText (Join-Path $metadata 'trellis-LICENSE.txt') ((Invoke-WebRequest -UseBasicParsing "https://raw.githubusercontent.com/pwilkin/trellis.cpp/$tag/LICENSE").Content)
    Write-Json (Join-Path $metadata 'github-release.json') $release
    Write-Json (Join-Path $metadata 'hf-model-api.json') $hf
    $script:manifest = [ordered]@{ schemaVersion = 1; status = 'installing'; release = $tag; githubApi = $ghApi; huggingFaceApi = $hfApi; huggingFaceRevision = $hfRevision; upstreamManifest = $installerUrl; resolution = 512; quantization = 'q4'; skipped = @($official | Where-Object { $_ -match '_1024\.gguf$' }); licenseWarning = 'DINOv3 custom license applies to converted weights. Public access does not waive license terms. No gating bypass or source substitution.'; licenseSource = $licenseUrl; artifacts = $artifacts }
    Write-Json (Join-Path $metadata 'installation-manifest.json') $manifest
    Write-Warning $manifest.licenseWarning
    $downloadBytes = ($artifacts | ForEach-Object { $_.bytes } | Measure-Object -Sum).Sum
    Write-Host "Preflight passed: 8 Q4 files; $downloadBytes total download bytes."
    Get-VerifiedArtifact $artifacts[0]
    $zipPath = Join-Path $root $artifacts[0].destination
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::OpenRead($zipPath)
    try {
        if (@($zip.Entries | Where-Object { $_.FullName -match '[/\\:]' }).Count) { throw 'Unexpected non-flat runtime archive.' }
        if (@($zip.Entries | Where-Object Name -eq 'trellis-cli.exe').Count -ne 1) { throw 'CLI missing from archive.' }
    } finally { $zip.Dispose() }
    $stage = "$runtime.extracting-$([Guid]::NewGuid().ToString('N'))"
    Expand-Archive -LiteralPath $zipPath -DestinationPath $stage
    $inventory = @(Get-ChildItem -LiteralPath $stage -File | ForEach-Object {
        [ordered]@{ name = $_.Name; bytes = $_.Length; sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
    })
    if (Test-Path -LiteralPath $runtime) {
        foreach ($entry in $inventory) {
            if (-not (Test-Artifact (Join-Path $runtime $entry.name) $entry.bytes $entry.sha256)) { throw "Existing runtime differs: $($entry.name). Staging preserved: $stage" }
        }
        # Only the freshly created, root-contained extraction directory is removed.
        if (-not ([IO.Path]::GetFullPath($stage).StartsWith([IO.Path]::GetFullPath($root) + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase))) { throw 'Unsafe staging path.' }
        Remove-Item -LiteralPath $stage -Recurse -Force
    } else { Move-Item -LiteralPath $stage -Destination $runtime }
    $manifest.runtimeFiles = $inventory
    $oldPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $help = & (Join-Path $runtime 'trellis-cli.exe') --help 2>&1 | ForEach-Object { $_.ToString() } | Out-String
        $helpExit = $LASTEXITCODE
    } finally { $ErrorActionPreference = $oldPreference }
    Write-AtomicText (Join-Path $metadata 'cli-help.txt') $help
    $manifest.cliHelpExitCode = $helpExit
    Write-Json (Join-Path $metadata 'installation-manifest.json') $manifest
    Write-Host $help
    if ($helpExit -ne 0) { throw "CLI --help failed ($helpExit); no generation attempted." }
    foreach ($artifact in $artifacts | Select-Object -Skip 1) { Get-VerifiedArtifact $artifact }
    foreach ($artifact in $artifacts | Select-Object -Skip 1) {
        $stream = [IO.File]::OpenRead((Join-Path $root $artifact.destination))
        try {
            $header = New-Object byte[] 4
            if ($stream.Read($header, 0, 4) -ne 4 -or [Text.Encoding]::ASCII.GetString($header) -ne 'GGUF') {
                throw "Invalid GGUF header: $($artifact.destination)"
            }
            $artifact.magic = 'GGUF'
        } finally { $stream.Dispose() }
    }
    $manifest.status = 'complete'
    $manifest.completedAtUtc = [DateTime]::UtcNow.ToString('o')
    Write-Json (Join-Path $metadata 'installation-manifest.json') $manifest
    Write-Host "Complete: $runtime ; $models . Use --res 512 explicitly; default resolution requires skipped 1024 files."
} finally { $lock.Dispose() }
