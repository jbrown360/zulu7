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

# Ensure git is authenticated via gh CLI
if command -v gh &> /dev/null; then
    echo "Configuring GitHub CLI credential helper..."
    gh auth setup-git
    
    # Check if repo exists, create if not
    if ! gh repo view >/dev/null 2>&1; then
        echo "Repository not found on GitHub. Creating it now..."
        gh repo create zulu7 --public --source=. --remote=origin --push
        exit 0
    fi
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

# Push with Error Handling
echo "Pushing to $BRANCH..."
if git push -u origin $BRANCH; then
    echo "------------------------------------------------"
    echo "✅ SUCCESS! Dashboard published to $REPO_URL"
    echo "------------------------------------------------"
else
    EXIT_CODE=$?
    if [ $EXIT_CODE -eq 128 ]; then
        echo "------------------------------------------------"
        echo "❌ ERROR: Permission Denied (403)"
        echo "------------------------------------------------"
        echo "Your GitHub token does not have the 'repo' scope."
        echo "To fix this, run this command and follow the prompts:"
        echo ""
        echo "  gh auth login -w -s repo"
        echo ""
        echo "Select 'GitHub.com', 'HTTPS', and 'Login with a web browser'."
        echo "Ensure you allow 'repository' access in the browser."
        echo "------------------------------------------------"
    else
        echo "Push failed with exit code $EXIT_CODE"
    fi
    exit $EXIT_CODE
fi
