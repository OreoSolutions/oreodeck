#!/bin/bash
# Binary `claude` giả dùng cho test: in ra env liên quan rồi thoát.
echo "CLAUDE_CONFIG_DIR=${CLAUDE_CONFIG_DIR}"
echo "ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-<unset>}"
echo "ARGS=$*"
exit "${FAKE_CLAUDE_EXIT:-0}"
