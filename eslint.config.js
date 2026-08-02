import sonarjs from "eslint-plugin-sonarjs";
import tseslint from "typescript-eslint";

// Keep typed linting bounded to the catalog tooling TypeScript program.
const typedFiles = ["scripts/**/*.ts"];

export default tseslint.config(
  {
    // Generated output, vendored dependencies, and independently configured
    // simulator services are outside the root catalog tooling program.
    ignores: [
      "node_modules/**",
      "dist/**",
      "build/**",
      "battles/**/services/**",
      "**/*.spec.ts",
      "**/*.test.ts",
    ],
  },
  ...tseslint.configs.strict,
  ...tseslint.configs.stylistic,
  sonarjs.configs.recommended,
  {
    files: typedFiles,
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        // This repository has one root TypeScript program for catalog scripts.
        // Explicit project binding makes typed rules fail closed instead of
        // silently running without type information.
        project: ["./tsconfig.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-assertions": [
        "error",
        { assertionStyle: "never" },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/ban-ts-comment": "error",
      "@typescript-eslint/no-floating-promises": "warn",
      "@typescript-eslint/no-misused-promises": "warn",
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/no-base-to-string": "error",
      // Intentional fire-and-forget promises must be marked with `void`.
      "sonarjs/void-use": "off",
    },
  },
);
