import type { CSSProperties } from "react";
import type { Tag } from "../types";
import { ENTRY_COLORS } from "./EntryIcon";

export function tagColorStyle(color: string): CSSProperties {
  const palette = ENTRY_COLORS.find((item) => item.value === color) ?? ENTRY_COLORS[0];
  return { "--tag-ink": palette.ink, "--tag-dark": palette.dark, "--tag-soft": palette.soft } as CSSProperties;
}

export function TagChip({ tag }: { tag: Tag }) {
  return <span className="tag-chip" style={tagColorStyle(tag.color)}><i aria-hidden="true"/>{tag.name}</span>;
}
