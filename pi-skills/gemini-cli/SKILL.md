---
name: gemini-cli
description: Use Google's Gemini CLI tool for AI-powered code analysis, file editing, and shell assistance in agent workflows.
---

# Gemini CLI Skill

Skill for using Google's Gemini CLI tool effectively in agent workflows.

## Overview

Gemini CLI is an open-source AI-powered terminal assistant that brings Gemini models directly to the command line. It can analyze codebases, edit files, run shell commands, and provide intelligent assistance.

## Installation & Availability

Gemini CLI is pre-installed in this environment:
- **Path:** `~/.local/share/mise/installs/node/25.8.1/bin/gemini`

## Essential Usage Patterns

### Headless Mode with Streaming Output

**Always use this pattern** for agent workflows (always include `--raw-output --accept-raw-output-risk`):

```bash
gemini -p "your prompt here" --approval-mode yolo --output-format stream-json --raw-output --accept-raw-output-risk
```

**Key flags:**
- `-p, --prompt` - Run in non-interactive mode with the given prompt
- `--approval-mode yolo` - Auto-approve all tool calls (YOLO mode)
- `--output-format stream-json` - Streaming JSON events for real-time progress
- `--raw-output --accept-raw-output-risk` - Raw unsanitized output (always use with stream-json)

### Approval Modes
- `yolo` - Auto-approve all tool calls (default for this skill)
- `auto_edit` - Auto-approve only file edit tools
- `plan` - Read-only mode (no changes)

## Custom Slash Commands

Custom commands are defined in `~/.gemini/commands/*.toml`. They work in **both interactive and headless mode** — pass the slash command as part of the `-p` prompt.

### `/reviewer` — Code Review

Defined in `~/.gemini/commands/reviewer.toml`.

Thorough code reviewer focusing on correctness, security, edge cases, and actionable feedback with minimal diffs.

```bash
gemini -p "/reviewer review the latest commit" --approval-mode yolo --output-format stream-json --raw-output --accept-raw-output-risk
```

**When to use:** Whenever the user asks Gemini to review code, check a PR, audit for bugs/security, or provide code feedback.

### `/researcher` — Web Research

Defined in `~/.gemini/commands/researcher.toml`.

Research specialist with access to `google_web_search` tool for web searching and deep analysis.

```bash
gemini -p "/researcher compare React Server Components vs Astro islands" --approval-mode yolo --output-format stream-json --raw-output --accept-raw-output-risk
```

**When to use:** Whenever the user asks Gemini to research a topic, look up documentation, find best practices, compare technologies, or gather information from the web.

## Common Commands Reference

### File Operations (`@` syntax)

```bash
# Include file in prompt
@src/components/UserProfile.tsx Explain this component

# Include multiple files
@file1.go @file2.go Compare these files

# Include directory
@src/utils/ Check for deprecated APIs
```

### Shell Commands (`!` syntax)

```bash
# Execute shell command
!ls -la
!git status

# Toggle shell mode (type ! alone)
!
```

## Agent Usage Guidelines

When the user asks to "use Gemini":

1. **Always use headless mode with streaming:** `--approval-mode yolo --output-format stream-json --raw-output --accept-raw-output-risk`
2. **Use `usePTY=true`** in bash execution for real-time streaming view
3. **Use appropriate timeout:** Default 180s, up to 420s for complex tasks (Gemini typically takes 2-6 minutes)
4. **Route to custom slash commands when applicable:**
   - **Code review tasks** (review PR, audit code, check for bugs/security) → prepend `/reviewer` to the prompt
   - **Research tasks** (look up docs, compare tech, find best practices, web search) → prepend `/researcher` to the prompt

## Examples

### Analyze Project Structure
```bash
gemini -p "Analyze this codebase. What is the project about? What tech stack does it use?" --approval-mode yolo --output-format stream-json --raw-output --accept-raw-output-risk
```

### Read and Explain File
```bash
gemini -p "Read @cmd/stitchdb/main.go and explain the entry point" --approval-mode yolo --output-format stream-json --raw-output --accept-raw-output-risk
```

### Search for Patterns
```bash
gemini -p "Find all TODO comments in the Go source files" --approval-mode yolo --output-format stream-json --raw-output --accept-raw-output-risk
```

### Compare Files
```bash
gemini -p "Compare @file1.go and @file2.go and highlight differences" --approval-mode yolo --output-format stream-json --raw-output --accept-raw-output-risk
```

### Generate Code
```bash
gemini -p "Create a new Go function that handles database connection retries" --approval-mode yolo --output-format stream-json --raw-output --accept-raw-output-risk
```

## Configuration Files

Gemini CLI respects these configuration files in the project:

- `GEMINI.md` - Project-specific context and instructions
- `.geminiignore` - Files to exclude from AI context (like `.gitignore`)
- `.gemini/settings.json` - Project settings
- `~/.gemini/settings.json` - User settings

## Important Notes

- **Git-aware:** Respects `.gitignore` by default (won't read `node_modules/`, `.env`, etc.)
- **Safety:** Always shows diff before file modifications (unless in YOLO mode)
- **Sessions:** Auto-saves conversations; resume with `/resume`
- **Quota:** Check usage with `/stats model`
- **Extensions:** Can install extensions via `gemini extensions install <url>`

## Version & Help

```bash
# Check version
gemini --version

# Show all options
gemini --help

# List available models
gemini /model set
```

## See Also

- Official docs: https://geminicli.com/docs/
- GitHub: https://github.com/google-gemini/gemini-cli
- Extensions: https://geminicli.com/extensions/
