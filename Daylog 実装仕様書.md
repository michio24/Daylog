# Daylog 実装仕様書
## Windows 11 完全ローカル・デイリージャーナル

**Document Version:** 0.1  
**Target:** Version 1.0  
**Platform:** Windows 11  
**Application Type:** Desktop Application  
**Operation:** Fully Local / Offline First

---

# 1. 実装コンセプト

Daylogは、1日単位で以下を記録する個人用デイリージャーナルである。

```text
朝
 ↓
今日やること

 ↓

日中
 ↓
出来事を追記

 ↓

必要に応じて
 ↓
Markdownメモ

 ↓

夜
 ↓
振り返り

 ↓

必要な場合のみ
 ↓
ローカルAIによる総括
```

通常利用時にはAIを一切起動しない。

Daylogの基本思想は、

> 普段は軽い。必要な時だけ賢い。

とする。

---

# 2. 技術スタック

## 2.1 アプリ本体

```text
Tauri
React
TypeScript
Rust
SQLite
```

構成：

```text
React / TypeScript
        │
        │ Tauri Command
        ▼
Rust Backend
        │
        ├─ SQLite
        │
        ├─ File System
        │
        ├─ Backup
        │
        └─ AI Process Manager
```

---

# 3. AI構成

AIはDaylog本体とは完全に別プロセスとする。

```text
Daylog.exe
    │
    │ 必要時のみ起動
    ▼
daylog-ai.exe
    │
    ▼
llama.cpp
    │
    ▼
GGUF Model
```

推奨実装：

```text
daylog-ai.exe
    C++20
       +
    llama.cpp
```

AI関連ライブラリをDaylog本体へ直接リンクしない。

---

# 4. AI非使用時の状態

Daylog起動直後：

```text
Daylog.exe          RUNNING
SQLite              OPEN
React UI            RUNNING

daylog-ai.exe       NOT RUNNING
llama.cpp           NOT LOADED
GGUF                 NOT LOADED
AI GPU Context      NONE
AI VRAM Usage       0
```

通常のジャーナル利用では、この状態を維持する。

AIモデルの事前ロードは禁止する。

AIのバックグラウンド常駐も禁止する。

---

# 5. プロジェクト構成

```text
daylog/
│
├─ src/
│   ├─ components/
│   ├─ pages/
│   ├─ hooks/
│   ├─ services/
│   ├─ stores/
│   ├─ types/
│   └─ App.tsx
│
├─ src-tauri/
│   ├─ src/
│   │   ├─ main.rs
│   │   ├─ commands/
│   │   ├─ database/
│   │   ├─ ai/
│   │   ├─ backup/
│   │   └─ settings/
│   │
│   └─ Cargo.toml
│
├─ ai/
│   ├─ src/
│   │   ├─ main.cpp
│   │   ├─ engine.cpp
│   │   ├─ prompt.cpp
│   │   └─ json.cpp
│   │
│   └─ CMakeLists.txt
│
└─ package.json
```

---

# 6. 配布時ディレクトリ

```text
Daylog/
│
├─ Daylog.exe
│
├─ data/
│   └─ daylog.db
│
├─ ai/
│   ├─ daylog-ai.exe
│   └─ runtime/
│
├─ models/
│   └─ model.gguf
│
├─ backups/
│
├─ logs/
│
└─ settings.json
```

ただし初回起動時には必要なディレクトリを自動生成する。

---

# 7. メイン画面

基本画面は1カラム構成。

常設サイドバーは使用しない。

