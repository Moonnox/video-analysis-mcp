#!/usr/bin/env node

/**
 * Test script for the Video Analysis Remote MCP Server
 * 
 * Usage: node test-remote.js [server-url] [api-key]
 */

const fetch = require('node-fetch');
const WebSocket = require('ws');

const SERVER_URL = process.argv[2] || 'http://localhost:8080';
const API_KEY = process.argv[3] || process.env.API_KEY;

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function testHealthCheck() {
  log('\n📋 Testing Health Check...', 'blue');
  try {
    const response = await fetch(`${SERVER_URL}/health`);
    const data = await response.json();
    
    if (response.ok && data.status === 'healthy') {
      log('✅ Health check passed', 'green');
      log(`   Status: ${data.status}`, 'green');
      log(`   Version: ${data.version}`, 'green');
    } else {
      log('❌ Health check failed', 'red');
    }
  } catch (error) {
    log(`❌ Health check error: ${error.message}`, 'red');
  }
}

async function testAuthentication() {
  log('\n🔐 Testing Authentication...', 'blue');
  
  try {
    // First try without authentication to see if it's disabled
    const noAuthResponse = await fetch(`${SERVER_URL}/api/status`);
    
    if (noAuthResponse.ok) {
      const data = await noAuthResponse.json();
      log('⚠️  Authentication is DISABLED on the server', 'yellow');
      log(`   Server status: ${data.status}`, 'green');
      log(`   Google API configured: ${data.api_key_configured}`, 'green');
      return true;
    }
    
    // Authentication is required, test with API key
    if (!API_KEY) {
      log('❌ Authentication is required but no API key provided', 'red');
      log('   Set API_KEY environment variable or pass as argument', 'yellow');
      return false;
    }
    
    const response = await fetch(`${SERVER_URL}/api/status`, {
      headers: { 'X-API-Key': API_KEY }
    });
    
    if (response.ok) {
      const data = await response.json();
      log('✅ Authentication successful with API key', 'green');
      log(`   Server status: ${data.status}`, 'green');
      log(`   Google API configured: ${data.api_key_configured}`, 'green');
      return true;
    } else if (response.status === 401) {
      log('❌ Authentication failed - Invalid API key', 'red');
      return false;
    } else {
      log(`❌ Authentication test failed: ${response.statusText}`, 'red');
      return false;
    }
  } catch (error) {
    log(`❌ Authentication error: ${error.message}`, 'red');
    return false;
  }
}

async function testMCPTools() {
  log('\n🔧 Testing MCP Tools Listing...', 'blue');
  
  const headers = API_KEY ? { 'X-API-Key': API_KEY } : {};
  
  try {
    const response = await fetch(`${SERVER_URL}/api/mcp/tools`, {
      method: 'POST',
      headers
    });
    
    if (response.ok) {
      const data = await response.json();
      log('✅ MCP tools retrieved successfully', 'green');
      
      if (data.tools && data.tools.length > 0) {
        log(`   Found ${data.tools.length} tools:`, 'green');
        data.tools.forEach(tool => {
          log(`   - ${tool.name}: ${tool.description}`, 'green');
        });
      }
    } else {
      log(`❌ Failed to retrieve MCP tools: ${response.statusText}`, 'red');
    }
  } catch (error) {
    log(`❌ MCP tools error: ${error.message}`, 'red');
  }
}

