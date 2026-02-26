#!/bin/bash
# Run this script ON THE VPS to login each account inside Docker
# Usage: ./setup-on-vps.sh 1

ACCOUNT=${1:-1}

echo "========================================"
echo " Setup Account $ACCOUNT inside Docker"
echo "========================================"
echo ""
echo "STEP 1: On your LOCAL machine, open a NEW terminal and run:"
echo "   ssh -L 5900:localhost:5900 $(whoami)@$(hostname -I | awk '{print $1}')"
echo ""
echo "STEP 2: Open a VNC client (eg. RealVNC, TigerVNC) and connect to:"
echo "   localhost:5900  (no password)"
echo ""
echo "STEP 3: You will see a Chrome browser. Log in with Google account $ACCOUNT."
echo ""
echo "STEP 4: Once logged in, come back here and press Enter."
echo ""
echo "Starting VNC server + browser..."
echo ""

# Run setup inside the container with VNC exposed
docker compose run --rm \
  -p 5900:5900 \
  -e DISPLAY=:99 \
  app bash -c "
    Xvfb :99 -screen 0 1280x800x24 -ac &
    sleep 1
    x11vnc -display :99 -forever -passwd vnc1234 -quiet &
    node setup.js $ACCOUNT
  "
