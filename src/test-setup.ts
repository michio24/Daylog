// 全テスト共通のセットアップ。個々のテストにあった
// `import "@testing-library/jest-dom/vitest"` と
// `// @vitest-environment jsdom` コメントの代わりになる。
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// globals を有効にしていないので RTL の自動クリーンアップは働かない。明示的に呼ぶ。
afterEach(() => {
  cleanup();
});
