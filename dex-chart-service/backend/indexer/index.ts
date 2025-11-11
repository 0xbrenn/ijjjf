import { ethers } from 'ethers';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { Server } from 'socket.io';
import { PriceCalculatorEnhanced } from '../services/PriceCalculator';
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
    
    // Sync pairs first (sequentially, not in parallel)
    await this.syncPairs();
    
    // Then start other services
    await Promise.all([
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
  protected async syncPairs() {
    const factoryAbi = [
      'function allPairsLength() view returns (uint256)',
      'function allPairs(uint256) view returns (address)',
      'event PairCreated(address indexed token0, address indexed token1, address pair, uint256)'
    ];

    const factory = new ethers.Contract(this.factoryAddress, factoryAbi, this.provider);
    
    try {
      const pairsCount = await factory.allPairsLength();
      const pairsCountNumber = Number(pairsCount);
      logger.info(`Found ${pairsCountNumber} pairs in factory`);

      // Step 1: Collect all unique tokens FIRST
      const uniqueTokens = new Set<string>();
      const pairDataArray = [];
      
      logger.info('Collecting unique tokens from pairs...');
      
      const pairAbi = [
        'function token0() view returns (address)',
        'function token1() view returns (address)',
        'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
        'function totalSupply() view returns (uint256)'
      ];
      
      // Gather all pair data and unique tokens
      for (let i = 0; i < pairsCountNumber; i++) {
        const pairAddress = await factory.allPairs(i);
        const pair = new ethers.Contract(pairAddress, pairAbi, this.provider);
        
        try {
          const [token0, token1, reserves, totalSupply] = await Promise.all([
            pair.token0(),
            pair.token1(),
            pair.getReserves(),
            pair.totalSupply()
          ]);
          
          uniqueTokens.add(token0.toLowerCase());
          uniqueTokens.add(token1.toLowerCase());
          
          pairDataArray.push({
            address: pairAddress,
            token0,
            token1,
            reserves,
            totalSupply
          });
        } catch (error) {
          logger.error(`Failed to get data for pair ${pairAddress}:`, error);
        }
      }
      
      // Step 2: Index all unique tokens ONCE
      logger.info(`Indexing ${uniqueTokens.size} unique tokens...`);
      let tokenCount = 0;
      
      for (const tokenAddress of uniqueTokens) {
        await this.indexToken(tokenAddress);
        tokenCount++;
        if (tokenCount % 10 === 0) {
          logger.info(`Progress: ${tokenCount}/${uniqueTokens.size} tokens indexed`);
        }
      }
      
      // Step 3: Now index all pairs using cached token data
      logger.info(`Indexing ${pairDataArray.length} pairs...`);
      let pairCount = 0;
      
      for (const pairData of pairDataArray) {
        await this.indexPairWithData(pairData);
        pairCount++;
        if (pairCount % 10 === 0) {
          logger.info(`Progress: ${pairCount}/${pairDataArray.length} pairs indexed`);
        }
      }
      
      logger.info('✅ All pairs synced');
    } catch (error) {
      logger.error('Pair sync error:', error);
    }
  }
  /**
   * Index a single pair
   */

   protected async indexPairWithData(pairData: any) {
  const { address, token0, token1, reserves, totalSupply } = pairData;
  
  // ✅ NORMALIZE addresses to lowercase!
  const normalizedToken0 = token0.toLowerCase();
  const normalizedToken1 = token1.toLowerCase();
  
  // Get token info from cache
  const token0Info = this.tokensCache.get(normalizedToken0);
  const token1Info = this.tokensCache.get(normalizedToken1);

  // ✅ If tokens not in cache, check database
  if (!token0Info || !token1Info) {
    logger.warn(`Missing token info for pair ${address}`);
    
    // Try to fetch from database
    const token0Result = await this.db.query(
      'SELECT * FROM tokens WHERE LOWER(address) = LOWER($1)',
      [token0]
    );
    const token1Result = await this.db.query(
      'SELECT * FROM tokens WHERE LOWER(address) = LOWER($1)',
      [token1]
    );
    
    if (token0Result.rows.length === 0 || token1Result.rows.length === 0) {
      logger.error(`Cannot insert pair ${address} - tokens missing from DB`);
      return; // Skip this pair
    }
    
    // Update cache
    this.tokensCache.set(normalizedToken0, token0Result.rows[0]);
    this.tokensCache.set(normalizedToken1, token1Result.rows[0]);
  }

  // Get fresh token info
  const token0InfoFinal = this.tokensCache.get(normalizedToken0);
  const token1InfoFinal = this.tokensCache.get(normalizedToken1);

  // Insert pair with EXACT address from database
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
    address,
    token0InfoFinal.address,  // ✅ Use address from DB (guaranteed to match)
    token1InfoFinal.address,  // ✅ Use address from DB (guaranteed to match)
    token0InfoFinal?.symbol || 'Unknown',
    token1InfoFinal?.symbol || 'Unknown',
    token0InfoFinal?.decimals || 18,
    token1InfoFinal?.decimals || 18,
    this.factoryAddress,
    reserves.reserve0.toString(),
    reserves.reserve1.toString(),
    totalSupply.toString()
  ]);

  this.pairsCache.set(address, {
    token0: token0InfoFinal.address,
    token1: token1InfoFinal.address,
    token0Info: token0InfoFinal,
    token1Info: token1InfoFinal
  });

  logger.info(`✅ Indexed pair: ${token0InfoFinal?.symbol}/${token1InfoFinal?.symbol}`);
}


  protected async indexPair(pairAddress: string) {
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

    // Index tokens if not already done - CRITICAL FIX
    await Promise.all([
      this.indexToken(token0),
      this.indexToken(token1)
    ]);

    // Wait a bit to ensure tokens are committed to DB
    await new Promise(resolve => setTimeout(resolve, 100));

    // Get token info from cache
    const token0Info = this.tokensCache.get(token0.toLowerCase()) || this.tokensCache.get(token0);
    const token1Info = this.tokensCache.get(token1.toLowerCase()) || this.tokensCache.get(token1);

    // If tokens still not found, skip this pair for now
    if (!token0Info || !token1Info) {
      logger.warn(`Skipping pair ${pairAddress} - tokens not indexed yet`);
      return;
    }

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
      token0Info.symbol || 'Unknown',
      token1Info.symbol || 'Unknown', 
      token0Info.decimals || 18,
      token1Info.decimals || 18,
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

    logger.info(`✅ Indexed pair: ${token0Info.symbol}/${token1Info.symbol}`);
  } catch (error) {
    logger.error(`Failed to index pair ${pairAddress}:`, error);
  }
}

  /**
   * Index token with analysis
   */
  // Replace the indexToken method in backend/indexer/index.ts
