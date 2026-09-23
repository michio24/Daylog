import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../services/api";
import type { SearchKind, SearchResult, Tag } from "../types";
import { formatLongDate, localDateKey, startOfMonth, startOfWeek, startOfYear } from "../utils/date";
import { TagChip } from "../components/TagChip";
import { Highlight } from "../components/Highlight";

const labels: Record<string, string> = { task: "タスク", entry: "記録", note: "メモ", note_card: "メモ", review: "振り返り", ai_summary: "AIまとめ" };
const kinds: SearchKind[] = ["task", "entry", "note_card", "review", "ai_summary"];
const periods = ["すべて", "今週", "今月", "今年"] as const;
type Period = (typeof periods)[number];
const PAGE_SIZE = 50;

/** 選んだ期間の開始日。「すべて」なら絞り込まない。 */
const periodStart = (period: Period): string | null => {
  const today = localDateKey();
  if (period === "今週") return startOfWeek(today);
  if (period === "今月") return startOfMonth(today);
  if (period === "今年") return startOfYear(today);
  return null;
};

interface Props { tags: Tag[]; onOpen: (date: string) => void; }
export function SearchPage({ tags, onOpen }: Props) {
  const [query, setQuery] = useState(""); const [tagQuery, setTagQuery] = useState(""); const [tagId, setTagId] = useState<number | null>(null);
  const [selectedKinds, setSelectedKinds] = useState<SearchKind[]>([]); const [period, setPeriod] = useState<Period>("すべて");
  const [results, setResults] = useState<SearchResult[]>([]); const [total, setTotal] = useState(0); const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false); const [error, setError] = useState(""); const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => { if (tagId !== null && !tags.some((tag) => tag.id === tagId)) setTagId(null); }, [tags, tagId]);

  const from = periodStart(period);
  const active = query.trim().length > 0 || tagId !== null || from !== null;
  // 絞り込みが変わったら先頭ページから引き直す。
  const filter = useMemo(() => ({ query, tagId, entityTypes: selectedKinds, from, limit: PAGE_SIZE }), [query, tagId, selectedKinds, from]);

  useEffect(() => {
    if (!active) { setResults([]); setTotal(0); setHasMore(false); setError(""); return; }
    let live = true;
    const timer = window.setTimeout(() => {
      void api.search(filter).then((page) => {
        if (!live) return;
        setResults(page.results); setTotal(page.total); setHasMore(page.hasMore); setError("");
      }).catch((reason) => { if (live) setError(`検索できませんでした: ${String(reason)}`); });
    }, 250);
    return () => { live = false; window.clearTimeout(timer); };
  }, [filter, active]);

  const loadMore = () => {
    setLoadingMore(true);
    void api.search({ ...filter, offset: results.length })
      .then((page) => { setResults((current) => [...current, ...page.results]); setTotal(page.total); setHasMore(page.hasMore); })
      .catch((reason) => setError(`続きを読み込めませんでした: ${String(reason)}`))
      .finally(() => setLoadingMore(false));
  };

  const toggleKind = (kind: SearchKind) => setSelectedKinds((current) => current.includes(kind) ? current.filter((k) => k !== kind) : [...current, kind]);
  const selectedTag = tags.find((tag) => tag.id === tagId);
  const candidates = tags.filter((tag) => tag.id !== tagId && tag.name.toLocaleLowerCase("ja-JP").includes(tagQuery.trim().toLocaleLowerCase("ja-JP")));

  return <main className="page"><div className="page-inner search-width"><div className="page-title"><span>SEARCH</span><h1>記録を探す</h1></div>
    <div className="search-box"><span>⌕</span><input ref={input} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="タスク、記録、メモを検索"/><kbd>Ctrl+F</kbd></div>
    <p className="search-hint">空白区切りはすべてを含む検索、<code>OR</code> でどちらか、<code>-語</code> で除外。<code>&quot;…&quot;</code> で続けて出てくる語を指定できます。</p>

    <div className="search-filters">
      <div className="search-filter" role="group" aria-label="種類で絞り込む">
        <label>種類</label>
        <div className="search-chips">{kinds.map((kind) => <button key={kind} type="button" aria-pressed={selectedKinds.includes(kind)} className={selectedKinds.includes(kind) ? "active" : ""} onClick={() => toggleKind(kind)}>{labels[kind]}</button>)}</div>
      </div>
      <div className="search-filter" role="group" aria-label="期間で絞り込む">
        <label>期間</label>
        <div className="search-chips">{periods.map((value) => <button key={value} type="button" aria-pressed={period === value} className={period === value ? "active" : ""} onClick={() => setPeriod(value)}>{value}</button>)}</div>
      </div>
    </div>

    {tags.length > 0 && <div className="search-tag-picker" role="group" aria-label="タグで絞り込む"><label htmlFor="search-tag-input">タグで絞り込む</label>{selectedTag && <div className="search-tag-selected"><TagChip tag={selectedTag}/><button type="button" aria-label={`${selectedTag.name}の絞り込みを解除`} onClick={() => setTagId(null)}>解除 ×</button></div>}<input id="search-tag-input" value={tagQuery} placeholder="タグ名で探す" onChange={(event) => setTagQuery(event.target.value)}/><div className="search-tag-options" role="group" aria-label="タグの候補">{candidates.map((tag) => <button type="button" key={tag.id} aria-label={`${tag.name}で絞り込む`} onClick={() => { setTagId(tag.id); setTagQuery(""); }}><TagChip tag={tag}/></button>)}{!candidates.length && <p>{tagQuery.trim() ? "一致するタグはありません。" : "選べるタグはありません。"}</p>}</div></div>}

    <div className="result-heading"><span>{query ? `「${query}」の検索結果` : active ? "絞り込みの結果" : "検索語・タグ・期間のいずれかを指定してください"}</span>{active && <small>{total} 件</small>}</div>
    {error && <p className="error-text" role="alert">{error}</p>}
    <div className="results">{results.map((result, i) => <button key={`${result.entityType}-${result.entityId}-${i}`} className="result" onClick={() => onOpen(result.dayDate)}><div><time>{formatLongDate(result.dayDate)}</time><em>{labels[result.entityType] || result.entityType}</em></div><p><Highlight text={result.excerpt} query={query}/></p>{result.tags?.length > 0 && <span className="result-tags">{result.tags.map((tag) => <TagChip key={tag.id} tag={tag}/>)}</span>}</button>)}{active && !results.length && !error && <p className="empty">一致する記録はありません。</p>}</div>
    {hasMore && <button type="button" className="search-more" disabled={loadingMore} onClick={loadMore}>{loadingMore ? "読み込んでいます…" : `さらに読み込む（残り ${total - results.length} 件）`}</button>}
  </div></main>;
}
