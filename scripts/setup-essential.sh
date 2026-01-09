#!/bin/bash
set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}Starting Bounty-Hunter Essentials Setup (Web Search MCP)${NC}"

# 1. Install Xvfb (for Headful mode in headless environments)
echo -e "${YELLOW}Checking for Xvfb...${NC}"
if ! command -v Xvfb &> /dev/null; then
    echo -e "${YELLOW}Xvfb not found. Installing...${NC}"
    sudo apt-get update && sudo apt-get install -y xvfb
    echo -e "${GREEN}Xvfb installed successfully.${NC}"
else
    echo -e "${GREEN}Xvfb is already installed.${NC}"
fi

# 2. Install Google Chrome Stable (Essential for "Golden Path" evasion)
echo -e "${YELLOW}Checking for Google Chrome...${NC}"
if ! command -v google-chrome-stable &> /dev/null; then
    echo -e "${YELLOW}Google Chrome not found. Installing...${NC}"
    
    # Download the .deb package
    wget -q https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
    
    # Install dependencies might be needed, install with apt
    sudo apt-get update
    sudo apt-get install -y ./google-chrome-stable_current_amd64.deb
    
    # Clean up
    rm google-chrome-stable_current_amd64.deb
    
    echo -e "${GREEN}Google Chrome installed successfully.${NC}"
else
    CHROME_VERSION=$(google-chrome-stable --version)
    echo -e "${GREEN}Google Chrome is already installed: $CHROME_VERSION${NC}"
fi

echo -e "${GREEN}Essentials setup complete!${NC}"
echo -e "Ready for Golden Path execution."