async function testWebSocket() {
  log('\n🔌 Testing WebSocket Connection...', 'blue');
  
  return new Promise((resolve) => {
    const wsUrl = SERVER_URL.replace('http', 'ws');
    const authParam = API_KEY ? `?api_key=${API_KEY}` : '';
    const ws = new WebSocket(`${wsUrl}/ws/mcp${authParam}`);
    
    let timeout = setTimeout(() => {
      log('❌ WebSocket connection timeout', 'red');
      ws.close();
      resolve();
    }, 5000);
    
    ws.on('open', () => {
      log('✅ WebSocket connected', 'green');
      
      // Send ping
      ws.send(JSON.stringify({ type: 'ping' }));
    });
    
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data);
        
        switch (message.type) {
          case 'connected':
            log(`   Client ID: ${message.clientId}`, 'green');
            log(`   Version: ${message.version}`, 'green');
            break;
            
          case 'pong':
            log('✅ WebSocket ping/pong successful', 'green');
            
            // Test listing tools
            ws.send(JSON.stringify({ type: 'list_tools' }));
            break;
            
          case 'tools':
            log('✅ WebSocket tools listing successful', 'green');
            log(`   Received ${message.tools.length} tools`, 'green');
            
            // Clean close
            clearTimeout(timeout);
            ws.close();
            resolve();
            break;
            
          case 'error':
            log(`❌ WebSocket error: ${message.error}`, 'red');
            break;
        }
      } catch (error) {
        log(`❌ WebSocket message parse error: ${error.message}`, 'red');
      }
    });
    
    ws.on('error', (error) => {
      log(`❌ WebSocket error: ${error.message}`, 'red');
      clearTimeout(timeout);
      resolve();
    });
    
    ws.on('close', () => {
      log('   WebSocket disconnected', 'blue');
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function testVideoAnalysisURL() {
  log('\n🎥 Testing Video Analysis (URL)...', 'blue');
  
  // Using a small test video URL (you should replace with your own)
  const testVideoUrl = 'https://sample-videos.com/video321/mp4/720/big_buck_bunny_720p_1mb.mp4';
  
  try {
    log(`   Analyzing video: ${testVideoUrl}`, 'blue');
    
    const headers = { 'Content-Type': 'application/json' };
    if (API_KEY) {
      headers['X-API-Key'] = API_KEY;
    }
    
    const response = await fetch(`${SERVER_URL}/api/analyze/url`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        video_url: testVideoUrl,
        analysis_prompt: 'Briefly describe what you see in this video in one sentence.'
      })
    });
    
    if (response.ok) {
      const data = await response.json();
      
      if (data.success) {
        log('✅ Video analysis successful', 'green');
        
        if (data.results && data.results.length > 0) {
          log('   Analysis results:', 'green');
          data.results.forEach(result => {
            log(`   - ${result.prompt}`, 'blue');
            log(`     ${result.analysis.substring(0, 100)}...`, 'green');
          });
        }
      } else {
        log(`❌ Video analysis failed: ${data.error}`, 'red');
      }
    } else {
      const error = await response.text();
      log(`❌ Video analysis request failed: ${error}`, 'red');
    }
  } catch (error) {
    log(`❌ Video analysis error: ${error.message}`, 'red');
    log('   Note: This might fail if Google API key is not configured', 'yellow');
  }
}

async function runTests() {
  log('========================================', 'blue');
  log('Video Analysis Remote MCP Server Tests', 'blue');
  log('========================================', 'blue');
  log(`Server URL: ${SERVER_URL}`, 'yellow');
  log(`API Key: ${API_KEY ? '***' + API_KEY.slice(-4) : 'Not provided'}`, 'yellow');
  
  // Run tests
  await testHealthCheck();
  const authSuccess = await testAuthentication();
  
  // Continue with tests regardless of auth status (auth might be disabled)
  await testMCPTools();
  await testWebSocket();
  
  // Optional: Test actual video analysis
  const testVideo = process.argv[4] === '--with-video';
  if (testVideo) {
    await testVideoAnalysisURL();
  } else {
    log('\n💡 Tip: Add --with-video flag to test actual video analysis', 'yellow');
  }
  
  log('\n========================================', 'blue');
  log('Tests Complete', 'blue');
  log('========================================', 'blue');
}

// Run tests
runTests().catch(error => {
  log(`\n❌ Test suite error: ${error.message}`, 'red');
  process.exit(1);
});