```text
┌────────────────────────────────────────────┐
│ Daylog     2026年9月3日（木）        ⚙  … │
├────────────────────────────────────────────┤
│                                            │
│ おはようございます                        │
│                                            │
│ ┌ 今日やること ─────────────────────────┐ │
│ │ □ 仕様書作成                          │ │
│ │ □ メール返信                          │ │
│ │ □ バグ調査                            │ │
│ │                                       │ │
│ │ ＋ タスクを追加                       │ │
│ └───────────────────────────────────────┘ │
│                                            │
│ ┌ 今日の記録 ──────────────────────────┐ │
│ │ 09:18 朝会                            │ │
│ │ 10:42 バグ原因判明                    │ │
│ │ 13:24 新しいアイデア                  │ │
│ │                                       │ │
│ │ 今あったことを書く…                  │ │
│ └───────────────────────────────────────┘ │
│                                            │
│ ┌ 今日のメモ ────────────── 編集 | 表示 ┐ │
│ │                                       │ │
│ │ Markdown                              │ │
│ │                                       │ │
│ └───────────────────────────────────────┘ │
│                                            │
│ ▼ 今日を振り返る                          │
│                                            │
│ 今日よかったこと                         │
│ [                                      ] │
│                                            │
│ うまくいかなかったこと                   │
│ [                                      ] │
│                                            │
│ 明日に持ち越すこと                       │
│ [                                      ] │
│                                            │
│ [ AIで今日をまとめる ]                   │
│                                            │
│              [ 今日を完了 ]              │
└────────────────────────────────────────────┘
```

---

# 8. Reactコンポーネント

```text
App
 │
 └─ TodayPage
      │
      ├─ Header
      │
      ├─ Greeting
      │
      ├─ TaskSection
      │    ├─ TaskItem
      │    └─ AddTask
      │
      ├─ TimelineSection
      │    ├─ TimelineItem
      │    └─ QuickEntry
      │
      ├─ DailyNoteSection
      │    ├─ MarkdownEditor
      │    └─ MarkdownViewer
      │
      ├─ ReviewSection
      │
      └─ AiSummarySection
```

---

# 9. 今日の日付

起動時にWindowsのローカル日付を取得する。

日付キー：

```text
YYYY-MM-DD
```

例：

```text
2026-09-03
```

1日につきDayレコードは1件のみ。

---

# 10. SQLite

ファイル：

```text
data/daylog.db
```

文字コード：

```text
UTF-8
```

以下を有効化する。

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
```

---

# 11. days テーブル

```sql
CREATE TABLE days (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    day_date        TEXT NOT NULL UNIQUE,
    is_closed       INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);
```

`day_date` は

```text
YYYY-MM-DD
```

とする。

---

# 12. tasks テーブル

```sql
CREATE TABLE tasks (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    day_id          INTEGER NOT NULL,
    title           TEXT NOT NULL,
    is_completed    INTEGER NOT NULL DEFAULT 0,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    priority        INTEGER,
    carried_over    INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL,
    completed_at    TEXT,

    FOREIGN KEY(day_id)
        REFERENCES days(id)
        ON DELETE CASCADE
);
```

---

# 13. entries テーブル

タイムライン用。

```sql
CREATE TABLE entries (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    day_id          INTEGER NOT NULL,
    entry_type      TEXT NOT NULL DEFAULT 'memo',
    title           TEXT,
    body            TEXT NOT NULL,
    occurred_at     TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,

    FOREIGN KEY(day_id)
        REFERENCES days(id)
        ON DELETE CASCADE
);
```

---

# 14. daily_notes テーブル

Markdownメモ。

```sql
CREATE TABLE daily_notes (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    day_id          INTEGER NOT NULL UNIQUE,
    markdown        TEXT NOT NULL DEFAULT '',
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,

    FOREIGN KEY(day_id)
        REFERENCES days(id)
        ON DELETE CASCADE
);
```

---

# 15. reviews テーブル

```sql
CREATE TABLE reviews (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    day_id              INTEGER NOT NULL UNIQUE,
    good                TEXT NOT NULL DEFAULT '',
    bad                 TEXT NOT NULL DEFAULT '',
    carry_over           TEXT NOT NULL DEFAULT '',
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL,

    FOREIGN KEY(day_id)
        REFERENCES days(id)
        ON DELETE CASCADE
);
```

---

# 16. AI結果テーブル

```sql
CREATE TABLE ai_summaries (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    day_id                  INTEGER NOT NULL,

    summary                 TEXT,
    one_line                TEXT,

    achievements_json       TEXT,
    tomorrow_candidates_json TEXT,

    model_name              TEXT,
    source_hash             TEXT,

    generated_at            TEXT NOT NULL,

    FOREIGN KEY(day_id)
        REFERENCES days(id)
        ON DELETE CASCADE
);
```

AIによる結果は通常データとしてSQLiteへ保存する。

AIプロセス終了後も閲覧可能。

---

# 17. AI実行履歴

デバッグ・障害確認のためAI実行単位を記録する。

```sql
CREATE TABLE ai_runs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id      TEXT NOT NULL UNIQUE,
    day_id          INTEGER NOT NULL,

    status          TEXT NOT NULL,

    model_name      TEXT,
    backend         TEXT,

    started_at      TEXT,
    finished_at     TEXT,

    elapsed_ms      INTEGER,
    error_message   TEXT,

    FOREIGN KEY(day_id)
        REFERENCES days(id)
        ON DELETE CASCADE
);
```

status：

```text
starting
loading
running
completed
cancelled
failed
```

---

# 18. 今日のタスク

## 追加

入力：

```text
＋ タスクを追加
```

または

```text
Ctrl + T
```

確定すると即座にSQLiteへ保存。

---

## 完了

チェックボックスを変更した時点で保存。

```text
false
 ↓
