import { Children, cloneElement, isValidElement, useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type InputHTMLAttributes, type ReactNode } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { api } from "../services/api";
import { remarkDisplayBreaks } from "../utils/markdown";

interface Props {
  markdown: string;
  compact?: boolean;
  interactive?: boolean;
  checkboxDisabled?: boolean;
  onTaskToggle?: (lineNumber: number, checked: boolean) => void;
  onError?: (message: string) => void;
}

const attachmentId = (url?: string) => {
  const value = url?.match(/^daylog-attachment:([0-9a-f-]{36})$/i)?.[1];
  return value || null;
};

const textContent = (value: ReactNode): string => Children.toArray(value).map((child) => {
  if (typeof child === "string" || typeof child === "number") return String(child);
  return isValidElement<{ children?: ReactNode }>(child) ? textContent(child.props.children) : "";
}).join("");

function ExternalImage({ src, alt, interactive }: { src: string; alt: string; interactive: boolean }) {
  const [allowed, setAllowed] = useState(false);
  const [failed, setFailed] = useState(false);
  if (failed) return <span className="markdown-image-error">外部画像を読み込めませんでした</span>;
  if (!allowed) return <span className="external-image-placeholder"><span>{alt || "外部画像"}</span>{interactive && <button type="button" onClick={() => setAllowed(true)}>画像を読み込む</button>}</span>;
  return <img src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)}/>;
}

function LocalImage({ id, alt }: { id: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className="markdown-image-error">添付画像が見つかりません</span>;
  return <img src={convertFileSrc(id, "daylog-attachment")} alt={alt} loading="lazy" onError={() => setFailed(true)}/>;
}

function LocalAttachmentLink({ id, children, interactive, onError }: { id: string; children: ReactNode; interactive: boolean; onError?: (message: string) => void }) {
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    if (!interactive) return;
    let cancelled = false;
    void api.getAttachment(id).catch(() => { if (!cancelled) setMissing(true); });
    return () => { cancelled = true; };
  }, [id, interactive]);
  if (missing) return <span className="attachment-missing">{children}（見つかりません）</span>;
  if (!interactive) return <span className="markdown-link attachment-link">{children}</span>;
  return <button type="button" className="markdown-link attachment-link" onClick={() => {
    if (window.confirm("添付ファイルを開きますか？")) void api.openAttachment(id).catch((error) => onError?.(String(error)));
  }}>{children}</button>;
}

function CodeBlock({ children, compact, onError }: { children: ReactNode; compact: boolean; onError?: (message: string) => void }) {
  const child = Children.toArray(children)[0];
  const className = isValidElement<{ className?: string }>(child) ? child.props.className || "" : "";
  const language = className.match(/language-([\w-]+)/)?.[1] || "text";
  const code = textContent(child).replace(/\n$/, "");
  if (language === "mermaid") return <MermaidBlock code={code} compact={compact} onError={onError}/>;
  return <div className="code-block"><div className="code-block-heading"><span>{language}</span>{!compact && <button type="button" onClick={() => void navigator.clipboard.writeText(code).catch((error) => onError?.(String(error)))}>コピー</button>}</div><pre>{children}</pre></div>;
}

