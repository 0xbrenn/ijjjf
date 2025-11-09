import { ethers } from 'ethers';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { Server } from 'socket.io';
import { PriceCalculator } from '../services/PriceCalculator';
import { TokenAnalyzer } from '../services/TokenAnalyzer';
import { logger } from '../utils/logger';

interface IndexerConfig {
  rpcUrl: string;
  dbConfig: any;
  redisConfig: any;
  factoryAddress: string;
  routerAddress: string;
  wsServer?: Server;
  startBlock?: number;
  confirmations?: number;
}

export class EnhancedDexIndexer {
  protected provider: ethers.JsonRpcProvider;
  protected db: Pool;
  protected redis: Redis;
  protected factoryAddress: string;
  protected routerAddress: string;
  protected wsServer?: Server;
  protected tokenAnalyzer: TokenAnalyzer;
  
  // Caches
  protected pairsCache = new Map<string, any>();
  protected tokensCache = new Map<string, any>();
  protected priceCache = new Map<string, number>();
  
  // Constants
  protected readonly BATCH_SIZE = 100;
  protected readonly SYNC_INTERVAL = 12000; // 12 seconds
  protected readonly METRICS_INTERVAL = 60000; // 1 minute
  
  constructor(config: IndexerConfig) {
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
    this.db = new Pool(config.dbConfig);
    this.redis = new Redis(config.redisConfig);
    this.factoryAddress = config.factoryAddress;
    this.routerAddress = config.routerAddress;
    this.wsServer = config.wsServer;
    this.tokenAnalyzer = new TokenAnalyzer(this.provider, this.db);
  }

  async start() {
    logger.info('🚀 Starting Enhanced DEX Indexer...');
    
    // Initialize database
    await this.initializeDatabase();
    
    // Start indexing from multiple sources
    await Promise.all([
      this.syncPairs(),
      this.listenToEvents(),
      this.startMetricsCalculation(),
      this.startCandleGeneration(),
      this.startLiquidityTracking()
    ]);
  }

  protected async initializeDatabase() {
    try {
      const schemaPath = __dirname + '/../database/schema.sql';
      const schema = await require('fs').promises.readFile(schemaPath, 'utf8');
      await this.db.query(schema);
      logger.info('✅ Database initialized');
    } catch (error) {
      logger.error('Database initialization error:', error);
      throw error;
    }
  }

  /**
   * Sync all pairs from factory
   */
  // Fix for backend/indexer/index.ts - replace the syncPairs method
private async syncPairs() {
  const factoryAbi = [
    'function allPairsLength() view returns (uint256)',
    'function allPairs(uint256) view returns (address)',
    'event PairCreated(address indexed token0, address indexed token1, address pair, uint256)'
  ];

  const factory = new ethers.Contract(this.factoryAddress, factoryAbi, this.provider);
  
  try {
    const pairsCount = await factory.allPairsLength();
    const pairsCountNumber = Number(pairsCount); // Convert BigInt to Number
    logger.info(`Found ${pairsCountNumber} pairs in factory`);

    // Process in batches
    for (let i = 0; i < pairsCountNumber; i += this.BATCH_SIZE) {
      const batch = [];
      for (let j = i; j < Math.min(i + this.BATCH_SIZE, pairsCountNumber); j++) {
        batch.push(factory.allPairs(j));
      }
      
      const pairAddresses = await Promise.all(batch);
      await Promise.all(pairAddresses.map(addr => this.indexPair(addr)));
    }
    
    logger.info('✅ All pairs synced');
  } catch (error) {
    logger.error('Pair sync error:', error);
  }
}
  /**
   * Index a single pair
   */
  private async indexPair(pairAddress: string) {
    if (this.pairsCache.has(pairAddress)) return;

    const pairAbi = [
      'function token0() view returns (address)',
      'function token1() view returns (address)',
      'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
      'function totalSupply() view returns (uint256)'
    ];

    const pair = new ethers.Contract(pairAddress, pairAbi, this.provider);

    try {
      const [token0, token1, reserves, totalSupply] = await Promise.all([
        pair.token0(),
        pair.token1(),
        pair.getReserves(),
        pair.totalSupply()
      ]);

      // Index tokens if not already done
      await Promise.all([
        this.indexToken(token0),
        this.indexToken(token1)
      ]);

      // Get token info from cache
      const token0Info = this.tokensCache.get(token0);
      const token1Info = this.tokensCache.get(token1);

      // Insert pair
      const query = `
        INSERT INTO pairs (
          address, token0, token1, token0_symbol, token1_symbol,
          token0_decimals, token1_decimals, factory, reserve0, reserve1, total_supply
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (address) DO UPDATE SET
          reserve0 = EXCLUDED.reserve0,
          reserve1 = EXCLUDED.reserve1,
          total_supply = EXCLUDED.total_supply,
          updated_at = CURRENT_TIMESTAMP
      `;

      await this.db.query(query, [
        pairAddress,
        token0,
        token1,
        token0Info?.symbol || 'Unknown',
        token1Info?.symbol || 'Unknown',
        token0Info?.decimals || 18,
        token1Info?.decimals || 18,
        this.factoryAddress,
        reserves.reserve0.toString(),
        reserves.reserve1.toString(),
        totalSupply.toString()
      ]);

      this.pairsCache.set(pairAddress, {
        token0,
        token1,
        token0Info,
        token1Info
      });

      logger.info(`✅ Indexed pair: ${token0Info?.symbol}/${token1Info?.symbol}`);
    } catch (error) {
      logger.error(`Failed to index pair ${pairAddress}:`, error);
    }
  }

