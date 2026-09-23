export interface Slice { label: string; value: number; }
interface Props { slices: Slice[]; summary: string; }

/**
 * 割合を横棒で並べる。タグ別・アイコン別の件数に使う。
 *
 * 系列ごとに色を変えず、ラベルと数値を必ず添える。テーマによって
 * 使える色数が違ううえ、色だけで系列を見分けさせないため。
 */
export function RatioBar({ slices, summary }: Props) {
  const max = Math.max(1, ...slices.map((slice) => slice.value));
  return <ul className="ratio-bars" role="img" aria-label={summary}>
    {slices.map((slice) => <li key={slice.label}>
      <span className="ratio-label" title={slice.label}>{slice.label}</span>
      <span className="ratio-track"><span className="ratio-fill" style={{ width: `${(slice.value / max) * 100}%` }}/></span>
      <span className="ratio-value">{slice.value}</span>
    </li>)}
  </ul>;
}
