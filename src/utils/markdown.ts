type MarkdownNode = {
  type: string;
  value?: string;
  children?: MarkdownNode[];
};

// Treat a single newline in Markdown source as a visible line break.
export const remarkDisplayBreaks = () => (tree: MarkdownNode) => {
  const transform = (node: MarkdownNode) => {
    if (!node.children) return;
    node.children = node.children.flatMap((child) => {
      if (child.type !== "text" || !child.value?.includes("\n")) {
        transform(child);
        return [child];
      }
      return child.value.split("\n").flatMap((value, index) => [
        ...(index > 0 ? [{ type: "break" }] : []),
        ...(value ? [{ type: "text", value }] : [])
      ]);
    });
  };
  transform(tree);
};

export const toggleMarkdownTask = (markdown: string, lineNumber: number, checked: boolean) => {
  const lines = markdown.split("\n");
  const lineIndex = lineNumber - 1;
  if (!lines[lineIndex]) return markdown;
  lines[lineIndex] = lines[lineIndex].replace(/^(\s*(?:[-+*]|\d+[.)])\s+)\[[ xX]\]/, `$1[${checked ? "x" : " "}]`);
  return lines.join("\n");
};
