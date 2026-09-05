# Daylog

Windows 11向けの完全ローカル・オフラインファーストなデイリージャーナルです。React/Tauri/Rust/SQLiteで動作し、AI機能は明示的に実行した場合だけ別プロセスで起動します。

## 開発

```powershell
npm install
npm run tauri dev
```

フロントエンドのみの確認は `npm run dev`、静的検証は `npm run build` と `npm test` で行えます。

## ローカルAI

AIは既定でOFFです。利用する場合は次の構成を用意し、設定画面でGGUFモデルを指定します。

```text
ai/
├─ daylog-ai.exe
└─ runtime/
   ├─ llama-cli.exe
   ├─ llama-completion.exe
   └─ *.dll
```

`daylog-ai.exe` は `ai/CMakeLists.txt` からビルドできます。`llama-cli.exe`、同じ配布物の `llama-completion.exe`、DLL一式を利用環境に合わせて配置してください。モデルやランタイムは自動ダウンロードされず、アプリ起動時にも読み込まれません。

```powershell
cmake -S ai -B ai/build
cmake --build ai/build --config Release
```

データは実行ファイルと同じ場所（開発時はプロジェクト直下）の `data/`、`backups/`、`logs/`、`models/` に保存されます。

**llama-cli.exe**
https://github.com/ggml-org/llama.cpp/releases

**models**
https://huggingface.co/unsloth/Qwen3.5-4B-GGUF


## 祝日CSV

国民の祝日は `data/japanese_holidays.csv` から読み込みます。ファイルは初回起動時に生成され、UTF-8で1行につき `YYYY-MM-DD,名称` の形式です。日付には `YYYY/M/D` も使用でき、先頭行には `date,name` または内閣府CSVの見出しを配置できます。空行と `#` で始まる行は無視されます。

CSVを保存した後にカレンダーを再表示すると変更が反映されます。このファイルは日記データと一緒にバックアップZIPへ保存されます。

設定画面の「公式データから更新」を実行すると、[内閣府の公式CSV](https://www8.cao.go.jp/chosei/shukujitsu/gaiyou.html)をダウンロードし、UTF-8・ISO日付へ正規化して同じファイルへ保存します。取得内容の検証に失敗した場合は既存ファイルを維持します。この操作以外で祝日データの通信は行いません。

## ポータブル版の作成

```powershell
npm run portable
```

次の2種類が `artifacts/` に生成されます。

- `Daylog-portable-lite-YYYYMMDD-HHMMSS.zip`: llama.cppランタイム・モデルなしの軽量版
- `Daylog-portable-with-ai-YYYYMMDD-HHMMSS.zip`: llama.cppランタイム・GGUFモデル同梱版。AIは有効化され、同梱モデルの相対パスが設定済み

AI同梱版を作成するには、`ai/runtime/` に `llama-cli.exe`、`llama-completion.exe`、必要なDLLを配置し、`models/` にGGUFモデルを1つ配置します。別の場所にある素材を使う場合は次のように指定できます。

```powershell
npm run portable -- -LlamaCliPath 'C:\path\to\llama-cli.exe' -ModelPath 'C:\path\to\model.gguf'
```

素材が不足している場合、軽量版を作成した後に不足内容を表示し、AI同梱版の作成を中止します。単一のポータブル版だけを作成する場合は、従来どおりスクリプトを直接実行できます。

ZIPはWindows標準の `tar.exe` を使用して作成するため、2GBを超えるGGUFモデルも同梱できます。

```powershell
pwsh -NoLogo -NoProfile -File scripts/build-portable.ps1 `
  -LlamaCliPath 'C:\path\to\llama-cli.exe' `
  -ModelPath 'C:\path\to\model.gguf'
```

依存導入済みの場合は `-SkipInstall`、AIヘルパーを再ビルドしない場合は `-SkipAiBuild`、ZIPが不要な場合は `-NoArchive` を指定できます。
