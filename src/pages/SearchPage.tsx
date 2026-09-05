import { useEffect, useRef, useState } from "react";
import { api } from "../services/api";
import type { SearchResult } from "../types";
import { formatLongDate } from "../utils/date";

const labels: Record<string, string> = { task: "タスク", entry: "記録", note: "メモ", note_card: "メモ", review: "振り返り", ai_summary: "AIまとめ" };
interface Props { onOpen: (date: string) => void; }
export function SearchPage({ onOpen }: Props) {
  const [query, setQuery] = useState(""); const [results, setResults] = useState<SearchResult[]>([]); const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); const timer = window.setTimeout(() => { if (query.trim()) void api.search(query).then(setResults); else setResults([]); }, 250); return () => window.clearTimeout(timer); }, [query]);
  return <main className="page"><div className="page-inner search-width"><div className="page-title"><span>SEARCH</span><h1>記録を探す</h1></div>
    <div className="search-box"><span>⌕</span><input ref={input} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="タスク、記録、メモを検索"/><kbd>Ctrl+F</kbd></div>
    <div className="result-heading"><span>{query ? `「${query}」の検索結果` : "検索語を入力してください"}</span>{query && <small>{results.length} 件</small>}</div>
    <div className="results">{results.map((result, i) => <button key={`${result.entityType}-${result.entityId}-${i}`} className="result" onClick={() => onOpen(result.dayDate)}><div><time>{formatLongDate(result.dayDate)}</time><em>{labels[result.entityType] || result.entityType}</em></div><p>{result.excerpt}</p></button>)}{query && !results.length && <p className="empty">一致する記録はありません。</p>}</div>
  </div></main>;
}
