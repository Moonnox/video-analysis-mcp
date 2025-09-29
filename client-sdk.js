/**
 * Client SDK for connecting to the remote Video Analysis MCP Server
 * 
 * Usage:
 * const client = new VideoAnalysisClient({
 *   baseUrl: 'https://your-server.com',
 *   apiKey: 'your-api-key',
 *   // or use JWT:
 *   username: 'admin',
 *   password: 'your-password'
 * });
 */

const fetch = require('node-fetch');
const WebSocket = require('ws');
const EventEmitter = require('events');
const FormData = require('form-data');
const fs = require('fs');

class VideoAnalysisClient extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.baseUrl = config.baseUrl || 'http://localhost:8080';
    this.apiKey = config.apiKey;
    this.username = config.username;
    this.password = config.password;
    this.token = null;
    this.ws = null;
    this.requestId = 0;
    this.pendingRequests = new Map();
  }

  /**
   * Get authentication headers
   */
  async getAuthHeaders() {
    const headers = {};
    
    if (this.apiKey) {
      headers['X-API-Key'] = this.apiKey;
    } else if (this.username && this.password && !this.token) {
      // Get JWT token
      await this.authenticate();
    }
    
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    
    return headers;
  }

  /**
   * Authenticate with username/password to get JWT token
   */
  async authenticate() {
    const response = await fetch(`${this.baseUrl}/api/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: this.username,
        password: this.password
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Authentication failed: ${error.error || response.statusText}`);
    }

    const data = await response.json();
    this.token = data.token;
    this.emit('authenticated', { expiresIn: data.expiresIn });
    return data;
  }

  /**
   * Check server health
   */
  async checkHealth() {
    const response = await fetch(`${this.baseUrl}/health`);
    return response.json();
  }

  /**
   * Get server status
   */
  async getStatus() {
    const headers = await this.getAuthHeaders();
    const response = await fetch(`${this.baseUrl}/api/status`, { headers });
    
    if (!response.ok) {
      throw new Error(`Failed to get status: ${response.statusText}`);
    }
    
    return response.json();
  }

  /**
   * Analyze a local video file
   */
  async analyzeFile(filePath, analysisPrompt = null) {
    const headers = await this.getAuthHeaders();
    
    const form = new FormData();
    form.append('video', fs.createReadStream(filePath));
    if (analysisPrompt) {
      form.append('analysis_prompt', analysisPrompt);
    }

    const response = await fetch(`${this.baseUrl}/api/analyze/file`, {
      method: 'POST',
      headers: {
        ...headers,
        ...form.getHeaders()
      },
      body: form
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Analysis failed: ${error.error || response.statusText}`);
    }

    return response.json();
  }

  /**
   * Analyze a video from URL
   */
  async analyzeUrl(videoUrl, analysisPrompt = null) {
    const headers = await this.getAuthHeaders();
    
    const response = await fetch(`${this.baseUrl}/api/analyze/url`, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        video_url: videoUrl,
        analysis_prompt: analysisPrompt
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Analysis failed: ${error.error || response.statusText}`);
    }

    return response.json();
  }

  /**
   * List available MCP tools
   */
  async listTools() {
    const headers = await this.getAuthHeaders();
    
    const response = await fetch(`${this.baseUrl}/api/mcp/tools`, {
      method: 'POST',
      headers
    });

    if (!response.ok) {
      throw new Error(`Failed to list tools: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Call an MCP tool
   */
  async callTool(toolName, args = {}) {
    const headers = await this.getAuthHeaders();
    
    const response = await fetch(`${this.baseUrl}/api/mcp/call`, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        tool: toolName,
        arguments: args
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Tool call failed: ${error.error || response.statusText}`);
    }

    return response.json();
  }

  /**
   * Connect to WebSocket for real-time communication
   */
  async connectWebSocket() {
    const authParams = this.apiKey 
      ? `api_key=${this.apiKey}`
      : this.token 
        ? `token=${this.token}`
        : '';
    
    const wsUrl = this.baseUrl.replace('http', 'ws');
    const url = `${wsUrl}/ws/mcp${authParams ? '?' + authParams : ''}`;
    
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);
      
      this.ws.on('open', () => {
        this.emit('ws:connected');
        resolve();
      });
      
      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data);
          this.handleWebSocketMessage(message);
        } catch (error) {
          this.emit('ws:error', error);
        }
      });
      
      this.ws.on('close', (code, reason) => {
        this.emit('ws:disconnected', { code, reason });
        this.ws = null;
      });
      
      this.ws.on('error', (error) => {
        this.emit('ws:error', error);
        reject(error);
      });
    });
  }

  /**
   * Handle incoming WebSocket messages
   */
  handleWebSocketMessage(message) {
    switch (message.type) {
      case 'connected':
        this.emit('ws:ready', message);
        break;
        
      case 'tools':
        this.emit('tools', message.tools);
        break;
        
      case 'tool_result':
        if (message.id && this.pendingRequests.has(message.id)) {
          const { resolve } = this.pendingRequests.get(message.id);
          this.pendingRequests.delete(message.id);
          resolve(message.content);
        }
        this.emit('tool:result', message);
        break;
        
      case 'error':
        if (message.id && this.pendingRequests.has(message.id)) {
          const { reject } = this.pendingRequests.get(message.id);
          this.pendingRequests.delete(message.id);
          reject(new Error(message.error));
        }
        this.emit('ws:error', new Error(message.error));
        break;
        
      case 'pong':
        this.emit('ws:pong', message.timestamp);
        break;
        
      default:
        this.emit('ws:message', message);
    }
  }

  /**
   * Send a WebSocket message
   */
  sendWebSocketMessage(message) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not connected');
    }
    
    this.ws.send(JSON.stringify(message));
  }

  /**
   * List tools via WebSocket
   */
  async listToolsWS() {
    return new Promise((resolve) => {
      this.once('tools', resolve);
      this.sendWebSocketMessage({ type: 'list_tools' });
    });
  }

  /**
   * Call a tool via WebSocket
   */
  async callToolWS(toolName, args = {}) {
    const id = ++this.requestId;
    
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      
      this.sendWebSocketMessage({
        type: 'call_tool',
        id,
        tool: toolName,
        arguments: args
      });
      
      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Tool call timeout'));
        }
      }, 30000);
    });
  }

  /**
   * Ping WebSocket connection
   */
  ping() {
    this.sendWebSocketMessage({ type: 'ping' });
  }

  /**
   * Disconnect WebSocket
   */
  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

