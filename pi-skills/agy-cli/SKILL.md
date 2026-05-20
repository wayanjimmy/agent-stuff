---
name: agy-cli
description: |-
  Delegate work to Google's Antigravity CLI (agy) via non-interactive print mode for code analysis, reviews, and web research.
  USE FOR: "use agy", "ask agy", "have agy", "get agy to", "run agy".
  DO NOT USE FOR: general coding questions, tasks you can handle directly, requests without "agy" or "antigravity".
---

# Antigravity CLI (agy)

Google's AI terminal assistant.

## Usage

```bash
agy --print "prompt" --dangerously-skip-permissions 2>&1
```

Timeout: **300s** standard, **120s** simple, **600s** complex.

## Key Flags

| Flag | Description |
|------|-------------|
| `--print, -p` | Non-interactive print mode |
| `--dangerously-skip-permissions` | Auto-approve all (required for headless) |
| `--add-dir <path>` | Add directory to workspace |
| `--sandbox` | OS-level sandbox (restricts shell, not writes) |
| `--continue, -c` | Continue most recent conversation |

## Steps

1. Prefer piping ephemeral data via stdin over temp files.
2. Always use `--dangerously-skip-permissions` for non-interactive calls.
3. Route review tasks to `/reviewer`, research to `/researcher` (both read-only).
4. For external files use `--add-dir <path>`. Temp files go in `.agy-tmp/`.
5. Include timeout and `2>&1` in all calls.

## Examples

```bash
# Code review (piping)
git diff | agy --print "/reviewer Review for bugs" --dangerously-skip-permissions 2>&1

# Research
agy --print "/researcher compare X vs Y" --dangerously-skip-permissions 2>&1

# Read file
agy --print "@src/main.go Explain entry point" --dangerously-skip-permissions 2>&1
```

See [REFERENCE.md](REFERENCE.md) for config, plugins, and troubleshooting.
