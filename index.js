const express = require('express');
const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fetch = require('node-fetch');
const { v4: uuidv4 } = require('uuid');
const { promisify } = require('util');
const { pipeline } = require('stream');
const streamPipeline = promisify(pipeline);
const os = require('os');

// Configure Gemini API
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || 'AIzaSyAg4HnknP0qh74ysNmr_t8rnnTSokT8trg';
if (!GOOGLE_API_KEY) {
  console.error("Please set the GOOGLE_API_KEY environment variable");
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(GOOGLE_API_KEY);

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
  console.log(message);
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
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    
    // Default prompts if none provided
    const defaultPrompts = [
      "Analyze this video and provide a detailed timeline of key moments. For each important moment, scene change, or significant event, specify the approximate timestamp in seconds. Include: 1) A description of what happens at each moment, 2) The specific timestamp (in seconds) when it occurs, 3) Why this moment is significant or visually interesting. Format your response with clear timestamps like 'At 0s:', 'At 15s:', etc.",
      "Identify 5-10 of the most visually interesting or important frames in this video that would make good screenshots. For each frame, provide: 1) The exact timestamp in seconds, 2) What makes this frame significant, 3) What visual elements are present. Format timestamps clearly as numbers in seconds.",
      "Analyze the video's structure and identify timestamps for: 1) The opening/introduction, 2) Key transitions between topics or scenes, 3) Important moments showing the main subject matter, 4) The conclusion. Provide specific timestamps in seconds for each.",
      "Review this video and suggest optimal timestamps (in seconds) where screenshots should be captured to create a comprehensive visual summary. Aim for 6-12 timestamps that together tell the story of the video.",
      "Identify any moments in the video that contain: text overlays, important visual information, key demonstrations, or significant events. For each, provide the timestamp in seconds and describe what should be captured in a screenshot."
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

// Create Express app
const app = express();
app.use(express.json());

// API endpoints
app.post('/analyze_video_file', async (req, res) => {
  const { file_path, analysis_prompt } = req.body;
  log(`Received request to analyze video file: ${file_path}`);
  
  if (!file_path) {
    return res.status(400).json({
      success: false,
      error: 'File path is required'
    });
  }
  
  if (!fs.existsSync(file_path)) {
    return res.status(404).json({
      success: false,
      error: `File not found: ${file_path}`
    });
  }
  
  try {
    const result = await analyzeVideo(file_path, analysis_prompt);
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post('/analyze_video_url', async (req, res) => {
  const { video_url, analysis_prompt } = req.body;
  log(`Received request to analyze video from URL: ${video_url}`);
  
  if (!video_url) {
    return res.status(400).json({
      success: false,
      error: 'Video URL is required'
    });
  }
  
  try {
    // Generate a unique filename for the downloaded video
    const tempFilePath = path.join(TEMP_DIR, `${uuidv4()}.mp4`);
    
    // Download the video
    await downloadFile(video_url, tempFilePath);
    
    // Analyze the video
    const result = await analyzeVideo(tempFilePath, analysis_prompt);
    
    // Clean up the temporary file
    fs.unlinkSync(tempFilePath);
    log(`Deleted temporary file: ${tempFilePath}`);
    
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/status', (req, res) => {
  res.json({
    status: "operational",
    api_key_configured: !!GOOGLE_API_KEY,
    temp_directory: TEMP_DIR,
    log_directory: LOG_DIR
  });
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  log(`Video Analysis Server started on port ${PORT}`);
});