  /**
   * Index token with analysis
   */
  protected async indexToken(tokenAddress: string) {
  if (this.tokensCache.has(tokenAddress)) return;

  try {
    logger.info(`Analyzing token: ${tokenAddress}`);
    
    const tokenInfo = await this.tokenAnalyzer.analyzeToken(tokenAddress);
    
    const query = `
      INSERT INTO tokens (
        address, symbol, name, decimals, total_supply,
        logo_uri, website, telegram, twitter, description,
        honeypot_status, buy_tax, sell_tax
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      ON CONFLICT (address) DO UPDATE SET
        total_supply = EXCLUDED.total_supply,
        honeypot_status = EXCLUDED.honeypot_status
    `;

    await this.db.query(query, [
      tokenAddress,
      tokenInfo.symbol,
      tokenInfo.name,
      tokenInfo.decimals,
      tokenInfo.totalSupply,
      tokenInfo.logoUri || null,
      tokenInfo.website || null,
      tokenInfo.telegram || null,
      tokenInfo.twitter || null,
      tokenInfo.description || null,
      tokenInfo.honeypotStatus || 'unknown',
      tokenInfo.buyTax || null,
      tokenInfo.sellTax || null
    ]);

    this.tokensCache.set(tokenAddress, tokenInfo);
    logger.info(`✅ Indexed token: ${tokenInfo.symbol} (${tokenAddress})`);
  } catch (error) {
    logger.error(`Failed to index token ${tokenAddress}:`, error);
  }
}
  /**
   * Listen to blockchain events
   */
  private async listenToEvents() {
    // Listen to Swap events from all pairs
    const pairAbi = [
      'event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)',
      'event Sync(uint112 reserve0, uint112 reserve1)',
      'event Mint(address indexed sender, uint256 amount0, uint256 amount1)',
      'event Burn(address indexed sender, uint256 amount0, uint256 amount1, address indexed to)'
    ];

    // Create filter for all pairs
    const filter = {
      topics: [
        [
          ethers.id('Swap(address,uint256,uint256,uint256,uint256,address)'),
          ethers.id('Sync(uint112,uint112)'),
          ethers.id('Mint(address,uint256,uint256)'),
          ethers.id('Burn(address,uint256,uint256,address)')
        ]
      ]
    };

    this.provider.on(filter, async (log) => {
      try {
        const pairAddress = log.address;
        await this.indexPair(pairAddress); // Ensure pair is indexed
        
        const pairInfo = this.pairsCache.get(pairAddress);
        if (!pairInfo) return;

        const iface = new ethers.Interface(pairAbi);
        const parsed = iface.parseLog(log);

        switch (parsed?.name) {
          case 'Swap':
            await this.handleSwap(log, parsed.args, pairInfo);
            break;
          case 'Sync':
            await this.handleSync(pairAddress, parsed.args);
            break;
          case 'Mint':
            await this.handleLiquidityAdd(log, parsed.args, pairInfo);
            break;
          case 'Burn':
            await this.handleLiquidityRemove(log, parsed.args, pairInfo);
            break;
        }
      } catch (error) {
        logger.error('Event processing error:', error);
      }
    });

    logger.info('✅ Event listeners attached');
  }

