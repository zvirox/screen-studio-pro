import js from "@eslint/js";
import tseslint from "typescript-eslint";

// AGENTS §3: code style enforced from commit one; CI mirrors these commands.
export default tseslint.config(
  {
    ignores: ["dist/", "src-tauri/", "node_modules/"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
);
