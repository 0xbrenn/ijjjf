import { ethers } from 'ethers';

interface TokenPrice {
  priceInOPN: number;
  priceInUSD: number;
  priceInverse: number; // For display purposes (e.g., OPN per token)
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
  fdv?: number; // Fully diluted valuation
}

export class PriceCalculator {
  private static readonly WOPN_ADDRESS = '0xBc022C9dEb5AF250A526321d16Ef52E39b4DBD84'.toLowerCase();
  private static readonly OPN_PRICE_USD = 0.05; // This should be fetched from an oracle in production
  private static readonly STABLE_COINS = [
    'usdt', 'usdc', 'busd', 'dai', 'tusd', 'usdp'
  ];

  /**
   * Calculate comprehensive price data for a swap event
   */
  static calculateSwapPrice(
    token0: string,
    token1: string,
    amount0In: bigint,
    amount1In: bigint,
    amount0Out: bigint,
    amount1Out: bigint,
    reserve0: bigint,
    reserve1: bigint
  ): PriceUpdate | null {
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
        // WOPN -> Other token
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
        // Other token -> WOPN
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
        // Non-WOPN pair - need to estimate via reserves
        return this.calculateNonWOPNPairPrice(token0, token1, amt0In, amt1Out, res0, res1);
      }
    } else if (amt1In > 0 && amt0Out > 0) {
      // Token1 -> Token0 swap
      const rate = amt0Out / amt1In;
      
      if (isToken1WOPN) {
        // WOPN -> Other token
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
        // Other token -> WOPN
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
        return this.calculateNonWOPNPairPrice(token1, token0, amt1In, amt0Out, res1, res0);
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
      priceChange24h: 0, // Will be calculated from historical data
      liquidity: liquidityInOPN,
      liquidityUSD,
      txCount24h: 1, // Will be aggregated
      marketCap: 0, // Will be calculated based on total supply
      fdv: 0 // Will be calculated based on max supply
    };
  }

  /**
   * Handle non-WOPN pairs by routing through WOPN
   */
  private static calculateNonWOPNPairPrice(
    tokenA: string,
    tokenB: string,
    amountAIn: number,
    amountBOut: number,
    reserveA: number,
    reserveB: number
  ): PriceUpdate | null {
    // For non-WOPN pairs, estimate USD value based on known stablecoins
    // or use a default fallback
    const rate = amountBOut / amountAIn;
    
    // Check if either token is a stablecoin
    const tokenAIsStable = this.isStablecoin(tokenA);
    const tokenBIsStable = this.isStablecoin(tokenB);
    
    let tokenAPrice: TokenPrice;
    let tokenBPrice: TokenPrice;
    
    if (tokenAIsStable) {
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
    } else if (tokenBIsStable) {
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
    } else {
      // Neither is stable, use placeholder values
      tokenAPrice = {
        priceInOPN: 0,
        priceInUSD: 0,
        priceInverse: 0
      };
      tokenBPrice = {
        priceInOPN: 0,
        priceInUSD: 0,
        priceInverse: 0
      };
    }
    
    return {
      pair: this.getPairAddress(tokenA, tokenB),
      token0: tokenA,
      token1: tokenB,
      token0Price: tokenAPrice,
      token1Price: tokenBPrice,
      volume24h: 0,
      volumeUSD24h: amountAIn * tokenAPrice.priceInUSD,
      priceChange24h: 0,
      liquidity: 0,
      liquidityUSD: 0,
      txCount24h: 1,
      marketCap: 0,
      fdv: 0
    };
  }

  /**
   * Calculate K value for constant product AMM
   */
  static calculateK(reserve0: bigint, reserve1: bigint): bigint {
    return reserve0 * reserve1;
  }

  /**
   * Calculate price impact of a trade
   */
  static calculatePriceImpact(
    amountIn: number,
    reserveIn: number,
    reserveOut: number
  ): number {
    const amountInWithFee = amountIn * 997; // 0.3% fee
    const numerator = amountInWithFee * reserveOut;
    const denominator = (reserveIn * 1000) + amountInWithFee;
    const amountOut = numerator / denominator;
    
    const executionPrice = amountOut / amountIn;
    const spotPrice = reserveOut / reserveIn;
    const priceImpact = ((spotPrice - executionPrice) / spotPrice) * 100;
    
    return Math.abs(priceImpact);
  }

  /**
   * Format price for display with appropriate decimal places
   */
  static formatPrice(price: number, isUSD: boolean = true): string {
    if (isUSD) {
      if (price >= 1000) return `$${(price / 1000).toFixed(1)}K`;
      if (price >= 1) return `$${price.toFixed(2)}`;
      if (price >= 0.01) return `$${price.toFixed(4)}`;
      if (price >= 0.0001) return `$${price.toFixed(6)}`;
      if (price >= 0.000001) return `$${price.toFixed(8)}`;
      return `$${price.toFixed(10)}`;
    } else {
      // OPN price formatting
      if (price >= 1000) return `${(price / 1000).toFixed(1)}K`;
      if (price >= 1) return price.toFixed(4);
      if (price >= 0.01) return price.toFixed(6);
      return price.toFixed(8);
    }
  }

  /**
   * Format volume with K, M, B suffixes
   */
  static formatVolume(volume: number, isUSD: boolean = true): string {
    const prefix = isUSD ? '$' : '';
    if (volume >= 1e9) return `${prefix}${(volume / 1e9).toFixed(2)}B`;
    if (volume >= 1e6) return `${prefix}${(volume / 1e6).toFixed(2)}M`;
    if (volume >= 1e3) return `${prefix}${(volume / 1e3).toFixed(2)}K`;
    return `${prefix}${volume.toFixed(2)}`;
  }

  /**
   * Calculate 24h price change percentage
   */
  static calculatePriceChange(currentPrice: number, previousPrice: number): number {
    if (previousPrice === 0) return 0;
    return ((currentPrice - previousPrice) / previousPrice) * 100;
  }

  /**
   * Helper methods
   */
  private static isStablecoin(tokenAddress: string): boolean {
    const lowerAddr = tokenAddress.toLowerCase();
    return this.STABLE_COINS.some(stable => lowerAddr.includes(stable));
  }

  private static getPairAddress(token0: string, token1: string): string {
    // In a real implementation, this would calculate the CREATE2 address
    return ethers.keccak256(
      ethers.solidityPacked(['address', 'address'], 
      [token0.toLowerCase() < token1.toLowerCase() ? token0 : token1,
       token0.toLowerCase() < token1.toLowerCase() ? token1 : token0])
    ).slice(0, 42);
  }
}