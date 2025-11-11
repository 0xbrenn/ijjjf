// backend/indexer/swapProcessor.ts
// Enhanced swap processing with cross-pair pricing support

import { ethers } from 'ethers';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { Server } from 'socket.io';
import { PriceCalculatorEnhanced } from '../services/PriceCalculator';
import { logger } from '../utils/logger';

interface PairInfo {
  address: string;
  token0: string;
  token1: string;
  token0Info?: any;
  token1Info?: any;
  reserve0: bigint;
  reserve1: bigint;
}

export class SwapProcessor {
  constructor(
    private db: Pool,
    private redis: Redis,
    private wsServer?: Server,
    private pairsCache: Map<string, any> = new Map(),
    private tokensCache: Map<string, any> = new Map()
  ) {}

  /**
   * Process a swap event with enhanced cross-pair pricing
   */
  async processSwap(log: any, timestamp: number) {
    try {
      logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      logger.info(`🔄 Processing Swap Event`);
      logger.info(`Pair: ${log.address}`);
      logger.info(`Block: ${log.blockNumber}`);

      const pairInfo = this.pairsCache.get(log.address.toLowerCase());
      if (!pairInfo) {
        logger.warn(`⚠️  Pair not found in cache: ${log.address}`);
        return;
      }

      // Decode swap event
      const swapInterface = new ethers.Interface([
        'event Swap(address indexed sender, uint amount0In, uint amount1In, uint amount0Out, uint amount1Out, address indexed to)'
      ]);

      const decoded = swapInterface.parseLog({
        topics: log.topics,
        data: log.data
      });

      if (!decoded) {
        logger.error('Failed to decode swap event');
        return;
      }

      const { sender, amount0In, amount1In, amount0Out, amount1Out, to } = decoded.args;
      const transactionHash = log.transactionHash;

      logger.info(`Sender: ${sender}`);
      logger.info(`Maker: ${to}`);
      logger.info(`Amount0In: ${ethers.formatUnits(amount0In, 18)}`);
      logger.info(`Amount1In: ${ethers.formatUnits(amount1In, 18)}`);
      logger.info(`Amount0Out: ${ethers.formatUnits(amount0Out, 18)}`);
      logger.info(`Amount1Out: ${ethers.formatUnits(amount1Out, 18)}`);

      // ✅ ENHANCED: Use PriceCalculatorEnhanced with database support
      const priceData = await PriceCalculatorEnhanced.calculateSwapPrice(
        pairInfo.token0,
        pairInfo.token1,
        amount0In,
        amount1In,
        amount0Out,
        amount1Out,
        pairInfo.reserve0,
        pairInfo.reserve1,
        this.db // Pass database connection for cross-pair pricing
      );

      if (!priceData) {
        logger.warn('⚠️  Could not calculate price data');
        return;
      }

      // Determine trade type and amounts
      const token0IsWOPN = pairInfo.token0.toLowerCase() === PriceCalculatorEnhanced.WOPN_ADDRESS;
      const token1IsWOPN = pairInfo.token1.toLowerCase() === PriceCalculatorEnhanced.WOPN_ADDRESS;

      let tradeType: 'buy' | 'sell';
      let amountInUSD: number;
      let maker: string;

      if (amount0In > 0 && amount1Out > 0) {
        // Token0 -> Token1
        tradeType = token0IsWOPN ? 'buy' : 'sell';
        amountInUSD = priceData.volumeUSD24h;
        maker = to;
      } else {
        // Token1 -> Token0
        tradeType = token1IsWOPN ? 'buy' : 'sell';
        amountInUSD = priceData.volumeUSD24h;
        maker = to;
      }

      logger.info(`Trade Type: ${tradeType}`);
      logger.info(`Token0 Price (USD): $${priceData.token0Price.priceInUSD.toFixed(6)}`);
      logger.info(`Token1 Price (USD): $${priceData.token1Price.priceInUSD.toFixed(6)}`);
      logger.info(`Volume (USD): $${amountInUSD.toFixed(2)}`);

      // Calculate price impact
      const reserveIn = amount0In > 0 ? pairInfo.reserve0 : pairInfo.reserve1;
      const reserveOut = amount0In > 0 ? pairInfo.reserve1 : pairInfo.reserve0;
      const amountIn = amount0In > 0 ? Number(amount0In) / 1e18 : Number(amount1In) / 1e18;
      
      const priceImpact = PriceCalculatorEnhanced.calculatePriceImpact(
        amountIn,
        Number(reserveIn) / 1e18,
        Number(reserveOut) / 1e18
      );

      logger.info(`Price Impact: ${priceImpact.toFixed(2)}%`);

      // Get gas info from transaction
      let gasUsed = 0;
      let gasPrice = 0;
      try {
        const tx = await this.db.query(
          'SELECT gas_used, gas_price FROM trades WHERE transaction_hash = $1 LIMIT 1',
          [transactionHash]
        );
        if (tx.rows.length > 0) {
          gasUsed = tx.rows[0].gas_used;
          gasPrice = tx.rows[0].gas_price;
        }
      } catch (e) {
        // Ignore gas fetch errors
      }

      // Save trade to database
      const query = `
        INSERT INTO trades (
          block_number, transaction_hash, log_index, timestamp, pair_address,
          token0_amount, token1_amount, amount_in_usd, amount_out_usd,
          price_token0_usd, price_token1_usd, price_token0_opn, price_token1_opn,
          gas_used, gas_price, maker, trade_type, price_impact
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
        ON CONFLICT (transaction_hash, log_index) DO NOTHING
        RETURNING id
      `;

      const result = await this.db.query(query, [
        log.blockNumber,
        transactionHash,
        log.logIndex,
        timestamp,
        log.address,
        amount0In > 0 ? amount0In.toString() : (-amount0Out).toString(),
        amount1In > 0 ? amount1In.toString() : (-amount1Out).toString(),
        amountInUSD,
        amountInUSD,
        priceData.token0Price.priceInUSD,
        priceData.token1Price.priceInUSD,
        priceData.token0Price.priceInOPN,
        priceData.token1Price.priceInOPN,
        gasUsed,
        gasPrice,
        maker,
        tradeType,
        priceImpact
      ]);

      logger.info(`✅ Trade saved to database (ID: ${result.rows[0]?.id})`);

      // Determine which token's price to display (always the NON-WOPN token)
      const displayPriceUSD = token0IsWOPN 
        ? priceData.token1Price.priceInUSD
        : priceData.token0Price.priceInUSD;
        
      const displayPriceOPN = token0IsWOPN
        ? priceData.token1Price.priceInOPN
        : priceData.token0Price.priceInOPN;

      // Publish to Redis for real-time updates
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

      // Emit WebSocket event for real-time frontend updates
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
      logger.error(`Pair: ${log.address}, TX: ${log.transactionHash}`);
    }
  }
}