import express, { Request, Response } from 'express';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import morgan from 'morgan';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { logger, stream } from '../utils/logger';
import { PriceCalculatorEnhanced } from '../services/PriceCalculator';

const app = express();

// Database and Redis connections
const db = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'dex_charts',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD
});

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379')
});

// Middleware
app.use(helmet());
app.use(cors());
app.use(compression() as any);
app.use(express.json());
app.use(morgan('combined', { stream }));

// Rate limiting
/*
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 100,
  message: 'Too many requests from this IP'
});

const heavyLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 20,
  message: 'Too many requests from this IP'
});


app.use('/api/', limiter);
app.use('/api/search', heavyLimiter);
app.use('/api/tokens/:address/holders', heavyLimiter);
*/
// Health check
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes

/**
 * Get all pairs with pagination and filters
 */
app.get('/api/pairs', async (req: Request, res: Response) => {
  try {
    // ✅ FIXED: Parse query parameters properly
    const limit = parseInt(req.query.limit as string) || 100;
    const offset = parseInt(req.query.offset as string) || 0;
    const sort = (req.query.sort as string) || 'volume_24h';
    const order = (req.query.order as string) || 'desc';
    const minLiquidity = parseFloat(req.query.minLiquidity as string) || 0;
    const minVolume = parseFloat(req.query.minVolume as string) || 0;
    const token = (req.query.token as string) || '';

    let query = `
      SELECT 
        p.*,
        tm0.price_usd as token0_price_usd,
        tm0.price_opn as token0_price_opn,
        tm1.price_usd as token1_price_usd,
        tm1.price_opn as token1_price_opn,
        tm0.volume_24h_usd as token0_volume_24h,
        tm1.volume_24h_usd as token1_volume_24h,
        tm0.price_change_24h as token0_price_change_24h,
        tm1.price_change_24h as token1_price_change_24h,
        tm0.liquidity_usd as liquidity_usd,
        tm0.market_cap_usd as token0_mcap,
        tm1.market_cap_usd as token1_mcap,
        t0.logo_uri as token0_logo,
        t1.logo_uri as token1_logo,
        t0.honeypot_status as token0_honeypot,
        t1.honeypot_status as token1_honeypot
      FROM pairs p
      LEFT JOIN tokens t0 ON p.token0 = t0.address
      LEFT JOIN tokens t1 ON p.token1 = t1.address
      LEFT JOIN LATERAL (
        SELECT * FROM token_metrics 
        WHERE token_address = p.token0 
        ORDER BY timestamp DESC LIMIT 1
      ) tm0 ON true
      LEFT JOIN LATERAL (
        SELECT * FROM token_metrics 
        WHERE token_address = p.token1 
        ORDER BY timestamp DESC LIMIT 1
      ) tm1 ON true
      WHERE 1=1
    `;

    const params: any[] = [];
    let paramCount = 0;

    if (minLiquidity > 0) {
      paramCount++;
      query += ` AND COALESCE(tm0.liquidity_usd, 0) >= $${paramCount}`;
      params.push(minLiquidity);
    }

    if (minVolume > 0) {
      paramCount++;
      query += ` AND COALESCE(tm0.volume_24h_usd + tm1.volume_24h_usd, 0) >= $${paramCount}`;
      params.push(minVolume);
    }

    if (token) {
      paramCount++;
      query += ` AND (LOWER(t0.symbol) LIKE LOWER($${paramCount}) OR LOWER(t1.symbol) LIKE LOWER($${paramCount}) OR p.token0 = $${paramCount} OR p.token1 = $${paramCount})`;
      params.push(`%${token}%`);
    }

    const sortColumns: Record<string, string> = {
      'volume_24h': 'COALESCE(tm0.volume_24h_usd + tm1.volume_24h_usd, 0)',
      'liquidity': 'COALESCE(tm0.liquidity_usd, 0)',
      'price_change_24h': 'GREATEST(COALESCE(tm0.price_change_24h, 0), COALESCE(tm1.price_change_24h, 0))',
      'created': 'p.created_at'
    };

    const sortColumn = sortColumns[sort] || sortColumns['volume_24h'];
    query += ` ORDER BY ${sortColumn} ${order === 'asc' ? 'ASC' : 'DESC'}`;

    paramCount++;
    query += ` LIMIT $${paramCount}`;
    params.push(limit);
    
    paramCount++;
    query += ` OFFSET $${paramCount}`;
    params.push(offset);

    const result = await db.query(query, params);

    const pairs = result.rows.map(row => ({
      address: row.address,
      token0: {
        address: row.token0,
        symbol: row.token0_symbol,
        name: row.token0_name,
        decimals: row.token0_decimals,
        priceUSD: parseFloat(row.token0_price_usd || '0'),
        priceOPN: parseFloat(row.token0_price_opn || '0'),
        priceChange24h: parseFloat(row.token0_price_change_24h || '0'),
        logo: row.token0_logo,
        honeypotStatus: row.token0_honeypot,
        marketCap: parseFloat(row.token0_mcap || '0')
      },
      token1: {
        address: row.token1,
        symbol: row.token1_symbol,
        name: row.token1_name,
        decimals: row.token1_decimals,
        priceUSD: parseFloat(row.token1_price_usd || '0'),
        priceOPN: parseFloat(row.token1_price_opn || '0'),
        priceChange24h: parseFloat(row.token1_price_change_24h || '0'),
        logo: row.token1_logo,
        honeypotStatus: row.token1_honeypot,
        marketCap: parseFloat(row.token1_mcap || '0')
      },
      liquidity: {
        usd: parseFloat(row.liquidity_usd || '0'),
        token0: row.reserve0,
        token1: row.reserve1
      },
      volume24h: parseFloat(row.token0_volume_24h || '0') + parseFloat(row.token1_volume_24h || '0'),
      createdAt: row.created_at
    }));

    res.json({ pairs, total: pairs.length });
  } catch (error) {
    logger.error('Error fetching pairs:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


/**
 * Get all pairs for a specific token
 */
app.get('/api/tokens/:address/pairs', async (req, res) => {
  try {
    const { address } = req.params;
    const { limit = 50 } = req.query;

    const result = await db.query(
      `SELECT 
        p.*,
        t0.symbol as token0_symbol,
        t0.name as token0_name,
        t1.symbol as token1_symbol,
        t1.name as token1_name,
        COALESCE(tm0.price_usd, 0) as token0_price_usd,
        COALESCE(tm1.price_usd, 0) as token1_price_usd,
        COALESCE(tm0.price_change_24h, 0) as token0_price_change_24h,
        COALESCE(tm1.price_change_24h, 0) as token1_price_change_24h,
        COALESCE(tm0.volume_24h_usd, 0) + COALESCE(tm1.volume_24h_usd, 0) as total_volume_24h,
        COALESCE(tm0.liquidity_usd, 0) + COALESCE(tm1.liquidity_usd, 0) as total_liquidity_usd
       FROM pairs p
       JOIN tokens t0 ON LOWER(p.token0) = LOWER(t0.address)
       JOIN tokens t1 ON LOWER(p.token1) = LOWER(t1.address)
       LEFT JOIN LATERAL (
        SELECT * FROM token_metrics 
        WHERE LOWER(token_address) = LOWER(p.token0)
        ORDER BY timestamp DESC LIMIT 1
       ) tm0 ON true
       LEFT JOIN LATERAL (
        SELECT * FROM token_metrics 
        WHERE LOWER(token_address) = LOWER(p.token1)
        ORDER BY timestamp DESC LIMIT 1
       ) tm1 ON true
       WHERE LOWER(p.token0) = LOWER($1) OR LOWER(p.token1) = LOWER($1)
       ORDER BY total_liquidity_usd DESC
       LIMIT $2`,
      [address, limit]
    );

    const pairs = result.rows.map(row => ({
      address: row.address,
      token0: {
        address: row.token0,
        symbol: row.token0_symbol,
        name: row.token0_name,
        priceUSD: parseFloat(row.token0_price_usd || '0'),
        priceOPN: parseFloat(row.token0_price_usd || '0') / 0.05,
        priceChange24h: parseFloat(row.token0_price_change_24h || '0')
      },
      token1: {
        address: row.token1,
        symbol: row.token1_symbol,
        name: row.token1_name,
        priceUSD: parseFloat(row.token1_price_usd || '0'),
        priceOPN: parseFloat(row.token1_price_usd || '0') / 0.05,
        priceChange24h: parseFloat(row.token1_price_change_24h || '0')
      },
      liquidity: {
        usd: parseFloat(row.total_liquidity_usd || '0')
      },
      volume24h: parseFloat(row.total_volume_24h || '0')
    }));

    res.json({ pairs });
  } catch (error) {
    logger.error('Error fetching token pairs:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
/**
 * Get new pairs
 */
app.get('/api/pairs/new', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const minLiquidity = parseFloat(req.query.minLiquidity as string) || 1000;

    const result = await db.query(
      `SELECT 
        p.*,
        t0.symbol as token0_symbol,
        t0.name as token0_name,
        t0.logo_uri as token0_logo,
        t0.honeypot_status as token0_honeypot,
        t1.symbol as token1_symbol,
        t1.name as token1_name,
        t1.logo_uri as token1_logo,
        t1.honeypot_status as token1_honeypot,
        tm0.price_usd as token0_price_usd,
        tm1.price_usd as token1_price_usd,
        COALESCE(tm0.liquidity_usd, 0) + COALESCE(tm1.liquidity_usd, 0) as total_liquidity_usd,
        le.amount_usd as initial_liquidity
       FROM pairs p
       JOIN tokens t0 ON p.token0 = t0.address
       JOIN tokens t1 ON p.token1 = t1.address
       LEFT JOIN LATERAL (
        SELECT * FROM token_metrics 
        WHERE token_address = p.token0 
        ORDER BY timestamp DESC LIMIT 1
       ) tm0 ON true
       LEFT JOIN LATERAL (
        SELECT * FROM token_metrics 
        WHERE token_address = p.token1 
        ORDER BY timestamp DESC LIMIT 1
       ) tm1 ON true
       LEFT JOIN LATERAL (
        SELECT amount_usd FROM liquidity_events
        WHERE pair_address = p.address
        AND event_type = 'add'
        ORDER BY timestamp ASC
        LIMIT 1
       ) le ON true
       WHERE p.created_at > NOW() - INTERVAL '7 days'
       AND COALESCE(tm0.liquidity_usd, 0) + COALESCE(tm1.liquidity_usd, 0) >= $1
       ORDER BY p.created_at DESC
       LIMIT $2`,
      [minLiquidity, limit]
    );

    const newPairs = result.rows.map(pair => ({
      address: pair.address,
      token0: {
        address: pair.token0,
        symbol: pair.token0_symbol,
        name: pair.token0_name,
        logo: pair.token0_logo,
        honeypotStatus: pair.token0_honeypot,
        priceUSD: parseFloat(pair.token0_price_usd || '0')
      },
      token1: {
        address: pair.token1,
        symbol: pair.token1_symbol,
        name: pair.token1_name,
        logo: pair.token1_logo,
        honeypotStatus: pair.token1_honeypot,
        priceUSD: parseFloat(pair.token1_price_usd || '0')
      },
      liquidity: parseFloat(pair.total_liquidity_usd || '0'),
      initialLiquidity: parseFloat(pair.initial_liquidity || '0'),
      createdAt: pair.created_at,
      age: getAge(pair.created_at)
    }));

    res.json({ pairs: newPairs });
  } catch (error) {
    logger.error('Error fetching new pairs:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Get pair details with comprehensive data
 */
// Full fixed /api/pairs/:address endpoint with consistent price display
// Replace your existing endpoint in backend/api/server.ts with this complete version

// ✅ COMPLETE FIXED VERSION - /api/pairs/:address endpoint
// Replace your existing endpoint in backend/api/server.ts with this

app.get('/api/pairs/:address', async (req: Request, res: Response) => {
  try {
    const { address } = req.params;

    // Try cache first
    const cached = await redis.get(`pair:${address}`);
    if (cached) {
      return res.json(JSON.parse(cached));
    }

    // Get pair info
    const pairResult = await db.query(
      `SELECT 
        p.*,
        t0.symbol as token0_symbol,
        t0.name as token0_name,
        t0.decimals as token0_decimals,
        t0.total_supply as token0_total_supply,
        t0.logo_uri as token0_logo,
        t0.website as token0_website,
        t0.telegram as token0_telegram,
        t0.twitter as token0_twitter,
        t0.honeypot_status as token0_honeypot,
        t0.buy_tax as token0_buy_tax,
        t0.sell_tax as token0_sell_tax,
        t0.contract_verified as token0_contract_verified,
        t1.symbol as token1_symbol,
        t1.name as token1_name,
        t1.decimals as token1_decimals,
        t1.total_supply as token1_total_supply,
        t1.logo_uri as token1_logo,
        COALESCE(tm0.price_usd, 0) as token0_price_usd,
        COALESCE(tm0.price_opn, 0) as token0_price_opn,
        COALESCE(tm1.price_usd, 0) as token1_price_usd,
        COALESCE(tm1.price_opn, 0) as token1_price_opn,
        COALESCE(tm0.volume_24h_usd, 0) as token0_volume_24h,
        COALESCE(tm1.volume_24h_usd, 0) as token1_volume_24h,
        COALESCE(tm0.price_change_24h, 0) as token0_price_change_24h,
        COALESCE(tm1.price_change_24h, 0) as token1_price_change_24h,
        COALESCE(tm0.liquidity_usd, 0) + COALESCE(tm1.liquidity_usd, 0) as total_liquidity_usd
      FROM pairs p
      JOIN tokens t0 ON LOWER(p.token0) = LOWER(t0.address)
      JOIN tokens t1 ON LOWER(p.token1) = LOWER(t1.address)
      LEFT JOIN LATERAL (
        SELECT * FROM token_metrics 
        WHERE LOWER(token_address) = LOWER(p.token0)
        ORDER BY timestamp DESC LIMIT 1
      ) tm0 ON true
      LEFT JOIN LATERAL (
        SELECT * FROM token_metrics 
        WHERE LOWER(token_address) = LOWER(p.token1)
        ORDER BY timestamp DESC LIMIT 1
      ) tm1 ON true
      WHERE LOWER(p.address) = LOWER($1)`,
      [address]
    );

    if (pairResult.rows.length === 0) {
      return res.status(404).json({ error: 'Pair not found' });
    }

    const pair = pairResult.rows[0];

    // Get recent trades
    const tradesResult = await db.query(
      `SELECT * FROM trades 
       WHERE pair_address = $1 
       ORDER BY timestamp DESC 
       LIMIT 100`,
      [address]
    );

    // Get 24h stats
    const statsResult = await db.query(
      `SELECT 
        COUNT(*) as trade_count,
        SUM(amount_in_usd) as volume_usd,
        COUNT(DISTINCT maker) as unique_traders,
        MIN(price_token0_usd) as low_24h,
        MAX(price_token0_usd) as high_24h
       FROM trades 
       WHERE pair_address = $1 
       AND timestamp > EXTRACT(EPOCH FROM NOW() - INTERVAL '24 hours')`,
      [address]
    );

    // Get liquidity events
    const liquidityResult = await db.query(
      `SELECT * FROM liquidity_events
       WHERE pair_address = $1
       ORDER BY timestamp DESC
       LIMIT 20`,
      [address]
    );

    // ✅ FIXED: Intelligent base token detection for consistent price display
    const WOPN_ADDRESS = '0xBc022C9dEb5AF250A526321d16Ef52E39b4DBD84';
    const token0IsWOPN = pair.token0.toLowerCase() === WOPN_ADDRESS.toLowerCase();
    const token1IsWOPN = pair.token1.toLowerCase() === WOPN_ADDRESS.toLowerCase();

    // Determine which token is the "base" token (the one being priced)
    // Priority:
    // 1. If one token is WOPN, the other is the base
    // 2. If neither is WOPN, the token with lower price is the base (project token)
    let baseTokenIndex = 0; // Default to token0

    if (token1IsWOPN) {
      // TOKEN/WOPN pair -> show TOKEN (token0)
      baseTokenIndex = 0;
    } else if (token0IsWOPN) {
      // WOPN/TOKEN pair -> show TOKEN (token1)
      baseTokenIndex = 1;
    } else {
      // Non-WOPN pair: use token with lower price as base
      // Example: OPNT ($0.002477) / tBNB ($965.32) -> show OPNT
      const token0Price = parseFloat(pair.token0_price_usd || '0');
      const token1Price = parseFloat(pair.token1_price_usd || '0');
      
      if (token0Price > 0 && token1Price > 0) {
        // Both have prices - use the lower one as base
        baseTokenIndex = token0Price < token1Price ? 0 : 1;
      }
    }

    // ✅ NEW: Base and quote token metadata
    const baseToken = {
      index: baseTokenIndex,
      symbol: baseTokenIndex === 0 ? pair.token0_symbol : pair.token1_symbol,
      address: baseTokenIndex === 0 ? pair.token0 : pair.token1,
    };
    
    const quoteToken = {
      index: baseTokenIndex === 0 ? 1 : 0,
      symbol: baseTokenIndex === 0 ? pair.token1_symbol : pair.token0_symbol,
      address: baseTokenIndex === 0 ? pair.token1 : pair.token0,
    };
    
    // ✅ FIXED: Current price - always base token only
    const currentPrice = {
      usd: baseTokenIndex === 0 
        ? parseFloat(pair.token0_price_usd || '0')
        : parseFloat(pair.token1_price_usd || '0'),
      opn: baseTokenIndex === 0
        ? parseFloat(pair.token0_price_opn || '0')
        : parseFloat(pair.token1_price_opn || '0'),
    };

    // Build response object
    const response = {
      address: pair.address,
      
      // Individual token data (complete info for both)
      token0: {
        address: pair.token0,
        symbol: pair.token0_symbol,
        name: pair.token0_name,
        decimals: pair.token0_decimals,
        totalSupply: pair.token0_total_supply,
        priceUSD: parseFloat(pair.token0_price_usd || '0'),
        priceOPN: parseFloat(pair.token0_price_opn || '0'),
        priceChange24h: parseFloat(pair.token0_price_change_24h || '0'),
        volume24h: parseFloat(pair.token0_volume_24h || '0'),
        logo: pair.token0_logo,
        website: pair.token0_website,
        telegram: pair.token0_telegram,
        twitter: pair.token0_twitter,
        honeypotStatus: pair.token0_honeypot,
        buyTax: parseFloat(pair.token0_buy_tax || '0'),
        sellTax: parseFloat(pair.token0_sell_tax || '0'),
        isVerified: pair.token0_contract_verified || false
      },
      token1: {
        address: pair.token1,
        symbol: pair.token1_symbol,
        name: pair.token1_name,
        decimals: pair.token1_decimals,
        priceUSD: parseFloat(pair.token1_price_usd || '0'),
        priceOPN: parseFloat(pair.token1_price_opn || '0'),
        priceChange24h: parseFloat(pair.token1_price_change_24h || '0'),
        volume24h: parseFloat(pair.token1_volume_24h || '0'),
        logo: pair.token1_logo
      },

      // ✅ NEW: Base/quote token metadata for consistent display
      baseToken,
      quoteToken,
      currentPrice,

      // Liquidity information
      liquidity: {
        usd: parseFloat(pair.total_liquidity_usd || '0'),
        reserves: {
          token0: pair.reserve0,
          token1: pair.reserve1
        }
      },

      // 24h statistics
      stats24h: {
        volume: parseFloat(statsResult.rows[0]?.volume_usd || '0'),
        trades: parseInt(statsResult.rows[0]?.trade_count || '0'),
        uniqueTraders: parseInt(statsResult.rows[0]?.unique_traders || '0'),
        high: parseFloat(statsResult.rows[0]?.high_24h || '0'),
        low: parseFloat(statsResult.rows[0]?.low_24h || '0')
      },

      // ✅ FIXED: Recent trades with consistent base token pricing
      recentTrades: tradesResult.rows.map(trade => {
        // Always show the base token's price (the project token being traded)
        const displayPriceUSD = baseTokenIndex === 0
          ? parseFloat(trade.price_token0_usd || '0')
          : parseFloat(trade.price_token1_usd || '0');
          
        const displayPriceOPN = baseTokenIndex === 0
          ? parseFloat(trade.price_token0_opn || '0')
          : parseFloat(trade.price_token1_opn || '0');
        
        return {
          hash: trade.transaction_hash,
          timestamp: trade.timestamp,
          type: trade.trade_type,
          priceUSD: displayPriceUSD,  // ✅ Always base token price
          priceOPN: displayPriceOPN,  // ✅ Always base token price
          amountUSD: parseFloat(trade.amount_in_usd || '0'),
          maker: trade.maker,
          priceImpact: parseFloat(trade.price_impact || '0')
        };
      }),

      // Liquidity events
      liquidityEvents: liquidityResult.rows.map(event => ({
        type: event.event_type,
        timestamp: event.timestamp,
        amountUSD: parseFloat(event.amount_usd || '0'),
        provider: event.provider,
        hash: event.transaction_hash
      })),

      // Creation timestamp
      createdAt: pair.created_at
    };

    // Cache for 30 seconds
    await redis.setex(`pair:${address}`, 30, JSON.stringify(response));
    
    res.json(response);
    
  } catch (error) {
    logger.error('Error fetching pair details:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});



app.get('/api/pairs/:address/candles', async (req: Request, res: Response) => {
  try {
    const { address } = req.params;
    const timeframe = (req.query.timeframe as string) || '15m';
    const from = req.query.from as string;
    const to = req.query.to as string;
    const limit = parseInt(req.query.limit as string) || 500;

    const validTimeframes = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w'];
    if (!validTimeframes.includes(timeframe)) {
      return res.status(400).json({ error: 'Invalid timeframe' });
    }

    let query = `SELECT * FROM candles WHERE pair_address = $1 AND timeframe = $2`;
    const params: any[] = [address, timeframe];

    if (from) {
      params.push(from);
      query += ` AND time >= $${params.length}`;
    }

    if (to) {
      params.push(to);
      query += ` AND time <= $${params.length}`;
    }

    query += ` ORDER BY time DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await db.query(query, params);

    const candles = result.rows.reverse().map(candle => ({
      time: parseInt(candle.time),
      open: parseFloat(candle.open_usd),
      high: parseFloat(candle.high_usd),
      low: parseFloat(candle.low_usd),
      close: parseFloat(candle.close_usd),
      volume: parseFloat(candle.volume_usd),
      openOPN: parseFloat(candle.open_opn),
      highOPN: parseFloat(candle.high_opn),
      lowOPN: parseFloat(candle.low_opn),
      closeOPN: parseFloat(candle.close_opn)
    }));

    res.json({ candles });
  } catch (error) {
    logger.error('Error fetching candles:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Search tokens and pairs
 */
app.get('/api/search', async (req: Request, res: Response) => {
  try {
    const q = req.query.q as string;
    const limit = parseInt(req.query.limit as string) || 20;

    if (!q || q.length < 2) {
      return res.json({ results: [] });
    }

    const searchTerm = `%${q}%`;

    const tokensResult = await db.query(
      `SELECT 
        t.*,
        tm.price_usd,
        tm.price_opn,
        tm.volume_24h_usd,
        tm.price_change_24h,
        tm.market_cap_usd,
        tm.holder_count
       FROM tokens t
       LEFT JOIN LATERAL (
        SELECT * FROM token_metrics 
        WHERE token_address = t.address 
        ORDER BY timestamp DESC LIMIT 1
       ) tm ON true
       WHERE LOWER(t.symbol) LIKE LOWER($1) 
          OR LOWER(t.name) LIKE LOWER($1)
          OR t.address ILIKE $1
       ORDER BY tm.volume_24h_usd DESC NULLS LAST
       LIMIT $2`,
      [searchTerm, limit]
    );

    const pairsResult = await db.query(
      `SELECT 
        p.*,
        t0.symbol as token0_symbol,
        t0.name as token0_name,
        t1.symbol as token1_symbol,
        t1.name as token1_name,
        tm0.volume_24h_usd + tm1.volume_24h_usd as total_volume
       FROM pairs p
       JOIN tokens t0 ON p.token0 = t0.address
       JOIN tokens t1 ON p.token1 = t1.address
       LEFT JOIN LATERAL (
        SELECT volume_24h_usd FROM token_metrics 
        WHERE token_address = p.token0 
        ORDER BY timestamp DESC LIMIT 1
       ) tm0 ON true
       LEFT JOIN LATERAL (
        SELECT volume_24h_usd FROM token_metrics 
        WHERE token_address = p.token1 
        ORDER BY timestamp DESC LIMIT 1
       ) tm1 ON true
       WHERE LOWER(t0.symbol) LIKE LOWER($1) 
          OR LOWER(t1.symbol) LIKE LOWER($1)
          OR LOWER(t0.name) LIKE LOWER($1)
          OR LOWER(t1.name) LIKE LOWER($1)
          OR p.address ILIKE $1
       ORDER BY total_volume DESC NULLS LAST
       LIMIT $2`,
      [searchTerm, limit]
    );

    const results = {
      tokens: tokensResult.rows.map(token => ({
        type: 'token',
        address: token.address,
        symbol: token.symbol,
        name: token.name,
        logo: token.logo_uri,
        priceUSD: parseFloat(token.price_usd || '0'),
        priceOPN: parseFloat(token.price_opn || '0'),
        priceChange24h: parseFloat(token.price_change_24h || '0'),
        volume24h: parseFloat(token.volume_24h_usd || '0'),
        marketCap: parseFloat(token.market_cap_usd || '0'),
        holders: token.holder_count || 0,
        honeypotStatus: token.honeypot_status
      })),
      pairs: pairsResult.rows.map(pair => ({
        type: 'pair',
        address: pair.address,
        token0Symbol: pair.token0_symbol,
        token1Symbol: pair.token1_symbol,
        token0Name: pair.token0_name,
        token1Name: pair.token1_name,
        volume24h: parseFloat(pair.total_volume || '0')
      }))
    };

    res.json({ results: [...results.tokens, ...results.pairs] });
  } catch (error) {
    logger.error('Search error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Get trending tokens (gainers/losers)
 */
app.get('/api/trending', async (req: Request, res: Response) => {
  try {
    const type = (req.query.type as string) || 'gainers';
    const timeframe = (req.query.timeframe as string) || '24h';
    const limit = parseInt(req.query.limit as string) || 50;

    const timeframeMap: Record<string, string> = {
      '5m': 'price_change_5m',
      '1h': 'price_change_1h',
      '6h': 'price_change_6h',
      '24h': 'price_change_24h',
      '7d': 'price_change_7d',
      '30d': 'price_change_30d'
    };

    const changeColumn = timeframeMap[timeframe] || 'price_change_24h';
    const order = type === 'gainers' ? 'DESC' : 'ASC';

    const result = await db.query(
      `SELECT 
        t.*,
        tm.price_usd,
        tm.price_opn,
        tm.${changeColumn} as price_change,
        tm.volume_24h_usd,
        tm.market_cap_usd,
        tm.liquidity_usd
       FROM tokens t
       JOIN token_metrics tm ON t.address = tm.token_address
       WHERE tm.timestamp = (
        SELECT MAX(timestamp) FROM token_metrics WHERE token_address = t.address
       )
       AND tm.volume_24h_usd > 0
       ORDER BY tm.${changeColumn} ${order} NULLS LAST
       LIMIT $1`,
      [limit]
    );

    const trending = result.rows.map(token => ({
      address: token.address,
      symbol: token.symbol,
      name: token.name,
      logo: token.logo_uri,
      priceUSD: parseFloat(token.price_usd || '0'),
      priceOPN: parseFloat(token.price_opn || '0'),
      priceChange: parseFloat(token.price_change || '0'),
      volume24h: parseFloat(token.volume_24h_usd || '0'),
      marketCap: parseFloat(token.market_cap_usd || '0'),
      liquidity: parseFloat(token.liquidity_usd || '0')
    }));

    res.json({ [type]: trending });
  } catch (error) {
    logger.error('Error fetching trending:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Utility functions
function getAge(createdAt: string): string {
  const now = new Date();
  const created = new Date(createdAt);
  const diff = now.getTime() - created.getTime();
  
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  return `${minutes}m ago`;
}

// Start server
const PORT = process.env.API_PORT || 3000;
app.listen(PORT, () => {
  logger.info(`🚀 API server running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM signal received: closing HTTP server');
  await db.end();
  redis.disconnect();
  process.exit(0);
});

export default app;