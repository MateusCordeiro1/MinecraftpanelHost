#!/bin/bash
# Script to run a Minecraft server with a playit.gg tunnel

echo "Starting playit.gg tunnel in the background..."
/home/user/painel-minecraft_V5/playit-linux-amd64 > /dev/null 2>&1 &
PLAYIT_PID=$!

trap 'echo "Stopping playit.gg tunnel..."; kill $PLAYIT_PID' EXIT

echo "Waiting for the tunnel to establish..."
sleep 5

echo "Starting Minecraft server..."
nix-shell -p pkgs.jdk21_headless --run "java -Xms12G -Xmx12G -jar paper-1.21.11-69.jar nogui"

echo "Minecraft server process has finished."
