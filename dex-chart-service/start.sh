#!/bin/bash
echo "🚀 Starting DEX Chart Service..."
docker-compose up -d
echo "✅ Services started!"
echo "📊 Frontend: http://localhost:3001"
echo "🔌 API: http://localhost:3000"