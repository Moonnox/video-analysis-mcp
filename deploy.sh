#!/bin/bash

# Video Analysis MCP Remote Server Deployment Script
# Usage: ./deploy.sh [local|docker|production]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Functions
print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

check_requirements() {
    echo "Checking requirements..."
    
    # Check Node.js
    if ! command -v node &> /dev/null; then
        print_error "Node.js is not installed"
        exit 1
    fi
    print_success "Node.js found: $(node --version)"
    
    # Check npm
    if ! command -v npm &> /dev/null; then
        print_error "npm is not installed"
        exit 1
    fi
    print_success "npm found: $(npm --version)"
    
    # Check for .env file
    if [ ! -f .env ]; then
        print_warning ".env file not found. Creating from template..."
        cp env.example .env
        print_warning "Please edit .env file with your configuration"
        exit 1
    fi
    print_success ".env file found"
    
    # Check for Google API key
    if grep -q "your-google-api-key-here" .env; then
        print_error "Please set GOOGLE_API_KEY in .env file"
        exit 1
    fi
    print_success "Google API key configured"
}

install_dependencies() {
    echo "Installing dependencies..."
    npm install
    print_success "Dependencies installed"
}

deploy_local() {
    echo "Deploying locally..."
    check_requirements
    install_dependencies
    
    # Start the server
    echo "Starting remote server on port 8080..."
    npm run start:remote
}

deploy_docker() {
    echo "Deploying with Docker..."
    
    # Check Docker
    if ! command -v docker &> /dev/null; then
        print_error "Docker is not installed"
        exit 1
    fi
    print_success "Docker found"
    
    # Check Docker Compose
    if ! command -v docker-compose &> /dev/null; then
        print_warning "docker-compose not found, using docker compose"
        COMPOSE_CMD="docker compose"
    else
        COMPOSE_CMD="docker-compose"
    fi
    
    # Check .env file
    if [ ! -f .env ]; then
        print_error ".env file not found. Please create it from env.example"
        exit 1
    fi
    
    echo "Building Docker image..."
    $COMPOSE_CMD build
    
    echo "Starting containers..."
    $COMPOSE_CMD up -d
    
    print_success "Docker deployment complete"
    echo "Server is running at http://localhost:8080"
    echo "View logs: $COMPOSE_CMD logs -f"
}

deploy_production() {
    echo "Production deployment..."
    
    # Check for production requirements
    if [ ! -f ssl/cert.pem ] || [ ! -f ssl/key.pem ]; then
        print_warning "SSL certificates not found in ssl/ directory"
        echo "For HTTPS, place cert.pem and key.pem in ssl/ directory"
        read -p "Continue without SSL? (y/n) " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
        PROFILE=""
    else
        print_success "SSL certificates found"
        PROFILE="--profile with-ssl"
    fi
    
    # Check production environment variables
    if grep -q "change-this-in-production" .env; then
        print_error "Please update JWT_SECRET in .env for production"
        exit 1
    fi
    
    if ! grep -q "API_KEY=" .env || grep -q "your-secure-api-key-here" .env; then
        print_error "Please set a secure API_KEY in .env for production"
        exit 1
    fi
    
    # Build and deploy
    echo "Building production Docker image..."
    docker build -f Dockerfile.remote -t video-analysis-remote:latest .
    
    if [ -n "$PROFILE" ]; then
        echo "Starting with SSL/Nginx..."
        docker-compose $PROFILE up -d
    else
        echo "Starting without SSL..."
        docker-compose up -d
    fi
    
    print_success "Production deployment complete"
    echo "Server is running on port ${PORT:-8080}"
    
    # Show status
    sleep 3
    if curl -s http://localhost:${PORT:-8080}/health > /dev/null; then
        print_success "Health check passed"
    else
        print_error "Health check failed"
    fi
}

show_status() {
    echo "Checking server status..."
    
    # Check if running locally
    if pgrep -f "node.*remote-server.js" > /dev/null; then
        print_success "Local server is running"
    fi
    
    # Check Docker
    if command -v docker &> /dev/null; then
        if docker ps | grep -q video-analysis-remote; then
            print_success "Docker container is running"
            docker ps | grep video-analysis-remote
        fi
    fi
    
    # Check health endpoint
    if curl -s http://localhost:${PORT:-8080}/health > /dev/null; then
        print_success "Server is responding to health checks"
        curl -s http://localhost:${PORT:-8080}/health | python3 -m json.tool 2>/dev/null || cat
    else
        print_warning "Server is not responding on port ${PORT:-8080}"
    fi
}

stop_server() {
    echo "Stopping server..."
    
    # Stop local Node.js process
    if pgrep -f "node.*remote-server.js" > /dev/null; then
        echo "Stopping local server..."
        pkill -f "node.*remote-server.js"
        print_success "Local server stopped"
    fi
    
    # Stop Docker containers
    if command -v docker &> /dev/null; then
        if docker ps | grep -q video-analysis-remote; then
            echo "Stopping Docker containers..."
            docker-compose down
            print_success "Docker containers stopped"
        fi
    fi
}

# Main script
case "${1:-local}" in
    local)
        deploy_local
        ;;
    docker)
        deploy_docker
        ;;
    production|prod)
        deploy_production
        ;;
    status)
        show_status
        ;;
    stop)
        stop_server
        ;;
    restart)
        stop_server
        sleep 2
        deploy_docker
        ;;
    *)
        echo "Video Analysis MCP Remote Server Deployment"
        echo ""
        echo "Usage: $0 [command]"
        echo ""
        echo "Commands:"
        echo "  local       - Run locally with Node.js (default)"
        echo "  docker      - Deploy with Docker Compose"
        echo "  production  - Deploy for production with SSL support"
        echo "  status      - Check server status"
        echo "  stop        - Stop all running servers"
        echo "  restart     - Restart Docker deployment"
        echo ""
        echo "Examples:"
        echo "  $0 local      # Run locally for development"
        echo "  $0 docker     # Deploy with Docker"
        echo "  $0 production # Deploy for production"
        exit 1
        ;;
esac
