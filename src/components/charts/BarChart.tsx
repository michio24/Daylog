export interface Bar { label: string; value: number; title?: string; }
interface Props {
  bars: Bar[];
  /** 全体を1文で説明する。読み上げはこれだけを読む。 */
  summary: string;
  /** 目盛りラベルを間引く間隔。24時間のように本数が多いときに使う。 */
  labelEvery?: number;
  height?: number;
}

/**
 * 縦棒グラフ。依存を足さずインラインSVGで描く。
 *
 * 塗りを `var(--accent)` で書けるので、7テーマすべてに自動で追従する。
 * 値は棒の上にも出し、色や高さだけに情報を載せない。
 */
export function BarChart({ bars, summary, labelEvery = 1, height = 96 }: Props) {
  const max = Math.max(1, ...bars.map((bar) => bar.value));
  return <div className="chart" role="img" aria-label={summary}>
    <div className="chart-bars" style={{ height: `${height}px` }}>
      {bars.map((bar, index) => <div key={`${bar.label}-${index}`} className="chart-bar" title={bar.title ?? `${bar.label}: ${bar.value}`}>
        <span className="chart-bar-value">{bar.value > 0 ? bar.value : ""}</span>
        <span className="chart-bar-fill" style={{ height: `${(bar.value / max) * 100}%` }} data-empty={bar.value === 0 ? "true" : undefined}/>
      </div>)}
    </div>
    <div className="chart-labels">
      {bars.map((bar, index) => <span key={`${bar.label}-${index}`}>{index % labelEvery === 0 ? bar.label : ""}</span>)}
    </div>
  </div>;
}
