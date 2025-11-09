import { ethers } from 'ethers';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { Server } from 'socket.io';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

interface Trade {
  blockNumber: number;
  transactionHash: string;
  timestamp: number;
  pair: string;
  token0: string;
  token1: string;
  amount0In: string;
  amount1In: string;
  amount0Out: string;
  amount1Out: string;
  price: number;
  volume: number;
  maker: string;
}

interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  trades: number;
}

class DexIndexer {
  private provider: ethers.Provider;
  private db: Pool;
  private redis: Redis;
  private wsServer: any; // WebSocket server reference
  private factoryAddress: string;
  private routerAddress: string;
  private pairsCache: Map<string, any> = new Map(); // Cache for pair info

  constructor(config: {
    rpcUrl: string;
    dbConfig: any;
    redisConfig: any;
    factoryAddress: string;
    routerAddress: string;
    wsServer?: any;
  }) {
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
    this.db = new Pool(config.dbConfig);
    this.redis = new Redis(config.redisConfig);
    this.factoryAddress = config.factoryAddress;
    this.routerAddress = config.routerAddress;
    this.wsServer = config.wsServer;
  }

  async start() {
    console.log('Starting DEX indexer...');
    console.log('Using RPC:', process.env.RPC_URL);
    console.log('Factory Address:', process.env.FACTORY_ADDRESS);
    
    // Initialize database tables
    await this.initializeDatabase();
    
    // Start listening to events
    await this.listenToSwapEvents();
    
    // Start candle generation job
    this.startCandleGeneration();
  }

