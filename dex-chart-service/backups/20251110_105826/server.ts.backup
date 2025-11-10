// backend/websocket/server-fixed.ts
// FIXED WebSocket server with proper channel-based subscription handling
// Replace your current backend/websocket/server.ts with this content

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import Redis from 'ioredis';
import { logger } from '../utils/logger';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3001',
    methods: ['GET', 'POST'],
    credentials: true
  },
  transports: ['websocket', 'polling']
});

// Redis clients
const redis = new Redis({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6379'),
});

const subscriber = new Redis({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6379'),
});

// Track subscriptions
const socketSubscriptions = new Map<string, Set<string>>();
const pairSubscriptions = new Map<string, Set<string>>();

// Connection handler
io.on('connection', (socket) => {
  logger.info(`Client connected: ${socket.id}`);
  
  // ===== FIXED: Handle channel-based subscriptions from frontend =====
  socket.on('subscribe', (data: { channel?: string, pairs?: string[] }) => {
    // Handle channel-based format: "trades:PAIR" or "candles:PAIR:TIMEFRAME"
    if (data.channel && typeof data.channel === 'string') {
      const parts = data.channel.split(':');
      
      // Handle trade subscriptions: "trades:0x..."
      if (parts[0] === 'trades' && parts[1]) {
        const pair = parts[1];
        socket.join(`pair:${pair}`);
        socket.join(`trades:${pair}`);
        
        // Track subscriptions
        let subs = socketSubscriptions.get(socket.id);
        if (!subs) {
          subs = new Set();
          socketSubscriptions.set(socket.id, subs);
        }
        subs.add(pair);
        
        // Track pair subscriptions
        let pairSubs = pairSubscriptions.get(pair);
        if (!pairSubs) {
          pairSubs = new Set();
          pairSubscriptions.set(pair, pairSubs);
        }
        pairSubs.add(socket.id);
        
        // Subscribe to Redis channels
        subscriber.subscribe(`price:${pair}`);
        subscriber.subscribe(`trades:${pair}`);
        
        logger.info(`Client ${socket.id} subscribed to trades for pair ${pair}`);
      }
      // Handle candle subscriptions: "candles:0x...:1m"
      else if (parts[0] === 'candles' && parts[1] && parts[2]) {
        const pair = parts[1];
        const timeframe = parts[2];
        const room = `candles:${pair}:${timeframe}`;
        
        socket.join(room);
        subscriber.subscribe(room);
        
        logger.info(`Client ${socket.id} subscribed to ${room}`);
      }
      // Generic channel subscription
      else {
        socket.join(data.channel);
        subscriber.subscribe(data.channel);
        logger.info(`Client ${socket.id} subscribed to channel ${data.channel}`);
      }
    }
    // Handle array-based format: { pairs: ["0x...", "0x..."] }
    else if (data.pairs && Array.isArray(data.pairs)) {
      const { pairs } = data;
      
      let subs = socketSubscriptions.get(socket.id);
      if (!subs) {
        subs = new Set();
        socketSubscriptions.set(socket.id, subs);
      }
      
      pairs.forEach(pair => {
        subs!.add(pair);
        socket.join(`pair:${pair}`);
        socket.join(`trades:${pair}`);
        
        let pairSubs = pairSubscriptions.get(pair);
        if (!pairSubs) {
          pairSubs = new Set();
          pairSubscriptions.set(pair, pairSubs);
        }
        pairSubs.add(socket.id);
        
        subscriber.subscribe(`price:${pair}`);
        subscriber.subscribe(`trades:${pair}`);
      });
      
      logger.info(`Client ${socket.id} subscribed to ${pairs.length} pairs`);
    }
  });
  
  // ===== FIXED: Handle channel-based unsubscriptions =====
  socket.on('unsubscribe', (data: { channel?: string, pairs?: string[] }) => {
    // Handle channel-based unsubscribe
    if (data.channel && typeof data.channel === 'string') {
      const parts = data.channel.split(':');
      
      if (parts[0] === 'candles' && parts[1] && parts[2]) {
        const pair = parts[1];
        const timeframe = parts[2];
        const room = `candles:${pair}:${timeframe}`;
        
        socket.leave(room);
        
        // Check if anyone else is subscribed to this channel
        const roomSockets = io.sockets.adapter.rooms.get(room);
        if (!roomSockets || roomSockets.size === 0) {
          subscriber.unsubscribe(room);
        }
        
        logger.info(`Client ${socket.id} unsubscribed from ${room}`);
      } else {
        socket.leave(data.channel);
        
        // Check if anyone else is subscribed to this channel
        const roomSockets = io.sockets.adapter.rooms.get(data.channel);
        if (!roomSockets || roomSockets.size === 0) {
          subscriber.unsubscribe(data.channel);
        }
      }
    }
    // Handle array-based unsubscribe
    else if (data.pairs && Array.isArray(data.pairs)) {
      const { pairs } = data;
      const subs = socketSubscriptions.get(socket.id);
      
      if (subs) {
        pairs.forEach(pair => {
          subs.delete(pair);
          socket.leave(`pair:${pair}`);
          socket.leave(`trades:${pair}`);
          
          const pairSubs = pairSubscriptions.get(pair);
          if (pairSubs) {
            pairSubs.delete(socket.id);
            if (pairSubs.size === 0) {
              pairSubscriptions.delete(pair);
              subscriber.unsubscribe(`price:${pair}`);
              subscriber.unsubscribe(`trades:${pair}`);
            }
          }
        });
      }
    }
  });
  
  // Clean up on disconnect
  socket.on('disconnect', () => {
    logger.info(`Client disconnected: ${socket.id}`);
    
    const subs = socketSubscriptions.get(socket.id);
    if (subs) {
      subs.forEach(pair => {
        const pairSubs = pairSubscriptions.get(pair);
        if (pairSubs) {
          pairSubs.delete(socket.id);
          if (pairSubs.size === 0) {
            pairSubscriptions.delete(pair);
            subscriber.unsubscribe(`price:${pair}`);
            subscriber.unsubscribe(`trades:${pair}`);
          }
        }
      });
      socketSubscriptions.delete(socket.id);
    }
  });
});

