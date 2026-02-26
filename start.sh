#!/bin/bash
set -e

# Start virtual display so headed Playwright can run (bypasses Cloudflare bot detection)
Xvfb :99 -screen 0 1280x800x24 -ac &
export DISPLAY=:99

echo "Virtual display started on :99"
exec node server.js
