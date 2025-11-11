// backend/services/PriceCalculatorEnhanced.ts
// Enhanced version with database-backed cross-pair pricing

import { Pool } from 'pg';

interface TokenPrice {
  priceInOPN: number;
  priceInUSD: number;
  priceInverse: number;
}

interface PriceUpdate {
  pair: string;
  token0: string;
  token1: string;
  token0Price: TokenPrice;
  token1Price: TokenPrice;
  volume24h: number;
  volumeUSD24h: number;
  priceChange24h: number;
  liquidity: number;
  liquidityUSD: number;
  txCount24h: number;
  holders?: number;
  marketCap?: number;
  fdv?: number;
}

interface TokenPriceCache {
  address: string;
  priceUSD: number;
  priceOPN: number;
  timestamp: number;
  liquidityUSD: number;
}

export class PriceCalculatorEnhanced {
  public static readonly WOPN_ADDRESS = '0xBc022C9dEb5AF250A526321d16Ef52E39b4DBD84'.toLowerCase();
  public static readonly OPN_PRICE_USD = 0.05;
  
  // Common base tokens for routing (in order of preference)
  private static readonly BASE_TOKENS = [
    '0xBc022C9dEb5AF250A526321d16Ef52E39b4DBD84'.toLowerCase(), // WOPN
    '0x0000000000000000000000000000000000000000'.toLowerCase(), // Native token (tBNB)
    // Add other major tokens here as they become available
  ];
  
  private static readonly STABLE_COINS = [
    'usdt', 'usdc', 'busd', 'dai', 'tusd', 'usdp'
  ];

  // Price cache - stores recently fetched prices
  private static priceCache = new Map<string, TokenPriceCache>();
  private static readonly CACHE_TTL = 30000; // 30 seconds

