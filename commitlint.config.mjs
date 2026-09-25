export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [
      2,
      "always",
      ["feat", "fix", "docs", "style", "refactor", "perf", "test", "build", "ci", "chore", "revert"],
    ],
    // Descricoes em portugues mantem maiusculas e acentos, entao case fica livre.
    "subject-case": [0],
    "subject-full-stop": [2, "never", "."],
    "body-max-line-length": [2, "always", 100],
    "footer-max-line-length": [0],
  },
};
