# Video Analysis MCP Remote Server

This is a remote-accessible version of the Video Analysis MCP Server that can be deployed on the internet and accessed via HTTP/WebSocket protocols. It provides video analysis capabilities using Google's Gemini AI through both REST API and WebSocket connections.

## Features

### Core Capabilities
- **Remote Access**: Access the MCP server over HTTP/HTTPS from anywhere
- **WebSocket Support**: Real-time bidirectional communication for MCP protocol
- **REST API**: Standard HTTP endpoints for video analysis
- **File Upload**: Direct video file upload support
- **URL Analysis**: Analyze videos from any accessible URL
- **Authentication**: Multiple authentication methods (API Key, JWT)
- **Security**: Rate limiting, CORS, helmet protection, input validation
- **Production Ready**: Docker support, health checks, logging, graceful shutdown

### Video Analysis Features
- Analyze local video files (upload)
- Download and analyze videos from URLs
- Custom analysis prompts
- Detailed video descriptions
- Quality assessment
- Content organization analysis
- User expectation evaluation

## Quick Start

### 1. Clone and Install

```bash
git clone https://github.com/your-repo/video-analysis-mcp.git
cd video-analysis-mcp
npm install
```

### 2. Configure Environment

```bash
cp env.example .env
# Edit .env with your configuration
```

Required configuration:
- `GOOGLE_API_KEY`: Your Google Gemini API key
- `API_KEY`: A secure API key for authentication (or use JWT)

### 3. Run Locally

```bash
# Start the remote server with authentication
npm run start:remote

# Or with environment variables
GOOGLE_API_KEY=your-key API_KEY=your-api-key node remote-server.js

# For development without authentication
GOOGLE_API_KEY=your-key ENABLE_AUTH=false node remote-server.js
```

### 4. Run with Docker

```bash
# Build and run with Docker Compose
docker-compose up -d

# Or build manually
docker build -f Dockerfile.remote -t video-analysis-remote .
docker run -p 8080:8080 --env-file .env video-analysis-remote
```

## API Documentation

### Authentication

Authentication can be completely disabled by setting `ENABLE_AUTH=false` in your environment variables. This is useful for development or when running on trusted internal networks.

When authentication is enabled (default), the server supports two authentication methods:

#### 1. API Key Authentication
Include your API key in requests:
```bash
# Header
X-API-Key: your-api-key

# Or query parameter
?api_key=your-api-key
```

#### 2. JWT Authentication
First obtain a token:
```bash
curl -X POST http://localhost:8080/api/auth/token \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"your-password"}'
```

Then use the token:
```bash
Authorization: Bearer your-jwt-token
```

### REST API Endpoints

#### Standard MCP Endpoint
```bash
# Discovery (no auth required)
GET /mcp

# MCP Operations (auth required if enabled)
POST /mcp
Content-Type: application/json

# For listing tools:
{"method": "tools/list"}

# For calling tools:
{
  "method": "tools/call",
  "params": {
    "name": "analyze_video_url",
    "arguments": {
      "video_url": "https://example.com/video.mp4"
    }
  }
}
```

#### Health Check
```bash
GET /health
# No authentication required
```

#### Server Status
```bash
GET /api/status
# Returns server status, configuration, and metrics
```

#### Analyze Video File
```bash
POST /api/analyze/file
Content-Type: multipart/form-data

# Form fields:
- video: [video file]
- analysis_prompt: (optional) custom prompt
```

Example with curl:
```bash
curl -X POST http://localhost:8080/api/analyze/file \
  -H "X-API-Key: your-api-key" \
  -F "video=@/path/to/video.mp4" \
  -F "analysis_prompt=What is happening in this video?"
```

#### Analyze Video URL
```bash
POST /api/analyze/url
Content-Type: application/json

{
  "video_url": "https://example.com/video.mp4",
  "analysis_prompt": "optional custom prompt"
}
```

Example:
```bash
curl -X POST http://localhost:8080/api/analyze/url \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"video_url":"https://example.com/video.mp4"}'
```

#### MCP Tool List
```bash
POST /api/mcp/tools
# Returns available MCP tools
```

#### MCP Tool Call
```bash
POST /api/mcp/call
Content-Type: application/json

{
  "tool": "tool_name",
  "arguments": {
    // tool-specific arguments
  }
}
```

### WebSocket API

Connect to WebSocket endpoint:
```
ws://localhost:8080/ws/mcp?api_key=your-api-key
```

#### Message Types

**List Tools:**
```json
{
  "type": "list_tools"
}
```

**Call Tool:**
```json
{
  "type": "call_tool",
  "id": 1,
  "tool": "analyze_video_url",
  "arguments": {
    "video_url": "https://example.com/video.mp4",
    "analysis_prompt": "Describe this video"
  }
}
```

**Ping:**
```json
{
  "type": "ping"
}
```

## Client SDK Usage

### JavaScript/Node.js

```javascript
const VideoAnalysisClient = require('./client-sdk');

// Initialize client
const client = new VideoAnalysisClient({
  baseUrl: 'https://your-server.com',
  apiKey: 'your-api-key'
});

// Analyze a video file
const result = await client.analyzeFile('/path/to/video.mp4');

// Analyze a video URL
const result = await client.analyzeUrl('https://example.com/video.mp4');

// Use WebSocket
await client.connectWebSocket();
const tools = await client.listToolsWS();
const result = await client.callToolWS('analyze_video_url', {
  video_url: 'https://example.com/video.mp4'
});
```

