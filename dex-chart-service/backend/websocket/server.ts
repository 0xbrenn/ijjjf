import { Server } from 'socket.io';
import Redis from 'ioredis';
import http from 'http';
import express from 'express';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3001',
    methods: ['GET', 'POST']
  }
});

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379')
});

const subscriber = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379')
});

// Track subscriptions
const pairSubscriptions = new Map<string, Set<string>>(); // pairAddress -> Set of socketIds
const socketSubscriptions = new Map<string, Set<string>>(); // socketId -> Set of pairAddresses

io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);
  
  // Subscribe to pair updates
  socket.on('subscribe', async (data: { pairs: string[] }) => {
    const { pairs } = data;
    
    // Clean up previous subscriptions for this socket
    const previousSubs = socketSubscriptions.get(socket.id) || new Set();
    previousSubs.forEach(pair => {
      const subs = pairSubscriptions.get(pair);
      if (subs) {
        subs.delete(socket.id);
        if (subs.size === 0) {
          pairSubscriptions.delete(pair);
          // Unsubscribe from Redis if no one is watching
          subscriber.unsubscribe(`price:${pair}`);
        }
      }
    });
    
    // Add new subscriptions
    const newSubs = new Set<string>();
    pairs.forEach(pair => {
      // Add to pair subscriptions
      if (!pairSubscriptions.has(pair)) {
        pairSubscriptions.set(pair, new Set());
        // Subscribe to Redis channel for this pair
        subscriber.subscribe(`price:${pair}`);
      }
      pairSubscriptions.get(pair)!.add(socket.id);
      newSubs.add(pair);
      
      // Join socket.io room for the pair
      socket.join(`pair:${pair}`);
    });
    
    socketSubscriptions.set(socket.id, newSubs);
    
    // Send current prices for subscribed pairs
    for (const pair of pairs) {
      const priceData = await redis.hgetall(`price:${pair}`);
      if (priceData && priceData.price) {
        socket.emit('price_update', {
          pair,
          price: parseFloat(priceData.price),
          timestamp: parseInt(priceData.timestamp),
          volume24h: parseFloat(priceData.volume24h || '0')
        });
      }
    }
  });
  
  // Unsubscribe from pairs
  socket.on('unsubscribe', (data: { pairs: string[] }) => {
    const { pairs } = data;
    const subs = socketSubscriptions.get(socket.id);
    
    if (subs) {
      pairs.forEach(pair => {
        subs.delete(pair);
        socket.leave(`pair:${pair}`);
        
        const pairSubs = pairSubscriptions.get(pair);
        if (pairSubs) {
          pairSubs.delete(socket.id);
          if (pairSubs.size === 0) {
            pairSubscriptions.delete(pair);
            subscriber.unsubscribe(`price:${pair}`);
          }
        }
      });
    }
  });
  
  // Request specific candle updates
  socket.on('subscribe_candles', (data: { pair: string, timeframe: string }) => {
    const { pair, timeframe } = data;
    const room = `candles:${pair}:${timeframe}`;
    socket.join(room);
    
    // Subscribe to candle updates
    subscriber.subscribe(`candles:${pair}:${timeframe}`);
  });
  
  // Clean up on disconnect
  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
    
    const subs = socketSubscriptions.get(socket.id);
    if (subs) {
      subs.forEach(pair => {
        const pairSubs = pairSubscriptions.get(pair);
        if (pairSubs) {
          pairSubs.delete(socket.id);
          if (pairSubs.size === 0) {
            pairSubscriptions.delete(pair);
            subscriber.unsubscribe(`price:${pair}`);
          }
        }
      });
      socketSubscriptions.delete(socket.id);
    }
  });
});

// Handle Redis pub/sub messages
subscriber.on('message', (channel, message) => {
  try {
    const data = JSON.parse(message);
    
    if (channel.startsWith('price:')) {
      const pair = channel.substring(6);
      // Emit to all clients in the pair room
      io.to(`pair:${pair}`).emit('price_update', {
        pair,
        price: data.price,
        timestamp: data.timestamp,
        volume: data.volume
      });
    } else if (channel.startsWith('candles:')) {
      // Handle candle updates
      const [, pair, timeframe] = channel.split(':');
      io.to(`candles:${pair}:${timeframe}`).emit('candle_update', {
        pair,
        timeframe,
        candle: data
      });
    }
  } catch (error) {
    console.error('Error processing Redis message:', error);
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    connections: io.engine.clientsCount,
    subscriptions: pairSubscriptions.size
  });
});

// Start server
const PORT = process.env.WS_PORT || 3002;
server.listen(PORT, () => {
  console.log(`WebSocket server running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    redis.disconnect();
    subscriber.disconnect();
    process.exit(0);
  });
});

export { io, server };