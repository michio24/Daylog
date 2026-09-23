interface Props {
  label: string;
  value: string;
  note?: string;
  /** 前期との差。増減を色ではなく記号と語で示す。 */
  delta?: number | null;
}

export function StatTile({ label, value, note, delta }: Props) {
  const hasDelta = delta !== null && delta !== undefined;
  const sign = !hasDelta ? "" : delta > 0 ? "▲" : delta < 0 ? "▼" : "±";
  const deltaText = !hasDelta ? "" : delta === 0 ? "前期と同じ" : `前期比 ${sign}${Math.abs(delta)}`;
  return <div className="stat-tile">
    <span className="stat-label">{label}</span>
    <strong className="stat-value">{value}</strong>
    {note && <small className="stat-note">{note}</small>}
    {hasDelta && <small className="stat-delta">{deltaText}</small>}
  </div>;
}
