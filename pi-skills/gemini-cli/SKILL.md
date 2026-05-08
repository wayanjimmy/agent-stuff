---
name: gemini-cli
description: |
  USE THIS SKILL when the user explicitly asks to "use Gemini", "ask Gemini", "have Gemini", 
  "get Gemini to", or "run Gemini" for any task. This skill delegates work to Google's Gemini 
  CLI tool via interactive_shell for AI-powered code analysis, file editing, shell assistance, 
  code reviews, and web research. Do NOT use this skill for general tasks you can handle directly.
---

# Gemini CLI Skill

Skill for using Google's Gemini CLI tool effectively in agent workflows.

## Overview

Gemini CLI is an open-source AI-powered terminal assistant that brings Gemini models directly to the command line. It can analyze codebases, edit files, run shell commands, and provide intelligent assistance.

## When to Use This Skill

**ACTIVATE this skill when the user says things like:**
- "Use Gemini to..."
- "Ask Gemini to..."
- "Have Gemini..."
- "Get Gemini to..."
- "Run Gemini for..."
- "Let Gemini..."

**DO NOT use this skill when:**
- The user asks you directly to perform a task (use your own capabilities)
- The request is a general coding/editing task you can handle with standard tools
- No explicit mention of "Gemini" or delegation to another AI agent

## Installation & Availability

Gemini CLI should be available in the system PATH. To find the path:
```bash
which gemini
```

## Essential Usage Patterns

Run Gemini CLI as a regular bash command with a timeout:

```bash
$ gemini -p "your prompt here" --approval-mode yolo 2>&1
(timeout 300s)
```

**Timeout Guidelines:**
- **Minimum: 240s (4 minutes)** - Absolute minimum for any Gemini command
- **Standard: 300-480s (5-8 minutes)** - Most code analysis and file operations
- **Complex tasks: 600s (10 minutes)** - Large file generation, complex reviews, or multi-step operations

**Key flags:**
- `-p, --prompt` - Run in non-interactive mode with the given prompt
- `--approval-mode yolo` - Auto-approve all tool calls (YOLO mode)
- `--output-format json` - Single JSON object output (for parsing)
- `--output-format stream-json` - Streaming JSON events (for real-time progress)
- `--raw-output --accept-raw-output-risk` - Raw unsanitized output

### Approval Modes
- `yolo` - Auto-approve all tool calls. **Warning:** Use with caution as this allows the model to execute arbitrary shell commands and file edits without manual confirmation. Only use in trusted environments.
- `auto_edit` - Auto-approve only file edit tools
- `plan` - Read-only mode (no changes)

## Custom Slash Commands

Custom commands are defined in `~/.gemini/commands/*.toml`. They work by passing the slash command as part of the `-p` prompt.

### `/reviewer` — Code Review

Defined in `~/.gemini/commands/reviewer.toml`.

Thorough code reviewer focusing on correctness, security, edge cases, and actionable feedback with minimal diffs.

**Example:**
```bash
$ gemini -p "/reviewer Please review this git diff from file /tmp/changes.diff for correctness, potential bugs, security issues, and provide actionable feedback" --approval-mode yolo 2>&1
(timeout 120s)
```

**When to use:** Whenever the user asks Gemini to review code, check a PR, audit for bugs/security, or provide code feedback.

### `/researcher` — Web Research

Defined in `~/.gemini/commands/researcher.toml`.

Research specialist with access to `google_web_search` tool for web searching and deep analysis.

**Example:**
```bash
$ gemini -p "/researcher compare React Server Components vs Astro islands" --approval-mode yolo 2>&1
(timeout 120s)
```

**When to use:** Whenever the user asks Gemini to research a topic, look up documentation, find best practices, compare technologies, or gather information from the web.

## Common Commands Reference

### File Operations (`@` syntax)

```bash
# Include file in prompt
$ gemini -p "@src/components/UserProfile.tsx Explain this component" --approval-mode yolo 2>&1

# Include multiple files
$ gemini -p "@file1.go @file2.go Compare these files" --approval-mode yolo 2>&1

# Include directory
$ gemini -p "@src/utils/ Check for deprecated APIs" --approval-mode yolo 2>&1
```

### Shell Commands (`!` syntax)

```bash
# Execute shell command
$ gemini -p "!git status" --approval-mode yolo 2>&1
```

## Agent Usage Guidelines

When the user asks to "use Gemini":

1. **Execute as regular bash command:** Run with `bash` tool, include timeout.
2. **Use appropriate timeout:** Gemini typically takes 2-8 minutes depending on task complexity.
   - **Minimum 240s (4m)** for any command
   - **300-480s (5-8m)** for standard tasks
   - **600s (10m)** for complex reviews or large file generations
3. **Route to custom slash commands when applicable:**
   - **Code review tasks** (review PR, audit code, check for bugs/security) → prepend `/reviewer` to the prompt
   - **Research tasks** (look up docs, compare tech, find best practices, web search) → prepend `/researcher` to the prompt

### Example: Code Review
```bash
$ gemini -p "/reviewer review the latest commit for security issues" --approval-mode yolo 2>&1
(timeout 300s)
```

## Examples

### Analyze Project Structure
```bash
$ gemini -p "Analyze this codebase. What is the project about? What tech stack does it use?" --approval-mode yolo 2>&1
(timeout 120s)
```

### Read and Explain File
```bash
$ gemini -p "Read @cmd/stitchdb/main.go and explain the entry point" --approval-mode yolo 2>&1
(timeout 120s)
```

### Search for Patterns
```bash
$ gemini -p "Find all TODO comments in the Go source files" --approval-mode yolo 2>&1
(timeout 120s)
```

### Compare Files
```bash
$ gemini -p "Compare @file1.go and @file2.go and highlight differences" --approval-mode yolo 2>&1
(timeout 120s)
```

### Generate Code
```bash
$ gemini -p "Create a new Go function that handles database connection retries" --approval-mode yolo 2>&1
(timeout 180s)
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
