# pi-qwen-agent

A Pi extension that delegates coding tasks to the [Qwen Code CLI](https://github.com/nicepkg/qwen-coder) agent via subprocess.

## Installation

This extension is part of the `agent-stuff` Pi package. It's automatically loaded when the package is installed.

## Usage

### Command

```
/qwen <task>
```

If no task is provided, the extension pulls text from the Pi editor.

### Tool

The `qwen_agent` tool is available to the Pi agent:

| Parameter             | Type       | Required | Description                               |
| --------------------- | ---------- | -------- | ----------------------------------------- |
| `task`                | `string`   | ✓        | The task/prompt for the Qwen agent        |
| `cwd`                 | `string`   | ✗        | Working directory (defaults to workspace) |
| `approval_mode`       | `string`   | ✗        | `default`, `plan`, `auto-edit`, or `yolo` |
| `model`               | `string`   | ✗        | Specific model ID                         |
| `include_directories` | `string[]` | ✗        | Additional workspace directories          |
| `continue`            | `boolean`  | ✗        | Resume the most recent session            |
| `resume`              | `string`   | ✗        | Resume a specific session by ID           |

## Requirements

- `qwen` CLI must be installed and available on `$PATH`
- Qwen Code must be configured with valid credentials

## How it works

1. Spawns `qwen -p "<task>" --output-format stream-json` as a subprocess
2. Parses the JSONL stream to track assistant messages, tool calls, and errors
3. Provides throttled live progress updates to the Pi TUI
4. Supports abort via signal (SIGTERM → SIGKILL)