  /**
   * Handle swap events with enhanced price tracking
   */
  private async handleSwap(
    log: ethers.Log,
    args: any,
    pairInfo: any
  ) {
    const { sender, amount0In, amount1In, amount0Out, amount1Out, to } = args;
    const { transactionHash, blockNumber } = log;

    // Get current reserves
    const pairContract = new ethers.Contract(
      log.address,
      ['function getReserves() view returns (uint112, uint112, uint32)'],
      this.provider
    );
    const [reserve0, reserve1] = await pairContract.getReserves();

    // Calculate prices
    const priceData = PriceCalculator.calculateSwapPrice(
      pairInfo.token0,
      pairInfo.token1,
      amount0In,
      amount1In,
      amount0Out,
      amount1Out,
      reserve0,
      reserve1
    );

    if (!priceData) return;

    // Determine trade type
    const tradeType = amount0In > 0n ? 
      (pairInfo.token0.toLowerCase() === PriceCalculator.WOPN_ADDRESS ? 'sell' : 'buy') :
      (pairInfo.token1.toLowerCase() === PriceCalculator.WOPN_ADDRESS ? 'sell' : 'buy');

    // Get transaction details
    const tx = await this.provider.getTransaction(transactionHash);
    const receipt = await this.provider.getTransactionReceipt(transactionHash);
    const block = await this.provider.getBlock(blockNumber);

    // Save trade
    const query = `
      INSERT INTO trades (
        block_number, transaction_hash, log_index, timestamp, pair_address,
        token0_amount, token1_amount, amount_in_usd, amount_out_usd,
        price_token0_usd, price_token1_usd, price_token0_opn, price_token1_opn,
        gas_used, gas_price
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      ON CONFLICT (transaction_hash, log_index) DO NOTHING
    `;

    await this.db.query(query, [
      blockNumber,
      transactionHash,
      log.index,
      block?.timestamp || Math.floor(Date.now() / 1000),
      log.address,
      amount0In || amount0Out,
      amount1In || amount1Out,
      priceData.volumeUSD24h,
      priceData.volumeUSD24h,
      priceData.token0Price.priceInUSD,
      priceData.token1Price.priceInUSD,
      priceData.token0Price.priceInOPN,
      priceData.token1Price.priceInOPN,
      receipt?.gasUsed.toString(),
      tx?.gasPrice?.toString()
    ]);

    // Update cache
    this.priceCache.set(`${log.address}:token0`, priceData.token0Price.priceInUSD);
    this.priceCache.set(`${log.address}:token1`, priceData.token1Price.priceInUSD);

    // Emit to WebSocket
    if (this.wsServer) {
      this.wsServer.emit('trade', {
        pair: log.address,
        token0: pairInfo.token0,
        token1: pairInfo.token1,
        token0Symbol: pairInfo.token0Info?.symbol,
        token1Symbol: pairInfo.token1Info?.symbol,
        priceUSD: tradeType === 'buy' ? priceData.token0Price.priceInUSD : priceData.token1Price.priceInUSD,
        priceOPN: tradeType === 'buy' ? priceData.token0Price.priceInOPN : priceData.token1Price.priceInOPN,
        volumeUSD: priceData.volumeUSD24h,
        tradeType,
        timestamp: block?.timestamp || Math.floor(Date.now() / 1000),
        txHash: transactionHash
      });
    }

    // Publish to Redis for other services
    await this.redis.publish(`trades:${log.address}`, JSON.stringify({
      ...priceData,
      tradeType,
      timestamp: block?.timestamp || Math.floor(Date.now() / 1000)
    }));

    logger.debug(`Trade processed: ${pairInfo.token0Info?.symbol}/${pairInfo.token1Info?.symbol} - ${tradeType}`);
  }

  /**
   * Handle sync events (reserve updates)
   */
  private async handleSync(pairAddress: string, args: any) {
    const { reserve0, reserve1 } = args;

    await this.db.query(
      'UPDATE pairs SET reserve0 = $1, reserve1 = $2, updated_at = CURRENT_TIMESTAMP WHERE address = $3',
      [reserve0.toString(), reserve1.toString(), pairAddress]
    );
  }

