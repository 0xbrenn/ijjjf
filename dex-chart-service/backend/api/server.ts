import express, { Request, Response, NextFunction } from 'express';
import { Pool } from 'pg';
import Redis from 'ioredis';
import cors from 'cors';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';

dotenv.config();

const app = express();

// Database connection
const db = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'dex_charts',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'password'
});

// Redis connection
const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379')
});

// Middleware - proper order
app.use(cors());
app.use(compression());
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100 // limit each IP to 100 requests per minute
});
app.use('/api/', limiter);

// Error handling middleware
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error('API Error:', err);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

// Health check
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Get all pairs
app.get('/api/pairs', async (req: Request, res: Response) => {
  try {
    const search = req.query.search as string;
    const limit = parseInt(req.query.limit as string || '100');
    const offset = parseInt(req.query.offset as string || '0');
    
    let query = `
      SELECT 
        p.address,
        p.token0,
        p.token1,
        p.token0_symbol,
        p.token1_symbol,
        p.token0_decimals,
        p.token1_decimals,
        COALESCE(latest.price, 0) as current_price,
        COALESCE(stats.volume_24h, 0) as volume_24h,
        COALESCE(stats.price_change_24h, 0) as price_change_24h
      FROM pairs p
      LEFT JOIN LATERAL (
        SELECT price 
        FROM trades 
        WHERE pair_address = p.address 
        ORDER BY timestamp DESC 
        LIMIT 1
      ) latest ON true
      LEFT JOIN LATERAL (
        SELECT 
          SUM(CASE WHEN token0_amount::numeric > 0 THEN token0_amount::numeric ELSE token1_amount::numeric END) as volume_24h,
          0 as price_change_24h
        FROM trades
        WHERE pair_address = p.address 
          AND timestamp > EXTRACT(EPOCH FROM NOW() - INTERVAL '24 hours')
      ) stats ON true
    `;
    
    const params: any[] = [];
    
    if (search) {
      query += ` WHERE p.token0_symbol ILIKE $1 OR p.token1_symbol ILIKE $1 OR p.address ILIKE $1`;
      params.push(`%${search}%`);
    }
    
    query += ` ORDER BY stats.volume_24h DESC NULLS LAST`;
    query += ` LIMIT ${limit} OFFSET ${offset}`;
    
    const result = await db.query(query, params);
    
    res.json({
      pairs: result.rows,
      total: result.rowCount
    });
  } catch (error) {
    console.error('Error fetching pairs:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get pair details
app.get('/api/pairs/:address', async (req: Request, res: Response) => {
  try {
    const { address } = req.params;
    
    // Get pair info
    const pairQuery = await db.query(
      `SELECT * FROM pairs WHERE address = $1`,
      [address]
    );
    
    if (pairQuery.rowCount === 0) {
      return res.status(404).json({ error: 'Pair not found' });
    }
    
    // Get latest price from Redis or DB
    const cachedPrice = await redis.hgetall(`price:${address}`);
    
    let priceData;
    if (cachedPrice && cachedPrice.price) {
      priceData = cachedPrice;
    } else {
      const priceQuery = await db.query(
        `SELECT price, timestamp FROM trades 
         WHERE pair_address = $1 
         ORDER BY timestamp DESC 
         LIMIT 1`,
        [address]
      );
      priceData = priceQuery.rows[0] || { price: 0 };
    }
    
    // Get 24h stats
    const statsQuery = await db.query(
      `SELECT 
        COUNT(*) as trades_24h,
        COALESCE(MAX(price), 0) as high_24h,
        COALESCE(MIN(price), 0) as low_24h
       FROM trades
       WHERE pair_address = $1 AND timestamp > EXTRACT(EPOCH FROM NOW() - INTERVAL '24 hours')`,
      [address]
    );
    
    const pair = pairQuery.rows[0];
    const stats = statsQuery.rows[0];
    
    res.json({
      ...pair,
      price: parseFloat(priceData.price || '0'),
      volume_24h: 0, // Calculate this properly later
      trades_24h: parseInt(stats.trades_24h || '0'),
      high_24h: parseFloat(stats.high_24h || priceData.price || '0'),
      low_24h: parseFloat(stats.low_24h || priceData.price || '0')
    });
  } catch (error) {
    console.error('Error fetching pair details:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get candles for charting
app.get('/api/pairs/:address/candles', async (req: Request, res: Response) => {
  try {
    const { address } = req.params;
    const timeframe = req.query.timeframe as string || '1h';
    const from = parseInt(req.query.from as string || String(Math.floor(Date.now() / 1000) - 86400 * 7));
    const to = parseInt(req.query.to as string || String(Math.floor(Date.now() / 1000)));
    const limit = parseInt(req.query.limit as string || '500');
    
    const query = `
      SELECT 
        time,
        open,
        high,
        low,
        close,
        volume,
        trades
      FROM candles
      WHERE pair_address = $1 
        AND timeframe = $2 
        AND time >= $3 
        AND time <= $4
      ORDER BY time ASC
      LIMIT $5
    `;
    
    const result = await db.query(query, [
      address,
      timeframe,
      from,
      to,
      limit
    ]);
    
    // If no candles, generate from trades
    if (result.rows.length === 0) {
      // Generate candles from raw trades
      const tradesQuery = `
        SELECT 
          timestamp,
          price
        FROM trades
        WHERE pair_address = $1 
          AND timestamp >= $2 
          AND timestamp <= $3
        ORDER BY timestamp ASC
      `;
      
      const trades = await db.query(tradesQuery, [address, from, to]);
      
      // Simple candle generation (you'd want to improve this)
      const candles = trades.rows.map(trade => ({
        time: parseInt(trade.timestamp),
        open: parseFloat(trade.price),
        high: parseFloat(trade.price),
        low: parseFloat(trade.price),
        close: parseFloat(trade.price),
        volume: 0
      }));
      
      return res.json({
        candles,
        timeframe,
        from,
        to
      });
    }
    
    // Format for TradingView
    const candles = result.rows.map(row => ({
      time: parseInt(row.time),
      open: parseFloat(row.open),
      high: parseFloat(row.high),
      low: parseFloat(row.low),
      close: parseFloat(row.close),
      volume: parseFloat(row.volume)
    }));
    
    res.json({
      candles,
      timeframe,
      from,
      to
    });
  } catch (error) {
    console.error('Error fetching candles:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get recent trades
app.get('/api/pairs/:address/trades', async (req: Request, res: Response) => {
  try {
    const { address } = req.params;
    const limit = parseInt(req.query.limit as string || '50');
    const offset = parseInt(req.query.offset as string || '0');
    
    const query = `
      SELECT 
        transaction_hash,
        timestamp,
        token0_amount,
        token1_amount,
        price,
        maker
      FROM trades
      WHERE pair_address = $1
      ORDER BY timestamp DESC
      LIMIT $2 OFFSET $3
    `;
    
    const result = await db.query(query, [address, limit, offset]);
    
    res.json({
      trades: result.rows,
      total: result.rowCount
    });
  } catch (error) {
    console.error('Error fetching trades:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get top gainers/losers - simplified version
app.get('/api/trending', async (req: Request, res: Response) => {
  try {
    const type = String(req.query.type || 'gainers');
    const limit = parseInt(String(req.query.limit || '20'));
    
    // For now, just return pairs with most trades
    const query = `
      SELECT 
        p.address,
        p.token0_symbol,
        p.token1_symbol,
        COALESCE(t.latest_price, 0) as current_price,
        COALESCE(t.trade_count, 0) as trade_count,
        0 as price_change_24h,
        0 as volume_24h
      FROM pairs p
      LEFT JOIN (
        SELECT 
          pair_address,
          COUNT(*) as trade_count,
          (SELECT price FROM trades WHERE pair_address = t.pair_address ORDER BY timestamp DESC LIMIT 1) as latest_price
        FROM trades t
        GROUP BY pair_address
      ) t ON p.address = t.pair_address
      WHERE t.trade_count > 0
      ORDER BY t.trade_count DESC
      LIMIT $1
    `;
    
    const result = await db.query(query, [limit]);
    
    const response: any = {};
    response[type] = result.rows;
    res.json(response);
  } catch (error) {
    console.error('Error fetching trending:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Search tokens
app.get('/api/search', async (req: Request, res: Response) => {
  try {
    const q = req.query.q as string;
    const limit = parseInt(req.query.limit as string || '10');
    
    if (!q || q.length < 2) {
      return res.json({ results: [] });
    }
    
    const query = `
      SELECT 
        address,
        token0,
        token1,
        token0_symbol,
        token1_symbol
      FROM pairs
      WHERE token0_symbol ILIKE $1 
         OR token1_symbol ILIKE $1 
         OR address ILIKE $1
         OR token0 ILIKE $1
         OR token1 ILIKE $1
      LIMIT $2
    `;
    
    const result = await db.query(query, [`%${q}%`, limit]);
    
    res.json({
      results: result.rows
    });
  } catch (error) {
    console.error('Error searching:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Start server
const PORT = process.env.API_PORT || 3000;
app.listen(PORT, () => {
  console.log(`API server running on port ${PORT}`);
});

export default app;