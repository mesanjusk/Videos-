import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

const eslintConfig = [
  {
    // `next build` scopes its own lint to the source tree; the standalone `npm run lint` script did
    // not, so it reported thousands of problems in build output and generated files — enough noise
    // to make the script useless and, in `npm run verify`, unrunnable. These are all generated:
    // linting them tells us nothing and fixing them is not possible.
    ignores: [
      ".next/**",
      "out/**",
      "build/**",
      "node_modules/**",
      "storage/**",
      "next-env.d.ts",
      "package-lock.json",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
];

export default eslintConfig;
