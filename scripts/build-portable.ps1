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
$tauriCommand = Join-Path $repoRoot 'node_modules/.bin/tauri.cmd'
$appExecutable = Join-Path $repoRoot 'src-tauri/target/release/daylog.exe'
$aiExecutable = Join-Path $repoRoot 'ai/build/Release/daylog-ai.exe'

if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $OutputDirectory = Join-Path $repoRoot "artifacts/Daylog-portable-$stamp"
} elseif (-not [System.IO.Path]::IsPathRooted($OutputDirectory)) {
    $OutputDirectory = Join-Path $repoRoot $OutputDirectory
}
$OutputDirectory = [System.IO.Path]::GetFullPath($OutputDirectory)

if (Test-Path -LiteralPath $OutputDirectory) {
    throw "出力先が既に存在します。別のパスを指定してください: $OutputDirectory"
}

Push-Location $repoRoot
try {
    if (-not $SkipInstall) {
        Write-Host '依存パッケージを確認しています...'
        & npm.cmd install
        if ($LASTEXITCODE -ne 0) { throw "npm install failed: $LASTEXITCODE" }
    } elseif (-not (Test-Path -LiteralPath $tauriCommand)) {
        throw 'node_modules がありません。-SkipInstall を外して再実行してください。'
    }

    Write-Host 'Daylog.exe をビルドしています...'
    & $tauriCommand build --no-bundle
    if ($LASTEXITCODE -ne 0) { throw "Tauri build failed: $LASTEXITCODE" }

    if (-not $SkipAiBuild) {
        Write-Host 'daylog-ai.exe をビルドしています...'
        & cmake.exe -S ai -B ai/build
        if ($LASTEXITCODE -ne 0) { throw "CMake configure failed: $LASTEXITCODE" }
        & cmake.exe --build ai/build --config Release
        if ($LASTEXITCODE -ne 0) { throw "CMake build failed: $LASTEXITCODE" }
    }

    if (-not (Test-Path -LiteralPath $appExecutable -PathType Leaf)) {
        throw "Daylog.exe が生成されませんでした: $appExecutable"
    }

    $aiDirectory = Join-Path $OutputDirectory 'ai'
    $runtimeDirectory = Join-Path $aiDirectory 'runtime'
    $modelsDirectory = Join-Path $OutputDirectory 'models'
    $resolvedLlama = $null
    $resolvedModel = $null
    New-Item -ItemType Directory -Path $runtimeDirectory, $modelsDirectory -Force | Out-Null

    Copy-Item -LiteralPath $appExecutable -Destination (Join-Path $OutputDirectory 'Daylog.exe')

    if (Test-Path -LiteralPath $aiExecutable -PathType Leaf) {
        Copy-Item -LiteralPath $aiExecutable -Destination (Join-Path $aiDirectory 'daylog-ai.exe')
    } else {
        Write-Warning 'daylog-ai.exe がないため、AIヘルパーは同梱されません。'
    }

    if (-not [string]::IsNullOrWhiteSpace($LlamaCliPath)) {
        $resolvedLlama = (Resolve-Path -LiteralPath $LlamaCliPath -ErrorAction Stop).Path
        $runtimeSourceDirectory = Split-Path -Parent $resolvedLlama
        $completionExecutable = Join-Path $runtimeSourceDirectory 'llama-completion.exe'
        if (-not (Test-Path -LiteralPath $completionExecutable -PathType Leaf)) {
            throw "llama-completion.exe が llama-cli.exe と同じフォルダにありません: $runtimeSourceDirectory"
        }
        Copy-Item -LiteralPath $resolvedLlama -Destination (Join-Path $runtimeDirectory 'llama-cli.exe')
        Copy-Item -LiteralPath $completionExecutable -Destination $runtimeDirectory
        Get-ChildItem -LiteralPath $runtimeSourceDirectory -Filter '*.dll' -File |
            Copy-Item -Destination $runtimeDirectory
    } else {
        Write-Warning 'llama-cli.exe は未指定です。AI機能を使う場合は -LlamaCliPath で指定してください。'
    }

    if (-not [string]::IsNullOrWhiteSpace($ModelPath)) {
        $resolvedModel = (Resolve-Path -LiteralPath $ModelPath -ErrorAction Stop).Path
        if ([System.IO.Path]::GetExtension($resolvedModel) -ne '.gguf') {
            throw "モデルファイルは .gguf 形式である必要があります: $resolvedModel"
        }
        Copy-Item -LiteralPath $resolvedModel -Destination (Join-Path $modelsDirectory ([System.IO.Path]::GetFileName($resolvedModel)))
    }

    $aiConfigured = -not [string]::IsNullOrWhiteSpace($resolvedLlama) -and
        -not [string]::IsNullOrWhiteSpace($resolvedModel) -and
        (Test-Path -LiteralPath $aiExecutable -PathType Leaf)
    if ($aiConfigured) {
        $includedModelName = [System.IO.Path]::GetFileName($resolvedModel)
        $initialSettings = [ordered]@{
            aiEnabled = $true
            modelPath = "models/$includedModelName"
            backend = 'Auto'
            contextSize = $null
            generationLength = '標準'
            backupGenerations = 30
            theme = 'light'
            layout = 'one'
        }
        $initialSettings | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $OutputDirectory 'settings.json') -Encoding utf8
        $aiInstruction = "3. AIは有効です。同梱モデル（models/$includedModelName）が設定済みです。"
    } else {
        $aiInstruction = '3. AIを利用する場合は、設定画面でGGUFモデルを指定します。'
    }

    $portableReadme = @"
Daylog ポータブル版

1. 書き込み可能なフォルダへ展開します。
2. Daylog.exe を起動します。
$aiInstruction

data、backups、logs、settings.json は初回起動時に自動生成されます。
国民の祝日は data/japanese_holidays.csv をUTF-8で編集できます。
"@
    Set-Content -LiteralPath (Join-Path $OutputDirectory 'はじめに.txt') -Value $portableReadme -Encoding utf8

    Write-Host "ポータブル版を作成しました: $OutputDirectory"

    if (-not $NoArchive) {
        $archivePath = "$OutputDirectory.zip"
        if (Test-Path -LiteralPath $archivePath) {
            throw "ZIP出力先が既に存在します: $archivePath"
        }
        $archiveParent = Split-Path -Parent $OutputDirectory
        $archiveDirectoryName = Split-Path -Leaf $OutputDirectory
        & tar.exe -a -c -f $archivePath -C $archiveParent $archiveDirectoryName
        if ($LASTEXITCODE -ne 0) {
            Remove-Item -LiteralPath $archivePath -Force -ErrorAction SilentlyContinue
            throw "ZIPの作成に失敗しました: $LASTEXITCODE"
        }
        Write-Host "ZIPを作成しました: $archivePath"
    }
} finally {
    Pop-Location
}