protected async indexToken(tokenAddress: string) {
  const normalizedAddress = tokenAddress.toLowerCase();
  
  // ✅ ALWAYS check DB first, even if cached
  const existing = await this.db.query(
    'SELECT * FROM tokens WHERE LOWER(address) = LOWER($1)',
    [tokenAddress]
  );
  
  if (existing.rows.length > 0) {
    this.tokensCache.set(normalizedAddress, existing.rows[0]);
    return; // ✅ Token confirmed in DB
  }

  // Check if in cache but not in DB (race condition)
  if (this.tokensCache.has(normalizedAddress)) {
    // Wait a bit and check DB again
    await new Promise(resolve => setTimeout(resolve, 100));
    const recheck = await this.db.query(
      'SELECT * FROM tokens WHERE LOWER(address) = LOWER($1)',
      [tokenAddress]
    );
    if (recheck.rows.length > 0) {
      return; // ✅ Now in DB
    }
  }

  try {
    // Check if this address is actually a pair contract
    const pairCheck = await this.db.query(
      'SELECT * FROM pairs WHERE LOWER(address) = LOWER($1)',
      [tokenAddress]
    );
    
    if (pairCheck.rows.length > 0) {
      logger.info(`Address ${tokenAddress} is an LP token from a pair`);
    }

    logger.info(`Analyzing new token: ${tokenAddress}`);
    
    // STEP 1: Get basic token info WITHOUT full analysis
    const tokenContract = new ethers.Contract(tokenAddress, [
      'function symbol() view returns (string)',
      'function name() view returns (string)',
      'function decimals() view returns (uint8)',
      'function totalSupply() view returns (uint256)'
    ], this.provider);

    const [symbol, name, decimals, totalSupply] = await Promise.all([
      tokenContract.symbol().catch(() => 'UNKNOWN'),
      tokenContract.name().catch(() => 'Unknown Token'),
      tokenContract.decimals().catch(() => 18),
      tokenContract.totalSupply().catch(() => BigInt(0))
    ]);

    // For LP tokens, override the symbol
    const finalSymbol = pairCheck.rows.length > 0 ? 'LP-TOKEN' : symbol;
    const finalName = pairCheck.rows.length > 0 ? 
      `LP Token (${pairCheck.rows[0].token0_symbol}/${pairCheck.rows[0].token1_symbol})` : name;

    // ✅ Insert token and WAIT for it to complete
    const insertQuery = `
      INSERT INTO tokens (
        address, symbol, name, decimals, total_supply, 
        circulating_supply, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
      ON CONFLICT (address) DO UPDATE SET
        symbol = EXCLUDED.symbol,
        name = EXCLUDED.name,
        decimals = EXCLUDED.decimals,
        total_supply = EXCLUDED.total_supply,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `;

    // ✅ WAIT for the insert to complete and return the row
    const result = await this.db.query(insertQuery, [
      tokenAddress,
      finalSymbol,
      finalName,
      decimals,
      totalSupply.toString(),
      totalSupply.toString() // Assume circulating = total for now
    ]);

    // ✅ Only cache AFTER confirming DB insert
    if (result.rows.length > 0) {
      this.tokensCache.set(normalizedAddress, result.rows[0]);
      logger.info(`✅ Token indexed: ${finalSymbol} (${finalName})`);
    }

    // ✅ Double-check it's actually in the database
    await new Promise(resolve => setTimeout(resolve, 50));
    const verify = await this.db.query(
      'SELECT * FROM tokens WHERE LOWER(address) = LOWER($1)',
      [tokenAddress]
    );
    
    if (verify.rows.length === 0) {
      throw new Error(`Token ${tokenAddress} failed to commit to database`);
    }

  } catch (error) {
    logger.error(`Failed to index token ${tokenAddress}:`, error);
    throw error; // ✅ Propagate error so pair indexing stops
  }
}
  /**
   * Listen to blockchain events
   */
  protected async listenToEvents() {
    const pairAbi = [
      'event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)',
      'event Sync(uint112 reserve0, uint112 reserve1)',
      'event Mint(address indexed sender, uint256 amount0, uint256 amount1)',
      'event Burn(address indexed sender, uint256 amount0, uint256 amount1, address indexed to)'
    ];

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
        await this.indexPair(pairAddress);
        
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


  // Add this method to your indexer class:
protected async updateTokenMetricsForPair(pairAddress: string, priceData: any, timestamp: number) {
  try {
    const pairInfo = this.pairsCache.get(pairAddress);
    if (!pairInfo) return;

    const now = Math.floor(timestamp);
    
    // Update metrics for both tokens in the pair
    for (const tokenAddress of [pairInfo.token0, pairInfo.token1]) {
      // ✅ FIXED: Normalize address to lowercase for database consistency
      const normalizedTokenAddress = tokenAddress.toLowerCase();
      
      const isToken0 = normalizedTokenAddress === pairInfo.token0.toLowerCase();
      const priceUSD = isToken0 ? priceData.token0Price.priceInUSD : priceData.token1Price.priceInUSD;
      const priceOPN = isToken0 ? priceData.token0Price.priceInOPN : priceData.token1Price.priceInOPN;

      // Get 24h volume for this token across all pairs (use LOWER for case-insensitive comparison)
      const volumeResult = await this.db.query(
        `SELECT COALESCE(SUM(amount_in_usd), 0) as volume 
         FROM trades t
         JOIN pairs p ON t.pair_address = p.address
         WHERE (LOWER(p.token0) = LOWER($1) OR LOWER(p.token1) = LOWER($1))
         AND t.timestamp > $2`,
        [normalizedTokenAddress, now - 86400]
      );
      
      const volume24h = parseFloat(volumeResult.rows[0]?.volume || '0');

      // Get liquidity from reserves (use LOWER for case-insensitive comparison)
      const liquidityResult = await this.db.query(
        `SELECT 
          CASE 
            WHEN LOWER(token0) = LOWER($1) THEN CAST(reserve0 AS NUMERIC) * $2 / 1e18
            WHEN LOWER(token1) = LOWER($1) THEN CAST(reserve1 AS NUMERIC) * $2 / 1e18
            ELSE 0
          END as token_liquidity
         FROM pairs
         WHERE LOWER(token0) = LOWER($1) OR LOWER(token1) = LOWER($1)`,
        [normalizedTokenAddress, priceUSD]
      );

      const liquidityUSD = liquidityResult.rows.reduce((sum, row) => sum + parseFloat(row.token_liquidity || '0'), 0);

      // Insert or update token metrics (use normalized lowercase address)
      await this.db.query(
        `INSERT INTO token_metrics (
          token_address, timestamp, price_usd, price_opn, 
          volume_24h_usd, liquidity_usd, liquidity_opn,
          price_change_24h, market_cap_usd
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (token_address, timestamp) DO UPDATE SET
          price_usd = EXCLUDED.price_usd,
          price_opn = EXCLUDED.price_opn,
          volume_24h_usd = EXCLUDED.volume_24h_usd,
          liquidity_usd = EXCLUDED.liquidity_usd,
          liquidity_opn = EXCLUDED.liquidity_opn`,
        [
          normalizedTokenAddress, // ✅ FIXED: Use lowercase address
          now, 
          priceUSD, 
          priceOPN, 
          volume24h,
          liquidityUSD,
          liquidityUSD / 0.05, // OPN liquidity
          0, // price_change_24h (will be calculated later)
          0  // market_cap (will be calculated later)
        ]
      );
    }
  } catch (error) {
    // Log errors during batch processing
    logger.error('Error updating token metrics:', error);
  }
}
  /**
   * Handle swap events with enhanced price tracking
   */
 // Replace the handleSwap method in backend/indexer/index.ts (around line 460)
// This fixes the zero price and amount issues

protected async handleSwap(log: ethers.Log, args: any, pairInfo: any) {
  const { sender, amount0In, amount1In, amount0Out, amount1Out, to } = args;
  const { transactionHash, blockNumber } = log;

  let tradeType = 'unknown';

  logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  logger.info(`Processing Swap Event`);
  logger.info(`Pair: ${log.address}`);
  logger.info(`TX: ${transactionHash}`);

  try {
    // ✅ NEW: Check if pair exists in cache, if not, index it dynamically
    if (!pairInfo) {
      logger.warn(`🆕 Pair ${log.address} not in cache, indexing now...`);
      await this.indexPair(log.address);
      
      // Get the newly indexed pair info
      pairInfo = this.pairsCache.get(log.address);
      
      if (!pairInfo) {
        logger.error(`❌ Failed to index pair ${log.address}`);
        return;
      }
      
      logger.info(`✅ Dynamically indexed pair: ${pairInfo.token0Info?.symbol}/${pairInfo.token1Info?.symbol}`);
    }

    // 1. Get current reserves
    const pairContract = new ethers.Contract(
      log.address,
      ['function getReserves() view returns (uint112, uint112, uint32)'],
      this.provider
    );
    const [reserve0, reserve1] = await pairContract.getReserves();

    logger.info(`Reserves: ${ethers.formatEther(reserve0)} / ${ethers.formatEther(reserve1)}`);
    logger.info(`Amount0In: ${ethers.formatEther(amount0In)}, Amount0Out: ${ethers.formatEther(amount0Out)}`);
    logger.info(`Amount1In: ${ethers.formatEther(amount1In)}, Amount1Out: ${ethers.formatEther(amount1Out)}`);

    // 2. Calculate prices using PriceCalculator
    const priceData = await PriceCalculatorEnhanced.calculateSwapPrice(
      pairInfo.token0,
      pairInfo.token1,
      amount0In,
      amount1In,
      amount0Out,
      amount1Out,
      reserve0,
      reserve1,
      this.db
    );

    if (!priceData) {
      logger.warn('PriceCalculator returned null - invalid swap data');
      return;
    }

    logger.info(`Token0 Price: $${priceData.token0Price.priceInUSD} (${priceData.token0Price.priceInOPN} OPN)`);
    logger.info(`Token1 Price: $${priceData.token1Price.priceInUSD} (${priceData.token1Price.priceInOPN} OPN)`);

    // 3. Determine trade direction and calculate actual USD amounts
    let isBuyingToken0 = false;
    let amountInToken: bigint;
    let amountOutToken: bigint;
    let amountInUSD = 0;
    let amountOutUSD = 0;

    if (amount0In > 0n && amount1Out > 0n) {
      // Selling token0 for token1
      isBuyingToken0 = false;
      amountInToken = amount0In;
      amountOutToken = amount1Out;
      amountInUSD = Number(ethers.formatEther(amount0In)) * priceData.token0Price.priceInUSD;
      amountOutUSD = Number(ethers.formatEther(amount1Out)) * priceData.token1Price.priceInUSD;
    } else if (amount1In > 0n && amount0Out > 0n) {
      // Selling token1 for token0
      isBuyingToken0 = true;
      amountInToken = amount1In;
      amountOutToken = amount0Out;
      amountInUSD = Number(ethers.formatEther(amount1In)) * priceData.token1Price.priceInUSD;
      amountOutUSD = Number(ethers.formatEther(amount0Out)) * priceData.token0Price.priceInUSD;
    } else {
      logger.warn('Invalid swap: no input or output amounts');
      return;
    }

    logger.info(`Amount In USD: $${amountInUSD.toFixed(6)}`);
    logger.info(`Amount Out USD: $${amountOutUSD.toFixed(6)}`);

    // 4. Determine trade type (buy/sell)
   const WOPN_ADDRESS = '0xBc022C9dEb5AF250A526321d16Ef52E39b4DBD84';
const token0IsWOPN = pairInfo.token0.toLowerCase() === WOPN_ADDRESS.toLowerCase();
const token1IsWOPN = pairInfo.token1.toLowerCase() === WOPN_ADDRESS.toLowerCase();
let baseIsToken0 = true;
let tradeType: string;
if (token0IsWOPN) {
  tradeType = isBuyingToken0 ? 'sell' : 'buy';
  baseIsToken0 = false;
} else if (token1IsWOPN) {
  tradeType = isBuyingToken0 ? 'buy' : 'sell';
  baseIsToken0 = true;
} else {
  const token0Price = priceData.token0Price.priceInUSD;
  const token1Price = priceData.token1Price.priceInUSD;
  
  if (token0Price > 0 && token1Price > 0) {
    baseIsToken0 = token0Price < token1Price;
  }
  
  tradeType = baseIsToken0
    ? (isBuyingToken0 ? 'buy' : 'sell')
    : (isBuyingToken0 ? 'sell' : 'buy');
}

logger.info(`Trade Type: ${tradeType} (base: ${baseIsToken0 ? 'token0' : 'token1'})`);
    // 5. Calculate price impact
    const reserveIn = isBuyingToken0 
      ? Number(ethers.formatEther(reserve1)) 
      : Number(ethers.formatEther(reserve0));
    const reserveOut = isBuyingToken0 
      ? Number(ethers.formatEther(reserve0)) 
      : Number(ethers.formatEther(reserve1));
    
    const priceImpact = PriceCalculatorEnhanced.calculatePriceImpact(
      Number(ethers.formatEther(amountInToken)),
      reserveIn,
      reserveOut
    );

    logger.info(`Price Impact: ${priceImpact.toFixed(2)}%`);

    // 6. Get transaction details
    const tx = await this.provider.getTransaction(transactionHash);
    const receipt = await this.provider.getTransactionReceipt(transactionHash);
    const block = await this.provider.getBlock(blockNumber);
    
    const maker = tx?.from || sender;
    const timestamp = block?.timestamp || Math.floor(Date.now() / 1000);

    // 7. Insert trade into database
    const query = `
      INSERT INTO trades (
        block_number, transaction_hash, log_index, timestamp, pair_address,
        token0_amount, token1_amount, amount_in_usd, amount_out_usd,
        price_token0_usd, price_token1_usd, price_token0_opn, price_token1_opn,
        gas_used, gas_price, maker, trade_type, price_impact
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      ON CONFLICT (transaction_hash, log_index) DO UPDATE SET
        amount_in_usd = EXCLUDED.amount_in_usd,
        amount_out_usd = EXCLUDED.amount_out_usd,
        price_token0_usd = EXCLUDED.price_token0_usd,
        price_token1_usd = EXCLUDED.price_token1_usd
      RETURNING id
    `;

    const result = await this.db.query(query, [
      Number(blockNumber),
      transactionHash,
      log.index,
      timestamp,
      log.address,
      (amount0In > 0n ? amount0In : amount0Out).toString(),
      (amount1In > 0n ? amount1In : amount1Out).toString(),
      amountInUSD,
      amountOutUSD,
      priceData.token0Price.priceInUSD,
      priceData.token1Price.priceInUSD,
      priceData.token0Price.priceInOPN,
      priceData.token1Price.priceInOPN,
      receipt?.gasUsed?.toString() || '0',
      tx?.gasPrice?.toString() || '0',
      maker,
      tradeType,
      priceImpact
    ]);

    logger.info(`✅ Trade saved to database (ID: ${result.rows[0]?.id})`);

    // Update token metrics
await this.updateTokenMetricsForPair(log.address, priceData, timestamp);

    // 8. Update price cache
    this.priceCache.set(`${log.address}:token0`, priceData.token0Price.priceInUSD);
    this.priceCache.set(`${log.address}:token1`, priceData.token1Price.priceInUSD);

    // Determine which token's price to display (always the NON-WOPN token)
    const displayPriceUSD = token0IsWOPN 
      ? priceData.token1Price.priceInUSD
      : priceData.token0Price.priceInUSD;
      
    const displayPriceOPN = token0IsWOPN
      ? priceData.token1Price.priceInOPN
      : priceData.token0Price.priceInOPN;

    // 9. Publish to Redis
    await this.redis.publish(`price:${log.address}`, JSON.stringify({
      pair: log.address,
      token0Price: priceData.token0Price.priceInUSD,
      token1Price: priceData.token1Price.priceInUSD,
      timestamp: timestamp,
      volume: amountInUSD
    }));

    await this.redis.publish(`trades:${log.address}`, JSON.stringify({
      pair: log.address,
      txHash: transactionHash,
      timestamp: timestamp,
      tradeType: tradeType,
      priceUSD: displayPriceUSD,
      priceOPN: displayPriceOPN,
      volumeUSD: amountInUSD,
      maker: maker,
      priceImpact: priceImpact
    }));

    logger.info('✅ Published to Redis');

    // 10. Emit WebSocket event
    if (this.wsServer) {
      this.wsServer.emit('trade', {
        pair: log.address,
        token0: pairInfo.token0,
        token1: pairInfo.token1,
        token0Symbol: pairInfo.token0Info?.symbol || 'UNKNOWN',
        token1Symbol: pairInfo.token1Info?.symbol || 'UNKNOWN',
        priceUSD: displayPriceUSD,
        priceOPN: displayPriceOPN,
        volumeUSD: amountInUSD,
        volumeOPN: amountInUSD / 0.05,
        timestamp: timestamp,
        txHash: transactionHash,
        maker: maker,
        tradeType: tradeType,
        priceImpact: priceImpact
      });

      logger.info('✅ Emitted WebSocket event');
    }

    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  } catch (error) {
    logger.error('❌ Error processing swap:', error);
    logger.error(`Pair: ${log.address}, TX: ${transactionHash}`);
  }

  logger.debug(`Trade processed: ${pairInfo?.token0Info?.symbol}/${pairInfo?.token1Info?.symbol} - ${tradeType}`);
}

  protected async handleSync(pairAddress: string, args: any) {
    const { reserve0, reserve1 } = args;
    await this.db.query(
      'UPDATE pairs SET reserve0 = $1, reserve1 = $2, updated_at = CURRENT_TIMESTAMP WHERE address = $3',
      [reserve0.toString(), reserve1.toString(), pairAddress]
    );
  }

  protected async handleLiquidityAdd(log: ethers.Log, args: any, pairInfo: any) {
    const { sender, amount0, amount1 } = args;
    const block = await this.provider.getBlock(log.blockNumber);

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
      '0',
      sender,
      totalUSD
    ]);

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

  protected async handleLiquidityRemove(log: ethers.Log, args: any, pairInfo: any) {
    const { sender, amount0, amount1, to } = args;
    const block = await this.provider.getBlock(log.blockNumber);

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
      '0',
      sender,
      totalUSD
    ]);

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

  protected async startCandleGeneration() {
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
    }, 60000);
  }

  protected async generateCandles(timeframe: string, seconds: number) {
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

        const firstTrade = trades.rows[0];
        const lastTrade = trades.rows[trades.rows.length - 1];
        
        let highUSD = firstTrade.price_token0_usd;
        let lowUSD = firstTrade.price_token0_usd;
        let highOPN = firstTrade.price_token0_opn;
        let lowOPN = firstTrade.price_token0_opn;
        let volumeUSD = 0;
        let volumeToken0 = 0n;
        let volumeToken1 = 0n;

        for (const trade of trades.rows) {
          highUSD = Math.max(highUSD, trade.price_token0_usd);
          lowUSD = Math.min(lowUSD, trade.price_token0_usd);
          highOPN = Math.max(highOPN, trade.price_token0_opn);
          lowOPN = Math.min(lowOPN, trade.price_token0_opn);
          volumeUSD += parseFloat(trade.amount_in_usd);
          volumeToken0 += BigInt(trade.token0_amount);
          volumeToken1 += BigInt(trade.token1_amount);
        }

        const query = `
          INSERT INTO candles (
            pair_address, timeframe, time, 
            open_usd, high_usd, low_usd, close_usd,
            open_opn, high_opn, low_opn, close_opn,
            volume_usd, volume_token0, volume_token1
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
          ON CONFLICT (pair_address, timeframe, time) DO UPDATE SET
            high_usd = GREATEST(candles.high_usd, EXCLUDED.high_usd),
            low_usd = LEAST(candles.low_usd, EXCLUDED.low_usd),
            close_usd = EXCLUDED.close_usd,
            high_opn = GREATEST(candles.high_opn, EXCLUDED.high_opn),
            low_opn = LEAST(candles.low_opn, EXCLUDED.low_opn),
            close_opn = EXCLUDED.close_opn,
            volume_usd = candles.volume_usd + EXCLUDED.volume_usd,
            volume_token0 = candles.volume_token0 + EXCLUDED.volume_token0,
            volume_token1 = candles.volume_token1 + EXCLUDED.volume_token1
        `;

        await this.db.query(query, [
          pair.address,
          timeframe,
          candleTime,
          firstTrade.price_token0_usd,
          highUSD,
          lowUSD,
          lastTrade.price_token0_usd,
          firstTrade.price_token0_opn,
          highOPN,
          lowOPN,
          lastTrade.price_token0_opn,
          volumeUSD,
          volumeToken0.toString(),
          volumeToken1.toString()
        ]);

        if (this.wsServer) {
          this.wsServer.to(`candles:${pair.address}:${timeframe}`).emit('candle', {
            pair: pair.address,
            timeframe,
            time: candleTime,
            open: lastTrade.price_token0_usd,
            high: highUSD,
            low: lowUSD,
            close: lastTrade.price_token0_usd,
            volume: volumeUSD
          });
        }
      }
    } catch (error) {
      logger.error(`Candle generation error for ${timeframe}:`, error);
    }
  }

  protected async startMetricsCalculation() {
    setInterval(async () => {
      await this.calculateTokenMetrics();
    }, this.METRICS_INTERVAL);
  }

