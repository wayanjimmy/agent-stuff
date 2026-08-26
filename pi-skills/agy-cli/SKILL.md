---
name: agy-cli
description: |-
  Delegate work to Google's Antigravity CLI (agy) via non-interactive print mode for code analysis, reviews, and web research.
  USE FOR: "use agy", "ask agy", "have agy", "get agy to", "run agy".
  DO NOT USE FOR: general coding questions, tasks you can handle directly, requests without "agy" or "antigravity".
---

# Antigravity CLI (agy)

Google's AI terminal assistant.

## Preferred: run as a Herdr tab

If running inside a Herdr-managed pane, prefer a dedicated, named tab over headless print mode:

```bash
test "${HERDR_ENV:-}" = 1 || echo "not in herdr"
```

When the check passes:

1. Create a labeled tab in the current workspace and cwd (skip if a live agy agent for the same task already exists — `herdr agent list`):
   ```bash
   herdr tab create --label "agy: <short-task-slug>" --cwd "$PWD" --no-focus
   # IDs from JSON: .result.tab.tab_id, .result.root_pane.pane_id
   ```
2. Start agy in that tab's root pane and name it after the task:
   ```bash
   herdr agent start <task-slug> --kind agy --pane <pane-id> -- --dangerously-skip-permissions
   ```
3. Submit work and read the result:
   ```bash
   herdr agent prompt <task-slug> "<prompt>" --wait --timeout 600000
   herdr agent read <task-slug> --source recent-unwrapped --lines 120
   ```

Agent names must match `[a-z][a-z0-9_-]{0,31}` and be unique among live agents. Use one tab per task, named `agy: <task>` — do not spawn a new tab for follow-ups on the same task.

If `agent read` output looks truncated (agy may use the alternate screen), ask agy to write its full response as Markdown in `.agy-tmp/` and reply with only the file path, then read that file. Use this as a fallback only.

Timeout discipline carries over to `agent prompt --timeout`: **300000ms** standard, **120000ms** simple, **600000ms** complex. If the agent becomes `blocked` (approval/question UI), inspect with `agent get` / `agent read` and ask the user before answering.

## Fallback: headless print mode

Use when not inside Herdr, or when `tab create` / `agent start` fails after one retry:

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
3. For review tasks, instruct agy to spin up verifier and reviewer subagents with explicit model and thinking-level specs (e.g. verifier using Gemini 3.7 Flash Low, reviewer using Gemini 3.7 Flash Medium).
4. For external files use `--add-dir <path>`. Temp files go in `.agy-tmp/`.
5. Include timeout and `2>&1` in all calls.

## Examples

```bash
# Code review with subagents
agy --print "Review the latest changes for bugs. Spin up a Verifier subagent using Gemini 3.7 Flash (Low) to build the project and run tests. Pass any failures to the main agent to fix. Once passing, spin up a Reviewer subagent using Gemini 3.7 Flash (Medium) to review the code for quality and best practices. Fix any flagged issues and repeat until both subagents are satisfied." --dangerously-skip-permissions 2>&1


# Read file
agy --print "@src/main.go Explain entry point" --dangerously-skip-permissions 2>&1
```

See [REFERENCE.md](REFERENCE.md) for config, plugins, and troubleshooting.