  /**
   * Calculate comprehensive price data for a swap event
   * Now with database fallback for cross-pair pricing
   */
  static async calculateSwapPrice(
    token0: string,
    token1: string,
    amount0In: bigint,
    amount1In: bigint,
    amount0Out: bigint,
    amount1Out: bigint,
    reserve0: bigint,
    reserve1: bigint,
    db?: Pool
  ): Promise<PriceUpdate | null> {
    const isToken0WOPN = token0.toLowerCase() === this.WOPN_ADDRESS;
    const isToken1WOPN = token1.toLowerCase() === this.WOPN_ADDRESS;

    // Convert amounts to numbers with 18 decimal precision
    const amt0In = Number(amount0In) / 1e18;
    const amt1In = Number(amount1In) / 1e18;
    const amt0Out = Number(amount0Out) / 1e18;
    const amt1Out = Number(amount1Out) / 1e18;
    const res0 = Number(reserve0) / 1e18;
    const res1 = Number(reserve1) / 1e18;

    let token0Price: TokenPrice;
    let token1Price: TokenPrice;
    let volumeInOPN = 0;
    let volumeInUSD = 0;

    // Calculate based on which tokens are being swapped
    if (amt0In > 0 && amt1Out > 0) {
      // Token0 -> Token1 swap
      const rate = amt1Out / amt0In;
      
      if (isToken0WOPN) {
        // WOPN -> Other token (direct pricing)
        token0Price = {
          priceInOPN: 1,
          priceInUSD: this.OPN_PRICE_USD,
          priceInverse: 1
        };
        token1Price = {
          priceInOPN: 1 / rate,
          priceInUSD: (1 / rate) * this.OPN_PRICE_USD,
          priceInverse: rate
        };
        volumeInOPN = amt0In;
        volumeInUSD = amt0In * this.OPN_PRICE_USD;
      } else if (isToken1WOPN) {
        // Other token -> WOPN (direct pricing)
        token0Price = {
          priceInOPN: rate,
          priceInUSD: rate * this.OPN_PRICE_USD,
          priceInverse: 1 / rate
        };
        token1Price = {
          priceInOPN: 1,
          priceInUSD: this.OPN_PRICE_USD,
          priceInverse: 1
        };
        volumeInOPN = amt1Out;
        volumeInUSD = amt1Out * this.OPN_PRICE_USD;
      } else {
        // Non-WOPN pair - use database lookup
        if (!db) {
          return this.calculateFallbackPrice(token0, token1, amt0In, amt1Out, res0, res1);
        }
        return await this.calculateCrossPairPrice(
          db, token0, token1, amt0In, amt1Out, res0, res1
        );
      }
    } else if (amt1In > 0 && amt0Out > 0) {
      // Token1 -> Token0 swap
      const rate = amt0Out / amt1In;
      
      if (isToken1WOPN) {
        // WOPN -> Other token (direct pricing)
        token1Price = {
          priceInOPN: 1,
          priceInUSD: this.OPN_PRICE_USD,
          priceInverse: 1
        };
        token0Price = {
          priceInOPN: 1 / rate,
          priceInUSD: (1 / rate) * this.OPN_PRICE_USD,
          priceInverse: rate
        };
        volumeInOPN = amt1In;
        volumeInUSD = amt1In * this.OPN_PRICE_USD;
      } else if (isToken0WOPN) {
        // Other token -> WOPN (direct pricing)
        token1Price = {
          priceInOPN: rate,
          priceInUSD: rate * this.OPN_PRICE_USD,
          priceInverse: 1 / rate
        };
        token0Price = {
          priceInOPN: 1,
          priceInUSD: this.OPN_PRICE_USD,
          priceInverse: 1
        };
        volumeInOPN = amt0Out;
        volumeInUSD = amt0Out * this.OPN_PRICE_USD;
      } else {
        // Non-WOPN pair - use database lookup
        if (!db) {
          return this.calculateFallbackPrice(token1, token0, amt1In, amt0Out, res1, res0);
        }
        return await this.calculateCrossPairPrice(
          db, token1, token0, amt1In, amt0Out, res1, res0
        );
      }
    } else {
      return null;
    }

    // Calculate liquidity in USD
    const liquidityInOPN = isToken0WOPN ? res0 * 2 : isToken1WOPN ? res1 * 2 : 0;
    const liquidityUSD = liquidityInOPN * this.OPN_PRICE_USD;

    return {
      pair: this.getPairAddress(token0, token1),
      token0,
      token1,
      token0Price,
      token1Price,
      volume24h: volumeInOPN,
      volumeUSD24h: volumeInUSD,
      priceChange24h: 0,
      liquidity: liquidityInOPN,
      liquidityUSD,
      txCount24h: 1,
      marketCap: 0,
      fdv: 0
    };
  }

