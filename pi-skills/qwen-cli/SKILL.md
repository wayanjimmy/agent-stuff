---
name: qwen-cli
description: Qwen Code CLI reference. Use when running qwen in interactive_shell overlay or when user asks about Qwen CLI options, headless mode, session controls, or streaming output.
---

# Qwen Code CLI

## Commands

| Command | Description |
|---------|-------------|
| `qwen` | Start interactive TUI |
| `qwen "prompt"` | Headless one-shot (positional prompt) |
| `qwen -i "prompt"` | Interactive session with initial prompt |
| `echo "query" \| qwen` | Headless from stdin |
| `cat file \| qwen "summarize"` | Stdin + prompt combined |
| `qwen --continue -p "prompt"` | Resume most recent session for this project |
| `qwen --resume <id> -p "prompt"` | Resume specific session by ID |
| `qwen mcp add\|remove\|list` | Manage MCP servers |
| `qwen extensions` | Manage extensions |

> **Note:** `-p`/`--prompt` is deprecated for new usage — prefer the positional prompt. Use `-p` only when combining with `--continue`/`--resume` or stdin.

## Key Flags

| Flag | Description |
|------|-------------|
| `-m, --model <model>` | Switch model |
| `-o, --output-format <fmt>` | Output format: `text`, `json`, `stream-json` |
| `--input-format <fmt>` | Input format: `text`, `stream-json` |
| `--include-partial-messages` | Include partial deltas in `stream-json` output |
| `-c, --continue` | Resume most recent session for current project |
| `-r, --resume <id>` | Resume specific session (omit id for picker) |
| `--session-id <id>` | Force a specific session ID for this run |
| `--max-session-turns <n>` | Cap number of session turns |
| `--approval-mode <mode>` | `plan`, `default`, `auto-edit`, `yolo` |
| `-y, --yolo` | Auto-approve all actions (dangerous) |
| `--allowed-tools <...>` | Bypass confirmation for specified tools |
| `--exclude-tools <...>` | Forbid specified tools |
| `--core-tools <path...>` | Specify core tool paths |
| `-s, --sandbox` | Enable sandbox mode |
| `--sandbox-image <uri>` | Custom sandbox image |
| `--include-directories <dir...>` | Additional directories in workspace |
| `-e, --extensions <...>` | Use specific extensions only |
| `-l, --list-extensions` | List available extensions and exit |
| `--web-search-default <provider>` | Default search provider: `dashscope`, `tavily`, `google` |
| `--vlm-switch-mode <mode>` | Vision-language switching: `once`, `session`, `persist` |
| `--auth-type <type>` | Auth backend: `openai`, `anthropic`, `qwen-oauth`, `gemini`, `vertex-ai` |
| `--acp` | Start in ACP mode |
| `--experimental-lsp` | Enable experimental LSP integration |
| `-d, --debug` | Debug logging |

## Sandbox Modes

- `--sandbox` — Runs in a sandboxed environment; may restrict filesystem/network access
- `--sandbox-image <uri>` — Use a custom sandbox image (reproducible deps, custom toolchain)

## Approval Modes

- `plan` — Plan only, no tool execution
- `default` — Prompt for approval on each action
- `auto-edit` — Auto-approve edit tools, prompt for others
- `yolo` — Auto-approve everything (use with caution)

## Features

- **Interactive + resumable sessions** — `--continue`, `--resume`, `--session-id`
- **Streaming structured output** — `stream-json` with `--include-partial-messages`
- **Tool governance** — approval modes, allowed/excluded/core tools
- **Sandbox execution** — optional, with custom image support
- **MCP integration** — `qwen mcp add|remove|list`
- **Extensions system** — `qwen extensions`, `--extensions`, `--list-extensions`
- **Web search** — Tavily, Google, or DashScope providers
- **VLM switching** — automatic vision-language model switching
- **Multi-provider auth** — OpenAI, Anthropic, Qwen OAuth, Gemini, Vertex AI

## Config

Config file: `~/.qwen/settings.json`
Session data: `~/.qwen/projects/<sanitized-cwd>/chats`

Key settings:
- `security.auth.selectedType` — auth provider (e.g., `qwen-oauth`)
- `tools.experimental.skills` — enable skills
- `experimental.skills` — enable experimental skills

## In interactive_shell

Do NOT pass `-s` / `--sandbox` flags in interactive_shell overlays. Sandbox mode applies OS-level restrictions that can break shell operations inside the PTY. The interactive shell overlay already provides supervision (user watches in real-time), making sandbox redundant.

User's auth is `qwen-oauth`. Just run `qwen "prompt"` for headless one-shots — no auth flags needed.

```typescript
// Headless one-shot — dispatch for reliable full output capture
interactive_shell({
  command: 'qwen "summarize this repo"',
  mode: "dispatch"
})

// Streaming JSON output — dispatch for machine-readable capture
interactive_shell({
  command: 'qwen "explain the architecture" -o stream-json --include-partial-messages',
  mode: "dispatch"
})

// Interactive session — hands-free allows user supervision
interactive_shell({
  command: 'qwen -i "Help me refactor the auth module"',
  mode: "hands-free"
})

// Resume most recent session
interactive_shell({
  command: 'qwen --continue -p "Run the tests again"',
  mode: "dispatch"
})

// Override model for a single run
interactive_shell({
  command: 'qwen -m qwen3-coder-plus "Complex analysis task"',
  mode: "dispatch"
})

// Headless via bash (alternative, no overlay)
bash({ command: 'qwen "summarize the repo"' })

// Stdin piping via bash
bash({ command: 'cat src/main.ts | qwen "review this code for issues"' })
```

### Mode Recommendations

| Use Case | Recommended Mode | Why |
|----------|------------------|-----|
| `qwen "…"` headless one-shot | `dispatch` | Ensures full output captured, no early exit |
| `qwen -o json "…"` structured output | `dispatch` | Waits for completion, returns all output |
| `qwen -i "…"` interactive | `hands-free` | User can watch and take over if needed |
| Quick checks, stdin pipes | `bash` | Simple, no overlay overhead |