true
```

`completed_at`も設定する。

---

# 19. 今日の記録

画面下部：

```text
今あったことを書く…
```

Enter：

改行。

Ctrl + Enter：

登録。

登録時点の時刻を

```text
occurred_at
```

として記録する。

---

# 20. Markdownメモ

Markdownメモには

```text
編集
表示
```

の2モードを用意する。

---

# 21. Markdown編集モード

Version 1.0では複雑なWYSIWYGエディタを導入しない。

基本は通常のテキストエディタとする。

対応：

```markdown
# Heading

## Heading

- list

1. list

- [ ] task
- [x] task

**bold**

*italic*

`code`

> quote
```

コードブロックにも対応する。

---

# 22. Markdownビューモード

React側でMarkdownをHTMLへレンダリングする。

推奨：

```text
react-markdown
+
remark-gfm
```

Raw HTMLはデフォルトで無効。

Markdownから任意のHTMLやJavaScriptを実行させない。

---

# 23. Markdown自動保存

入力開始：

```text
ユーザー入力
    ↓
700ms
    ↓
変更なし
    ↓
SQLite保存
```

debounce：

```text
700ms
```

を初期値とする。

さらに以下でも強制保存する。

```text
フォーカス離脱
日付移動
アプリ終了
```

---

# 24. 保存状態表示

画面の邪魔にならない場所に状態を表示可能とする。

```text
保存中…
```

↓

```text
保存済み
```

エラー：

```text
保存できませんでした
```

---

# 25. 振り返り

以下の3項目。

```text
今日よかったこと

うまくいかなかったこと

明日に持ち越すこと
```

Markdownにはしない。

簡単なプレーンテキストとする。

こちらも自動保存。

---

# 26. 今日を完了

```text
今日を完了
```

押下時：

```sql
days.is_closed = 1
```

とする。

完了後でも閲覧可能。

再編集：

```text
再編集する
```

を選択した場合、

```sql
is_closed = 0
```

へ戻す。

---

# 27. AI実行ボタン

基本ボタン：

```text
AIで今日をまとめる
```

通常時には、このボタン以外でAIプロセスを起動しない。

---

# 28. AI実行フロー

```text
[ AIで今日をまとめる ]
          │
          ▼
DaylogがDBから
今日のデータを取得
          │
          ▼
スナップショット作成
          │
          ▼
request.json生成
          │
          ▼
daylog-ai.exe起動
          │
          ▼
GGUFロード
          │
          ▼
推論
          │
          ▼
JSON生成
          │
          ▼
Daylogへ結果返却
          │
          ▼
JSON検証
          │
          ▼
SQLite保存
          │
          ▼
daylog-ai.exe終了
          │
          ▼