// ===== Handle Redis pub/sub messages =====
subscriber.on('message', (channel, message) => {
  try {
    const data = JSON.parse(message);
    
    // Handle price updates: price:0x...
    if (channel.startsWith('price:')) {
      const pair = channel.substring(6);
      io.to(`pair:${pair}`).emit('price_update', {
        pair,
        priceUSD: data.priceUSD,
        priceOPN: data.priceOPN,
        timestamp: data.timestamp,
        volume: data.volume,
        volume24h: data.volume24h
      });
    }
    // Handle trade updates: trades:0x...
    else if (channel.startsWith('trades:')) {
      const pair = channel.substring(7);
      io.to(`trades:${pair}`).emit('trade', {
        pair,
        txHash: data.txHash,
        timestamp: data.timestamp,
        tradeType: data.tradeType,
        priceUSD: data.priceUSD,
        priceOPN: data.priceOPN,
        volumeUSD: data.volumeUSD,
        maker: data.maker,
        priceImpact: data.priceImpact
      });
    }
    // Handle candle updates: candles:0x...:1m
    else if (channel.startsWith('candles:')) {
      const parts = channel.split(':');
      if (parts.length === 3) {
        const [, pair, timeframe] = parts;
        io.to(channel).emit('candle', {
          pair,
          timeframe,
          candle: data
        });
      }
    }
  } catch (error) {
    logger.error('Error processing Redis message:', error);
  }
});

subscriber.on('error', (error) => {
  logger.error('Redis subscriber error:', error);
});

redis.on('error', (error) => {
  logger.error('Redis client error:', error);
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    connections: io.engine.clientsCount,
    subscriptions: pairSubscriptions.size,
    timestamp: Date.now()
  });
});

// Start server
const PORT = process.env.WS_PORT || 3002;
server.listen(PORT, () => {
  logger.info(`🚀 WebSocket server running on port ${PORT}`);
  logger.info(`   Accepting connections from: ${process.env.FRONTEND_URL || 'http://localhost:3001'}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM signal received: closing WebSocket server');
  server.close(() => {
    logger.info('WebSocket server closed');
    redis.disconnect();
    subscriber.disconnect();
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT signal received: closing WebSocket server');
  server.close(() => {
    logger.info('WebSocket server closed');
    redis.disconnect();
    subscriber.disconnect();
    process.exit(0);
  });
});

export { io, server };