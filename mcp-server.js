#!/usr/bin/env node

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { 
  CallToolRequestSchema, 
  ListToolsRequestSchema, 
  McpError, 
  ErrorCode 
} = require("@modelcontextprotocol/sdk/types.js");
const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fetch = require('node-fetch');
const { v4: uuidv4 } = require('uuid');
const { promisify } = require('util');
const { pipeline } = require('stream');
const streamPipeline = promisify(pipeline);
const os = require('os');

// Configuration management
let currentConfig = {};

function setConfig(config) {
  currentConfig = config;
}

function requireGoogleApiKey() {
  if (!currentConfig.googleApiKey) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      "Google API key is required for video analysis"
    );
  }
}

// Setup logging
const LOG_DIR = path.join(os.tmpdir(), 'video-analysis-mcp-logs');
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}
const logFile = path.join(LOG_DIR, 'video-analysis.log');

function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `${timestamp} - ${message}\n`;
  fs.appendFileSync(logFile, logMessage);
}

// Create temp directory for video uploads
const TEMP_DIR = path.join(os.tmpdir(), 'video-analysis-uploads');
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// Helper function to download a file from URL
async function downloadFile(url, outputPath) {
  log(`Downloading file from ${url} to ${outputPath}`);
  const response = await fetch(url);
  
  if (!response.ok) {
    throw new Error(`Failed to download file: ${response.statusText}`);
  }
  
  await streamPipeline(response.body, fs.createWriteStream(outputPath));
  log('Download complete');
  return outputPath;
}

// Helper function to get file as base64
async function fileToGenerativePart(filePath, mimeType) {
  log(`Converting file to generative part: ${filePath}`);
  const fileBuffer = fs.readFileSync(filePath);
  return {
    inlineData: {
      data: fileBuffer.toString('base64'),
      mimeType
    }
  };
}

// Supported video formats
const SUPPORTED_FORMATS = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm', 
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska'
};

// Maximum file size (100MB)
const MAX_FILE_SIZE = 100 * 1024 * 1024;

// Validate video file
function validateVideoFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new McpError(ErrorCode.InvalidRequest, `File not found: ${filePath}`);
  }
  
  const ext = path.extname(filePath).toLowerCase();
  if (!SUPPORTED_FORMATS[ext]) {
    const supportedExts = Object.keys(SUPPORTED_FORMATS).join(', ');
    throw new McpError(ErrorCode.InvalidRequest, `Unsupported file format. Supported formats: ${supportedExts}`);
  }
  
  const stats = fs.statSync(filePath);
  if (stats.size > MAX_FILE_SIZE) {
    throw new McpError(ErrorCode.InvalidRequest, `File too large. Maximum size: ${MAX_FILE_SIZE / (1024 * 1024)}MB`);
  }
  
  return SUPPORTED_FORMATS[ext];
}

// Validate URL
function validateUrl(url) {
  try {
    new URL(url);
    return true;
  } catch {
    throw new McpError(ErrorCode.InvalidRequest, 'Invalid URL format');
  }
}

