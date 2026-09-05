[CmdletBinding()]
param(
    [string]$OutputDirectory,
    [string]$LlamaCliPath,
    [string]$ModelPath,
    [switch]$SkipInstall,
    [switch]$SkipAiBuild,
    [switch]$NoArchive
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$builder = Join-Path $PSScriptRoot 'build-portable.ps1'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $outputRoot = Join-Path $repoRoot 'artifacts'
} elseif ([System.IO.Path]::IsPathRooted($OutputDirectory)) {
    $outputRoot = [System.IO.Path]::GetFullPath($OutputDirectory)
} else {
    $outputRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $OutputDirectory))
}

$liteDirectory = Join-Path $outputRoot "Daylog-portable-lite-$stamp"
$aiDirectory = Join-Path $outputRoot "Daylog-portable-with-ai-$stamp"

function Invoke-PortableBuilder {
    param(
        [Parameter(Mandatory)]
        [string]$Destination,
        [string]$Llama,
        [string]$Model,
        [switch]$ReuseBuild
    )

    $arguments = @('-NoLogo', '-NoProfile', '-File', $builder, '-OutputDirectory', $Destination)
    if ($SkipInstall -or $ReuseBuild) { $arguments += '-SkipInstall' }
    if ($SkipAiBuild -or $ReuseBuild) { $arguments += '-SkipAiBuild' }
    if ($NoArchive) { $arguments += '-NoArchive' }
    if (-not [string]::IsNullOrWhiteSpace($Llama)) { $arguments += @('-LlamaCliPath', $Llama) }
    if (-not [string]::IsNullOrWhiteSpace($Model)) { $arguments += @('-ModelPath', $Model) }

    & pwsh @arguments
    if ($LASTEXITCODE -ne 0) {
        throw "ポータブル版の作成に失敗しました: $Destination"
    }
}

Write-Host '軽量版を作成します...'
Invoke-PortableBuilder -Destination $liteDirectory

if ([string]::IsNullOrWhiteSpace($LlamaCliPath)) {
    $defaultLlama = Join-Path $repoRoot 'ai/runtime/llama-cli.exe'
    if (Test-Path -LiteralPath $defaultLlama -PathType Leaf) {
        $LlamaCliPath = $defaultLlama
    }
}

if ([string]::IsNullOrWhiteSpace($ModelPath)) {
    $modelCandidates = @(Get-ChildItem -LiteralPath (Join-Path $repoRoot 'models') -Filter '*.gguf' -File -ErrorAction SilentlyContinue)
    if ($modelCandidates.Count -eq 1) {
        $ModelPath = $modelCandidates[0].FullName
    } elseif ($modelCandidates.Count -gt 1) {
        throw "models フォルダにGGUFモデルが複数あります。-ModelPath で1つ指定してください。軽量版は作成済みです: $liteDirectory"
    }
}

$missing = [System.Collections.Generic.List[string]]::new()
$aiHelper = Join-Path $repoRoot 'ai/build/Release/daylog-ai.exe'
if (-not (Test-Path -LiteralPath $aiHelper -PathType Leaf)) {
    $missing.Add('ai/build/Release/daylog-ai.exe（-SkipAiBuild を外すと自動ビルド）')
}
if ([string]::IsNullOrWhiteSpace($LlamaCliPath) -or -not (Test-Path -LiteralPath $LlamaCliPath -PathType Leaf)) {
    $missing.Add('ai/runtime/llama-cli.exe（または -LlamaCliPath）')
} else {
    $runtimeDirectory = Split-Path -Parent ([System.IO.Path]::GetFullPath($LlamaCliPath))
    if (-not (Test-Path -LiteralPath (Join-Path $runtimeDirectory 'llama-completion.exe') -PathType Leaf)) {
        $missing.Add('llama-cli.exe と同じフォルダの llama-completion.exe')
    }
}
if ([string]::IsNullOrWhiteSpace($ModelPath) -or -not (Test-Path -LiteralPath $ModelPath -PathType Leaf)) {
    $missing.Add('models フォルダの単一GGUFモデル（または -ModelPath）')
}
if ($missing.Count -gt 0) {
    throw "AI同梱版に必要なファイルがありません: $($missing -join '、')。軽量版は作成済みです: $liteDirectory"
}

Write-Host 'llama.cppランタイム・モデル同梱版を作成します...'
Invoke-PortableBuilder -Destination $aiDirectory -Llama $LlamaCliPath -Model $ModelPath -ReuseBuild

Write-Host '2種類のポータブル版を作成しました。'
Write-Host "  軽量版: $liteDirectory"
Write-Host "  AI同梱版: $aiDirectory"
