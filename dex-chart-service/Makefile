# DEX Chart Service Makefile

.PHONY: help install setup start stop dev clean logs test build

# Default target
help:
	@echo "DEX Chart Service - Available Commands:"
	@echo "  make install    - Install all dependencies"
	@echo "  make setup      - Run complete setup"
	@echo "  make start      - Start all services (Docker)"
	@echo "  make stop       - Stop all services"
	@echo "  make dev        - Start in development mode"
	@echo "  make clean      - Clean up containers and volumes"
	@echo "  make logs       - View all logs"
	@echo "  make test       - Run tests"
	@echo "  make build      - Build all services"

# Install dependencies
install:
	@echo "Installing backend dependencies..."
	yarn install
	@echo "Installing frontend dependencies..."
	cd frontend && yarn install

# Start services with Docker
start:
	@echo "Starting services..."
	@docker-compose up -d
	@echo "Services started!"
	@echo "Frontend: http://localhost:3001"
	@echo "API: http://localhost:3000"
	@echo "WebSocket: http://localhost:3002"

# Stop services
stop:
	@echo "Stopping services..."
	@docker-compose down
	@echo "Services stopped!"

# Development mode
dev:
	@echo "Starting development mode..."
	@yarn dev

# Clean up
clean:
	@echo "Cleaning up..."
	@docker-compose down -v
	@rm -rf node_modules
	@rm -rf frontend/node_modules
	@rm -rf dist
	@rm -rf frontend/.next
	@echo "Cleanup complete!"

# View logs
logs:
	@docker-compose logs -f

# Build commands
build:
	@echo "Building all services..."
	@docker-compose build
	@echo "Build complete!"

# Quick restart
restart: stop start