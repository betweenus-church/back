// ESLint 설정 (TypeScript 권장 규칙 + Prettier와 충돌하는 규칙 끄기)
import { defineConfig, globalIgnores } from "eslint/config";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier/flat";
import globals from "globals";

export default defineConfig([
  globalIgnores(["node_modules/**", "dist/**", "dist-production/**", ".server/**", ".test-data/**"]),
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,js,mjs}"],
    languageOptions: { globals: globals.node },
  },
  prettier,
]);