AIリソース完全解放
```

---

# 29. AI用スナップショット

AI開始時点でデータを固定する。

その後ユーザーが内容を変更しても、実行中AIへは反映しない。

対象：

```text
Tasks
Entries
DailyNote
Review
```

---

# 30. AI Request JSON

```json
{
  "schema_version": 1,
  "request_id": "uuid",
  "operation": "daily_review",
  "locale": "ja-JP",

  "day": {
    "date": "2026-09-03",

    "tasks": [
      {
        "title": "仕様書を仕上げる",
        "completed": true
      }
    ],

    "entries": [
      {
        "time": "09:18",
        "type": "memo",
        "title": "朝会",
        "body": "今日の進捗について確認した"
      }
    ],

    "note_markdown": "# 気づき\nUIはもっとシンプルでよい",

    "review": {
      "good": "バグ原因が判明した",
      "bad": "朝の作業開始が遅れた",
      "carry_over": "仕様書レビュー"
    }
  }
}
```

---

# 31. AI Response JSON

```json
{
  "schema_version": 1,
  "request_id": "uuid",
  "status": "ok",

  "result": {
    "summary": "今日はバグ調査と仕様整理が中心の一日でした。",
    "one_line": "問題を解決し、次の方向性を固めた日。",

    "achievements": [
      "バグ原因を特定",
      "UI方針を整理"
    ],

    "tomorrow_candidates": [
      "仕様書レビュー",
      "UIプロトタイプ作成"
    ]
  },

  "runtime": {
    "model": "model.gguf",
    "backend": "cuda"
  }
}
```

---

# 32. AI出力方針

一回のモデル起動で以下を生成する。

```text
今日の総括

今日の一行

今日の成果

明日への候補
```

4回推論するのではなく、

```text
モデルロード
    ↓
1回の推論
    ↓
JSON取得
    ↓
モデル終了
```

を基本とする。

---

# 33. AIプロンプト基本方針

AIには以下を明示する。

```text
あなたは個人用デイリージャーナルの整理アシスタントです。

ユーザーが記録した事実だけを基にしてください。

記録にない事実を推測して追加しないでください。

心理診断を行わないでください。

過度な励ましや批評を行わないでください。

簡潔にまとめてください。

指定されたJSON形式だけを返してください。
```

DaylogではAIの創造性より、

```text
忠実性
簡潔性
構造化
```

を優先する。

---

# 34. AI実行中UI

AIボタンを以下へ変更する。

```text
AIを準備しています…
```

モデルロード後：

```text
今日の記録を整理しています…
```

生成中：

```text
まとめを作成しています…
```

同時に

```text
キャンセル
```

を表示する。

---

# 35. AI実行中もDaylogは使用可能

AIは別プロセスなので、

```text
メモ編集
タスク追加
タイムライン追加
履歴閲覧
```

は継続可能とする。

ただし現在のAI結果は、

**AI開始時点のスナップショット**

に基づくことを保証する。

---

# 36. AI IPC

IPCはできるだけ単純にする。

Version 1では

```text
stdin
stdout
stderr
```

を使用する。

---

## stdin

Daylogから `daylog-ai.exe` へRequest JSONを送信。

---

## stdout

AIはResponse JSONのみを返す。

ログをstdoutへ出さない。

---

## stderr

以下はstderrへ出力。

```text
モデルロード
バックエンド判定
推論進捗
エラー
デバッグログ
```

---

# 37. AIプロセス管理

Rust側に

```text
AiProcessManager
```

を実装する。

責務：

```text
AI起動

Request送信

stdout取得

stderr取得

キャンセル

終了待機

異常終了処理

プロセス残存確認
```

---

# 38. Windows Job Object

AIプロセス管理にはWindows Job Objectの使用を推奨する。

AI実行開始：

```text
Job Object作成
      ↓
daylog-ai.exe起動
      ↓
Job Objectへ登録
```

Job Objectに

```text
JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
```

相当の設定を行う。

これによりDaylogが異常終了した場合でも、

AI関連プロセスを残しにくくする。

---

# 39. AIキャンセル

```text
[ キャンセル ]
```

押下：

```text
Cancellation Request
        ↓
短時間のGraceful Stop
        ↓
停止しない場合
        ↓
Job Object終了
        ↓
AIプロセス強制終了
```

キャンセル時：

```text
ai_runs.status = cancelled
```

---

# 40. AI異常終了

対象：

```text
モデルがない

GGUFが壊れている

VRAM不足

AI初期化失敗

GPUバックエンド失敗

推論失敗

JSON不正

プロセスクラッシュ
```

エラー時も必ず終了処理へ進む。

```text
ERROR
  ↓
エラー記録
  ↓
