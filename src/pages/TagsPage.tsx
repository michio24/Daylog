import { useState } from "react";
import { api } from "../services/api";
import type { Tag } from "../types";
import { ENTRY_COLORS } from "../components/EntryIcon";
import { TagChip, tagColorStyle } from "../components/TagChip";

interface Props { tags: Tag[]; onTags: (tags: Tag[]) => void; onError: (message: string) => void; }
export function TagsPage({ tags, onTags, onError }: Props) {
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>("blue");
  const [editing, setEditing] = useState<Tag | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [listQuery, setListQuery] = useState("");
  const [pending, setPending] = useState(false);
  const visibleTags = tags.filter((tag) => tag.name.toLocaleLowerCase("ja-JP").includes(listQuery.trim().toLocaleLowerCase("ja-JP")));
  const save = async () => {
    if (!name.trim() || pending) return;
    setPending(true);
    try {
      const saved = editing ? await api.updateTag({ ...editing, name: name.trim(), color }) : await api.createTag(name.trim(), color);
      onTags([...tags.filter((tag) => tag.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name, "ja")));
      setName(""); setColor("blue"); setEditing(null);
    } catch (error) { onError(`タグを保存できませんでした: ${String(error)}`); }
    finally { setPending(false); }
  };
  const remove = async (id: number) => {
    if (pending) return;
    setPending(true);
    try { await api.deleteTag(id); onTags(tags.filter((tag) => tag.id !== id)); setDeleting(null); if (editing?.id === id) { setEditing(null); setName(""); } }
    catch (error) { onError(`タグを削除できませんでした: ${String(error)}`); }
    finally { setPending(false); }
  };
  return <main className="page"><div className="page-inner tags-width"><div className="page-title"><span>TAGS</span><h1>タグを整理する</h1><p>タスクとメモを、あなたの視点でまとめます。</p></div>
    <section className="card tag-manager"><div className="section-heading"><h2>{editing ? "タグを編集" : "新しいタグ"}</h2></div>
      <div className="tag-form"><label><span>名前</span><input aria-label="タグ名" value={name} disabled={pending} maxLength={40} placeholder="例：仕事、アイデア" onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) void save(); }}/></label>
        <div className="tag-color-field"><span>色</span><div className="tag-color-options">{ENTRY_COLORS.map((item) => <button type="button" key={item.value} className={color === item.value ? "selected" : ""} style={tagColorStyle(item.value)} title={item.label} aria-label={`${item.label}を選択`} aria-pressed={color === item.value} disabled={pending} onClick={() => setColor(item.value)}/>)}</div></div>
        <div className="tag-form-actions"><span className="tag-preview-label">プレビュー <TagChip tag={{ id: 0, name: name.trim() || "タグ", color }}/></span>{editing && <button type="button" disabled={pending} onClick={() => { setEditing(null); setName(""); setColor("blue"); }}>キャンセル</button>}<button type="button" className="primary-button" disabled={pending || !name.trim()} onClick={() => void save()}>{pending ? "保存中…" : editing ? "変更を保存" : "タグを追加"}</button></div>
      </div>
    </section>
    <section className="card tag-list"><div className="section-heading"><h2>すべてのタグ</h2><span>{tags.length} 件</span></div>
      {tags.length > 0 && <input className="tag-list-search" aria-label="タグ一覧を絞り込む" value={listQuery} placeholder="タグ名で絞り込む" onChange={(event) => setListQuery(event.target.value)}/>}
      {visibleTags.length ? <div className="tag-list-rows">{visibleTags.map((tag) => <div key={tag.id} className="tag-list-row"><TagChip tag={tag}/><div><button type="button" disabled={pending} onClick={() => { setEditing(tag); setName(tag.name); setColor(tag.color); setDeleting(null); }}>編集</button><button type="button" className="danger-text" disabled={pending} onClick={() => setDeleting(tag.id)}>削除</button></div>{deleting === tag.id && <div className="tag-delete-confirm" role="group" aria-label={`${tag.name}の削除確認`}><p>このタグを付けたタスク・メモからタグだけを外します。項目は残ります。</p><button type="button" disabled={pending} onClick={() => setDeleting(null)}>キャンセル</button><button type="button" className="danger-button" disabled={pending} onClick={() => void remove(tag.id)}>タグを削除</button></div>}</div>)}</div> : <p className="empty">{tags.length ? "一致するタグはありません。" : "タグはまだありません。"}</p>}
    </section>
  </div></main>;
}