  /**
   * Calculate price for non-WOPN pairs using database lookups
   * This enables multi-hop price discovery: TokenA -> TokenB -> WOPN -> USD
   */
  private static async calculateCrossPairPrice(
    db: Pool,
    tokenA: string,
    tokenB: string,
    amountAIn: number,
    amountBOut: number,
    reserveA: number,
    reserveB: number
  ): Promise<PriceUpdate | null> {
    try {
      // Try to get prices from cache first
      const tokenAPriceCache = this.getCachedPrice(tokenA);
      const tokenBPriceCache = this.getCachedPrice(tokenB);

      let tokenAPriceUSD = tokenAPriceCache?.priceUSD || 0;
      let tokenBPriceUSD = tokenBPriceCache?.priceUSD || 0;

      // If either price is not cached, fetch from database
      if (tokenAPriceUSD === 0) {
        tokenAPriceUSD = await this.getTokenPriceFromDB(db, tokenA);
      }
      if (tokenBPriceUSD === 0) {
        tokenBPriceUSD = await this.getTokenPriceFromDB(db, tokenB);
      }

      // If we still don't have prices, try to calculate from reserves
      if (tokenAPriceUSD === 0 && tokenBPriceUSD > 0) {
        // Calculate tokenA price from tokenB price and current swap rate
        const rate = amountBOut / amountAIn;
        tokenAPriceUSD = rate * tokenBPriceUSD;
      } else if (tokenBPriceUSD === 0 && tokenAPriceUSD > 0) {
        // Calculate tokenB price from tokenA price and current swap rate
        const rate = amountBOut / amountAIn;
        tokenBPriceUSD = tokenAPriceUSD / rate;
      } else if (tokenAPriceUSD === 0 && tokenBPriceUSD === 0) {
        // Try to find a price path through base tokens
        tokenAPriceUSD = await this.findPricePathThroughBase(db, tokenA);
        tokenBPriceUSD = await this.findPricePathThroughBase(db, tokenB);
        
        // If still no prices, use fallback calculation
        if (tokenAPriceUSD === 0 && tokenBPriceUSD === 0) {
          return this.calculateFallbackPrice(tokenA, tokenB, amountAIn, amountBOut, reserveA, reserveB);
        }
        
        // If only one price is found, calculate the other
        if (tokenAPriceUSD === 0 && tokenBPriceUSD > 0) {
          const rate = amountBOut / amountAIn;
          tokenAPriceUSD = rate * tokenBPriceUSD;
        } else if (tokenBPriceUSD === 0 && tokenAPriceUSD > 0) {
          const rate = amountBOut / amountAIn;
          tokenBPriceUSD = tokenAPriceUSD / rate;
        }
      }

      // Update cache
      this.updatePriceCache(tokenA, tokenAPriceUSD);
      this.updatePriceCache(tokenB, tokenBPriceUSD);

      // Calculate volume
      const volumeUSD = amountAIn * tokenAPriceUSD;
      const volumeOPN = volumeUSD / this.OPN_PRICE_USD;

      // Calculate liquidity
      const liquidityUSD = (reserveA * tokenAPriceUSD) + (reserveB * tokenBPriceUSD);
      const liquidityOPN = liquidityUSD / this.OPN_PRICE_USD;

      return {
        pair: this.getPairAddress(tokenA, tokenB),
        token0: tokenA,
        token1: tokenB,
        token0Price: {
          priceInOPN: tokenAPriceUSD / this.OPN_PRICE_USD,
          priceInUSD: tokenAPriceUSD,
          priceInverse: tokenBPriceUSD > 0 ? tokenBPriceUSD / tokenAPriceUSD : 0
        },
        token1Price: {
          priceInOPN: tokenBPriceUSD / this.OPN_PRICE_USD,
          priceInUSD: tokenBPriceUSD,
          priceInverse: tokenAPriceUSD > 0 ? tokenAPriceUSD / tokenBPriceUSD : 0
        },
        volume24h: volumeOPN,
        volumeUSD24h: volumeUSD,
        priceChange24h: 0,
        liquidity: liquidityOPN,
        liquidityUSD: liquidityUSD,
        txCount24h: 1,
        marketCap: 0,
        fdv: 0
      };
    } catch (error) {
      console.error('Error in calculateCrossPairPrice:', error);
      return this.calculateFallbackPrice(tokenA, tokenB, amountAIn, amountBOut, reserveA, reserveB);
    }
  }

  /**
   * Get token price from database using most recent token_metrics
   */
  private static async getTokenPriceFromDB(db: Pool, tokenAddress: string): Promise<number> {
    try {
      const result = await db.query(
        `SELECT price_usd, liquidity_usd, timestamp 
         FROM token_metrics 
         WHERE LOWER(token_address) = LOWER($1) 
         AND price_usd > 0
         ORDER BY timestamp DESC 
         LIMIT 1`,
        [tokenAddress]
      );

      if (result.rows.length > 0) {
        const price = parseFloat(result.rows[0].price_usd);
        return price > 0 ? price : 0;
      }

      return 0;
    } catch (error) {
      console.error('Error fetching price from DB:', error);
      return 0;
    }
  }