AI process terminate
  ↓
Job Object close
  ↓
UI復帰
```

---

# 41. AI終了保証

AI処理の最終処理は必ず、

```text
AI結果取得

↓

SQLite保存

↓

AI Process終了

↓

Job Object終了

↓

プロセス終了確認

↓

通常状態へ復帰
```

とする。

正常・異常・キャンセルすべて同じ終了ルートへ収束させる。

---

# 42. AI完了後状態

```text
Daylog.exe          RUNNING

daylog-ai.exe       NOT RUNNING

AI Model            NOT LOADED

AI GPU Context      NONE

AIによるVRAM使用    NONE
```

この状態がAI機能の正常な完了状態である。

---

# 43. AIバックエンド選択

基本：

```text
Auto
```

とする。

候補：

```text
CUDA
Vulkan
CPU
```

優先順位は実際の配布構成に応じて決定する。

例：

```text
CUDA使用可能
    ↓ YES
CUDA

    ↓ NO

Vulkan使用可能
    ↓ YES
Vulkan

    ↓ NO

CPU
```

この判定もAI実行時のみ行う。

アプリ起動時にGPU初期化を行わない。

---

# 44. モデル設定

設定：

```text
AI機能

[ ON / OFF ]

モデル
C:\...\model.gguf

バックエンド
Auto

最大コンテキスト
Auto

生成量
標準
```

AI OFFの場合：

```text
AIで今日をまとめる
```

ボタン自体を非表示、または無効化する。

---

# 45. AIモデル管理

Version 1ではモデル自動ダウンロードは実装しない。

モデルファイル：

```text
models/
```

から選択する。

設定画面：

```text
モデルファイルを選択

モデルフォルダを開く
```

---

# 46. AI結果表示

AI完了後：

```text
AIによる今日のまとめ
────────────────────

今日はバグ調査と仕様整理が中心でした。
午後には問題の原因を特定できています。

成果
・バグ原因を特定
・UI方針を整理

明日への候補
□ 仕様書レビュー
□ UIプロトタイプ作成

今日の一行

「問題を解決し、次の方向性を固めた日。」
```

---

# 47. 明日への候補

AIが提案した内容を直接翌日のタスクには登録しない。

各候補に

```text
＋ 明日のタスクへ
```

を用意する。

ユーザーが明示的に選択したものだけ登録する。

---

# 48. 履歴画面

ヘッダーから開く。

```text
履歴
```

表示内容：

```text
カレンダー

過去の日記

検索
```

---

# 49. カレンダー

月表示。

日付をクリック：

```text
2026-09-02
```

↓

その日のページを表示。

今日以外の場合は、

```text
過去の記録
```

として扱う。

---

# 50. 記録量表示

日付背景を記録量に応じて変更可能。

```text
0      記録なし
1～2   少ない
3～5   普通
6以上  多い
```

具体的な閾値は実装後調整可能。

---

# 51. 通常検索

AIを使用しない。

SQLite検索で行う。

検索対象：

```text
Task.title

Entry.title
Entry.body

DailyNote.markdown

Review.good
Review.bad
Review.carry_over

AI Summary
```

---

# 52. FTS

検索性能向上のためSQLite FTS5を利用可能とする。

検索インデックス：

```text
entity_type
entity_id
day_id
content
```

対象データ更新時に検索インデックスも更新する。

Version 1のデータ量では通常LIKE検索でも動作可能だが、将来性を考慮しFTS5を推奨する。

---

# 53. バックアップ

データベース：

```text
daylog.db
```

バックアップ先：

```text
backups/
```

ファイル例：

```text
daylog_20260903_220500.db
```

---

# 54. バックアップ方式

単純なファイルコピーではなくSQLite Backup API相当を使用する。

理由：

```text
WAL使用中でも
整合性のあるバックアップを取得するため
```

---

# 55. 自動バックアップ

初期設定：

```text
1日1回
```

Daylog起動時に、

```text
今日バックアップ済みか
```

を確認する。

未実施の場合のみバックアップ。

---

# 56. バックアップ世代

初期値：

```text
30世代
```

それ以前は自動削除。

設定変更可能。

---

# 57. ログ

通常ログ：

```text
logs/daylog.log
```

AIログ：

```text
logs/daylog-ai.log
```

個人のジャーナル本文を通常ログへ書き込まない。

ログ対象：

```text
起動

