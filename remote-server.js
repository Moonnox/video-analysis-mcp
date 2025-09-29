#!/usr/bin/env node

const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const cors = require('cors');
const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
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
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const multer = require('multer');

// Configuration
const PORT = process.env.PORT || 8080;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const API_KEY = process.env.API_KEY || null; // Optional API key for simple auth
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
const ENABLE_CORS = process.env.ENABLE_CORS !== 'false';
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const ENABLE_AUTH = process.env.ENABLE_AUTH !== 'false'; // Authentication enabled by default

// Setup logging
const LOG_DIR = path.join(os.tmpdir(), 'video-analysis-mcp-logs');
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}
const logFile = path.join(LOG_DIR, 'remote-server.log');

function log(message, level = 'INFO') {
  const timestamp = new Date().toISOString();
  const logMessage = `${timestamp} [${level}] - ${message}\n`;
  fs.appendFileSync(logFile, logMessage);
  console.log(`[${level}] ${message}`);
}

// Create temp directory for video uploads
const TEMP_DIR = path.join(os.tmpdir(), 'video-analysis-uploads');
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, TEMP_DIR);
  },
  filename: function (req, file, cb) {
    const uniqueName = `${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: function (req, file, cb) {
    const allowedExtensions = ['.mp4', '.webm', '.mov', '.avi', '.mkv'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedExtensions.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file format. Allowed: ${allowedExtensions.join(', ')}`));
    }
  }
});

// Helper functions for video analysis
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

function validateVideoFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  
  const ext = path.extname(filePath).toLowerCase();
  if (!SUPPORTED_FORMATS[ext]) {
    const supportedExts = Object.keys(SUPPORTED_FORMATS).join(', ');
    throw new Error(`Unsupported file format. Supported formats: ${supportedExts}`);
  }
  
  const stats = fs.statSync(filePath);
  if (stats.size > MAX_FILE_SIZE) {
    throw new Error(`File too large. Maximum size: ${MAX_FILE_SIZE / (1024 * 1024)}MB`);
  }
  
  return SUPPORTED_FORMATS[ext];
}

async function analyzeVideo(videoPath, analysisPrompt) {
  if (!GOOGLE_API_KEY) {
    throw new Error("Google API key is required for video analysis");
  }
  
  log(`Analyzing video: ${videoPath}`);
  
  try {
    const mimeType = validateVideoFile(videoPath);
    const videoPart = await fileToGenerativePart(videoPath, mimeType);
    
    const genAI = new GoogleGenerativeAI(GOOGLE_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    
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
    log(`Error analyzing video: ${error.message}`, 'ERROR');
    return {
      success: false,
      error: error.message
    };
  }
}

// Create Express app
const app = express();
const server = http.createServer(app);

// Middleware
app.use(helmet());
app.use(express.json({ limit: '10mb' }));

// CORS configuration
if (ENABLE_CORS) {
  app.use(cors({
    origin: CORS_ORIGIN,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key']
  }));
}

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);

