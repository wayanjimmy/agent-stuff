# Plan: Set Up `oxfmt` (Oxc Formatter)

## 1. Overview

`oxfmt` is Oxc's formatter for JS/TS and related web formats. It's designed to be fast and Prettier-compatible, with built-in sorting features and CI/editor support.

**Philosophy**: Adopt minimal setup first (`fmt` + `fmt:check`), then add config only for real needs.

---

## 2. Milestones and Deliverables

| Milestone                      | Deliverables                                                                |
| ------------------------------ | --------------------------------------------------------------------------- |
| **M1: Baseline install**       | `oxfmt` added as dev dependency; `package.json` scripts: `fmt`, `fmt:check` |
| **M2: Minimal config**         | `.oxfmtrc.json` committed (only required options)                           |
| **M3: Ignore policy**          | `ignorePatterns` in `.oxfmtrc` and/or `--ignore-path` usage documented      |
| **M4: CI enforcement**         | CI job running `fmt:check` (GitHub Actions example)                         |
| **M5: Editor enablement**      | Team editor defaults documented (`oxc.oxc-vscode`, format-on-save)          |
| **M6: Verification & rollout** | One-time reformat PR merged; formatter checks required on PRs               |

---

## 3. Implementation Steps

### Phase A: Install & Scripts (KISS)

```bash
# npm
npm add -D oxfmt

# pnpm (recommended)
pnpm add -D oxfmt
```

```json
// package.json
{
  "scripts": {
    "fmt": "oxfmt",
    "fmt:check": "oxfmt --check"
  }
}
```

```bash
# Verify
npm run fmt
npm run fmt:check
```

### Phase B: Minimal Config

```json
// .oxfmtrc.json
{
  "$schema": "./node_modules/oxfmt/configuration_schema.json"
}
```

**YAGNI**: Only add options like `printWidth` if you have a proven need (e.g., migrating from Prettier with width 80).

### Phase C: Ignore Rules

Use `ignorePatterns` in `.oxfmtrc` for formatter-specific ignores. Note:

- `.gitignore`-ignored files CAN still be formatted if passed explicitly
- `ignorePatterns` entries CANNOT be formatted even if explicitly passed

### Phase D: CI Integration

```yaml
# .github/workflows/ci.yml (minimal)
- name: Check formatting
  run: pnpm run fmt:check
```

### Phase E: Editor Setup

**VS Code/Cursor:**

- Extension: `oxc.oxc-vscode`
- Enable format-on-save

**Neovim:** Use `conform.nvim` with oxfmt mapping

---

## 4. Risk Assessment & Mitigation

| Risk                                                             | Impact                | Mitigation                                                       |
| ---------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------- |
| Alpha status                                                     | Behavior changes      | Pin version in lockfile; upgrade intentionally                   |
| Unsupported Prettier plugins                                     | Migration breakage    | Run `oxfmt --migrate prettier`; audit unsupported features first |
| Default `printWidth: 100`                                        | Large formatting diff | Set `printWidth: 80` during migration if needed                  |
| Config limitations (no `package.json` config, no nested configs) | Monorepo confusion    | Centralize `.oxfmtrc` at repo root                               |
| Ignore semantics                                                 | CI/local mismatch     | Codify ignore policy in docs                                     |

---

## 5. Test Strategy

| Test                  | How                                                             |
| --------------------- | --------------------------------------------------------------- |
| **Local smoke**       | Run `fmt` → files modified; `fmt:check` → success on clean tree |
| **CLI behavior**      | Verify `--list-different` and `--no-error-on-unmatched-pattern` |
| **Ignore rules**      | Add file to `ignorePatterns`; verify it's never formatted       |
| **CI validation**     | PR with bad formatting → CI fails; fix → CI passes              |
| **Editor validation** | Format-on-save uses project config                              |

---

## 6. KISS / YAGNI Compliance

### Start With:

- Dependency install
- `fmt` / `fmt:check` scripts
- CI check

### Skip Initially:

- Import sorting tweaks
- Tailwind sorting config
- Autofix bots
- Complex pre-commit hooks

### Add Only When Proven:

- Style parity options (`printWidth`, quotes, semicolons)
- Repo-specific ignore patterns

**One Source of Truth:** Formatter behavior in `.oxfmtrc`; CI uses same command as local.

---

## References

Public codebase examples: sanity-io/next-sanity, actualbudget/actual, Comfy-Org/ComfyUI_frontend, monkeytypegame/monkeytype all use `.oxfmtrc.json` with minimal configs.

Documentation: https://oxc.rs/docs/guide/usage/formatter