DBエラー

AI起動

AI終了

AIバックエンド

AI実行時間

エラーコード
```

---

# 58. プライバシー

以下を外部送信しない。

```text
日記

メモ

タスク

AIプロンプト

AI結果

検索内容
```

Version 1ではアプリ本体から外部APIへ通信する機能を実装しない。

---

# 59. ショートカット

```text
Ctrl + T
タスク追加

Ctrl + Enter
タイムライン登録

Ctrl + M
今日のメモへ移動

Ctrl + R
振り返りへ移動

Ctrl + F
検索

Ctrl + S
現在入力中の内容を即時保存
```

---

# 60. アプリ終了

アプリ終了時：

```text
未保存データをflush
       ↓
SQLite Commit
       ↓
AI実行中？
   │
   ├ NO
   │
   └ YES
       ↓
    AI停止
       ↓
    Job Object終了
       ↓
    AI終了確認
       ↓
Daylog終了
```

AIだけバックグラウンドに残る状態は禁止する。

---

# 61. Rust側主要モジュール

```text
src-tauri/src/

database/
    mod.rs
    migrations.rs
    days.rs
    tasks.rs
    entries.rs
    notes.rs
    reviews.rs
    search.rs

ai/
    mod.rs
    process_manager.rs
    protocol.rs
    snapshot.rs
    job_object.rs

backup/
    mod.rs

settings/
    mod.rs

commands/
    day.rs
    task.rs
    entry.rs
    note.rs
    review.rs
    ai.rs
```

---

# 62. Tauri Command

主要Command：

```text
get_today

get_day

create_task
update_task
delete_task

create_entry
update_entry
delete_entry

save_daily_note

save_review

close_day
reopen_day

search_entries

run_daily_ai

cancel_ai

get_ai_status

create_backup
```

---

# 63. フロントエンド状態管理

必要以上に複雑な状態管理を使用しない。

主な状態：

```text
currentDay

tasks

entries

dailyNote

review

aiStatus

saveStatus
```

ページ読み込み時にSQLiteから取得。

変更時にバックエンドへ保存する。

---

# 64. AI状態

Frontend：

```typescript
type AiStatus =
  | "idle"
  | "starting"
  | "loading"
  | "generating"
  | "completed"
  | "cancelled"
  | "error";
```

通常状態：

```text
idle
```

である。

---

# 65. 保存状態

```typescript
type SaveStatus =
  | "saved"
  | "saving"
  | "error";
```

---

# 66. 起動性能方針

アプリ起動時に実行するもの：

```text
UI初期化

SQLite初期化

今日のデータ取得
```

実行しないもの：

```text
AIモデルロード

AIプロセス起動

GPU初期化

モデルスキャン

Embedding生成

AIサーバー起動
```

---

# 67. 起動後の理想状態

```text
軽量なTauriアプリ
+
SQLite
```

だけであることを目標とする。

---

# 68. Version 1.0 実装範囲

必須：

```text
今日ページ

タスク

タイムライン

Markdownメモ

編集 / 表示切替

振り返り

今日を完了

履歴

カレンダー

検索

SQLite

自動保存

バックアップ

AI ON/OFF

オンデマンドAI

今日の総括

AI完全終了
```

---

# 69. Version 1.0では実装しないもの

以下は初期リリースから外す。

```text
クラウド同期

アカウント

Web版

スマートフォン版

AIチャット

常駐AI

Embedding常時生成

オンラインAI

高度な統計

画像認識

音声入力

複雑なプロジェクト管理

外部タスク管理サービス連携
```

---

# 70. Version 1.1以降

候補：

```text
Weekly Review

Monthly Review

去年の今日

今日の一行一覧

アイデア発掘

タグ

Markdown Export

JSON Export

添付ファイル

画像貼り付け

自然文検索

ローカルEmbedding検索

テーマ

ダークモード
```

AI検索についても常駐AIにはしない。

必要になった場合のみ起動する。

---

# 71. 実装優先順位

## Phase 1

AIなしでDaylogを完成させる。

```text
SQLite

