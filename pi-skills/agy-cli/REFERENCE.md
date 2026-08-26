# Antigravity CLI (agy) Reference
Detailed reference for Google's Antigravity CLI (`agy`). See [SKILL.md](SKILL.md) for the quick guide.
## Examples

```bash
# Analyze project
agy --print "Analyze this codebase" --dangerously-skip-permissions 2>&1
(timeout 300s)

# Read file
agy --print "@src/main.go Explain the entry point" --dangerously-skip-permissions 2>&1
(timeout 300s)

# Code review with subagents
git diff | agy --print "Review the latest changes for bugs. Spin up a Verifier subagent using Gemini 3.7 Flash (Low) to build the project and run tests. Pass any failures to the main agent to fix. Once passing, spin up a Reviewer subagent using Gemini 3.7 Flash (Medium) to review the code for quality and best practices. Fix any flagged issues and repeat until both subagents are satisfied." --dangerously-skip-permissions 2>&1
(timeout 600s)

# Generate code
agy --print "Create a Go retry function for DB connections" --dangerously-skip-permissions 2>&1
(timeout 300s)
```

## Configuration Files

- `AGENTS.md` — Project context (read automatically)
- `.geminiignore` — Exclude files from AI context
- `~/.gemini/antigravity-cli/settings.json` — User settings (permissions, model)
- `~/.gemini/commands/*.toml` — Custom slash commands

## Plugins

```bash
agy plugin import     # Import plugins
agy plugin list       # List installed plugins
agy plugin install <name>
agy plugin validate [path]
```

Staged under `~/.gemini/antigravity-cli/plugins/<name>/`.

## Running as a Herdr tab

When `HERDR_ENV=1`, prefer a named Herdr tab over print mode (see [SKILL.md](SKILL.md) for the full flow):

```bash
herdr tab create --label "agy: review-auth" --cwd "$PWD" --no-focus
herdr agent start review-auth --kind agy --pane <pane-id> -- --dangerously-skip-permissions
herdr agent prompt review-auth "Review the latest diff for bugs..." --wait --timeout 600000
herdr agent read review-auth --source recent-unwrapped --lines 120
```

Notes:

- Reuse a live `agy: <task>` tab for follow-ups; one tab per task.
- Prompt guidance (subagent specs, stdin piping, `.agy-tmp/`) is prompt content sent via `agent prompt`, not shell flags.
- `--timeout` values move from seconds (print mode) to milliseconds (`agent prompt --timeout`).
- Truncated reads (alternate screen): have agy write its full response to `.agy-tmp/<file>.md` and reply with the path.
- Fallback to `--print` mode if not in Herdr, or if tab/agent creation fails after one retry.

## Pre-flight Checklist

- [ ] Prefer piping over temp files?
- [ ] `@` file inside CWD (or using `--add-dir`)?
- [ ] Temp files in `.agy-tmp/` (not `/tmp/`)? Cleanup planned?
- [ ] `--dangerously-skip-permissions` included?
- [ ] Timeout set (300s standard, 600s complex; ms on `agent prompt`)?
- [ ] Inside Herdr (`HERDR_ENV=1`)? Prefer a labeled `agy: <task>` tab over print mode.

## See Also

- Docs: https://antigravity.google/docs/
- CLI features: https://antigravity.google/docs/cli-features