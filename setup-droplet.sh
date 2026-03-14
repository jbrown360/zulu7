#!/bin/bash
# Zulu7 DigitalOcean Droplet Deployment Script
# This script installs Docker, clones the repository, and starts the Zulu7 services using docker-compose.
# Run this script on a fresh Ubuntu droplet as root.

set -e

# Configuration
REPO_URL="https://github.com/jbrown360/zulu7.git"
INSTALL_DIR="/opt/zulu7"

echo "=================================================="
echo " Starting Zulu7 DigitalOcean Droplet Deployment   "
echo "=================================================="

# 1. System Update
echo ""
echo "[1/4] Updating system packages..."
apt-get update -y
apt-get upgrade -y

# 2. Install Docker & Docker Compose
echo ""
echo "[2/4] Installing Docker and Git..."
# Check if docker is already installed
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    rm get-docker.sh
else
    echo "Docker is already installed. Skipping installation."
fi

# Ensure git is installed (get-docker.sh handles docker-compose-plugin)
apt-get install -y git

# Enable and start Docker service
systemctl enable docker
systemctl start docker

# 3. Clone Repository
echo ""
echo "[3/4] Setting up Zulu7 application..."
if [ -d "$INSTALL_DIR" ]; then
    echo "Directory $INSTALL_DIR already exists. Pulling latest changes..."
    cd $INSTALL_DIR
    git pull
else
    echo "Cloning repository to $INSTALL_DIR..."
    git clone $REPO_URL $INSTALL_DIR
    cd $INSTALL_DIR
fi

# Ensure necessary directories and files exist for docker volumes
mkdir -p published_configs
# Create a default go2rtc config if it doesn't exist to prevent Docker mount errors
if [ ! -f "go2rtc.yaml" ]; then
    if [ -f "go2rtc.example.yaml" ]; then
        cp go2rtc.example.yaml go2rtc.yaml
        echo "Created initial go2rtc.yaml from example."
    else
        touch go2rtc.yaml
        echo "Created empty go2rtc.yaml."
    fi
fi

# 4. Build and Start Services
echo ""
echo "[4/4] Building and starting Docker containers..."
echo "This may take a few minutes as the Node.js application builds."
docker compose up -d --build

echo ""
echo "=================================================="
echo " Zulu7 Deployment Complete!                       "
echo "=================================================="
echo "Your dashboard should now be accessible at:"
echo "http://$(curl -s http://checkip.amazonaws.com):8080"
echo ""
echo "Streamer UI (Go2RTC) is accessible at:"
echo "http://$(curl -s http://checkip.amazonaws.com):1984"
echo ""
echo "To view logs, run:"
echo "cd $INSTALL_DIR && docker compose logs -f"
echo "=================================================="
