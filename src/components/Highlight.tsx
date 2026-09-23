import { Fragment } from "react";

/** 検索語をそのまま正規表現に入れないためのエスケープ。 */
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 検索欄の入力から、抜粋の中で強調したい語を取り出す。演算子と記号は除く。 */
const termsOf = (query: string) =>
  query
    // JS の \s は全角スペース(U+3000)も含むので、別途指定する必要はない。
    .split(/[\s"]+/)
    .map((term) => term.replace(/^-/, ""))
    .filter((term) => term.length > 0 && term.toLowerCase() !== "or");

interface Props { text: string; query: string; }

/**
 * 抜粋の中の検索語を `<mark>` で囲む。
 *
 * HTML を組み立てずに要素の配列を返すので、記録の本文が markup として
 * 解釈されることはない。
 */
export function Highlight({ text, query }: Props) {
  const terms = termsOf(query);
  if (!terms.length) return <>{text}</>;
  const pattern = new RegExp(`(${terms.map(escapeRegExp).join("|")})`, "gi");
  const parts = text.split(pattern);
  return <>{parts.map((part, index) =>
    // split の奇数番目が捕捉したマッチ。
    index % 2 === 1 ? <mark key={index}>{part}</mark> : <Fragment key={index}>{part}</Fragment>
  )}</>;
}
