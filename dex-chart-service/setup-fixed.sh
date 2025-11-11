#!/bin/bash

# DEX Chart Service - Complete Setup Script
# Works with both npm and yarn

echo "🚀 DEX Chart Service Setup Starting..."

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Detect package manager preference
if command -v yarn >/dev/null 2>&1; then
    PKG_MANAGER="yarn"
    PKG_INSTALL="yarn add"
    PKG_INSTALL_DEV="yarn add -D"
    PKG_RUN="yarn"
else
    PKG_MANAGER="npm"
    PKG_INSTALL="npm install --save"
    PKG_INSTALL_DEV="npm install --save-dev"
    PKG_RUN="npm run"
fi

echo "📦 Using package manager: $PKG_MANAGER"

# Create project structure
echo "📁 Creating project structure..."
mkdir -p backend/indexer
mkdir -p backend/api
mkdir -p backend/websocket
mkdir -p backend/database/migrations
mkdir -p frontend/components
mkdir -p frontend/services
mkdir -p frontend/pages
mkdir -p frontend/styles
mkdir -p frontend/public
mkdir -p infrastructure/nginx

echo "✓ Project structure created"

# Create package.json files
echo "⚙️ Creating package configurations..."

# Backend package.json
cat > package.json << 'ENDFILE'
{
  "name": "dex-chart-backend",
  "version": "1.0.0",
  "description": "DEX Chart Service Backend",
  "scripts": {
    "dev:indexer": "tsx watch backend/indexer/index.ts",
    "dev:api": "tsx watch backend/api/server.ts",
    "dev:ws": "tsx watch backend/websocket/server.ts",
    "build": "tsc",
    "start:indexer": "node dist/indexer/index.js",
    "start:api": "node dist/api/server.js",
    "start:ws": "node dist/websocket/server.js"
  }
}
ENDFILE

# Frontend package.json
cat > frontend/package.json << 'ENDFILE'
{
  "name": "dex-chart-frontend",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev -p 3001",
    "build": "next build",
    "start": "next start -p 3001",
    "lint": "next lint"
  }
}
ENDFILE

# Install backend dependencies
echo "📦 Installing backend dependencies..."
$PKG_INSTALL ethers@^6.9.0 express@^4.18.2 socket.io@^4.6.1 socket.io-client@^4.6.1 pg@^8.11.3 ioredis@^5.3.2 cors@^2.8.5 compression@^1.7.4 express-rate-limit@^7.1.5 dotenv@^16.3.1 helmet@^7.1.0 morgan@^1.10.0 winston@^3.11.0

$PKG_INSTALL_DEV @types/node@^20.10.4 @types/express@^4.17.21 @types/pg@^8.10.9 @types/cors@^2.8.17 @types/compression@^1.7.5 @types/morgan@^1.9.9 typescript@^5.3.3 tsx@^4.6.2 nodemon@^3.0.2 prettier@^3.1.1 eslint@^8.55.0

echo "✓ Backend dependencies installed"

# Install frontend dependencies
echo "📦 Installing frontend dependencies..."
cd frontend
$PKG_INSTALL react@^18.2.0 react-dom@^18.2.0 next@^14.0.4 lightweight-charts@^4.1.2 socket.io-client@^4.6.1 axios@^1.6.2 ethers@^6.9.0 @tanstack/react-query@^5.12.2 zustand@^4.4.7 tailwindcss@^3.3.6 autoprefixer@^10.4.16 postcss@^8.4.32 @heroicons/react@^2.0.18 react-hot-toast@^2.4.1 date-fns@^2.30.0

$PKG_INSTALL_DEV @types/react@^18.2.45 @types/react-dom@^18.2.18 @types/node@^20.10.4 typescript@^5.3.3 eslint@^8.55.0 eslint-config-next@^14.0.4

cd ..
echo "✓ Frontend dependencies installed"

# Create TypeScript configuration
cat > tsconfig.json << 'ENDFILE'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "moduleResolution": "node",
    "allowJs": true,
    "sourceMap": true
  },
  "include": ["backend/**/*"],
  "exclude": ["node_modules", "dist", "frontend"]
}
ENDFILE

# Create .env.example
cat > .env.example << 'ENDFILE'
# Blockchain Configuration
RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_ALCHEMY_KEY
CHAIN_ID=1
FACTORY_ADDRESS=0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f
ROUTER_ADDRESS=0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D

# Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_NAME=dex_charts
DB_USER=postgres
DB_PASSWORD=postgres_password

# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379

# API Configuration
API_PORT=3000
WS_PORT=3002

# Frontend Configuration
FRONTEND_URL=http://localhost:3001
REACT_APP_API_URL=http://localhost:3000
REACT_APP_WS_URL=http://localhost:3002
ENDFILE

cp .env.example .env

# Create start scripts
cat > start.sh << 'ENDFILE'
#!/bin/bash
echo "🚀 Starting DEX Chart Service..."
docker-compose up -d
echo "✅ Services started!"
echo "📊 Frontend: http://localhost:3001"
echo "🔌 API: http://localhost:3000"
ENDFILE
chmod +x start.sh

cat > stop.sh << 'ENDFILE'
#!/bin/bash
echo "🛑 Stopping DEX Chart Service..."
docker-compose down
echo "✅ Services stopped"
ENDFILE
chmod +x stop.sh

# Create database init script
mkdir -p backend/database
cat > backend/database/init.sql << 'ENDFILE'
-- Create tables
CREATE TABLE IF NOT EXISTS pairs (
    address VARCHAR(42) PRIMARY KEY,
    token0 VARCHAR(42) NOT NULL,
    token1 VARCHAR(42) NOT NULL,
    token0_symbol VARCHAR(20),
    token1_symbol VARCHAR(20),
    token0_decimals INT DEFAULT 18,
    token1_decimals INT DEFAULT 18,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS trades (
    id SERIAL PRIMARY KEY,
    block_number BIGINT NOT NULL,
    transaction_hash VARCHAR(66) NOT NULL,
    timestamp BIGINT NOT NULL,
    pair_address VARCHAR(42) NOT NULL,
    token0_amount NUMERIC(78, 0) NOT NULL,
    token1_amount NUMERIC(78, 0) NOT NULL,
    price NUMERIC(40, 18) NOT NULL,
    volume_usd NUMERIC(40, 18),
    maker VARCHAR(42) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS candles (
    id SERIAL PRIMARY KEY,
    pair_address VARCHAR(42) NOT NULL,
    timeframe VARCHAR(10) NOT NULL,
    time BIGINT NOT NULL,
    open NUMERIC(40, 18) NOT NULL,
    high NUMERIC(40, 18) NOT NULL,
    low NUMERIC(40, 18) NOT NULL,
    close NUMERIC(40, 18) NOT NULL,
    volume NUMERIC(40, 18) NOT NULL,
    trades INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(pair_address, timeframe, time)
);

-- Create indexes
CREATE INDEX idx_trades_pair_timestamp ON trades(pair_address, timestamp DESC);
CREATE INDEX idx_trades_timestamp ON trades(timestamp DESC);
CREATE INDEX idx_candles_lookup ON candles(pair_address, timeframe, time DESC);
ENDFILE

echo "✅ Setup Complete!"
echo ""
echo "📋 Next Steps:"
echo "1. Edit .env file with your RPC URL and configuration"
echo "2. Run ./start.sh to start all services"
echo "3. Visit http://localhost:3001"
echo ""
echo "📦 Package manager: $PKG_MANAGER"
echo "🏃 Run '$PKG_RUN dev:api' for development mode"