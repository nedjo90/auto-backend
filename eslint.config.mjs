import cds from "@sap/cds/eslint.config.mjs";
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  ...cds.recommended,
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ["node_modules/", "@cds-models/", "gen/", "dist/"],
  },
];
