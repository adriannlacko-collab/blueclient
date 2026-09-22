#!/bin/sh
# Rebuild the patched companion jars into launcher/resources/mod/ (see mod/README.md).
set -e
exec python3 "$(dirname "$0")/build.py" "$@"
