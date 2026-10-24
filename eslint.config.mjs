import { globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

const eslintConfig = tseslint.config(
  ...tseslint.configs.recommended,
  globalIgnores([
    ".next/**",
    ".next-dev/**",
    "out/**",
    "legacy/**",
    "node_modules/**",
    "public/**",
    "next-env.d.ts",
  ]),
);

export default eslintConfig;
