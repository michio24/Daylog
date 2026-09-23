import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

// Prettier は入れていない。既存コードは1行に詰めた密なスタイルで書かれており、
// 自動整形をかけると全ファイルが書き換わって変更の差分が埋もれるため。
// ここで見るのは書式ではなく、型付き lint で拾える誤りに絞る。
export default tseslint.config(
  // Mock/ は初期デザインのモックで、アプリのビルドには入らない。
  { ignores: ["dist", "src-tauri", "artifacts", "node_modules", "Mock"] },
  js.configs.recommended,
  // 型情報を要する規則は tsconfig.json が見ている src 配下にだけ適用する。
  // ルート直下の設定ファイルは型プロジェクトに含まれていないため対象外。
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ["src/**/*.{ts,tsx}"]
  })),
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      globals: { ...globals.browser }
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Tauri コマンドは Promise を返すので、投げっぱなしを禁じるのが効く。
      // 既存コードは void / .catch() を徹底しており、この規則に沿っている。
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { attributes: false } }
      ],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      // `any` の漏れ（CalendarPanel の cells、MarkdownRenderer の remark ノード）は
      // 実在する型の負債だが、今回の変更範囲外。可視化のため warn にとどめ、
      // CI は error のみで落とす。解消したら error に上げること。
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unsafe-argument": "warn",
      "@typescript-eslint/no-unsafe-member-access": "warn",
      "@typescript-eslint/no-unsafe-call": "warn",
      "@typescript-eslint/no-unsafe-return": "warn",
      // `async () => 値` はテストのモックで多用される書き方で、誤りではない。
      "@typescript-eslint/require-await": "off"
    }
  },
  {
    // 設定ファイルは Node 環境で動き、型プロジェクトの外にある。
    files: ["*.config.{ts,js}", "eslint.config.js"],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      ...tseslint.configs.disableTypeChecked.languageOptions,
      globals: { ...globals.node }
    }
  },
  {
    files: ["src/**/*.test.{ts,tsx}", "src/test-setup.ts"],
    rules: {
      // テストのモックは戻り値の型が緩くなりがちなので、そこだけ許す。
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      // DOM 要素の型を読み手に示すための明示キャストを許す。
      "@typescript-eslint/no-unnecessary-type-assertion": "off"
    }
  }
);
