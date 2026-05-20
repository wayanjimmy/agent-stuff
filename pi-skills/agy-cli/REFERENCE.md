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

# Code review (piping)
git diff | agy --print "/reviewer Review for security issues" --dangerously-skip-permissions 2>&1
(timeout 300s)

# Research
agy --print "/researcher compare React Server Components vs Astro islands" --dangerously-skip-permissions 2>&1
(timeout 300s)

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

## Pre-flight Checklist

- [ ] Prefer piping over temp files?
- [ ] `@` file inside CWD (or using `--add-dir`)?
- [ ] Temp files in `.agy-tmp/` (not `/tmp/`)? Cleanup planned?
- [ ] `--dangerously-skip-permissions` included?
- [ ] Timeout set (300s standard, 600s complex)?

## See Also

- Docs: https://antigravity.google/docs/
- CLI features: https://antigravity.google/docs/cli-features