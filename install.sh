#!/usr/bin/env bash
# Thin wrapper: all logic is in install.js so it stays identical across OSes.
set -e
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_js="${DIR}/install.js"
if command -v cygpath >/dev/null 2>&1; then _js="$(cygpath -w "${_js}")"; fi
exec node "${_js}" "$@"
