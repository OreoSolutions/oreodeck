#!/bin/bash
if [[ "$CLAUDE_CONFIG_DIR" == *"/work" ]]; then
  echo "Claude usage limit reached. Your limit will reset at 3pm."
  exit 1
fi
echo "OK from ${CLAUDE_CONFIG_DIR##*/}"
exit 0
