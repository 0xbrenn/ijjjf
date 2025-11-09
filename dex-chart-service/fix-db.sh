#!/bin/bash

# Quick Fix for PostgreSQL Connection Issue

echo "🔧 Fixing PostgreSQL connection..."

# Get current macOS username
MAC_USER=$(whoami)

# Check if PostgreSQL is running
if ! brew services list | grep -q "postgresql.*started"; then
    echo "📦 Starting PostgreSQL..."
    brew services start postgresql@15
    sleep 2
fi

# Check if Redis is running
if ! brew services list | grep -q "redis.*started"; then
    echo "📦 Starting Redis..."
    brew services start redis
    sleep 2
fi

# Create database and user
echo "💾 Setting up database..."

# Try to create database as current user
createdb dex_charts 2>/dev/null || echo "Database 'dex_charts' already exists"

# Create postgres user with password
psql -d postgres -c "CREATE USER postgres WITH SUPERUSER PASSWORD 'postgres_password';" 2>/dev/null || echo "User 'postgres' already exists"

# Grant permissions
psql -d postgres -c "GRANT ALL PRIVILEGES ON DATABASE dex_charts TO postgres;" 2>/dev/null

# Initialize database schema
echo "🔧 Initializing database schema..."
psql -U $MAC_USER -d dex_charts < backend/database/init.sql

# Update .env file
echo "📝 Updating .env file..."

if [ -f .env ]; then
    # Backup current .env
    cp .env .env.backup
    
    # Update DB_USER to current macOS user
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "s/DB_USER=.*/DB_USER=$MAC_USER/" .env
        sed -i '' "s/DB_PASSWORD=.*/DB_PASSWORD=/" .env
    else
        sed -i "s/DB_USER=.*/DB_USER=$MAC_USER/" .env
        sed -i "s/DB_PASSWORD=.*/DB_PASSWORD=/" .env
    fi
else
    # Create new .env from example
    cp .env.example .env
    sed -i '' "s/DB_USER=.*/DB_USER=$MAC_USER/" .env
    sed -i '' "s/DB_PASSWORD=.*/DB_PASSWORD=/" .env
fi

echo "✅ Fixed! Your database should now work."
echo ""
echo "Current configuration:"
echo "  DB_USER: $MAC_USER"
echo "  DB_PASSWORD: (empty)"
echo "  DB_NAME: dex_charts"
echo ""
echo "⚠️  Don't forget to add your RPC_URL to .env!"
echo ""
echo "Now run: yarn dev"