# VideoAnalysisAI MCP Server

This MCP (Model Context Protocol) server provides video analysis capabilities using Google's Gemini AI. It allows AI assistants to analyze videos and provide detailed descriptions, identify problems, and assess how well the video meets user expectations.

## Features

- Analyze local video files
- Download and analyze videos from URLs
- Get detailed descriptions of video content
- Identify quality issues and improvement opportunities
- Assess video pacing and organization
- Evaluate how well videos meet user expectations

## Setup

1. Install dependencies:
```bash
npm install
```

2. Set up your Google API key:
```bash
export GOOGLE_API_KEY="your_google_api_key_here"
```

## Usage

### Starting the Server

```bash
node index.js
```

The server communicates via stdin/stdout as per the MCP protocol, not via HTTP.

### Available Tools

- `analyze_video_file`: Analyze a local video file
- `analyze_video_url`: Download and analyze a video from a URL
- `get_video_analysis_status`: Check the status of the video analysis service

### Example Prompts

The server uses these default prompts if no custom prompt is provided:

1. "Describe the video in detail, including what's happening and the main subject matter."
2. "What is the quality of the video recording and audio?"
3. "Are there any areas where the video could be improved?"
4. "Analyze the pacing and content organization of the video."
5. "How well does this video meet typical user expectations for this type of content?"

## Logs

Logs are stored in:
- `/tmp/video-analysis-mcp-logs/video-analysis.log`

## Temporary Files

Downloaded videos are temporarily stored in:
- `/tmp/video-analysis-uploads/`

These files are automatically deleted after analysis.

## Requirements

- Node.js 14+
- Google Gemini API key
- Internet connection for downloading videos and accessing the Gemini API
