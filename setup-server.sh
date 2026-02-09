#!/bin/bash
set -e

echo "=========================================="
echo "  Minecraft AI Bot - Server Setup"
echo "=========================================="

# Update system
echo "[1/6] Updating system packages..."
sudo apt-get update
sudo apt-get upgrade -y

# Install Docker
echo "[2/6] Installing Docker..."
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker $USER

# Install Node.js 22
echo "[3/6] Installing Node.js 22..."
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install pnpm
echo "[4/6] Installing pnpm..."
sudo npm install -g pnpm

# Create app directory
echo "[5/6] Setting up application directory..."
mkdir -p ~/minecraft-bot
cd ~/minecraft-bot

echo "[6/6] Setup complete!"
echo ""
echo "Next steps:"
echo "  1. Log out and back in (for Docker group permissions)"
echo "  2. Upload your code to ~/minecraft-bot"
echo "  3. Run: cd ~/minecraft-bot && pnpm install"
echo "  4. Configure .env file"
echo "  5. Start Minecraft server and bot"
echo ""
echo "=========================================="