// Authentication middleware
const authenticate = (req, res, next) => {
  // Skip authentication if disabled
  if (!ENABLE_AUTH) {
    return next();
  }
  
  // Check for API key if configured
  if (API_KEY) {
    const providedKey = req.headers['x-api-key'] || req.query.api_key;
    if (providedKey === API_KEY) {
      return next();
    }
  }
  
  // Check for JWT token
  const token = req.headers.authorization?.split(' ')[1];
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.user = decoded;
      return next();
    } catch (error) {
      log(`JWT verification failed: ${error.message}`, 'WARN');
    }
  }
  
  // If no API key is configured and no valid JWT, allow access (for development)
  if (!API_KEY) {
    log('Warning: No authentication configured. Set API_KEY or use JWT for production.', 'WARN');
    return next();
  }
  
  res.status(401).json({ error: 'Authentication required' });
};

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Authentication endpoint (for JWT)
app.post('/api/auth/token', async (req, res) => {
  const { username, password } = req.body;
  
  // Simple authentication - in production, use a database
  const validUsername = process.env.AUTH_USERNAME || 'admin';
  const validPasswordHash = process.env.AUTH_PASSWORD_HASH || 
    bcrypt.hashSync('admin', 10);
  
  if (username === validUsername && bcrypt.compareSync(password, validPasswordHash)) {
    const token = jwt.sign(
      { username, timestamp: Date.now() },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    res.json({ 
      token,
      expiresIn: '24h'
    });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

// REST API endpoints
app.post('/api/analyze/file', authenticate, upload.single('video'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No video file provided' });
  }
  
  const analysisPrompt = req.body.analysis_prompt;
  log(`Received file upload: ${req.file.filename}`);
  
  try {
    const result = await analyzeVideo(req.file.path, analysisPrompt);
    
    // Clean up the uploaded file
    fs.unlinkSync(req.file.path);
    log(`Deleted uploaded file: ${req.file.path}`);
    
    res.json(result);
  } catch (error) {
    // Clean up on error
    if (fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post('/api/analyze/url', authenticate, async (req, res) => {
  const { video_url, analysis_prompt } = req.body;
  
  if (!video_url) {
    return res.status(400).json({ error: 'Video URL is required' });
  }
  
  log(`Received request to analyze video from URL: ${video_url}`);
  
  const tempFilePath = path.join(TEMP_DIR, `${uuidv4()}.mp4`);
  
  try {
    await downloadFile(video_url, tempFilePath);
    const result = await analyzeVideo(tempFilePath, analysis_prompt);
    
    // Clean up
    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
      log(`Deleted temporary file: ${tempFilePath}`);
    }
    
    res.json(result);
  } catch (error) {
    // Clean up on error
    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }
    
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/api/status', authenticate, (req, res) => {
  res.json({
    status: 'operational',
    api_key_configured: !!GOOGLE_API_KEY,
    authentication: API_KEY ? 'api_key' : 'none',
    temp_directory: TEMP_DIR,
    log_directory: LOG_DIR,
    uptime: process.uptime(),
    memory: process.memoryUsage()
  });
});

// Standard MCP endpoint at /mcp - GET for discovery
app.get('/mcp', (req, res) => {
  res.json({
    name: "video-analysis-mcp",
    version: "1.0.0",
    description: "MCP server for video analysis using Google's Gemini AI",
    capabilities: {
      tools: true
    }
  });
});

// Standard MCP endpoint at /mcp - POST for operations
app.post('/mcp', authenticate, async (req, res) => {
  const { method, params } = req.body;
  
  log(`MCP request: ${method}`);
  
  try {
    switch (method) {
      case 'tools/list':
        res.json({
          tools: [
            {
              name: "analyze_video_file",
              description: "Analyze a video file using Google's Gemini AI",
              inputSchema: {
                type: "object",
                properties: {
                  file_path: {
                    type: "string",
                    description: "Path to the video file (for uploaded files)"
                  },
                  analysis_prompt: {
                    type: "string",
                    description: "Optional custom prompt for analysis"
                  }
                },
                required: ["file_path"]
              }
            },
            {
              name: "analyze_video_url",
              description: "Download and analyze a video from URL",
              inputSchema: {
                type: "object",
                properties: {
                  video_url: {
                    type: "string",
                    description: "URL of the video to analyze"
                  },
                  analysis_prompt: {
                    type: "string",
                    description: "Optional custom prompt for analysis"
                  }
                },
                required: ["video_url"]
              }
            }
          ]
        });
        break;
        
      case 'tools/call':
        const { name: toolName, arguments: args } = params || {};
        
        switch (toolName) {
          case 'analyze_video_file': {
            const { file_path, analysis_prompt } = args || {};
            if (!file_path) {
              throw new Error('file_path is required');
            }
            const result = await analyzeVideo(file_path, analysis_prompt);
            res.json({ content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
            break;
          }
          
          case 'analyze_video_url': {
            const { video_url, analysis_prompt } = args || {};
            if (!video_url) {
              throw new Error('video_url is required');
            }
            
            const tempFilePath = path.join(TEMP_DIR, `${uuidv4()}.mp4`);
            try {
              await downloadFile(video_url, tempFilePath);
              const result = await analyzeVideo(tempFilePath, analysis_prompt);
              
              if (fs.existsSync(tempFilePath)) {
                fs.unlinkSync(tempFilePath);
              }
              
              res.json({ content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
            } catch (error) {
              if (fs.existsSync(tempFilePath)) {
                fs.unlinkSync(tempFilePath);
              }
              throw error;
            }
            break;
          }
          
          default:
            res.status(404).json({ error: `Tool ${toolName} not found` });
        }
        break;
        
      default:
        res.status(404).json({ error: `Method ${method} not found` });
    }
  } catch (error) {
    log(`Error in MCP request: ${error.message}`, 'ERROR');
    res.status(500).json({ error: error.message });
  }
});

// MCP-compatible endpoints (keeping for backward compatibility)
app.post('/api/mcp/tools', authenticate, async (req, res) => {
  res.json({
    tools: [
      {
        name: "analyze_video_file",
        description: "Analyze a video file using Google's Gemini AI",
        inputSchema: {
          type: "object",
          properties: {
            file_path: {
              type: "string",
              description: "Path to the video file (for uploaded files)"
            },
            analysis_prompt: {
              type: "string",
              description: "Optional custom prompt for analysis"
            }
          },
          required: ["file_path"]
        }
      },
      {
        name: "analyze_video_url",
        description: "Download and analyze a video from URL",
        inputSchema: {
          type: "object",
          properties: {
            video_url: {
              type: "string",
              description: "URL of the video to analyze"
            },
            analysis_prompt: {
              type: "string",
              description: "Optional custom prompt for analysis"
            }
          },
          required: ["video_url"]
        }
      }
    ]
  });
});

app.post('/api/mcp/call', authenticate, async (req, res) => {
  const { tool, arguments: args } = req.body;
  
  if (!tool) {
    return res.status(400).json({ error: 'Tool name is required' });
  }
  
  log(`MCP tool call: ${tool} with args: ${JSON.stringify(args)}`);
  
  try {
    switch (tool) {
      case 'analyze_video_file': {
        const { file_path, analysis_prompt } = args || {};
        if (!file_path) {
          throw new Error('file_path is required');
        }
        const result = await analyzeVideo(file_path, analysis_prompt);
        res.json({ content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
        break;
      }
      
      case 'analyze_video_url': {
        const { video_url, analysis_prompt } = args || {};
        if (!video_url) {
          throw new Error('video_url is required');
        }
        
        const tempFilePath = path.join(TEMP_DIR, `${uuidv4()}.mp4`);
        try {
          await downloadFile(video_url, tempFilePath);
          const result = await analyzeVideo(tempFilePath, analysis_prompt);
          
          if (fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath);
          }
          
          res.json({ content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
        } catch (error) {
          if (fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath);
          }
          throw error;
        }
        break;
      }
      
      default:
        res.status(404).json({ error: `Tool ${tool} not found` });
    }
  } catch (error) {
    log(`Error in MCP tool execution: ${error.message}`, 'ERROR');
    res.status(500).json({ error: error.message });
  }
});

// WebSocket server for real-time MCP communication
const wss = new WebSocket.Server({ server, path: '/ws/mcp' });

wss.on('connection', (ws, req) => {
  const clientId = uuidv4();
  log(`WebSocket client connected: ${clientId}`);
  
  // Skip authentication if disabled
  if (ENABLE_AUTH) {
    // Verify authentication for WebSocket
    const token = req.url.split('token=')[1]?.split('&')[0];
    const apiKey = req.url.split('api_key=')[1]?.split('&')[0];
    
    let authenticated = false;
    
    if (API_KEY && apiKey === API_KEY) {
      authenticated = true;
    } else if (token) {
      try {
        jwt.verify(token, JWT_SECRET);
        authenticated = true;
      } catch (error) {
        log(`WebSocket JWT verification failed: ${error.message}`, 'WARN');
      }
    } else if (!API_KEY) {
      // Allow if no authentication is configured (development)
      authenticated = true;
      log('Warning: WebSocket connection without authentication', 'WARN');
    }
    
    if (!authenticated) {
      ws.send(JSON.stringify({ error: 'Authentication required' }));
      ws.close(1008, 'Authentication required');
      return;
    }
  }
  
  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      log(`WebSocket message from ${clientId}: ${data.type || 'unknown'}`);
      
      switch (data.type) {
        case 'list_tools':
          ws.send(JSON.stringify({
            type: 'tools',
            tools: [
              {
                name: "analyze_video_file",
                description: "Analyze a video file using Google's Gemini AI",
                inputSchema: {
                  type: "object",
                  properties: {
                    file_path: { type: "string", description: "Path to the video file" },
                    analysis_prompt: { type: "string", description: "Optional custom prompt" }
                  },
                  required: ["file_path"]
                }
              },
              {
                name: "analyze_video_url",
                description: "Download and analyze a video from URL",
                inputSchema: {
                  type: "object",
                  properties: {
                    video_url: { type: "string", description: "URL of the video" },
                    analysis_prompt: { type: "string", description: "Optional custom prompt" }
                  },
                  required: ["video_url"]
                }
              }
            ]
          }));
          break;
          
        case 'call_tool':
          const { tool, arguments: args, id } = data;
          
          try {
            let result;
            
            switch (tool) {
              case 'analyze_video_file':
                result = await analyzeVideo(args.file_path, args.analysis_prompt);
                break;
                
              case 'analyze_video_url':
                const tempFilePath = path.join(TEMP_DIR, `${uuidv4()}.mp4`);
                try {
                  await downloadFile(args.video_url, tempFilePath);
                  result = await analyzeVideo(tempFilePath, args.analysis_prompt);
                  if (fs.existsSync(tempFilePath)) {
                    fs.unlinkSync(tempFilePath);
                  }
                } catch (error) {
                  if (fs.existsSync(tempFilePath)) {
                    fs.unlinkSync(tempFilePath);
                  }
                  throw error;
                }
                break;
                
              default:
                throw new Error(`Unknown tool: ${tool}`);
            }
            
            ws.send(JSON.stringify({
              type: 'tool_result',
              id,
              content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
            }));
          } catch (error) {
            ws.send(JSON.stringify({
              type: 'error',
              id,
              error: error.message
            }));
          }
          break;
          
        case 'ping':
          ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
          break;
          
        default:
          ws.send(JSON.stringify({ 
            type: 'error', 
            error: `Unknown message type: ${data.type}` 
          }));
      }
    } catch (error) {
      log(`WebSocket error from ${clientId}: ${error.message}`, 'ERROR');
      ws.send(JSON.stringify({ type: 'error', error: error.message }));
    }
  });
  
  ws.on('close', () => {
    log(`WebSocket client disconnected: ${clientId}`);
  });
  
  ws.on('error', (error) => {
    log(`WebSocket error for ${clientId}: ${error.message}`, 'ERROR');
  });
  
  // Send initial connection confirmation
  ws.send(JSON.stringify({
    type: 'connected',
    clientId,
    version: '1.0.0'
  }));
});

// Error handling middleware
app.use((error, req, res, next) => {
  log(`Express error: ${error.message}`, 'ERROR');
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? error.message : undefined
  });
});

// Start server
server.listen(PORT, '0.0.0.0', () => {
  log(`Video Analysis Remote MCP Server started on port ${PORT}`);
  log(`WebSocket endpoint: ws://localhost:${PORT}/ws/mcp`);
  log(`REST API endpoint: http://localhost:${PORT}/api`);
  
  // Log authentication status
  if (!ENABLE_AUTH) {
    log(`Authentication: DISABLED (ENABLE_AUTH=false)`, 'WARN');
  } else if (API_KEY) {
    log(`Authentication: API Key configured`);
  } else {
    log(`Authentication: Enabled but no API Key set (Warning!)`, 'WARN');
  }
  
  log(`CORS: ${ENABLE_CORS ? `Enabled (${CORS_ORIGIN})` : 'Disabled'}`);
  
  if (!GOOGLE_API_KEY) {
    log('WARNING: GOOGLE_API_KEY not set. Video analysis will not work!', 'WARN');
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  log('SIGTERM received, shutting down gracefully...');
  server.close(() => {
    log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  log('SIGINT received, shutting down gracefully...');
  server.close(() => {
    log('Server closed');
    process.exit(0);
  });
});
