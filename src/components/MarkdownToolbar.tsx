import type { RefObject } from "react";

interface Props {
  textarea: RefObject<HTMLTextAreaElement>;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  onPickFiles: (imageOnly: boolean) => void;
}

type Edit = { before: string; after?: string; placeholder?: string; linePrefix?: string };

export function applyMarkdownEdit(textarea: HTMLTextAreaElement, value: string, edit: Edit) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  let selected = value.slice(start, end);
  if (edit.linePrefix !== undefined) {
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const lineEnd = value.indexOf("\n", end);
    const rangeEnd = lineEnd < 0 ? value.length : lineEnd;
    selected = value.slice(lineStart, rangeEnd).split("\n").map((line) => `${edit.linePrefix}${line}`).join("\n");
    return { value: value.slice(0, lineStart) + selected + value.slice(rangeEnd), start: lineStart, end: lineStart + selected.length };
  }
  const content = selected || edit.placeholder || "";
  const after = edit.after || "";
  const replacement = edit.before + content + after;
  return { value: value.slice(0, start) + replacement + value.slice(end), start: start + edit.before.length, end: start + edit.before.length + content.length };
}

export function MarkdownToolbar({ textarea, value, disabled, onChange, onPickFiles }: Props) {
  const apply = (edit: Edit) => {
    if (!textarea.current) return;
    const result = applyMarkdownEdit(textarea.current, value, edit);
    onChange(result.value);
    requestAnimationFrame(() => { textarea.current?.focus(); textarea.current?.setSelectionRange(result.start, result.end); });
  };
  const tools: Array<[string, string, Edit]> = [
    ["H", "見出し", { before: "", linePrefix: "## " }], ["B", "太字", { before: "**", after: "**", placeholder: "太字" }], ["I", "斜体", { before: "_", after: "_", placeholder: "斜体" }],
    ["S", "打ち消し線", { before: "~~", after: "~~", placeholder: "打ち消し" }], ["↗", "リンク", { before: "[", after: "](https://)", placeholder: "リンク" }], ["•", "箇条書き", { before: "", linePrefix: "- " }],
    ["1.", "番号付きリスト", { before: "", linePrefix: "1. " }], ["☐", "チェックリスト", { before: "", linePrefix: "- [ ] " }], ["❯", "引用", { before: "", linePrefix: "> " }],
    ["`", "インラインコード", { before: "`", after: "`", placeholder: "code" }], ["{ }", "コードブロック", { before: "```\n", after: "\n```", placeholder: "code" }],
    ["▦", "表", { before: "| 項目 | 内容 |\n| --- | --- |\n| A | B |" }], ["∑", "数式", { before: "$", after: "$", placeholder: "x^2" }],
    ["◇", "Mermaid", { before: "```mermaid\ngraph TD\n  A --> B", after: "\n```" }]
  ];
  return <div className="markdown-toolbar" role="toolbar" aria-label="Markdown書式">
    {tools.map(([label, title, edit]) => <button type="button" key={title} title={title} aria-label={title} disabled={disabled} onClick={() => apply(edit)}>{label}</button>)}
    <span className="toolbar-divider"/>
    <button type="button" disabled={disabled} onClick={() => onPickFiles(true)}>画像</button>
    <button type="button" disabled={disabled} onClick={() => onPickFiles(false)}>添付</button>
  </div>;
}
