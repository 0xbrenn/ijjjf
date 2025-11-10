import express from 'express';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import morgan from 'morgan';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { logger, stream } from '../utils/logger';
import { PriceCalculator } from '../services/PriceCalculator';

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
app.use(compression());
app.use(express.json());
app.use(morgan('combined', { stream }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  message: 'Too many requests from this IP'
});

const heavyLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 20, // 20 requests per minute for heavy endpoints
  message: 'Too many requests from this IP'
});

app.use('/api/', limiter);
app.use('/api/search', heavyLimiter);
app.use('/api/tokens/:address/holders', heavyLimiter);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes

/**
 * Get all pairs with pagination and filters
 */
app.get('/api/pairs', async (req, res) => {
  try {
    const { 
      limit = 100, 
      offset = 0, 
      sort = 'volume_24h',
      order = 'desc',
      minLiquidity = 0,
      minVolume = 0,
      token 
    } = req.query;

    // Build query
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

    // Add filters
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

    // Add sorting
    const sortColumns: Record<string, string> = {
      'volume_24h': 'COALESCE(tm0.volume_24h_usd + tm1.volume_24h_usd, 0)',
      'liquidity': 'COALESCE(tm0.liquidity_usd, 0)',
      'price_change_24h': 'GREATEST(COALESCE(tm0.price_change_24h, 0), COALESCE(tm1.price_change_24h, 0))',
      'created': 'p.created_at'
    };

    const sortColumn = sortColumns[sort as string] || sortColumns['volume_24h'];
    query += ` ORDER BY ${sortColumn} ${order === 'asc' ? 'ASC' : 'DESC'}`;

    // Add pagination
    paramCount++;
    query += ` LIMIT $${paramCount}`;
    params.push(limit);
    
    paramCount++;
    query += ` OFFSET $${paramCount}`;
    params.push(offset);

    const result = await db.query(query, params);

    // Format response
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
 * Get new pairs
 */
app.get('/api/pairs/new', async (req, res) => {
  try {
    const { limit = 50, minLiquidity = 1000 } = req.query;

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
app.get('/api/pairs/:address', async (req, res) => {
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
        t0.*, 
        t1.*,
        tm0.price_usd as token0_price_usd,
        tm0.price_opn as token0_price_opn,
        tm1.price_usd as token1_price_usd,
        tm1.price_opn as token1_price_opn,
        tm0.volume_24h_usd as token0_volume_24h,
        tm1.volume_24h_usd as token1_volume_24h,
        tm0.price_change_24h as token0_price_change_24h,
        tm1.price_change_24h as token1_price_change_24h,
        tm0.liquidity_usd + tm1.liquidity_usd as total_liquidity_usd,
        tm0.tx_count_24h + tm1.tx_count_24h as total_tx_24h
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
      WHERE p.address = $1`,
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

    // Format comprehensive response
    const response = {
      address: pair.address,
      token0: {
        address: pair.token0,
        symbol: pair.token0_symbol,
        name: pair.name,
        decimals: pair.decimals,
        totalSupply: pair.total_supply,
        priceUSD: parseFloat(pair.token0_price_usd || '0'),
        priceOPN: parseFloat(pair.token0_price_opn || '0'),
        priceChange24h: parseFloat(pair.token0_price_change_24h || '0'),
        logo: pair.logo_uri,
        website: pair.website,
        telegram: pair.telegram,
        twitter: pair.twitter,
        honeypotStatus: pair.honeypot_status,
        buyTax: parseFloat(pair.buy_tax || '0'),
        sellTax: parseFloat(pair.sell_tax || '0'),
        isRenounced: pair.owner === '0x0000000000000000000000000000000000000000',
        isVerified: pair.contract_verified
      },
      token1: {
        // Similar structure for token1
      },
      liquidity: {
        usd: parseFloat(pair.total_liquidity_usd || '0'),
        reserves: {
          token0: pair.reserve0,
          token1: pair.reserve1
        }
      },
      stats24h: {
        volume: parseFloat(statsResult.rows[0]?.volume_usd || '0'),
        trades: parseInt(statsResult.rows[0]?.trade_count || '0'),
        uniqueTraders: parseInt(statsResult.rows[0]?.unique_traders || '0'),
        high: parseFloat(statsResult.rows[0]?.high_24h || '0'),
        low: parseFloat(statsResult.rows[0]?.low_24h || '0')
      },
      recentTrades: tradesResult.rows.map(trade => ({
        hash: trade.transaction_hash,
        timestamp: trade.timestamp,
        type: trade.trade_type,
        priceUSD: parseFloat(trade.price_token0_usd),
        priceOPN: parseFloat(trade.price_token0_opn),
        amountUSD: parseFloat(trade.amount_in_usd),
        maker: trade.maker,
        priceImpact: parseFloat(trade.price_impact || '0')
      })),
      liquidityEvents: liquidityResult.rows.map(event => ({
        type: event.event_type,
        timestamp: event.timestamp,
        amountUSD: parseFloat(event.amount_usd),
        provider: event.provider,
        hash: event.transaction_hash
      })),
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

/**
 * Get candle data for charts
 */
app.get('/api/pairs/:address/candles', async (req, res) => {
  try {
    const { address } = req.params;
    const { 
      timeframe = '15m', 
      from, 
      to,
      limit = 500 
    } = req.query;

    // Validate timeframe
    const validTimeframes = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w'];
    if (!validTimeframes.includes(timeframe as string)) {
      return res.status(400).json({ error: 'Invalid timeframe' });
    }

    // Build query
    let query = `
      SELECT * FROM candles 
      WHERE pair_address = $1 
      AND timeframe = $2
    `;
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

    // Format for TradingView
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
      closeOPN: parseFloat(candle.close_opn),
      buyVolume: parseFloat(candle.buy_volume_usd || '0'),
      sellVolume: parseFloat(candle.sell_volume_usd || '0'),
      trades: candle.trades_count,
      buyers: candle.buyers_count,
      sellers: candle.sellers_count
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
app.get('/api/search', async (req, res) => {
  try {
    const { q, limit = 20 } = req.query;

    if (!q || (q as string).length < 2) {
      return res.json({ results: [] });
    }

    const searchTerm = `%${q}%`;

    // Search tokens
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

    // Search pairs
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
app.get('/api/trending', async (req, res) => {
  try {
    const { type = 'gainers', timeframe = '24h', limit = 50 } = req.query;

    // Determine timeframe column
    const timeframeMap: Record<string, string> = {
      '5m': 'price_change_5m',
      '1h': 'price_change_1h',
      '6h': 'price_change_6h',
      '24h': 'price_change_24h',
      '7d': 'price_change_7d',
      '30d': 'price_change_30d'
    };

    const changeColumn = timeframeMap[timeframe as string] || 'price_change_24h';
    const order = type === 'gainers' ? 'DESC' : 'ASC';

    const result = await db.query(
      `SELECT 
        t.*,
        tm.price_usd,
        tm.price_opn,
        tm.${changeColumn} as price_change,
        tm.volume_24h_usd,
        tm.market_cap_usd,
        tm.liquidity_usd,
        tm.holder_count,
        tm.tx_count_24h,
        tm.buy_pressure
       FROM tokens t
       JOIN token_metrics tm ON t.address = tm.token_address
       WHERE tm.timestamp = (
        SELECT MAX(timestamp) FROM token_metrics WHERE token_address = t.address
       )
       AND tm.volume_24h_usd > 1000
       AND tm.liquidity_usd > 5000
       AND t.honeypot_status != 'danger'
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
      liquidity: parseFloat(token.liquidity_usd || '0'),
      holders: token.holder_count || 0,
      txCount24h: token.tx_count_24h || 0,
      buyPressure: parseFloat(token.buy_pressure || '50'),
      honeypotStatus: token.honeypot_status,
      isVerified: token.contract_verified
    }));

    res.json({ [type as string]: trending });
  } catch (error) {
    logger.error('Error fetching trending:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Get token holders
 */
app.get('/api/tokens/:address/holders', async (req, res) => {
  try {
    const { address } = req.params;
    const { limit = 100, minBalance = 0 } = req.query;

    const result = await db.query(
      `SELECT 
        h.*,
        t.symbol,
        t.decimals,
        t.total_supply
       FROM token_holders h
       JOIN tokens t ON h.token_address = t.address
       WHERE h.token_address = $1
       AND h.balance >= $2
       ORDER BY h.balance DESC
       LIMIT $3`,
      [address, minBalance, limit]
    );

    const holders = result.rows.map(holder => ({
      address: holder.holder_address,
      balance: holder.balance,
      percentage: parseFloat(holder.percentage || '0'),
      isContract: holder.is_contract,
      label: holder.label,
      firstTransaction: holder.first_tx_timestamp,
      lastTransaction: holder.last_tx_timestamp
    }));

    // Get distribution stats
    const statsResult = await db.query(
      `SELECT 
        COUNT(*) as total_holders,
        SUM(CASE WHEN percentage > 5 THEN 1 ELSE 0 END) as whales,
        SUM(CASE WHEN percentage > 1 THEN balance ELSE 0 END) / 
          (SELECT total_supply FROM tokens WHERE address = $1) * 100 as top_holders_percentage
       FROM token_holders
       WHERE token_address = $1`,
      [address]
    );

    const stats = statsResult.rows[0];

    res.json({
      holders,
      stats: {
        totalHolders: parseInt(stats.total_holders || '0'),
        whales: parseInt(stats.whales || '0'),
        topHoldersPercentage: parseFloat(stats.top_holders_percentage || '0')
      }
    });
  } catch (error) {
    logger.error('Error fetching holders:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Get liquidity providers
 */
app.get('/api/pairs/:address/liquidity-providers', async (req, res) => {
  try {
    const { address } = req.params;
    const { limit = 50 } = req.query;

    const result = await db.query(
      `SELECT 
        provider,
        SUM(CASE WHEN event_type = 'add' THEN amount_usd ELSE 0 END) as total_added,
        SUM(CASE WHEN event_type = 'remove' THEN amount_usd ELSE 0 END) as total_removed,
        SUM(CASE WHEN event_type = 'add' THEN amount_usd ELSE -amount_usd END) as net_liquidity,
        COUNT(*) as transaction_count,
        MAX(timestamp) as last_activity
       FROM liquidity_events
       WHERE pair_address = $1
       GROUP BY provider
       HAVING SUM(CASE WHEN event_type = 'add' THEN amount_usd ELSE -amount_usd END) > 0
       ORDER BY net_liquidity DESC
       LIMIT $2`,
      [address, limit]
    );

    const providers = result.rows.map(provider => ({
      address: provider.provider,
      totalAdded: parseFloat(provider.total_added || '0'),
      totalRemoved: parseFloat(provider.total_removed || '0'),
      netLiquidity: parseFloat(provider.net_liquidity || '0'),
      transactionCount: parseInt(provider.transaction_count || '0'),
      lastActivity: provider.last_activity
    }));

    res.json({ providers });
  } catch (error) {
    logger.error('Error fetching liquidity providers:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * User watchlist endpoints
 */
app.post('/api/watchlist', async (req, res) => {
  try {
    const { userAddress, pairAddress, notes } = req.body;

    if (!userAddress || !pairAddress) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    await db.query(
      `INSERT INTO watchlists (user_address, pair_address, notes)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_address, pair_address) 
       DO UPDATE SET notes = $3, created_at = CURRENT_TIMESTAMP`,
      [userAddress, pairAddress, notes]
    );

    res.json({ success: true });
  } catch (error) {
    logger.error('Error adding to watchlist:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/watchlist/:userAddress', async (req, res) => {
  try {
    const { userAddress } = req.params;

    const result = await db.query(
      `SELECT 
        w.*,
        p.token0_symbol,
        p.token1_symbol,
        tm0.price_usd as token0_price,
        tm0.price_change_24h as token0_change,
        tm1.price_usd as token1_price,
        tm1.price_change_24h as token1_change
       FROM watchlists w
       JOIN pairs p ON w.pair_address = p.address
       LEFT JOIN LATERAL (
        SELECT price_usd, price_change_24h FROM token_metrics 
        WHERE token_address = p.token0 
        ORDER BY timestamp DESC LIMIT 1
       ) tm0 ON true
       LEFT JOIN LATERAL (
        SELECT price_usd, price_change_24h FROM token_metrics 
        WHERE token_address = p.token1 
        ORDER BY timestamp DESC LIMIT 1
       ) tm1 ON true
       WHERE w.user_address = $1
       ORDER BY w.created_at DESC`,
      [userAddress]
    );

    const watchlist = result.rows.map(item => ({
      pairAddress: item.pair_address,
      pairName: `${item.token0_symbol}/${item.token1_symbol}`,
      notes: item.notes,
      token0Price: parseFloat(item.token0_price || '0'),
      token0Change24h: parseFloat(item.token0_change || '0'),
      token1Price: parseFloat(item.token1_price || '0'),
      token1Change24h: parseFloat(item.token1_change || '0'),
      addedAt: item.created_at
    }));

    res.json({ watchlist });
  } catch (error) {
    logger.error('Error fetching watchlist:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Price alerts
 */
app.post('/api/alerts', async (req, res) => {
  try {
    const { userAddress, pairAddress, alertType, threshold } = req.body;

    if (!userAddress || !pairAddress || !alertType || !threshold) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const result = await db.query(
      `INSERT INTO alerts (user_address, pair_address, alert_type, threshold)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [userAddress, pairAddress, alertType, threshold]
    );

    res.json({ alertId: result.rows[0].id });
  } catch (error) {
    logger.error('Error creating alert:', error);
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