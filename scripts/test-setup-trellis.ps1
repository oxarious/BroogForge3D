#requires -Version 5.1
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'setup-trellis.ps1'), [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
# Load only local helper definitions, never the install orchestration.
$ast.FindAll({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] }, $false) |
    ForEach-Object { Invoke-Expression $_.Extent.Text }
$project = Split-Path -Parent $PSScriptRoot
$root = Join-Path $project "runtime/setup-cache/test-$([Guid]::NewGuid().ToString('N'))"
$metadata = $root
New-Item -ItemType Directory -Path $root | Out-Null
$script:manifest = @{ test = $true }
$curl = 'Invoke-FakeCurl'
$script:curlCalls = 0
$script:failCurl = $false
function Invoke-FakeCurl {
    $script:curlCalls++
    if ($script:failCurl) { $global:LASTEXITCODE = 18; return }
    $out = $args[[Array]::IndexOf($args, '--output') + 1]
    $offset = if (Test-Path -LiteralPath $out) { (Get-Item -LiteralPath $out).Length } else { 0 }
    $stream = [IO.File]::Open($out, 'Append', 'Write')
    try { $stream.Write($script:payload, $offset, $script:payload.Length - $offset) }
    finally { $stream.Dispose() }
    $global:LASTEXITCODE = 0
}
function Assert([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Assert-Fails([scriptblock]$Action, [string]$Pattern) {
    $caught = $false
    try { & $Action } catch { $caught = $true; Assert ($_.Exception.Message -match $Pattern) "Unexpected error: $_" }
    Assert $caught "Expected rejection: $Pattern"
}
try {
    $script:payload = [Text.Encoding]::UTF8.GetBytes('verified test artifact')
    $fixture = Join-Path $root 'fixture'
    [IO.File]::WriteAllBytes($fixture, $payload)
    $hash = (Get-FileHash -LiteralPath $fixture -Algorithm SHA256).Hash
    Assert (Test-Artifact $fixture $payload.Length $hash) 'Valid fixture rejected'
    Assert (-not (Test-Artifact $fixture 1 $hash)) 'Wrong size accepted'
    Assert (-not (Test-Artifact $fixture $payload.Length ('0' * 64))) 'Wrong hash accepted'
    $artifact = [ordered]@{ destination = 'download.bin'; url = 'https://example.invalid/fixture'; bytes = $payload.Length; sha256 = $hash }
    $dest = Join-Path $root $artifact.destination
    [IO.File]::WriteAllBytes("$dest.part", $payload[0..4])
    Get-VerifiedArtifact $artifact
    Assert ((Test-Artifact $dest $payload.Length $hash) -and -not (Test-Path "$dest.part")) 'Partial resume/promotion failed'
    Get-VerifiedArtifact $artifact
    Assert ($curlCalls -eq 1) 'Verified file was downloaded twice'
    [IO.File]::WriteAllText($dest, 'corrupt')
    Assert-Fails { Get-VerifiedArtifact $artifact } 'Existing file fails verification'
    Assert ([IO.File]::ReadAllText($dest) -eq 'corrupt') 'Existing corrupt file overwritten'
    Remove-Item -LiteralPath $dest
    [IO.File]::WriteAllBytes("$dest.part", $payload)
    Get-VerifiedArtifact $artifact
    Assert ($curlCalls -eq 1) 'Complete partial unnecessarily downloaded'
    Remove-Item -LiteralPath $dest
    [IO.File]::WriteAllBytes("$dest.part", ([byte[]](0..99)))
    Assert-Fails { Get-VerifiedArtifact $artifact } 'Oversized partial'
    [IO.File]::WriteAllBytes("$dest.part", (New-Object byte[] $payload.Length))
    Assert-Fails { Get-VerifiedArtifact $artifact } 'SHA256/size mismatch'
    Assert (-not (Test-Path $dest)) 'Bad checksum exposed as final artifact'
    [IO.File]::WriteAllBytes("$dest.part", $payload[0..4])
    $script:failCurl = $true
    Assert-Fails { Get-VerifiedArtifact $artifact } 'curl failed'
    Assert ((Test-Path "$dest.part") -and -not (Test-Path $dest)) 'Interrupted partial was lost/promoted'
    Write-Host 'PASS: parser, size/hash checks, resume, atomic metadata replacement, safe promotion, repeat verification, corruption, oversized partial, interrupted curl.'
} finally {
    $allowed = [IO.Path]::GetFullPath((Join-Path $project 'runtime/setup-cache')) + [IO.Path]::DirectorySeparatorChar
    if (-not ([IO.Path]::GetFullPath($root).StartsWith($allowed, [StringComparison]::OrdinalIgnoreCase))) { throw 'Unsafe test cleanup path.' }
    Remove-Item -LiteralPath $root -Recurse -Force
}