// Example usage
async function example() {
  // Create client with API key
  const client = new VideoAnalysisClient({
    baseUrl: 'http://localhost:8080',
    apiKey: 'your-api-key-here'
  });

  // Or with username/password
  // const client = new VideoAnalysisClient({
  //   baseUrl: 'http://localhost:8080',
  //   username: 'admin',
  //   password: 'admin'
  // });

  try {
    // Check health
    const health = await client.checkHealth();
    console.log('Server health:', health);

    // Get status
    const status = await client.getStatus();
    console.log('Server status:', status);

    // Analyze a video file
    // const fileResult = await client.analyzeFile('/path/to/video.mp4', 'What is happening in this video?');
    // console.log('File analysis:', fileResult);

    // Analyze a video URL
    // const urlResult = await client.analyzeUrl('https://example.com/video.mp4');
    // console.log('URL analysis:', urlResult);

    // Use MCP-style tool calling
    const tools = await client.listTools();
    console.log('Available tools:', tools);

    // Connect WebSocket for real-time communication
    await client.connectWebSocket();
    console.log('WebSocket connected');

    // List tools via WebSocket
    const wsTools = await client.listToolsWS();
    console.log('Tools via WebSocket:', wsTools);

    // Call a tool via WebSocket
    // const wsResult = await client.callToolWS('analyze_video_url', {
    //   video_url: 'https://example.com/video.mp4',
    //   analysis_prompt: 'Describe this video'
    // });
    // console.log('WebSocket tool result:', wsResult);

    // Disconnect
    client.disconnect();

  } catch (error) {
    console.error('Error:', error.message);
  }
}

module.exports = VideoAnalysisClient;

// Run example if this file is executed directly
if (require.main === module) {
  example();
}
