import { useState } from "react";
import { api } from "../services/api";
import type { Settings } from "../types";

interface Props { settings: Settings; onChange: (settings: Settings) => void; onHolidayUpdated: () => Promise<void>; }
export function SettingsPage({ settings, onChange, onHolidayUpdated }: Props) {
  const [backupMessage, setBackupMessage] = useState("");
  const [holidayMessage, setHolidayMessage] = useState("");
  const [holidayError, setHolidayError] = useState(false);
  const [updatingHolidays, setUpdatingHolidays] = useState(false);
  const update = (patch: Partial<Settings>) => onChange({ ...settings, ...patch });
  const updateHolidays = async () => {
    if (updatingHolidays) return;
    setUpdatingHolidays(true);
    setHolidayError(false);
    setHolidayMessage("内閣府から祝日データを取得しています…");
    try {
      const result = await api.updateNationalHolidays();
      await onHolidayUpdated();
      setHolidayMessage(`${result.count}件に更新しました（最終日: ${result.latestDate}）`);
    } catch (error) {
      setHolidayError(true);
      setHolidayMessage(`更新できませんでした: ${String(error)}`);
    } finally {
      setUpdatingHolidays(false);
    }
  };
  return <main className="page"><div className="page-inner settings-width"><div className="page-title"><span>SETTINGS</span><h1>設定</h1></div>
    <section className="card settings-card"><div className="settings-group"><div><h2>ローカルAI</h2><p>必要なときだけ別プロセスで起動します。</p></div><button role="switch" aria-checked={settings.aiEnabled} className={`switch ${settings.aiEnabled ? "on" : ""}`} onClick={() => update({ aiEnabled: !settings.aiEnabled })}><span/></button></div>
      <label className="setting-field"><span>モデルファイル</span><input disabled={!settings.aiEnabled} value={settings.modelPath} onChange={(e) => update({ modelPath: e.target.value })} placeholder="C:\\...\\model.gguf"/><small>GGUFモデルの絶対パス、またはDaylog.exeからの相対パスを指定してください。</small></label>
      <label className="setting-field"><span>バックエンド</span><select disabled={!settings.aiEnabled} value={settings.backend} onChange={(e) => update({ backend: e.target.value as Settings["backend"] })}>{["Auto", "CUDA", "Vulkan", "CPU"].map((v) => <option key={v}>{v}</option>)}</select></label>
      <label className="setting-field"><span>生成量</span><select disabled={!settings.aiEnabled} value={settings.generationLength} onChange={(e) => update({ generationLength: e.target.value as Settings["generationLength"] })}>{["短め", "標準", "長め"].map((v) => <option key={v}>{v}</option>)}</select></label>
    </section>
    <section className="card settings-card"><div className="settings-group"><div><h2>祝日データ</h2><p>内閣府の公式CSVから日本の祝日・休日を更新します。</p></div><button type="button" disabled={updatingHolidays} onClick={() => void updateHolidays()}>{updatingHolidays ? "更新中…" : "公式データから更新"}</button></div>
      <p className="setting-note">更新時のみ内閣府のWebサイトへ接続します。取得したデータは検証後、ローカルのCSVへ保存されます。</p>
      {holidayMessage && <p className="setting-message" role={holidayError ? "alert" : "status"}>{holidayMessage}</p>}
    </section>
    <section className="card settings-card"><div className="settings-group"><div><h2>バックアップ</h2><p>起動時に1日1回、データベースと添付をZIPで保存します。</p></div><button onClick={() => void api.createBackup().then((path) => setBackupMessage(`作成しました: ${path}`)).catch(() => setBackupMessage("作成できませんでした"))}>今すぐ作成</button></div>
      <label className="setting-field"><span>保存する世代数</span><input type="number" min={1} max={365} value={settings.backupGenerations} onChange={(e) => update({ backupGenerations: Number(e.target.value) })}/></label>{backupMessage && <p className="setting-message">{backupMessage}</p>}
    </section>
    <p className="privacy-note">日記・検索内容・AI結果を外部へ送信しません。祝日更新を実行したときだけ内閣府へ接続します。</p>
  </div></main>;
}
