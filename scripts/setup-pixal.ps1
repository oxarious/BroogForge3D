$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Models = Join-Path $Root 'models/pixal3d'
$Revision = '0e8f0e0997949c8de1671c76a19a91aa7f424dfa'
$Files = @(
    @{name='pixal3d_naf.gguf'; sha='f316aad461679060726df016e31f12a386c69785fc7d7da22278485f63541aa2'},
    @{name='pixal3d_shape_flow_512.gguf'; sha='a4a99ba71e6065fa67b72fa903fbe7a7c1049eb6aee3c85df435d8795b846185'},
    @{name='pixal3d_ss_flow.gguf'; sha='113e00d1548d512e625eb76437cafd7fa2d79101efb4438fdb8b174ec21e559c'}
)
New-Item -ItemType Directory -Force -Path $Models | Out-Null
foreach ($File in $Files) {
    $Target = Join-Path $Models $File.name
    if (-not (Test-Path -LiteralPath $Target)) {
        Write-Host "Downloading $($File.name)"
        & curl.exe --fail --location --silent --show-error --retry 3 --output "$Target.part" "https://huggingface.co/vegax87/Pixal3D/resolve/$Revision/$($File.name)"
        if ($LASTEXITCODE -ne 0) { throw "Download failed: $($File.name)" }
        if ((Get-FileHash -LiteralPath "$Target.part" -Algorithm SHA256).Hash -ne $File.sha) { throw "Checksum mismatch: $($File.name)" }
        Move-Item -LiteralPath "$Target.part" -Destination $Target
    }
    if ((Get-FileHash -LiteralPath $Target -Algorithm SHA256).Hash -ne $File.sha) { throw "Checksum mismatch: $($File.name)" }
}
foreach ($Name in @('birefnet','dinov3','ss_dec','shape_dec','tex_dec')) {
    $Target = Join-Path $Models "$Name.gguf"
    $Source = Join-Path $Root "models/trellis-q4/$Name.gguf"
    if (-not (Test-Path -LiteralPath $Target)) { New-Item -ItemType HardLink -Path $Target -Target $Source | Out-Null }
}
@{ revision=$Revision; files=$Files; verifiedAt=(Get-Date).ToUniversalTime().ToString('o'); profile='512 geometry-only' } | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $Models 'verified.json') -Encoding UTF8
Write-Host 'Pixal3D 512 weights verified. This profile produces geometry only.'