  /**
   * Handle liquidity add events
   */
  private async handleLiquidityAdd(log: ethers.Log, args: any, pairInfo: any) {
    const { sender, amount0, amount1 } = args;
    const block = await this.provider.getBlock(log.blockNumber);

    // Calculate USD value
    const token0Price = this.priceCache.get(`${log.address}:token0`) || 0;
    const token1Price = this.priceCache.get(`${log.address}:token1`) || 0;
    const amount0USD = (Number(amount0) / 1e18) * token0Price;
    const amount1USD = (Number(amount1) / 1e18) * token1Price;
    const totalUSD = amount0USD + amount1USD;

    const query = `
      INSERT INTO liquidity_events (
        pair_address, transaction_hash, block_number, timestamp,
        event_type, token0_amount, token1_amount, liquidity_minted, provider, amount_usd
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `;

    await this.db.query(query, [
      log.address,
      log.transactionHash,
      log.blockNumber,
      block?.timestamp || Math.floor(Date.now() / 1000),
      'add',
      amount0.toString(),
      amount1.toString(),
      '0', // Would need to parse Mint event for actual LP tokens
      sender,
      totalUSD
    ]);

    // Emit event
    if (this.wsServer) {
      this.wsServer.emit('liquidity', {
        type: 'add',
        pair: log.address,
        amountUSD: totalUSD,
        provider: sender,
        timestamp: block?.timestamp
      });
    }
  }

  /**
   * Handle liquidity remove events
   */
  private async handleLiquidityRemove(log: ethers.Log, args: any, pairInfo: any) {
    const { sender, amount0, amount1, to } = args;
    const block = await this.provider.getBlock(log.blockNumber);

    // Calculate USD value
    const token0Price = this.priceCache.get(`${log.address}:token0`) || 0;
    const token1Price = this.priceCache.get(`${log.address}:token1`) || 0;
    const amount0USD = (Number(amount0) / 1e18) * token0Price;
    const amount1USD = (Number(amount1) / 1e18) * token1Price;
    const totalUSD = amount0USD + amount1USD;

    const query = `
      INSERT INTO liquidity_events (
        pair_address, transaction_hash, block_number, timestamp,
        event_type, token0_amount, token1_amount, liquidity_burned, provider, amount_usd
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `;

    await this.db.query(query, [
      log.address,
      log.transactionHash,
      log.blockNumber,
      block?.timestamp || Math.floor(Date.now() / 1000),
      'remove',
      amount0.toString(),
      amount1.toString(),
      '0', // Would need to parse Burn event for actual LP tokens
      sender,
      totalUSD
    ]);

    // Emit event
    if (this.wsServer) {
      this.wsServer.emit('liquidity', {
        type: 'remove',
        pair: log.address,
        amountUSD: totalUSD,
        provider: sender,
        timestamp: block?.timestamp
      });
    }
  }

  /**
   * Generate candles for all timeframes
   */
  private async startCandleGeneration() {
    const timeframes = [
      { interval: '1m', seconds: 60 },
      { interval: '5m', seconds: 300 },
      { interval: '15m', seconds: 900 },
      { interval: '30m', seconds: 1800 },
      { interval: '1h', seconds: 3600 },
      { interval: '4h', seconds: 14400 },
      { interval: '1d', seconds: 86400 },
      { interval: '1w', seconds: 604800 }
    ];

    setInterval(async () => {
      for (const { interval, seconds } of timeframes) {
        await this.generateCandles(interval, seconds);
      }
    }, 60000); // Run every minute
  }

  /**
   * Generate candles for a specific timeframe
   */
  private async generateCandles(timeframe: string, seconds: number) {
    // Implementation remains the same
    const currentTime = Math.floor(Date.now() / 1000);
    const candleTime = Math.floor(currentTime / seconds) * seconds;

    try {
      const pairs = await this.db.query('SELECT address FROM pairs');
      
      for (const pair of pairs.rows) {
        const trades = await this.db.query(
          `SELECT * FROM trades 
           WHERE pair_address = $1 
           AND timestamp >= $2 
           AND timestamp < $3
           ORDER BY timestamp ASC`,
          [pair.address, candleTime, candleTime + seconds]
        );

        if (trades.rows.length === 0) continue;

        // Process trades and create candles
        // ... (rest of implementation same as before)
      }
    } catch (error) {
      logger.error(`Candle generation error for ${timeframe}:`, error);
    }
  }

  /**
   * Calculate and update token metrics
   */
  private async startMetricsCalculation() {
    setInterval(async () => {
      await this.calculateTokenMetrics();
    }, this.METRICS_INTERVAL);
  }

  private async calculateTokenMetrics() {
    try {
      const tokens = await this.db.query('SELECT address FROM tokens');
      
      for (const token of tokens.rows) {
        // Calculate metrics for each token
        // ... (implementation remains the same)
      }

      logger.info('✅ Token metrics updated');
    } catch (error) {
      logger.error('Metrics calculation error:', error);
    }
  }

