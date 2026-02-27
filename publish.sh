#!/bin/bash

# Zulu7 GitHub Publishing Script
# This script initializes a git repository (if not already done) and pushes to the specified remote.

REPO_URL="https://github.com/jbrown360/zulu7.git"
BRANCH="main"

# Check if git is installed
if ! command -v git &> /dev/null; then
    echo "Error: git is not installed."
    exit 1
fi

# Initialize git if needed
if [ ! -d ".git" ]; then
    echo "Initializing git repository..."
    git init
    git branch -M $BRANCH
fi

# Check for .gitignore
if [ ! -f ".gitignore" ]; then
    echo "Warning: .gitignore not found. Creating a default one..."
    cat > .gitignore <<EOF
node_modules
dist
.env
.env.*
*.log
public/config.json
published_configs/
EOF
fi

# Add remote if it doesn't exist
if ! git remote | grep -q "origin"; then
    echo "Adding remote origin: $REPO_URL"
    git remote add origin $REPO_URL
else
    echo "Updating remote origin: $REPO_URL"
    git remote set-url origin $REPO_URL
fi

# Stage files
echo "Staging files..."
git add .

# Prompt for commit message
read -p "Enter commit message (default: 'update'): " COMMIT_MSG
COMMIT_MSG=${COMMIT_MSG:-"update"}

# Commit
echo "Committing changes..."
git commit -m "$COMMIT_MSG"

# Push
echo "Pushing to $BRANCH..."
git push -u origin $BRANCH

echo "Done! Dashboard published to $REPO_URL"
