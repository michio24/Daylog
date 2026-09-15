import { useEffect, useRef, useState } from "react";
import { api } from "../services/api";
import type { SearchResult, Tag } from "../types";
import { formatLongDate } from "../utils/date";
import { TagChip } from "../components/TagChip";

const labels: Record<string, string> = { task: "タスク", entry: "記録", note: "メモ", note_card: "メモ", review: "振り返り", ai_summary: "AIまとめ" };
interface Props { tags: Tag[]; onOpen: (date: string) => void; }
export function SearchPage({ tags, onOpen }: Props) {
  const [query, setQuery] = useState(""); const [tagQuery, setTagQuery] = useState(""); const [tagId, setTagId] = useState<number | null>(null); const [results, setResults] = useState<SearchResult[]>([]); const [error, setError] = useState(""); const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => { if (tagId !== null && !tags.some((tag) => tag.id === tagId)) setTagId(null); }, [tags, tagId]);
  useEffect(() => { let active = true; const timer = window.setTimeout(() => { if (query.trim() || tagId !== null) void api.searchByTag(query, tagId).then((found) => { if (active) { setResults(found); setError(""); } }).catch((reason) => { if (active) setError(`検索できませんでした: ${String(reason)}`); }); else setResults([]); }, 250); return () => { active = false; window.clearTimeout(timer); }; }, [query, tagId]);
  const selectedTag = tags.find((tag) => tag.id === tagId);
  const candidates = tags.filter((tag) => tag.id !== tagId && tag.name.toLocaleLowerCase("ja-JP").includes(tagQuery.trim().toLocaleLowerCase("ja-JP")));
  return <main className="page"><div className="page-inner search-width"><div className="page-title"><span>SEARCH</span><h1>記録を探す</h1></div>
    <div className="search-box"><span>⌕</span><input ref={input} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="タスク、記録、メモを検索"/><kbd>Ctrl+F</kbd></div>
    {tags.length > 0 && <div className="search-tag-picker" role="group" aria-label="タグで絞り込む"><label htmlFor="search-tag-input">タグで絞り込む</label>{selectedTag && <div className="search-tag-selected"><TagChip tag={selectedTag}/><button type="button" aria-label={`${selectedTag.name}の絞り込みを解除`} onClick={() => setTagId(null)}>解除 ×</button></div>}<input id="search-tag-input" value={tagQuery} placeholder="タグ名で探す" onChange={(event) => setTagQuery(event.target.value)}/><div className="search-tag-options" role="group" aria-label="タグの候補">{candidates.map((tag) => <button type="button" key={tag.id} aria-label={`${tag.name}で絞り込む`} onClick={() => { setTagId(tag.id); setTagQuery(""); }}><TagChip tag={tag}/></button>)}{!candidates.length && <p>{tagQuery.trim() ? "一致するタグはありません。" : "選べるタグはありません。"}</p>}</div></div>}
    <div className="result-heading"><span>{query ? `「${query}」の検索結果` : tagId !== null ? "タグの検索結果" : "検索語またはタグを選択してください"}</span>{(query || tagId !== null) && <small>{results.length} 件</small>}</div>
    {error && <p className="error-text" role="alert">{error}</p>}
    <div className="results">{results.map((result, i) => <button key={`${result.entityType}-${result.entityId}-${i}`} className="result" onClick={() => onOpen(result.dayDate)}><div><time>{formatLongDate(result.dayDate)}</time><em>{labels[result.entityType] || result.entityType}</em></div><p>{result.excerpt}</p>{result.tags?.length > 0 && <span className="result-tags">{result.tags.map((tag) => <TagChip key={tag.id} tag={tag}/>)}</span>}</button>)}{(query || tagId !== null) && !results.length && !error && <p className="empty">一致する記録はありません。</p>}</div>
  </div></main>;
}