Today画面

Task

Timeline

Markdown

Review

History

Backup
```

---

## Phase 2

AIプロセス基盤。

```text
daylog-ai.exe

stdin / stdout IPC

Process Manager

Windows Job Object

Cancel

異常終了
```

---

## Phase 3

AI Daily Review。

```text
Snapshot

Prompt

JSON Response

Summary UI

SQLite保存
```

---

## Phase 4

品質向上。

```text
エラー処理

バックアップ

検索

ショートカット

UI調整

パフォーマンス改善
```

---

# 72. AI実装で最重要なテスト

### Test 1

Daylogを起動する。

確認：

```text
daylog-ai.exeが存在しない
AIモデルがRAMにロードされていない
AIモデルがVRAMにロードされていない
```

---

### Test 2

AIボタンを押す。

確認：

```text
daylog-ai.exe起動

モデルロード

推論実行
```

---

### Test 3

AI正常完了。

確認：

```text
結果がSQLiteへ保存

daylog-ai.exe終了

AI関連プロセスなし

VRAM解放
```

---

### Test 4

AI実行中キャンセル。

確認：

```text
推論停止

daylog-ai.exe終了

AI関連プロセスなし

Daylogは正常動作
```

---

### Test 5

AI実行中にDaylogを終了。

確認：

```text
AIプロセスも終了

孤児プロセスなし
```

---

### Test 6

GGUF破損。

確認：

```text
エラー表示

Daylogはクラッシュしない

AIプロセス終了
```

---

### Test 7

VRAM不足。

確認：

```text
エラー処理

可能ならCPU等へのフォールバック

またはユーザーへ通知

AIプロセス終了
```

---

# 73. 完了条件

Version 1.0の重要な受け入れ条件を以下とする。

### ジャーナル

- アプリを起動すると今日が表示される
- タスクを書ける
- 出来事を追記できる
- Markdownメモを書ける
- Markdownを表示できる
- 振り返りを書ける
- 過去の日記を閲覧できる
- 検索できる
- 自動保存される
- オフラインで使用できる

### AI

- AIを使わなくても全機能が利用できる
- Daylog起動時にAIが起動しない
- AIボタンを押した場合のみAIが起動する
- AI処理中もDaylogを操作できる
- AI完了後にAIプロセスが終了する
- AI完了後にモデルを保持しない
- キャンセル時もAIプロセスが終了する
- Daylog終了時にAIだけ残らない
- AI結果だけSQLiteへ残る

---

# 74. 最終アーキテクチャ

```text
                         ┌────────────────────┐
                         │      Windows 11    │
                         └──────────┬─────────┘
                                    │
                                    ▼
┌───────────────────────────────────────────────────────┐
│                      Daylog.exe                       │
│                                                       │
│   React UI                                            │
│       │                                               │
│       ▼                                               │
│   Tauri / Rust                                        │
│       │                                               │
│       ├──────────── SQLite                            │
│       │                                               │
│       ├──────────── Backup                            │
│       │                                               │
│       └──────────── AI Process Manager                │
│                          │                            │
└──────────────────────────┼────────────────────────────┘
                           │
                  AI実行時のみ
                           │
                           ▼
                  ┌─────────────────┐
                  │ daylog-ai.exe   │
                  │                 │
                  │ llama.cpp       │
                  │      ↓          │
                  │ model.gguf      │
                  └────────┬────────┘
                           │
                       JSON Result
                           │
                           ▼
                       Daylog.exe
                           │
                           ▼
                         SQLite
                           │
                           ▼
                  daylog-ai.exe終了
```

通常時は図の下半分が存在しない状態とする。

---

# 75. Daylogの実装原則

開発中に判断に迷った場合は、以下の優先順位に従う。

```text
1. 記録しやすいこと

2. データを失わないこと

3. 通常時に軽いこと

4. シンプルであること

5. 完全ローカルであること

6. AIは必要な時しか動かないこと

7. AI処理速度

8. 高度な機能
```

DaylogはAIアプリではない。

Daylogは、

**毎日の記録を自然に残すためのジャーナルアプリであり、ローカルAIは必要な時だけ記録整理を手伝う補助機能である。**