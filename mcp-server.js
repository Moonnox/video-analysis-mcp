#!/usr/bin/env node

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { SSEServerTransport } = require("@modelcontextprotocol/sdk/server/sse.js");
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
const express = require('express');

// Configuration management
let currentConfig = {};

// Store active transports by session ID
const transports = new Map();

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

// Main video analysis function
async function analyzeVideo(videoPath, analysisPrompt) {
  requireGoogleApiKey();
  log(`Analyzing video: ${videoPath}`);
  
  try {
    // Determine MIME type based on file extension
    const ext = path.extname(videoPath).toLowerCase();
    let mimeType;
    
    switch (ext) {
      case '.mp4':
        mimeType = 'video/mp4';
        break;
      case '.webm':
        mimeType = 'video/webm';
        break;
      case '.mov':
        mimeType = 'video/quicktime';
        break;
      default:
        mimeType = 'video/mp4'; // Default to mp4
    }
    
    // Convert video to generative part
    const videoPart = await fileToGenerativePart(videoPath, mimeType);
    
    // Set up Gemini model
    const genAI = new GoogleGenerativeAI(currentConfig.googleApiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });
    
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
 * Main function to run the Video Analysis MCP server
 */
async function runServer() {
  try {
    const app = express();
    app.use(express.json());

    // Parse configuration from query parameters
    app.use((req, res, next) => {
      const config = {
        googleApiKey: req.query.google_api_key || process.env.GOOGLE_API_KEY
      };
      setConfig(config);
      next();
    });

    // Initialize the server
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

    // Set error handler
    server.onerror = (error) => log(`[MCP Error] ${error}`);

    // Handle tool listing - CRITICAL: No authentication required for tool discovery
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

    // Handle tool calls - Authentication happens here during execution
    server.setRequestHandler(
      CallToolRequestSchema,
      async (request) => {
        const toolName = request.params.name;
        const toolParams = request.params.arguments || {};

        log(`Tool called: ${toolName} with params: ${JSON.stringify(toolParams)}`);

        try {
          switch (toolName) {
            case "analyze_video_file":
              const { file_path, analysis_prompt } = toolParams;
              
              if (!file_path) {
                throw new McpError(ErrorCode.InvalidRequest, 'File path is required');
              }
              
              if (!fs.existsSync(file_path)) {
                throw new McpError(ErrorCode.InvalidRequest, `File not found: ${file_path}`);
              }
              
              const fileResult = await analyzeVideo(file_path, analysis_prompt);
              return {
                content: [{ 
                  type: "text", 
                  text: JSON.stringify(fileResult, null, 2) 
                }]
              };

            case "analyze_video_url":
              const { video_url, analysis_prompt: urlPrompt } = toolParams;
              
              if (!video_url) {
                throw new McpError(ErrorCode.InvalidRequest, 'Video URL is required');
              }
              
              // Generate a unique filename for the downloaded video
              const tempFilePath = path.join(TEMP_DIR, `${uuidv4()}.mp4`);
              
              try {
                // Download the video
                await downloadFile(video_url, tempFilePath);
                
                // Analyze the video
                const urlResult = await analyzeVideo(tempFilePath, urlPrompt);
                
                // Clean up the temporary file
                fs.unlinkSync(tempFilePath);
                log(`Deleted temporary file: ${tempFilePath}`);
                
                return {
                  content: [{ 
                    type: "text", 
                    text: JSON.stringify(urlResult, null, 2) 
                  }]
                };
              } catch (error) {
                // Clean up on error
                if (fs.existsSync(tempFilePath)) {
                  fs.unlinkSync(tempFilePath);
                }
                throw error;
              }

            case "get_server_status":
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

            default:
              throw new McpError(ErrorCode.MethodNotFound, `Tool ${toolName} not found`);
          }
        } catch (error) {
          log(`Error in tool execution: ${error.message}`);
          if (error instanceof McpError) {
            throw error;
          }
          throw new McpError(ErrorCode.InternalError, error.message);
        }
      }
    );

    // SSE endpoint for establishing connection
    app.get('/sse', async (req, res) => {
      try {
        // Create SSE transport with the messages endpoint
        const transport = new SSEServerTransport('/messages', res);
        
        // Store transport by session ID
        transports.set(transport.sessionId, transport);
        
        // Set up transport cleanup on close
        transport.onclose = () => {
          transports.delete(transport.sessionId);
          log(`SSE connection closed for session ${transport.sessionId}`);
        };
        
        // Connect server to transport
        await server.connect(transport);
        log(`SSE connection established for session ${transport.sessionId}`);
      } catch (error) {
        log(`SSE connection error: ${error instanceof Error ? error.message : String(error)}`);
        res.status(500).json({ error: 'Failed to establish SSE connection' });
      }
    });

    // Messages endpoint for handling client requests
    app.post('/messages', async (req, res) => {
      try {
        // Extract session ID from query parameters
        const sessionId = req.query.sessionId;
        
        if (!sessionId) {
          res.status(400).json({ error: 'Missing sessionId parameter' });
          return;
        }
        
        // Get the transport for this session
        const transport = transports.get(sessionId);
        
        if (!transport) {
          res.status(404).json({ error: 'Session not found. Please establish SSE connection first.' });
          return;
        }
        
        // Handle the message through the transport
        await transport.handlePostMessage(req, res);
      } catch (error) {
        log(`Message handling error: ${error instanceof Error ? error.message : String(error)}`);
        res.status(500).json({ error: 'Internal server error' });
      }
    });
    
    // Health check endpoint
    app.get('/health', (req, res) => {
      res.json({ status: 'ok', activeSessions: transports.size });
    });

    const port = process.env.PORT || 3000;
    app.listen(port, () => {
      log(`Video Analysis MCP Server started on port ${port}`);
      console.log(`Video Analysis MCP Server running on port ${port}`);
      console.log(`SSE endpoint: http://localhost:${port}/sse`);
      console.log(`Messages endpoint: http://localhost:${port}/messages`);
    });
    
  } catch (error) {
    log(`Server failed to start: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

// Run the server
runServer().catch((error) => {
  log(`Server failed to start: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});