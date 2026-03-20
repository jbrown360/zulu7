#!/bin/bash
# Zulu7 DigitalOcean Droplet Deployment Script
# This script installs Docker, clones the repository, and starts the Zulu7 services using docker-compose.
# Run this script on a fresh Ubuntu droplet as root.

set -e

# Configuration
# Run directly inside the rsynced zulu7 directory

echo "=================================================="
echo " Starting Zulu7 DigitalOcean Droplet Deployment   "
echo "=================================================="

# 1. System Update
echo ""
echo "[1/4] Updating system packages..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold" upgrade -y

# Install bare-metal scanning tools for native Node drops
apt-get install -y nmap

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

# Enable and start Docker service
systemctl enable docker
systemctl start docker

# 3. Setup Directories
echo ""
echo "[3/4] Setting up localized Zulu7 volumes..."

# Ensure necessary directories and files exist for docker volumes
mkdir -p published_configs
mkdir -p integrations

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

# Ensure sufficient memory for Docker build (Vite needs ~1.5GB RAM)
echo ""
echo "[*] Checking system memory and swap..."
if [ $(free -m | awk '/^Swap:/ {print $2}') -eq 0 ]; then
    echo "No swap space detected. Creating a 2GB swap file to prevent build crashes..."
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    # Persist swap across reboots
    echo "/swapfile none swap sw 0 0" >> /etc/fstab
    echo "Swap space created and enabled. Memory check passed."
else
    echo "Swap space already exists. Memory check passed."
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
echo "docker compose logs -f"
echo "=================================================="
