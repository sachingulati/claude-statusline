#!/usr/bin/env bash
# Claude Code status line entry point.
#
# Wired into ~/.claude/settings.json as:
#   "statusLine": { "type": "command", "command": "bash \"<repo>/src/statusline-command.sh\"" }
#
# Line 1: dir, model, effort, context %, session tokens
# Line 2: [active account] 5h/7d rate limit (live, from stdin)
# Line 3+: other accounts' 5h/7d, from a background-refreshed cache
#
# Real work is in statusline-render.js -- a real file avoids escaping a whole
# program through bash double quotes, and lets node build its own paths (bash
# $HOME is /c/Users/... under Git Bash but node's is C:\Users\...). This script
# finds its siblings relative to itself, so the repo can live anywhere.

input=$(cat)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# cygpath only exists under Git Bash/Cygwin on Windows. On native Linux/WSL the
# paths are already POSIX and node understands them directly, so guard every use.
_have_cygpath=0
if command -v cygpath >/dev/null 2>&1; then _have_cygpath=1; fi

# Display path: full path relative to $HOME (~/...), else absolute. Normalize via
# cygpath -u first -- $PWD and $HOME can appear in different formats (C:/Users vs
# /c/Users) depending on how the shell was spawned, breaking a prefix compare.
if [ "${_have_cygpath}" = "1" ]; then
  _cwd="$(cygpath -u "${PWD}" 2>/dev/null || printf '%s' "${PWD}")"
  _home="$(cygpath -u "${HOME:-$USERPROFILE}" 2>/dev/null || printf '%s' "${HOME:-$USERPROFILE}")"
else
  _cwd="${PWD}"
  _home="${HOME:-$USERPROFILE}"
fi
_cwd="${_cwd%/}"
_home="${_home%/}"

if [ "${_cwd}" = "${_home}" ]; then
  _display_path="~"
elif [ -n "${_home}" ] && [[ "${_cwd}" == "${_home}/"* ]]; then
  _display_path="~/${_cwd#${_home}/}"
else
  _display_path="${_cwd}"
fi

# Git branch, if cwd is inside a repo (detached HEAD falls back to short SHA)
_git_branch=""
if git -C "${_cwd}" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  _git_branch="$(git -C "${_cwd}" branch --show-current 2>/dev/null)"
  if [ -z "${_git_branch}" ]; then
    _git_branch="$(git -C "${_cwd}" rev-parse --short HEAD 2>/dev/null)"
  fi
fi

_render_js="${SCRIPT_DIR}/statusline-render.js"
if [ "${_have_cygpath}" = "1" ]; then
  _render_js="$(cygpath -w "${_render_js}" 2>/dev/null || printf '%s' "${_render_js}")"
fi

output=$(node "${_render_js}" "$input" "$_display_path" "$_git_branch")

echo "$output"

if [ -n "${RECAP}" ]; then
  echo "${RECAP}"
fi
