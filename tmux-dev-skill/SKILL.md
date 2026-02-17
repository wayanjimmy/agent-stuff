---
name: tmux-dev
description: "Tmux workflow for AI development with multiple project sessions, 3-pane layouts, and efficient window/session management"
---

## Overview

Use this skill when working with tmux for AI development workflows, especially when managing multiple projects with dedicated sessions.

## Session Management

### List Sessions
- `tmux ls` - List all sessions
- `Ctrl+b s` - Interactive session switcher

### Create New Sessions
```bash
# From terminal (creates detached)
tmux new -s <session-name> -c /path/to/project

# From inside tmux (stays in current session)
Ctrl+b : new-session -s <session-name> -c /path/to/project
```

### Switch Between Sessions
- `Ctrl+b s` - Interactive session list, use arrows + Enter
- `tmux attach -t <session-name>` - From terminal
- `tmux switch-client -t <session-name>` - From within tmux

### Rename Sessions
- `Ctrl+b $` - Rename current session
- `tmux rename-session <new-name>` - From terminal

### Detach/Kill Sessions
- `Ctrl+b d` - Detach from current session
- `Ctrl+b : kill-session -t <name>` - Kill specific session
- `tmux kill-session -t <name>` - From terminal

### Multi-Project Workflow
Each project should have its own session:
1. Create session for each project: `tmux new -s project1 -c ~/projects/project1`
2. Set up dev layout in each session (see 3-Pane Layout section)
3. Switch between projects: `tmux attach -t project1`

## 3-Pane Layout

### Using tmux_dev_layout Script
```bash
tmux_dev_layout [command]  # Create layout with command in right pane
tdl [command]             # Alias for tmux_dev_layout
```

### Manual Setup
From any pane in a session:
1. Create bottom pane (15% height): `tmux split-window -v -l 15% -c "$(pwd)"`
2. Return to main pane: `tmux select-pane -t 0`
3. Create right side pane (30% width): `tmux split-window -h -l 30% -c "$(pwd)"`

### Default Layout
- **Main Pane** (left): Editor/workspace (~70% width, ~85% height)
- **Right Pane** (30% width): AI assistant, side commands, file explorer
- **Bottom Pane** (15% height, full width): Terminal, logs, test output

## Window Management

### Create New Windows
- `Ctrl+b c` - Create new window
- `tmux new-window` - Command to create new window
- `tmux new-window -n "mywindow"` - Create window with specific name
- `tmux new-window -n "tests" "npm test"` - Create window with command

### Window Switching
- `Ctrl+b n` - Go to next window
- `Ctrl+b p` - Go to previous window
- `Ctrl+b l` - Toggle to last used window (quick toggle between last two)
- `Ctrl+b 0-9` - Jump directly to window by number (0, 1, 2, etc.)
- `Ctrl+b w` - Interactive window list (use arrow keys + Enter to select)
- `Ctrl+b : select-window -t 0` - Command to go to window 0
- `tmux select-window -t 1` - From terminal, go to window 1

### Window Management
- `Ctrl+b ,` - Rename current window
- `Ctrl+b &` - Close current window (with confirmation)
- `tmux list-windows` - List all windows in current session

### Window Names
Windows are automatically named based on the running command:
- `infisical` → Named "infisical"
- `vim` → Named "vim"
- `bash` → Named "bash"

Rename manually: `Ctrl+b ,` then type new name

## Pane Management

### Pane Navigation
- `Ctrl+b o` - Cycle through panes
- `Ctrl+b Arrow keys` - Move to specific direction
- `Ctrl+b q` - Show pane numbers, then press number to jump

### Resize Panes
- `Ctrl+b Ctrl+Arrow Right` - Increase width
- `Ctrl+b Ctrl+Arrow Left` - Decrease width
- `Ctrl+b : resize-pane -R 10` - Expand right by 10 cells
- `Ctrl+b : resize-pane -L 10` - Shrink by 10 cells
- `Ctrl+b : resize-pane -t %3 -x 50` - Set specific width to 50

### List Panes
- `tmux list-panes` - List all panes in current window
- `tmux list-panes -F '#{pane_id}: #{pane_width}x#{pane_height}'` - Detailed info

### Kill Panes
- `Ctrl+b x` - Confirm kill pane
- `tmux kill-pane -t %3` - Kill specific pane by ID

## Status Bar

### Current Status Bar Format
- **Left**: `[session_name]` - Current session
- **Center**: Window list (e.g., `0:infisical 1:bash`)
- **Right**: Pane title and timestamp

### Status Bar Commands
- `Ctrl+b : set status on` - Enable status bar
- `Ctrl+b : set status off` - Disable status bar
- `Ctrl+b : set status-bg <color>` - Change background color
- `Ctrl+b : set status-fg <color>` - Change text color

### View Status Bar Options
```bash
tmux show-options -g | grep status  # Show all status options
tmux show-options -g status-left    # Show left side format
tmux show-options -g status-right   # Show right side format
```

## Project Session Setup

When starting work on a new project:
```bash
# 1. Create new session
tmux new -s myproject -c ~/projects/myproject

# 2. Set up 3-pane layout
tmux split-window -v -l 15% -c "$(pwd)"
tmux split-window -h -l 30% -c "$(pwd)"

# 3. (Optional) Run AI assistant in right pane
tmux select-pane -t 2
# Start your AI assistant here
```

## Quick Reference

| Task | Command |
|------|---------|
| **Session Management** | |
| New session | `tmux new -s <name>` |
| List sessions | `tmux ls` |
| Attach to session | `tmux attach -t <name>` |
| Detach | `Ctrl+b d` |
| Switch sessions | `Ctrl+b s` |
| Rename session | `Ctrl+b $` |
| **Window Management** | |
| New window | `Ctrl+b c` |
| Next window | `Ctrl+b n` |
| Previous window | `Ctrl+b p` |
| Last used window | `Ctrl+b l` |
| Jump to window | `Ctrl+b 0-9` |
| Window picker | `Ctrl+b w` |
| Rename window | `Ctrl+b ,` |
| Close window | `Ctrl+b &` |
| List windows | `tmux list-windows` |
| **Pane Management** | |
| New pane (split) | `Ctrl+b %` (horizontal) or `Ctrl+b "` (vertical) |
| Switch pane | `Ctrl+b o` or arrow keys |
| Show pane numbers | `Ctrl+b q` then number |
| Resize pane | `Ctrl+b Ctrl+Arrow` |
| Kill pane | `Ctrl+b x` |

## Notes

- Always create separate sessions for different projects to maintain isolation
- Use windows (tabs) for different tasks within the same project
- Status bar only shows the current session name, not all sessions
- Session names are shown on the left side: `[session-name]`
- Each session maintains its own state, windows, and pane layouts independently
