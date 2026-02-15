#!/bin/bash

# This script ensures the Node.js server runs persistently.

# Kill any previously running instance of the server to prevent conflicts.
# The `-f` flag matches the full command line, not just the process name.
pkill -f "node server.js"

# Give the OS a moment to release the port
sleep 1

# Start the server in the background using nohup.
# nohup ensures the process isn't terminated when the shell session ends.
# `&` sends the process to the background.
# Output is redirected to server.log.
nohup node server.js > server.log 2>&1 &

# Give the server a moment to start up.
sleep 2

# Log the status.
echo "Control Panel server (re)started in the background."
echo "Output is being logged to server.log."