function MermaidBlock({ code, compact, onError }: { code: string; compact: boolean; onError?: (message: string) => void }) {
  const reactId = useId();
  const root = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(typeof IntersectionObserver === "undefined");
  const [themeKey, setThemeKey] = useState("");
  const [svg, setSvg] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (visible || !root.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) setVisible(true); });
    observer.observe(root.current);
    return () => observer.disconnect();
  }, [visible]);
  useEffect(() => {
    const shell = root.current?.closest<HTMLElement>(".app-shell");
    const updateTheme = () => setThemeKey(shell?.dataset.theme || "default");
    updateTheme();
    if (!shell) return;
    const observer = new MutationObserver(updateTheme);
    observer.observe(shell, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible || compact || !themeKey || !root.current) return;
    let cancelled = false;
    const themeRoot = root.current.closest<HTMLElement>(".app-shell") || root.current;
    const styles = getComputedStyle(themeRoot);
    const color = (name: string) => styles.getPropertyValue(name).trim();
    void import("mermaid").then(async ({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: "base",
        fontFamily: styles.fontFamily,
        themeVariables: {
          background: color("--surface-3"),
          primaryColor: color("--accent-soft"),
          primaryTextColor: color("--ink"),
          primaryBorderColor: color("--accent"),
          secondaryColor: color("--warm-soft"),
          secondaryTextColor: color("--ink"),
          secondaryBorderColor: color("--warm"),
          tertiaryColor: color("--surface"),
          tertiaryTextColor: color("--ink"),
          tertiaryBorderColor: color("--line-2"),
          lineColor: color("--ink-2"),
          textColor: color("--ink"),
          mainBkg: color("--accent-soft"),
          nodeBorder: color("--accent"),
          clusterBkg: color("--surface"),
          clusterBorder: color("--line-2"),
          edgeLabelBackground: color("--surface-3"),
          titleColor: color("--ink"),
          actorBkg: color("--surface"),
          actorBorder: color("--accent"),
          actorTextColor: color("--ink"),
          actorLineColor: color("--ink-2"),
          signalColor: color("--ink-2"),
          signalTextColor: color("--ink"),
          labelBoxBkgColor: color("--accent-soft"),
          labelBoxBorderColor: color("--accent"),
          labelTextColor: color("--ink"),
          loopTextColor: color("--ink"),
          noteBkgColor: color("--warm-soft"),
          noteBorderColor: color("--warm"),
          noteTextColor: color("--ink"),
          activationBkgColor: color("--accent-soft"),
          activationBorderColor: color("--accent")
        }
      });
      const result = await mermaid.render(`daylog-mermaid-${reactId.replace(/:/g, "")}`, code);
      if (!cancelled) { setError(""); setSvg(result.svg); }
    }).catch((reason) => { if (!cancelled) { const message = String(reason); setError(message); onError?.(`Mermaidを表示できませんでした: ${message}`); } });
    return () => { cancelled = true; };
  }, [code, compact, onError, reactId, themeKey, visible]);
  if (compact) return <div className="mermaid-compact">◇ Mermaid diagram</div>;
  return <div ref={root} className="mermaid-block">{error ? <><div><p>図を表示できませんでした。</p><small>{error}</small></div><pre><code>{code}</code></pre></> : svg ? <div dangerouslySetInnerHTML={{ __html: svg }}/> : <span>図を描画しています…</span>}</div>;
}

export function MarkdownRenderer({ markdown, compact = false, interactive = false, checkboxDisabled = true, onTaskToggle, onError }: Props) {
  const components = useMemo(() => ({
    li: ({ node, children, ...props }: any) => <li {...props}>{Children.map(children, (child) => {
      if (!isValidElement<InputHTMLAttributes<HTMLInputElement>>(child) || child.type !== "input" || child.props.type !== "checkbox" || !node?.position?.start.line || !onTaskToggle) return child;
      return cloneElement(child, { disabled: checkboxDisabled, onChange: (event: ChangeEvent<HTMLInputElement>) => onTaskToggle(node.position.start.line, event.target.checked) });
    })}</li>,
    pre: ({ children }: { children?: ReactNode }) => <CodeBlock compact={compact} onError={onError}>{children}</CodeBlock>,
    a: ({ href, children }: { href?: string; children?: ReactNode }) => {
      const id = attachmentId(href);
      if (id) return <LocalAttachmentLink id={id} interactive={interactive} onError={onError}>{children}</LocalAttachmentLink>;
      if (!href?.startsWith("https://") && !href?.startsWith("http://")) return <span>{children}</span>;
      return interactive ? <a href={href} onClick={(event) => { event.preventDefault(); if (window.confirm(`外部リンクを開きますか？\n${href}`)) void openUrl(href).catch((error) => onError?.(String(error))); }}>{children}</a> : <span className="markdown-link">{children}</span>;
    },
    img: ({ src, alt = "" }: { src?: string; alt?: string }) => {
      const id = attachmentId(src);
      if (id) return <LocalImage id={id} alt={alt}/>;
      if (src?.startsWith("https://")) return <ExternalImage src={src} alt={alt} interactive={interactive}/>;
      return <span className="markdown-image-error">画像を表示できません</span>;
    }
  }), [checkboxDisabled, compact, interactive, onError, onTaskToggle]);
  return <ReactMarkdown
    remarkPlugins={[remarkGfm, remarkMath, remarkDisplayBreaks]}
    rehypePlugins={[rehypeKatex, [rehypeHighlight, { detect: false, plainText: ["mermaid"] }]]}
    components={components}
    skipHtml
    urlTransform={(url) => /^(?:https?:\/\/|daylog-attachment:)/i.test(url) ? url : ""}
  >{markdown}</ReactMarkdown>;
}