### Python Example

```python
import requests
import websocket
import json

# REST API
headers = {'X-API-Key': 'your-api-key'}

# Analyze URL
response = requests.post(
    'http://localhost:8080/api/analyze/url',
    json={'video_url': 'https://example.com/video.mp4'},
    headers=headers
)
result = response.json()

# WebSocket
ws = websocket.WebSocket()
ws.connect('ws://localhost:8080/ws/mcp?api_key=your-api-key')
ws.send(json.dumps({'type': 'list_tools'}))
tools = json.loads(ws.recv())
```

## Deployment

### Production Deployment with Docker

1. **Prepare SSL certificates** (for HTTPS):
```bash
mkdir ssl
# Place your cert.pem and key.pem in the ssl directory
```

2. **Configure production environment**:
```bash
cp env.example .env
# Edit .env with production values
# Set strong API_KEY and JWT_SECRET
# Configure CORS_ORIGIN for your domain
```

3. **Deploy with Docker Compose**:
```bash
# With SSL/Nginx
docker-compose --profile with-ssl up -d

# Without SSL (direct access)
docker-compose up -d
```

### Deploy to Cloud Providers

#### AWS EC2/ECS
```bash
# Build and push to ECR
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin your-ecr-url
docker build -f Dockerfile.remote -t video-analysis-remote .
docker tag video-analysis-remote:latest your-ecr-url/video-analysis-remote:latest
docker push your-ecr-url/video-analysis-remote:latest
```

#### Google Cloud Run
```bash
# Build and deploy
gcloud builds submit --tag gcr.io/your-project/video-analysis-remote
gcloud run deploy video-analysis-remote \
  --image gcr.io/your-project/video-analysis-remote \
  --platform managed \
  --allow-unauthenticated \
  --set-env-vars GOOGLE_API_KEY=$GOOGLE_API_KEY,API_KEY=$API_KEY
```

#### Heroku
```bash
# Create app and deploy
heroku create your-app-name
heroku config:set GOOGLE_API_KEY=your-key API_KEY=your-api-key
git push heroku main
```

### Kubernetes Deployment

Create a `deployment.yaml`:
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: video-analysis-remote
spec:
  replicas: 3
  selector:
    matchLabels:
      app: video-analysis
  template:
    metadata:
      labels:
        app: video-analysis
    spec:
      containers:
      - name: video-analysis
        image: your-registry/video-analysis-remote:latest
        ports:
        - containerPort: 8080
        env:
        - name: GOOGLE_API_KEY
          valueFrom:
            secretKeyRef:
              name: video-analysis-secrets
              key: google-api-key
        - name: API_KEY
          valueFrom:
            secretKeyRef:
              name: video-analysis-secrets
              key: api-key
```

## Security Considerations

1. **Authentication**: Always use authentication in production
   - Set a strong `API_KEY` or use JWT with secure secrets
   - Rotate keys regularly
   - Only disable authentication (`ENABLE_AUTH=false`) for development or trusted internal networks
   - Never expose an unauthenticated server to the public internet

2. **HTTPS**: Use SSL/TLS in production
   - Deploy behind a reverse proxy (Nginx) with SSL
   - Use services like Cloudflare for SSL termination

3. **Rate Limiting**: Configured by default
   - Adjust limits based on your needs
   - Consider implementing user-based quotas

4. **CORS**: Configure appropriately
   - Set specific origins instead of `*` in production
   - Only allow trusted domains

5. **File Uploads**: Validate and scan uploads
   - Maximum file size enforced (100MB default)
   - File type validation
   - Consider virus scanning for production

6. **Environment Variables**: Keep secrets secure
   - Never commit `.env` files
   - Use secret management services (AWS Secrets Manager, etc.)

## Monitoring

### Logs
Logs are stored in `/tmp/video-analysis-mcp-logs/remote-server.log`

### Health Checks
Monitor the `/health` endpoint:
```bash
curl http://localhost:8080/health
```

### Metrics
The `/api/status` endpoint provides:
- Server uptime
- Memory usage
- Configuration status
- API key configuration

## Troubleshooting

### Common Issues

1. **"Google API key is required"**
   - Ensure `GOOGLE_API_KEY` is set in environment

2. **"Authentication required"**
   - Include API key in requests
   - Check if API_KEY is configured on server

3. **"File too large"**
   - Default limit is 100MB
   - Adjust `MAX_FILE_SIZE` if needed

4. **WebSocket connection fails**
   - Check if authentication is included in URL
   - Verify WebSocket port is accessible
   - Check for proxy/firewall issues

5. **CORS errors**
   - Configure `CORS_ORIGIN` properly
   - Ensure `ENABLE_CORS=true`

### Debug Mode

Run in debug mode:
```bash
NODE_ENV=development node remote-server.js
```

## Performance Optimization

1. **Caching**: Consider implementing Redis for caching results
2. **CDN**: Use CDN for serving analyzed video metadata
3. **Queue System**: Implement job queue for large videos
4. **Horizontal Scaling**: Deploy multiple instances with load balancer
5. **Database**: Store analysis results in database for retrieval

## License

MIT

## Support

For issues and questions:
- GitHub Issues: [your-repo/issues]
- Email: support@your-domain.com

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request