  /**
   * Calculate price changes for different timeframes
   */
  private async calculatePriceChanges(tokenAddress: string, currentPrice: number) {
    const now = Math.floor(Date.now() / 1000);
    const timeframes = [
      { name: 'change5m', seconds: 300 },
      { name: 'change1h', seconds: 3600 },
      { name: 'change6h', seconds: 21600 },
      { name: 'change24h', seconds: 86400 },
      { name: 'change7d', seconds: 604800 },
      { name: 'change30d', seconds: 2592000 }
    ];

    const changes: any = {};

    for (const { name, seconds } of timeframes) {
      const result = await this.db.query(
        `SELECT price_usd FROM token_metrics 
         WHERE token_address = $1 
         AND timestamp <= $2 
         ORDER BY timestamp DESC 
         LIMIT 1`,
        [tokenAddress, now - seconds]
      );

      const previousPrice = result.rows[0]?.price_usd || currentPrice;
      changes[name] = PriceCalculator.calculatePriceChange(currentPrice, previousPrice);
    }

    return changes;
  }

  /**
   * Get holder metrics for a token
   */
  private async getHolderMetrics(tokenAddress: string) {
    // In a real implementation, this would query the blockchain
    // For now, return placeholder data
    return {
      holderCount: 0,
      top10Percentage: 0,
      top20Percentage: 0
    };
  }

  /**
   * Get transaction metrics
   */
  private async getTransactionMetrics(tokenAddress: string, since: number) {
    const result = await this.db.query(
      `SELECT 
        COUNT(DISTINCT transaction_hash) as tx_count,
        COUNT(DISTINCT CASE WHEN trade_type = 'buy' THEN maker END) as unique_buyers,
        COUNT(DISTINCT CASE WHEN trade_type = 'sell' THEN maker END) as unique_sellers,
        SUM(CASE WHEN trade_type = 'buy' THEN amount_in_usd ELSE 0 END) as buy_volume,
        SUM(amount_in_usd) as total_volume
       FROM trades t
       JOIN pairs p ON t.pair_address = p.address
       WHERE (p.token0 = $1 OR p.token1 = $1)
       AND t.timestamp > $2`,
      [tokenAddress, since]
    );

    const row = result.rows[0];
    const buyPressure = row.total_volume > 0 ? (row.buy_volume / row.total_volume) * 100 : 50;

    return {
      txCount: parseInt(row.tx_count) || 0,
      uniqueBuyers: parseInt(row.unique_buyers) || 0,
      uniqueSellers: parseInt(row.unique_sellers) || 0,
      buyPressure
    };
  }

  /**
   * Start liquidity tracking
   */
  private async startLiquidityTracking() {
    // Monitor liquidity changes every 5 minutes
    setInterval(async () => {
      await this.updateLiquidityMetrics();
    }, 300000);
  }

  private async updateLiquidityMetrics() {
    try {
      const pairs = await this.db.query('SELECT * FROM pairs');
      
      for (const pair of pairs.rows) {
        const token0Price = this.priceCache.get(`${pair.address}:token0`) || 0;
        const token1Price = this.priceCache.get(`${pair.address}:token1`) || 0;
        
        const liquidity0USD = (Number(pair.reserve0) / 1e18) * token0Price;
        const liquidity1USD = (Number(pair.reserve1) / 1e18) * token1Price;
        const totalLiquidityUSD = liquidity0USD + liquidity1USD;
        
        // Check for significant liquidity changes
        const previousLiquidity = await this.redis.get(`liquidity:${pair.address}`);
        if (previousLiquidity) {
          const change = ((totalLiquidityUSD - parseFloat(previousLiquidity)) / parseFloat(previousLiquidity)) * 100;
          
          if (Math.abs(change) > 10) { // 10% change threshold
            if (this.wsServer) {
              this.wsServer.emit('liquidity_alert', {
                pair: pair.address,
                change,
                newLiquidity: totalLiquidityUSD,
                timestamp: Math.floor(Date.now() / 1000)
              });
            }
          }
        }
        
        await this.redis.set(`liquidity:${pair.address}`, totalLiquidityUSD.toString());
      }
    } catch (error) {
      logger.error('Liquidity tracking error:', error);
    }
  }

  /**
   * Graceful shutdown
   */
  async stop() {
    logger.info('Stopping indexer...');
    await this.db.end();
    this.redis.disconnect();
    this.provider.removeAllListeners();
  }
}

// Export for use
export default EnhancedDexIndexer;