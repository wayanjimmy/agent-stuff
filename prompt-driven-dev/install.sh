#!/bin/bash

# PDD Skill Installer
# Installs the PDD skill for various coding agents
#
# Usage:
#   ./install.sh              # Install for all detected agents
#   ./install.sh pi           # Install for Pi only
#   ./install.sh gemini       # Install for Gemini only
#   ./install.sh claude       # Install for Claude only
#   ./install.sh cursor       # Install for Cursor only
#   ./install.sh global       # Install globally for Pi

set -e

SKILL_DIR="$(cd "$(dirname "$0")/skills/pdd" && pwd)"
TARGET="${1:-all}"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${GREEN}✓${NC} $1"; }
info() { echo -e "${BLUE}→${NC} $1"; }

# Detect project root (look for .git, package.json, go.mod, etc.)
find_project_root() {
    local dir="$(pwd)"
    while [ "$dir" != "/" ]; do
        if [ -d "$dir/.git" ] || [ -f "$dir/package.json" ] || [ -f "$dir/go.mod" ] || [ -f "$dir/Cargo.toml" ]; then
            echo "$dir"
            return
        fi
        dir="$(dirname "$dir")"
    done
    echo "$(pwd)"
}

PROJECT_ROOT="$(find_project_root)"

# Install for Pi
install_pi() {
    local target_dir="$PROJECT_ROOT/.pi/skills/pdd"
    info "Installing for Pi: $target_dir"
    mkdir -p "$(dirname "$target_dir")"
    cp -r "$SKILL_DIR" "$target_dir"
    log "Pi skill installed"
}

# Install for Gemini (uses .agents/skills/)
install_gemini() {
    local target_dir="$PROJECT_ROOT/.agents/skills/pdd"
    info "Installing for Gemini: $target_dir"
    mkdir -p "$target_dir"
    cp -r "$SKILL_DIR"/* "$target_dir/"
    log "Gemini skill installed"
}

# Install for Claude (uses .claude/skills/)
install_claude() {
    local target_dir="$PROJECT_ROOT/.claude/skills/pdd"
    info "Installing for Claude: $target_dir"
    mkdir -p "$target_dir"
    cp -r "$SKILL_DIR"/* "$target_dir/"
    log "Claude skill installed"
}

# Install for Cursor (uses .cursor/skills/)
install_cursor() {
    local target_dir="$PROJECT_ROOT/.cursor/skills/pdd"
    info "Installing for Cursor: $target_dir"
    mkdir -p "$target_dir"
    cp -r "$SKILL_DIR"/* "$target_dir/"
    log "Cursor skill installed"
}

# Install globally for Pi
install_global() {
    local target_dir="$HOME/.pi/agent/skills/pdd"
    info "Installing globally for Pi: $target_dir"
    mkdir -p "$target_dir"
    cp -r "$SKILL_DIR"/* "$target_dir/"
    log "Global Pi skill installed"
}

# Install for all detected agents
install_all() {
    local installed=0

    # Always install for Pi (it's the primary target)
    install_pi
    installed=$((installed + 1))

    # Check for other agents
    if [ -d "$PROJECT_ROOT/.claude" ] || [ -f "$PROJECT_ROOT/.claude.json" ]; then
        install_claude
        installed=$((installed + 1))
    fi

    if [ -d "$PROJECT_ROOT/.cursor" ] || [ -f "$PROJECT_ROOT/.cursor.json" ]; then
        install_cursor
        installed=$((installed + 1))
    fi

    # Gemini uses .agents/ which is also used by Pi
    # So if Pi is installed, Gemini can use it too
    if [ -d "$PROJECT_ROOT/.agents" ]; then
        install_gemini
        installed=$((installed + 1))
    fi

    if [ $installed -eq 1 ]; then
        info "Only Pi detected. Other agents can use .pi/skills/pdd/"
    fi
}

# Main
echo ""
echo "PDD Skill Installer"
echo "==================="
echo ""

case "$TARGET" in
    pi) install_pi ;;
    gemini) install_gemini ;;
    claude) install_claude ;;
    cursor) install_cursor ;;
    global) install_global ;;
    all) install_all ;;
    *)
        echo "Usage: $0 [pi|gemini|claude|cursor|global|all]"
        exit 1
        ;;
esac

echo ""
echo "Done! Restart your coding agent to load the skill."
echo ""
echo "Usage:"
echo "  deno task new-canvas \"Add rate limiting\""
echo "  deno task new-spike \"Evaluate JWT auth\""
echo "  deno task sync 0001"