  /**
   * Find price through multi-hop routing via base tokens
   * Example: OPNT -> tBNB -> WOPN -> USD
   */
  private static async findPricePathThroughBase(db: Pool, tokenAddress: string): Promise<number> {
    try {
      // Try to find a pair with this token and any base token
      for (const baseToken of this.BASE_TOKENS) {
        if (baseToken === tokenAddress.toLowerCase()) continue;

        // Check if we have a direct pair with this base token
        const pairResult = await db.query(
          `SELECT 
            p.address, p.token0, p.token1, p.reserve0, p.reserve1,
            tm.price_usd as base_price_usd
           FROM pairs p
           LEFT JOIN LATERAL (
             SELECT price_usd FROM token_metrics 
             WHERE LOWER(token_address) = LOWER($2)
             ORDER BY timestamp DESC LIMIT 1
           ) tm ON true
           WHERE (LOWER(p.token0) = LOWER($1) AND LOWER(p.token1) = LOWER($2))
              OR (LOWER(p.token1) = LOWER($1) AND LOWER(p.token0) = LOWER($2))
           ORDER BY (CAST(p.reserve0 AS NUMERIC) * CAST(p.reserve1 AS NUMERIC)) DESC
           LIMIT 1`,
          [tokenAddress, baseToken]
        );

        if (pairResult.rows.length > 0) {
          const pair = pairResult.rows[0];
          const basePriceUSD = parseFloat(pair.base_price_usd || '0');

          // If base token is WOPN, use fixed price
          const basePrice = baseToken === this.WOPN_ADDRESS ? this.OPN_PRICE_USD : basePriceUSD;

          if (basePrice > 0) {
            // Calculate token price based on reserves
            const isToken0 = pair.token0.toLowerCase() === tokenAddress.toLowerCase();
            const tokenReserve = isToken0 ? Number(pair.reserve0) / 1e18 : Number(pair.reserve1) / 1e18;
            const baseReserve = isToken0 ? Number(pair.reserve1) / 1e18 : Number(pair.reserve0) / 1e18;

            if (tokenReserve > 0 && baseReserve > 0) {
              const tokenPrice = (baseReserve / tokenReserve) * basePrice;
              return tokenPrice;
            }
          }
        }
      }

      return 0;
    } catch (error) {
      console.error('Error finding price path:', error);
      return 0;
    }
  }

  /**
   * Fallback calculation for non-WOPN pairs when database is unavailable
   */
  private static calculateFallbackPrice(
    tokenA: string,
    tokenB: string,
    amountAIn: number,
    amountBOut: number,
    reserveA: number,
    reserveB: number
  ): PriceUpdate | null {
    const rate = amountBOut / amountAIn;
    
    // Check if either token is a stablecoin
    const tokenAIsStable = this.isStablecoin(tokenA);
    const tokenBIsStable = this.isStablecoin(tokenB);
    
    let tokenAPrice: TokenPrice;
    let tokenBPrice: TokenPrice;
    let volumeUSD = 0;
    
    if (tokenAIsStable) {
      // TokenA is stablecoin ($1)
      tokenAPrice = {
        priceInOPN: 1 / this.OPN_PRICE_USD,
        priceInUSD: 1,
        priceInverse: this.OPN_PRICE_USD
      };
      tokenBPrice = {
        priceInOPN: (1 / rate) / this.OPN_PRICE_USD,
        priceInUSD: 1 / rate,
        priceInverse: rate
      };
      volumeUSD = amountAIn * 1; // $1 per token
    } else if (tokenBIsStable) {
      // TokenB is stablecoin ($1)
      tokenBPrice = {
        priceInOPN: 1 / this.OPN_PRICE_USD,
        priceInUSD: 1,
        priceInverse: this.OPN_PRICE_USD
      };
      tokenAPrice = {
        priceInOPN: rate / this.OPN_PRICE_USD,
        priceInUSD: rate,
        priceInverse: 1 / rate
      };
      volumeUSD = amountAIn * rate;
    } else {
      // Neither is a known stable or WOPN - we can't determine USD price
      // Return with 0 USD values but keep the rate information
      return {
        pair: this.getPairAddress(tokenA, tokenB),
        token0: tokenA,
        token1: tokenB,
        token0Price: {
          priceInOPN: 0,
          priceInUSD: 0,
          priceInverse: rate
        },
        token1Price: {
          priceInOPN: 0,
          priceInUSD: 0,
          priceInverse: 1 / rate
        },
        volume24h: 0,
        volumeUSD24h: 0,
        priceChange24h: 0,
        liquidity: 0,
        liquidityUSD: 0,
        txCount24h: 1,
        marketCap: 0,
        fdv: 0
      };
    }

    const liquidityUSD = (reserveA * tokenAPrice.priceInUSD) + (reserveB * tokenBPrice.priceInUSD);

    return {
      pair: this.getPairAddress(tokenA, tokenB),
      token0: tokenA,
      token1: tokenB,
      token0Price: tokenAPrice,
      token1Price: tokenBPrice,
      volume24h: volumeUSD / this.OPN_PRICE_USD,
      volumeUSD24h: volumeUSD,
      priceChange24h: 0,
      liquidity: liquidityUSD / this.OPN_PRICE_USD,
      liquidityUSD: liquidityUSD,
      txCount24h: 1,
      marketCap: 0,
      fdv: 0
    };
  }

