#!/usr/bin/env bash
# Start tmux sessions for parallel Claudes
set -euo pipefail

cd "$(dirname "$0")"
ROOT_NAME="$(basename "$PWD")"
BUILDER_DIR="$(cd "../${ROOT_NAME}-builder" && pwd)"
TESTER_DIR="$(cd "../${ROOT_NAME}-tester" && pwd)"

if ! command -v tmux >/dev/null 2>&1; then
  echo "tmux is not installed. Run this from WSL/macOS/Linux, or open two terminals and run 'claude' in:" >&2
  echo "  $BUILDER_DIR" >&2
  echo "  $TESTER_DIR" >&2
  exit 1
fi

tmux new-session -d -s claude-builder -c "$BUILDER_DIR" "claude"
tmux new-session -d -s claude-tester -c "$TESTER_DIR" "claude"

echo "Parallel Claude Code sessions created in tmux!"
echo "To attach to Builder: tmux attach -t claude-builder"
echo "To attach to Tester:  tmux attach -t claude-tester"
echo "To list all sessions: tmux ls"
