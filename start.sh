#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "Starting VideoAnalysisAI MCP server in $SCRIPT_DIR..."

# Ensure dependencies are installed
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install
fi

# Check for GOOGLE_API_KEY
if [ -z "$GOOGLE_API_KEY" ]; then
  echo "Warning: GOOGLE_API_KEY is not set. The server might not function correctly."
  echo "Please set it using: export GOOGLE_API_KEY=\"your_google_api_key_here\""
fi

# Create log and temp directories if they don't exist (as the original install.sh did)
mkdir -p /tmp/video-analysis-mcp-logs
mkdir -p /tmp/video-analysis-uploads

echo "Launching VideoAnalysisAI MCP server..."
# This server is an Express server, but MCP clients will interact via stdio.
# If it's managed by an MCP client, the client handles how it's run and communicated with.
# If run directly for testing, it would listen on a port.
# For unified management, we just execute it.
node index.js "$@"

echo "VideoAnalysisAI MCP server script finished." 