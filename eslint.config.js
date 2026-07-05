import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**", "eslint.config.js"]
  },
  js.configs.recommended,
  {
    files: ["src/**/*.ts", "test/**/*.ts", "*.ts"],
    extends: [...tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.eslint.json",
        tsconfigRootDir: import.meta.dirname
      }
    },
    files: ["src/**/*.ts", "test/**/*.ts", "*.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "error"
    }
  }
);