protected async calculateTokenMetrics() {
  try {
    const tokens = await this.db.query('SELECT address FROM tokens');
    
    for (const token of tokens.rows) {
      const now = Math.floor(Date.now() / 1000);
      
      const pairs = await this.db.query(
        'SELECT * FROM pairs WHERE LOWER(token0) = LOWER($1) OR LOWER(token1) = LOWER($1)',
        [token.address]
      );

      if (pairs.rows.length === 0) continue;

      let totalLiquidityUSD = 0;
      let totalLiquidityOPN = 0;
      let volume24hUSD = 0;
      let priceUSD = 0;
      let priceOPN = 0;

      for (const pair of pairs.rows) {
        // ✅ FIXED: Use case-insensitive comparison
        const isToken0 = pair.token0.toLowerCase() === token.address.toLowerCase();
        const price = this.priceCache.get(`${pair.address}:token${isToken0 ? '0' : '1'}`);
        
        if (price && price > priceUSD) {
          priceUSD = price;
          priceOPN = price / PriceCalculatorEnhanced.OPN_PRICE_USD;
        }

        const volumeResult = await this.db.query(
          `SELECT SUM(amount_in_usd) as volume 
           FROM trades 
           WHERE pair_address = $1 
           AND timestamp > $2`,
          [pair.address, now - 86400]
        );
        
        volume24hUSD += parseFloat(volumeResult.rows[0]?.volume || '0');

        const reserve = isToken0 ? pair.reserve0 : pair.reserve1;
        const liquidityTokens = Number(reserve) / 1e18;
        totalLiquidityUSD += liquidityTokens * priceUSD;
        totalLiquidityOPN += liquidityTokens * priceOPN;
      }

      const priceChanges = await this.calculatePriceChanges(token.address, priceUSD);
      const holderMetrics = await this.getHolderMetrics(token.address);
      const txMetrics = await this.getTransactionMetrics(token.address, now - 86400);

      const tokenInfo = this.tokensCache.get(token.address);
      const marketCap = tokenInfo ? (Number(tokenInfo.circulatingSupply || tokenInfo.totalSupply) / 1e18) * priceUSD : 0;
      const fdv = tokenInfo ? (Number(tokenInfo.totalSupply) / 1e18) * priceUSD : 0;

      const query = `
        INSERT INTO token_metrics (
          token_address, timestamp, price_usd, price_opn,
          market_cap_usd, fdv_usd, volume_24h_usd,
          price_change_5m, price_change_1h, price_change_6h,
          price_change_24h, price_change_7d, price_change_30d,
          liquidity_usd, liquidity_opn, holder_count,
          tx_count_24h, unique_buyers_24h, unique_sellers_24h,
          buy_pressure
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
      `;

      await this.db.query(query, [
        token.address,
        now,
        priceUSD,
        priceOPN,
        marketCap,
        fdv,
        volume24hUSD,
        priceChanges.change5m,
        priceChanges.change1h,
        priceChanges.change6h,
        priceChanges.change24h,
        priceChanges.change7d,
        priceChanges.change30d,
        totalLiquidityUSD,
        totalLiquidityOPN,
        holderMetrics.holderCount,
        txMetrics.txCount,
        txMetrics.uniqueBuyers,
        txMetrics.uniqueSellers,
        txMetrics.buyPressure
      ]);

      this.redis.setex(
        `token:metrics:${token.address}`,
        300,
        JSON.stringify({
          priceUSD,
          priceOPN,
          marketCap,
          fdv,
          volume24hUSD,
          priceChange24h: priceChanges.change24h,
          liquidity: totalLiquidityUSD,
          holders: holderMetrics.holderCount
        })
      );
    }
    
    logger.info('✅ Token metrics updated');
  } catch (error) {
    logger.error('Metrics calculation error:', error);
  }
}

  protected async calculatePriceChanges(tokenAddress: string, currentPrice: number) {
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
      changes[name] = PriceCalculatorEnhanced.calculatePriceChange(currentPrice, previousPrice);
    }

    return changes;
  }

  protected async getHolderMetrics(tokenAddress: string) {
    return {
      holderCount: 0,
      top10Percentage: 0,
      top20Percentage: 0
    };
  }

  protected async getTransactionMetrics(tokenAddress: string, since: number) {
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

  protected async startLiquidityTracking() {
    setInterval(async () => {
      await this.updateLiquidityMetrics();
    }, 300000);
  }

  protected async updateLiquidityMetrics() {
    try {
      const pairs = await this.db.query('SELECT * FROM pairs');
      
      for (const pair of pairs.rows) {
        const token0Price = this.priceCache.get(`${pair.address}:token0`) || 0;
        const token1Price = this.priceCache.get(`${pair.address}:token1`) || 0;
        
        const liquidity0USD = (Number(pair.reserve0) / 1e18) * token0Price;
        const liquidity1USD = (Number(pair.reserve1) / 1e18) * token1Price;
        const totalLiquidityUSD = liquidity0USD + liquidity1USD;
        
        const previousLiquidity = await this.redis.get(`liquidity:${pair.address}`);
        if (previousLiquidity) {
          const change = ((totalLiquidityUSD - parseFloat(previousLiquidity)) / parseFloat(previousLiquidity)) * 100;
          
          if (Math.abs(change) > 10) {
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

  async stop() {
    logger.info('Stopping indexer...');
    await this.db.end();
    this.redis.disconnect();
    this.provider.removeAllListeners();
  }
}

export default EnhancedDexIndexer;