# ESLint baseline — 2026-10-19

## Scope and starting inventory

The baseline was measured against Security RC3 commit `edeb51c8703d0bc1d891c92cfb494cac47e67359` using the repository-owned Next.js 15 lint contract. The machine-readable inventory is retained with the release evidence as `dashboard-security-integrated-rc4-eslint-next15-inventory.json`.

- Affected files: 51
- Errors: 65
- Warnings: 66
- Fatal/configuration errors: 0

| Rule | Severity | Count | Resolution |
| --- | --- | ---: | --- |
| `@typescript-eslint/no-explicit-any` | error | 51 | Replaced with concrete domain types, `unknown`, and narrow runtime guards. |
| `react/no-unescaped-entities` | error | 13 | Escaped display text without changing rendered wording. |
| `@typescript-eslint/no-require-imports` | error | 1 | Replaced CommonJS loading with an ECMAScript import. |
| `@typescript-eslint/no-unused-vars` | warning | 52 | Removed dead bindings or rewrote safe-object projections without weakening redaction. |
| `@next/next/no-img-element` | warning | 9 | Replaced UI images with `next/image`; the DOM-only dimension probe uses `document.createElement("img")`. |
| `react-hooks/exhaustive-deps` | warning | 4 | Stabilized callbacks and corrected dependency lists. |
| `jsx-a11y/alt-text` | warning | 1 | Added meaningful alternative text. |

The affected files were concentrated in Dashboard pages/components and narrowly typed security helpers. The exact file-by-file error/warning counts are in the retained JSON inventory; it is the authoritative detailed inventory rather than a hand-maintained duplicate list.

## Accepted baseline

`npm run lint` now completes with zero errors and zero warnings. The command uses `--max-warnings 0`; no warning budget exists. The repository ESLint configuration extends the Next.js core-web-vitals and TypeScript rule sets. It does not disable security-critical rules and ignores only generated output, coverage/release evidence, and `next-env.d.ts`.

The behavior-preservation evidence consists of the standard production build plus all 526 Nexus, security, billing, Reader, publishing, content-worker, gateway, Firestore, and Storage regression checks. Any future lint warning or error fails local commit validation, release validation, and CI.