  private async initializeDatabase() {
    const queries = [
      `CREATE TABLE IF NOT EXISTS pairs (
        address VARCHAR(42) PRIMARY KEY,
        token0 VARCHAR(42) NOT NULL,
        token1 VARCHAR(42) NOT NULL,
        token0_symbol VARCHAR(20),
        token1_symbol VARCHAR(20),
        token0_decimals INT,
        token1_decimals INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      
      `CREATE TABLE IF NOT EXISTS trades (
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
      )`,
      
      `CREATE TABLE IF NOT EXISTS candles (
        id SERIAL PRIMARY KEY,
        pair_address VARCHAR(42) NOT NULL,
        timeframe VARCHAR(10) NOT NULL,
        time BIGINT NOT NULL,
        open NUMERIC(40, 18) NOT NULL,
        high NUMERIC(40, 18) NOT NULL,
        low NUMERIC(40, 18) NOT NULL,
        close NUMERIC(40, 18) NOT NULL,
        volume NUMERIC(40, 18) NOT NULL,
        trades INT NOT NULL,
        UNIQUE(pair_address, timeframe, time)
      )`
    ];

    for (const query of queries) {
      try {
        await this.db.query(query);
      } catch (error) {
        console.error('Error creating table:', error);
      }
    }

    // Create indexes
    const indexQueries = [
      `CREATE INDEX IF NOT EXISTS idx_trades_pair_timestamp ON trades(pair_address, timestamp)`,
      `CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trades(timestamp)`,
      `CREATE INDEX IF NOT EXISTS idx_candles_lookup ON candles(pair_address, timeframe, time)`
    ];

    for (const query of indexQueries) {
      try {
        await this.db.query(query);
      } catch (error) {
        // Ignore index exists errors
      }
    }
  }

  private async listenToSwapEvents() {
    // Get factory contract
    const factoryAbi = [
      'event PairCreated(address indexed token0, address indexed token1, address pair, uint)',
      'function allPairs(uint) external view returns (address)',
      'function allPairsLength() external view returns (uint)'
    ];
    
    try {
      const factory = new ethers.Contract(this.factoryAddress, factoryAbi, this.provider);
      
      // Get existing pairs
      const pairCount = await factory.allPairsLength();
      console.log(`Found ${pairCount} existing pairs`);
      
      // Index existing pairs
      const pairsToIndex = Math.min(Number(pairCount), 50); // Index up to 50 pairs
      for (let i = 0; i < pairsToIndex; i++) {
        const pairAddress = await factory.allPairs(i);
        await this.indexPair(pairAddress);
      }
      
      // Listen for new pairs
      factory.on('PairCreated', async (token0, token1, pair) => {
        console.log(`New pair created: ${pair}`);
        await this.indexPair(pair);
      });
    } catch (error) {
      console.error('Error connecting to factory:', error);
      console.log('Make sure your RPC_URL and FACTORY_ADDRESS are correct');
    }
  }

 // Add this to your indexer - updated indexPair function
private async indexPair(pairAddress: string) {
  const pairAbi = [
    'event Swap(address indexed sender, uint amount0In, uint amount1In, uint amount0Out, uint amount1Out, address indexed to)',
    'function token0() external view returns (address)',
    'function token1() external view returns (address)',
    'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)'
  ];
  
  const tokenAbi = [
    'function name() view returns (string)',
    'function symbol() view returns (string)',
    'function decimals() view returns (uint8)'
  ];
  
  const pair = new ethers.Contract(pairAddress, pairAbi, this.provider);
  
  try {
    const token0 = await pair.token0();
    const token1 = await pair.token1();
    
    // Fetch token information
    let token0Symbol = 'Unknown';
    let token1Symbol = 'Unknown';
    let token0Name = 'Unknown Token';
    let token1Name = 'Unknown Token';
    let token0Decimals = 18;
    let token1Decimals = 18;
    
    try {
      const token0Contract = new ethers.Contract(token0, tokenAbi, this.provider);
      const token1Contract = new ethers.Contract(token1, tokenAbi, this.provider);
      
      // Special handling for WOPN
      if (token0.toLowerCase() === '0xBc022C9dEb5AF250A526321d16Ef52E39b4DBD84'.toLowerCase()) {
        token0Symbol = 'WOPN';
        token0Name = 'Wrapped OPN';
      } else {
        try {
          token0Symbol = await token0Contract.symbol();
          token0Name = await token0Contract.name();
          token0Decimals = await token0Contract.decimals();
        } catch (e) {
          console.log(`Could not fetch token0 info for ${token0}, using defaults`);
          token0Symbol = `${token0.slice(0, 4)}...${token0.slice(-3)}`;
        }
      }
      
      if (token1.toLowerCase() === '0xBc022C9dEb5AF250A526321d16Ef52E39b4DBD84'.toLowerCase()) {
        token1Symbol = 'WOPN';
        token1Name = 'Wrapped OPN';
      } else {
        try {
          token1Symbol = await token1Contract.symbol();
          token1Name = await token1Contract.name();
          token1Decimals = await token1Contract.decimals();
        } catch (e) {
          console.log(`Could not fetch token1 info for ${token1}, using defaults`);
          token1Symbol = `${token1.slice(0, 4)}...${token1.slice(-3)}`;
        }
      }
    } catch (error) {
      console.error(`Error fetching token info for pair ${pairAddress}:`, error);
    }
    
    // Save pair to database with token info
    await this.db.query(
      `INSERT INTO pairs (address, token0, token1, token0_symbol, token1_symbol, token0_decimals, token1_decimals) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) 
       ON CONFLICT (address) 
       DO UPDATE SET 
         token0_symbol = EXCLUDED.token0_symbol,
         token1_symbol = EXCLUDED.token1_symbol,
         token0_decimals = EXCLUDED.token0_decimals,
         token1_decimals = EXCLUDED.token1_decimals`,
      [pairAddress, token0, token1, token0Symbol, token1Symbol, token0Decimals, token1Decimals]
    );
    
    console.log(`Indexed pair ${pairAddress}: ${token0Symbol}/${token1Symbol}`);
    
    // Listen to swap events
    pair.on('Swap', async (...args) => {
      // The event object is the last argument
      const event = args[args.length - 1];
      const [sender, amount0In, amount1In, amount0Out, amount1Out, to] = args;
      
      await this.processSwap({
        pairAddress,
        sender: sender.toString(),
        amount0In: amount0In.toString(),
        amount1In: amount1In.toString(),
        amount0Out: amount0Out.toString(),
        amount1Out: amount1Out.toString(),
        to: to.toString(),
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber,
        transactionIndex: event.transactionIndex,
        logIndex: event.logIndex
      });
    });
    
  } catch (error) {
    console.error(`Error indexing pair ${pairAddress}:`, error);
  }
}

  // Simplified processSwap function with correct price calculation
// FIXED: processSwap that always calculates the price of the non-WOPN token
async processSwap(swapData: any) {
  const { 
    pairAddress, 
    sender, 
    amount0In, 
    amount1In, 
    amount0Out, 
    amount1Out, 
    to, 
    transactionHash, 
    blockNumber 
  } = swapData;

  // Constants
  const WOPN_ADDRESS = '0xBc022C9dEb5AF250A526321d16Ef52E39b4DBD84'.toLowerCase();
  const WOPN_PRICE_USD = 0.05;

  // Get pair info
  let pairInfo = this.pairsCache.get(pairAddress);
  if (!pairInfo) {
    const pairQuery = await this.db.query(
      'SELECT * FROM pairs WHERE address = $1',
      [pairAddress]
    );
    if (pairQuery.rows.length > 0) {
      pairInfo = pairQuery.rows[0];
      this.pairsCache.set(pairAddress, pairInfo);
    } else {
      console.error('Pair not found in database:', pairAddress);
      return;
    }
  }

  // Identify which token is WOPN
  const isToken0WOPN = pairInfo.token0.toLowerCase() === WOPN_ADDRESS;
  const isToken1WOPN = pairInfo.token1.toLowerCase() === WOPN_ADDRESS;

  if (!isToken0WOPN && !isToken1WOPN) {
    console.log('Non-WOPN pair, cannot calculate USD price');
    return;
  }

  // Convert amounts from BigInt to numbers (assuming 18 decimals)
  const amount0InNum = Number(amount0In) / 1e18;
  const amount1InNum = Number(amount1In) / 1e18;
  const amount0OutNum = Number(amount0Out) / 1e18;
  const amount1OutNum = Number(amount1Out) / 1e18;

  // We always want to store the price of the NON-WOPN token in USD
  let priceOfNonWOPNTokenInUSD: number;
  let volumeUSD: number;
  let rawPrice: number; // For logging

  if (amount0InNum > 0 && amount1OutNum > 0) {
    // Token0 in, Token1 out
    const priceRatio = amount1OutNum / amount0InNum;
    
    if (isToken0WOPN) {
      // WOPN in, Other token out
      // priceRatio = Other tokens per WOPN
      // USD price of other token = priceRatio * $0.05
      rawPrice = priceRatio;
      priceOfNonWOPNTokenInUSD = priceRatio * WOPN_PRICE_USD;
      volumeUSD = amount0InNum * WOPN_PRICE_USD;
    } else {
      // Other token in, WOPN out
      // priceRatio = WOPN per Other token
      // USD price of other token = priceRatio * $0.05
      rawPrice = priceRatio;
      priceOfNonWOPNTokenInUSD = priceRatio * WOPN_PRICE_USD;
      volumeUSD = amount0InNum * priceOfNonWOPNTokenInUSD;
    }
    
  } else if (amount1InNum > 0 && amount0OutNum > 0) {
    // Token1 in, Token0 out
    const priceRatio = amount0OutNum / amount1InNum;
    
    if (isToken1WOPN) {
      // WOPN in, Other token out
      // priceRatio = Other tokens per WOPN
      // USD price of other token = priceRatio * $0.05
      rawPrice = priceRatio;
      priceOfNonWOPNTokenInUSD = priceRatio * WOPN_PRICE_USD;
      volumeUSD = amount1InNum * WOPN_PRICE_USD;
    } else {
      // Other token in, WOPN out
      // priceRatio = WOPN per Other token  
      // USD price of other token = priceRatio * $0.05
      rawPrice = priceRatio;
      priceOfNonWOPNTokenInUSD = priceRatio * WOPN_PRICE_USD;
      volumeUSD = amount1InNum * priceOfNonWOPNTokenInUSD;
    }
  } else {
    console.error('Invalid swap amounts');
    return;
  }

  // IMPORTANT: If the raw price is > 1, it means we have the inverse
  // e.g., 47.93 means 47.93 OPNT per WOPN, so we need to invert to get WOPN per OPNT
  if (rawPrice > 1) {
    // This means we have "Other tokens per WOPN" but we want "WOPN per Other token"
    const wopnPerOtherToken = 1 / rawPrice;
    priceOfNonWOPNTokenInUSD = wopnPerOtherToken * WOPN_PRICE_USD;
  }

  console.log(`Processing swap on pair ${pairAddress}: {`);
  console.log(`  blockNumber: ${blockNumber},`);
  console.log(`  rawPrice: '${rawPrice.toFixed(6)}',`);
  console.log(`  priceInUSD: '${priceOfNonWOPNTokenInUSD.toFixed(6)}',`);
  console.log(`  volumeUSD: ${volumeUSD.toFixed(2)}`);
  console.log(`}`);

  // Save to database
  const timestamp = Math.floor(Date.now() / 1000);
  const txHash = transactionHash || `0x${Date.now().toString(16)}${Math.random().toString(16).substr(2, 8)}`;
  
  const query = `
    INSERT INTO trades (
      pair_address, transaction_hash, block_number, timestamp,
      token0_amount, token1_amount, price, volume_usd, maker
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  `;

  await this.db.query(query, [
    pairAddress,
    txHash,
    blockNumber || 0,
    timestamp,
    amount0In || amount0Out,
    amount1In || amount1Out,
    priceOfNonWOPNTokenInUSD,
    volumeUSD,
    sender
  ]);

  // Emit price update
  if (this.wsServer) {
    this.wsServer.emit('price_update', {
      pair: pairAddress,
      price: priceOfNonWOPNTokenInUSD,
      volume: volumeUSD,
      timestamp: timestamp,
      type: amount0InNum > 0 ? 'sell' : 'buy'
    });
  }

  // Update Redis
  await this.redis.hset(`price:${pairAddress}`, {
    price: priceOfNonWOPNTokenInUSD.toString(),
    volume_24h: volumeUSD.toString(),
    last_update: timestamp.toString()
  });

  console.log('Trade saved to database');
}

  private startCandleGeneration() {
    const timeframes = [
      { name: '1m', seconds: 60 },
      { name: '5m', seconds: 300 },
      { name: '15m', seconds: 900 },
      { name: '30m', seconds: 1800 },
      { name: '1h', seconds: 3600 },
      { name: '4h', seconds: 14400 },
      { name: '1d', seconds: 86400 }
    ];
    
    // Generate candles every minute
    setInterval(async () => {
      const currentTime = Math.floor(Date.now() / 1000);
      
      for (const timeframe of timeframes) {
        const candleTime = Math.floor(currentTime / timeframe.seconds) * timeframe.seconds;
        await this.generateCandles(timeframe.name, candleTime, timeframe.seconds);
      }
    }, 60000); // Run every minute
  }

  private async generateCandles(timeframe: string, candleTime: number, duration: number) {
    const startTime = candleTime - duration;
    const endTime = candleTime;
    
    const query = `
      WITH pair_trades AS (
        SELECT 
          pair_address,
          price,
          volume_usd,
          timestamp
        FROM trades
        WHERE timestamp >= $1 AND timestamp < $2
        ORDER BY pair_address, timestamp
      )
      INSERT INTO candles (pair_address, timeframe, time, open, high, low, close, volume, trades)
      SELECT 
        pair_address,
        $3 as timeframe,
        $4 as time,
        (array_agg(price ORDER BY timestamp ASC))[1] as open,
        MAX(price) as high,
        MIN(price) as low,
        (array_agg(price ORDER BY timestamp DESC))[1] as close,
        COALESCE(SUM(volume_usd), 0) as volume,
        COUNT(*) as trades
      FROM pair_trades
      GROUP BY pair_address
      ON CONFLICT (pair_address, timeframe, time) DO UPDATE
      SET 
        open = EXCLUDED.open,
        high = EXCLUDED.high,
        low = EXCLUDED.low,
        close = EXCLUDED.close,
        volume = EXCLUDED.volume,
        trades = EXCLUDED.trades
    `;
    
    try {
      await this.db.query(query, [startTime, endTime, timeframe, candleTime]);
    } catch (error) {
      // Ignore errors for now
    }
  }

  // Set the WebSocket server after initialization
  setWebSocketServer(wsServer: any) {
    this.wsServer = wsServer;
  }
}

// Create and start indexer
const indexer = new DexIndexer({
  rpcUrl: process.env.RPC_URL || 'https://testnet-rpc.iopn.tech',
  dbConfig: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'dex_charts',
    user: process.env.DB_USER || 'brenn',
    password: process.env.DB_PASSWORD || ''
  },
  redisConfig: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379')
  },
  factoryAddress: process.env.FACTORY_ADDRESS || '0x8860242B65611dfd077aEe26C3C7920813dF9208',
  routerAddress: process.env.ROUTER_ADDRESS || '0xB489bce5c9c9364da2D1D1Bc5CE4274F63141885'
});

// Start indexing
indexer.start().catch(console.error);

export default DexIndexer;
export { indexer };