  /**
   * Cache management
   */
  private static getCachedPrice(tokenAddress: string): TokenPriceCache | null {
    const cached = this.priceCache.get(tokenAddress.toLowerCase());
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached;
    }
    return null;
  }

  private static updatePriceCache(tokenAddress: string, priceUSD: number): void {
    this.priceCache.set(tokenAddress.toLowerCase(), {
      address: tokenAddress.toLowerCase(),
      priceUSD,
      priceOPN: priceUSD / this.OPN_PRICE_USD,
      timestamp: Date.now(),
      liquidityUSD: 0
    });
  }

  /**
   * Check if a token is a known stablecoin
   */
  private static isStablecoin(tokenAddress: string): boolean {
    // You can add known stablecoin addresses here
    // For now, just return false
    return false;
  }

  /**
   * Helper methods
   */
  private static getPairAddress(token0: string, token1: string): string {
    return `pair_${token0}_${token1}`;
  }

  static formatPrice(price: number, isUSD: boolean = true): string {
    if (price >= 1000000) {
      return `${isUSD ? '$' : ''}${(price / 1000000).toFixed(2)}M`;
    } else if (price >= 1000) {
      return `${isUSD ? '$' : ''}${(price / 1000).toFixed(2)}K`;
    } else if (price >= 1) {
      return `${isUSD ? '$' : ''}${price.toFixed(2)}`;
    } else if (price >= 0.01) {
      return `${isUSD ? '$' : ''}${price.toFixed(4)}`;
    } else {
      return `${isUSD ? '$' : ''}${price.toFixed(6)}`;
    }
  }

  static formatVolume(volume: number, isUSD: boolean = true): string {
    const prefix = isUSD ? '$' : '';
    if (volume >= 1_000_000_000) {
      return `${prefix}${(volume / 1_000_000_000).toFixed(2)}B`;
    } else if (volume >= 1_000_000) {
      return `${prefix}${(volume / 1_000_000).toFixed(2)}M`;
    } else if (volume >= 1_000) {
      return `${prefix}${(volume / 1_000).toFixed(2)}K`;
    } else {
      return `${prefix}${volume.toFixed(2)}`;
    }
  }

  static calculatePriceChange(newPrice: number, oldPrice: number): number {
    if (oldPrice === 0) return 0;
    return ((newPrice - oldPrice) / oldPrice) * 100;
  }

  static calculatePriceImpact(
    amountIn: number,
    reserveIn: number,
    reserveOut: number
  ): number {
    if (reserveIn === 0 || reserveOut === 0) return 0;
    
    const amountInWithFee = amountIn * 0.997; // 0.3% fee
    const amountOut = (amountInWithFee * reserveOut) / (reserveIn + amountInWithFee);
    
    const priceImpact = (amountIn / reserveIn) * 100;
    return priceImpact;
  }

  static calculateK(reserve0: bigint, reserve1: bigint): bigint {
    return reserve0 * reserve1;
  }
}