import { useState } from "react";
import type { AiStatus, AiSummary, Review, Settings } from "../types";

interface Props { review: Review; disabled: boolean; settings: Settings; saveStatus: "saved" | "saving" | "error"; canRunAi: boolean; aiStatus: AiStatus; aiSummary?: AiSummary | null; exporting: boolean; exportMessage: string; onChange: (review: Review) => void; onBlur: () => void; onRunAi: () => void; onCancelAi: () => void; onCandidate: (title: string) => void; onExport: () => void; onClose: () => void; }
export function ReviewSection({ review, disabled, settings, saveStatus, canRunAi, aiStatus, aiSummary, exporting, exportMessage, onChange, onBlur, onRunAi, onCancelAi, onCandidate, onExport, onClose }: Props) {
  const [open, setOpen] = useState(true);
  const running = ["starting", "loading", "generating"].includes(aiStatus);
  const statusText = aiStatus === "starting" ? "AIを準備しています…" : aiStatus === "loading" ? "今日の記録を整理しています…" : "まとめを作成しています…";
  const field = (key: keyof Review, label: string, placeholder: string) => <label><span>{label}</span><textarea disabled={disabled} value={review[key]} onChange={(e) => onChange({ ...review, [key]: e.target.value })} onBlur={onBlur} placeholder={placeholder}/></label>;
  return <section className="card review-section" id="daily-review">
    <button className="review-toggle" onClick={() => setOpen(!open)}><span>今日を振り返る <small>{open ? "" : "Ctrl+R"}</small></span><span className={open ? "" : "closed-chevron"}>▾</span></button>
    {open && <div className="review-body">
      <div className="review-fields">{field("good", "今日よかったこと", "うまくいったことを一言で")}{field("bad", "うまくいかなかったこと", "引っかかったこと")}{field("carryOver", "明日に持ち越すこと", "明日の自分への申し送り")}</div>
      <p className={`save-state ${saveStatus}`}>{saveStatus === "saving" ? "保存中…" : saveStatus === "error" ? "保存できませんでした" : "保存済み"}</p>
      {(settings.aiEnabled || aiSummary) && <div className="ai-area">
        {settings.aiEnabled && (running ? <div className="ai-running"><span className="pulse"/>{statusText}<button onClick={onCancelAi}>キャンセル</button></div> : <button className="ai-button" disabled={!canRunAi} onClick={onRunAi}>{canRunAi ? (aiSummary ? "AIまとめを再生成" : "AIで今日をまとめる") : "まとめる記録がありません"}</button>)}
        {aiStatus === "error" && <p className="error-text">AI処理を完了できませんでした。表示されたエラーを確認してください。</p>}
        {aiSummary && <div className="ai-summary"><h3>AIによる今日のまとめ</h3><p>{aiSummary.summary}</p><h4>成果</h4><ul>{aiSummary.achievements.map((a) => <li key={a}>{a}</li>)}</ul><h4>明日への候補</h4>{aiSummary.tomorrowCandidates.map((c) => <div className="candidate" key={c}><span>{c}</span><button onClick={() => onCandidate(c)}>＋ 明日のタスクへ</button></div>)}<blockquote>{aiSummary.oneLine}</blockquote></div>}
      </div>}
      <div className="close-row"><span>{disabled ? "完了済み" : "書き終えたら、今日を閉じる"}</span><button className="export-button" disabled={exporting} onClick={onExport}>{exporting ? "保存中…" : "Markdownで保存"}</button><button className="primary" disabled={disabled} onClick={onClose}>{disabled ? "完了しました" : "今日を完了"}</button></div>
      {exportMessage && <p className="export-message" role="status">{exportMessage}</p>}
    </div>}
  </section>;
}