// Main video analysis function
async function analyzeVideo(videoPath, analysisPrompt) {
  requireGoogleApiKey();
  log(`Analyzing video: ${videoPath}`);
  
  try {
    // Validate file and get MIME type
    const mimeType = validateVideoFile(videoPath);
    
    // Convert video to generative part
    const videoPart = await fileToGenerativePart(videoPath, mimeType);
    
    // Set up Gemini model
    const genAI = new GoogleGenerativeAI(currentConfig.googleApiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    
    // Default prompts if none provided
    const defaultPrompts = [
      "Describe the video in detail, including what's happening and the main subject matter.",
      "What is the quality of the video recording and audio?",
      "Are there any areas where the video could be improved?",
      "Analyze the pacing and content organization of the video.",
      "How well does this video meet typical user expectations for this type of content?"
    ];
    
    const prompts = analysisPrompt ? [analysisPrompt] : defaultPrompts;
    
    log("Starting video analysis with Gemini...");
    const results = [];
    
    for (const prompt of prompts) {
      log(`Analyzing with prompt: ${prompt}`);
      
      const result = await model.generateContent([
        prompt,
        videoPart
      ]);
      
      const response = result.response;
      results.push({
        prompt,
        analysis: response.text()
      });
      
      log(`Analysis complete for prompt: ${prompt}`);
    }
    
    return {
      success: true,
      results
    };
    
  } catch (error) {
    log(`Error analyzing video: ${error.message}`);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Main function to run the Video Analysis MCP server (stdio only)
 */
async function runServer() {
  try {
    // Initialize the MCP server
    const server = new Server(
      {
        name: "video-analysis-server",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Load configuration from environment variables
    const config = {
      googleApiKey: process.env.GOOGLE_API_KEY
    };
    setConfig(config);

    // Set error handler
    server.onerror = (error) => log(`[MCP Error] ${error}`);

    // Handle tool listing
    server.setRequestHandler(
      ListToolsRequestSchema,
      async () => {
        return {
          tools: [
            {
              name: "analyze_video_file",
              description: "Analyze a video file using Google's Gemini AI (requires Google API key)",
              inputSchema: {
                type: "object",
                properties: {
                  file_path: {
                    type: "string",
                    description: "Path to the video file to analyze"
                  },
                  analysis_prompt: {
                    type: "string",
                    description: "Optional custom prompt for analysis (if not provided, uses default comprehensive analysis)"
                  }
                },
                required: ["file_path"]
              }
            },
            {
              name: "analyze_video_url",
              description: "Download and analyze a video from URL using Google's Gemini AI (requires Google API key)",
              inputSchema: {
                type: "object",
                properties: {
                  video_url: {
                    type: "string",
                    description: "URL of the video to download and analyze"
                  },
                  analysis_prompt: {
                    type: "string",
                    description: "Optional custom prompt for analysis (if not provided, uses default comprehensive analysis)"
                  }
                },
                required: ["video_url"]
              }
            },
            {
              name: "get_server_status",
              description: "Get the current status of the video analysis server",
              inputSchema: {
                type: "object",
                properties: {},
                required: []
              }
            }
          ]
        };
      }
    );

    // Handle tool calls
    server.setRequestHandler(
      CallToolRequestSchema,
      async (request) => {
        const toolName = request.params.name;
        const toolParams = request.params.arguments || {};

        log(`Tool called: ${toolName} with params: ${JSON.stringify(toolParams)}`);

        try {
          switch (toolName) {
            case "analyze_video_file": {
              const { file_path, analysis_prompt } = toolParams;
              if (!file_path || typeof file_path !== 'string') {
                throw new McpError(ErrorCode.InvalidRequest, 'File path is required and must be a string');
              }
              if (analysis_prompt && typeof analysis_prompt !== 'string') {
                throw new McpError(ErrorCode.InvalidRequest, 'Analysis prompt must be a string');
              }
              const fileResult = await analyzeVideo(file_path, analysis_prompt);
              return { content: [{ type: "text", text: JSON.stringify(fileResult, null, 2) }] };
            }
            case "analyze_video_url": {
              const { video_url, analysis_prompt: urlPrompt } = toolParams;
              if (!video_url || typeof video_url !== 'string') {
                throw new McpError(ErrorCode.InvalidRequest, 'Video URL is required and must be a string');
              }
              if (urlPrompt && typeof urlPrompt !== 'string') {
                throw new McpError(ErrorCode.InvalidRequest, 'Analysis prompt must be a string');
              }
              validateUrl(video_url);
              const tempFilePath = path.join(TEMP_DIR, `${uuidv4()}.mp4`);
              try {
                await downloadFile(video_url, tempFilePath);
                const urlResult = await analyzeVideo(tempFilePath, urlPrompt);
                if (fs.existsSync(tempFilePath)) {
                  fs.unlinkSync(tempFilePath);
                  log(`Deleted temporary file: ${tempFilePath}`);
                }
                return { content: [{ type: "text", text: JSON.stringify(urlResult, null, 2) }] };
              } catch (error) {
                if (fs.existsSync(tempFilePath)) {
                  fs.unlinkSync(tempFilePath);
                  log(`Cleanup: Deleted temporary file: ${tempFilePath}`);
                }
                throw error;
              }
            }
            case "get_server_status": {
              return {
                content: [{
                  type: "text",
                  text: JSON.stringify({
                    status: "operational",
                    api_key_configured: !!currentConfig.googleApiKey,
                    temp_directory: TEMP_DIR,
                    log_directory: LOG_DIR
                  }, null, 2)
                }]
              };
            }
            default:
              throw new McpError(ErrorCode.MethodNotFound, `Tool ${toolName} not found`);
          }
        } catch (error) {
          log(`Error in tool execution: ${error.message}`);
          if (error instanceof McpError) throw error;
          throw new McpError(ErrorCode.InternalError, error.message);
        }
      }
    );

    // Connect via stdio transport (no HTTP server)
    const transport = new StdioServerTransport();
    await server.connect(transport);
  } catch (error) {
    log(`Server failed to start: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

runServer().catch((error) => {
  log(`Server failed to start: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
