---
name: qwen-cli
description: Use Alibaba's Qwen Code CLI tool for AI-powered code analysis, file editing, and shell assistance in agent workflows.
---

# Qwen CLI Skill

Skill for using Alibaba's Qwen Code CLI tool effectively in agent workflows.

## Overview

Qwen Code is an open-source AI-powered terminal assistant from Alibaba Cloud that brings Qwen models directly to the command line. It can analyze codebases, edit files, run shell commands, and provide intelligent coding assistance. It's optimized for the Qwen series models and ships with features like agentic coding, MCP support, and sandboxing.

> ⚠️ **Proxy Note:** In environments with SOCKS proxy settings, Qwen CLI may fail with proxy errors. Always unset proxy variables before running Qwen commands:
> ```bash
> unset HTTP_PROXY HTTPS_PROXY ALL_PROXY && qwen "..." -y
> ```

## Installation & Availability

Qwen CLI is pre-installed in this environment. To find the path:
```bash
which qwen
# Output: ~/.local/share/mise/installs/node/25.8.1/bin/qwen
```

Or list all mise binary paths:
```bash
mise bin-paths | grep node
```

## Essential Usage Patterns

### Prompt-Interactive Mode (Recommended)

Execute a prompt with **streaming, human-readable output**. The TUI stays open after completion so you can see real-time progress:

```bash
unset HTTP_PROXY HTTPS_PROXY ALL_PROXY && qwen "your prompt here" -y -i
```

**Why this is recommended:**
- ✅ Streaming output (see progress in real-time)
- ✅ Human-readable format
- ✅ Can continue the conversation after the initial prompt

### One-Shot Mode

Run a single prompt and exit immediately (no streaming):

```bash
unset HTTP_PROXY HTTPS_PROXY ALL_PROXY && qwen "your prompt here" -y
```

Use this for:
- Quick, simple queries where you don't need to see progress
- Scripts and automation
- When you just want the final result

#### Output Formats for One-Shot Mode

By default, one-shot mode outputs plain text. For programmatic use:

```bash
# JSON output (final result only)
unset HTTP_PROXY HTTPS_PROXY ALL_PROXY && qwen "your prompt" -y --output-format json

# Streaming JSON events (real-time, machine-readable)
unset HTTP_PROXY HTTPS_PROXY ALL_PROXY && qwen "your prompt" -y --output-format stream-json
```

### Using via Agent Framework

When calling from the `pi` agent framework, use `interactive_shell` with `-i` for the best experience:

```typescript
interactive_shell({
  command: 'unset HTTP_PROXY HTTPS_PROXY ALL_PROXY && qwen "your prompt here" -y -i',
  mode: "interactive"
})
```

**Agent framework modes:**
- `interactive` - User watches/controls the session
- `hands-free` - Auto-exit on quiet, agent monitors
- `dispatch` - Fire-and-forget, agent notified on completion



**Key flags:**
- Positional prompt - Run in non-interactive mode with the given prompt (preferred over `-p`)
- `-p, --prompt` - Prompt (deprecated, use positional instead)
- `-i, --prompt-interactive` - Execute prompt and continue in interactive TUI mode
- `-y, --yolo` - Auto-approve all tool calls (YOLO mode)
- `--approval-mode <mode>` - Set approval mode: `yolo`, `auto-edit`, `plan`, `default`
- `-m, --model` - Specify which Qwen model to use
- `-o, --output-format` - Output format: `text`, `json`, `stream-json`
- `-c, --continue` - Resume the most recent session
- `-r, --resume` - Resume a specific session by ID

### Approval Mode

**This skill uses `yolo` mode (auto-approve all actions).**

Use `-y` or `--yolo` to enable automatic approval:

```bash
unset HTTP_PROXY HTTPS_PROXY ALL_PROXY && qwen "your prompt here" -y -i
```

**Why yolo mode:**
- ✅ No interruption during execution
- ✅ Full automation for agent workflows
- ✅ Required for `interactive_shell` to work properly in hands-free/dispatch modes

**Note:** This is equivalent to `--approval-mode yolo`.

## Slash Commands (Skills)

Qwen CLI supports slash commands that auto-load specialized skills when invoked:

| Command | Description |
|---------|-------------|
| `/review` | Multi-agent code review for PRs or local changes |
| `/test` | Run tests using Vitest |
| `/commit` | Generate Conventional Commits format messages |

**Example:**
```bash
unset HTTP_PROXY HTTPS_PROXY ALL_PROXY && qwen "/review" -y
```

## File & Shell Operations

### @ Commands (File Context)

```bash
# Include file in prompt
@src/components/UserProfile.tsx Explain this component

# Include directory
@docs/ Summarize this documentation

# Multiple files
@file1.go @file2.go Compare these files
```

### ! Commands (Shell Execution)

```bash
# Execute shell command
!ls -la
!git status

# Toggle shell mode (type ! alone)
!
```

## Agent Usage Guidelines

When the user asks to "use Qwen":

1. **Always use `-y -i` flags:**
   - `-y` = yolo mode (auto-approve all actions)
   - `-i` = prompt-interactive mode (streaming, human-readable output)
2. **Use `interactive_shell` with `mode: "interactive"`:** This gives the best user experience
3. **Use appropriate timeout:** Default 180s, up to 420s for complex tasks
4. **Use positional prompts:** Pass the prompt directly as a positional argument (not `-p`)

### Why `-y -i` is recommended

| Without flags | With `-y -i` |
|---------------|--------------|
| Requires manual approval | ✅ Auto-approve (no interruption) |
| No streaming output | ✅ Real-time streaming |
| Buffers until complete | ✅ See progress as it happens |
| Exits immediately | ✅ TUI stays open |
| Silent for long tasks | ✅ Visual feedback |

### Example: Prompt-Interactive Session (Recommended)

```bash
# Execute prompt with streaming output
unset HTTP_PROXY HTTPS_PROXY ALL_PROXY && qwen "analyze this codebase" -y -i
```

### Example: Agent Framework Session

Use `-y -i` for auto-approve with streaming output:

```typescript
interactive_shell({
  command: 'unset HTTP_PROXY HTTPS_PROXY ALL_PROXY && qwen "Analyze this codebase structure" -y -i',
  mode: "interactive",
  timeout: 300000
})
```

### Example: Headless with JSON Output

```bash
unset HTTP_PROXY HTTPS_PROXY ALL_PROXY && qwen "List all TODO comments" -y --output-format json
```

## Examples

### Analyze Project Structure
```typescript
interactive_shell({
  command: 'unset HTTP_PROXY HTTPS_PROXY ALL_PROXY && qwen "What is this project about? What tech stack does it use?" -y -i',
  mode: "interactive"
})
```

### Read and Explain File
```typescript
interactive_shell({
  command: 'unset HTTP_PROXY HTTPS_PROXY ALL_PROXY && qwen "Read @cmd/stitchdb/main.go and explain the entry point" -y -i',
  mode: "interactive"
})
```

### Generate Code
```typescript
interactive_shell({
  command: 'unset HTTP_PROXY HTTPS_PROXY ALL_PROXY && qwen "Create a new Go function that handles database connection retries" -y -i',
  mode: "interactive"
})
```

### Code Review
The `/review` skill auto-loads when invoked. It runs a multi-agent review process (Correctness, Quality, Performance, Audit, Build/Test).

```bash
# Review local uncommitted changes
unset HTTP_PROXY HTTPS_PROXY ALL_PROXY && qwen "/review" -y

# Review a specific PR by number
unset HTTP_PROXY HTTPS_PROXY ALL_PROXY && qwen "/review 123" -y

# Review by PR URL
unset HTTP_PROXY HTTPS_PROXY ALL_PROXY && qwen "/review https://github.com/user/repo/pull/123" -y

# Review a specific file
unset HTTP_PROXY HTTPS_PROXY ALL_PROXY && qwen "/review src/main.go" -y

# Post findings as PR inline comments
unset HTTP_PROXY HTTPS_PROXY ALL_PROXY && qwen "/review --comment" -y
```

## Configuration Files

Qwen Code respects these configuration files:

- `~/.qwen/settings.json` - User settings
- `<project>/.qwen/settings.json` - Project settings
- `QWEN.md` - Project-specific context (similar to GEMINI.md)
- `.qwenignore` - Files to exclude from AI context (like `.gitignore`)

## Important Notes

- **Git-aware:** Respects `.gitignore` by default
- **Safety:** Shows diff before file modifications (unless in YOLO mode)
- **Sessions:** Auto-saves conversations; resume with `/resume` or `-c`
- **Multi-directory:** Use `--include-directories` to add more workspace folders
- **Sandboxing:** Use `-s, --sandbox` for isolated execution
- **Extensions:** Can install extensions via `qwen extensions install <url>`

## Version & Help

```bash
# Check version
qwen --version

# Show all options
qwen --help

# List available extensions
qwen --list-extensions
```

## See Also

- Official docs: https://qwenlm.github.io/qwen-code-docs/
- GitHub: https://github.com/QwenLM/qwen-code
- Quickstart: https://qwenlm.github.io/qwen-code-docs/en/users/quickstart/
