// Token information for OpenBNB testnet
export const TOKEN_INFO: Record<string, { symbol: string; name: string; decimals: number; priceUSD?: number }> = {
  '0xBc022C9dEb5AF250A526321d16Ef52E39b4DBD84': {
    symbol: 'WOPN',
    name: 'Wrapped OPN',
    decimals: 18,
    priceUSD: 0.05
  },
  // Add more tokens as needed
};

// Format token address for display
export const formatAddress = (address: string | null | undefined, chars: number = 4): string => {
  if (!address) return '';
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
};

// Get token symbol or fallback to formatted address
export const getTokenSymbol = (address: string | null | undefined): string => {
  if (!address) return 'Unknown';
  
  const token = TOKEN_INFO[address];
  if (token) return token.symbol;
  
  // Check if it's a known stablecoin pattern
  const lowerAddr = address.toLowerCase();
  if (lowerAddr.includes('usdt') || lowerAddr.includes('tether')) return 'USDT';
  if (lowerAddr.includes('usdc')) return 'USDC';
  if (lowerAddr.includes('busd')) return 'BUSD';
  if (lowerAddr.includes('dai')) return 'DAI';
  
  // Return formatted address as fallback
  return formatAddress(address, 3);
};

// Get display name for a pair
export const getPairDisplay = (pair: any): { display: string; baseToken: string; quoteToken: string; isInverted: boolean } => {
  if (!pair) {
    return {
      display: 'Unknown/Unknown',
      baseToken: 'Unknown',
      quoteToken: 'Unknown',
      isInverted: false
    };
  }

  const token0Symbol = pair.token0_symbol || getTokenSymbol(pair.token0);
  const token1Symbol = pair.token1_symbol || getTokenSymbol(pair.token1);
  
  const wopnAddress = '0xBc022C9dEb5AF250A526321d16Ef52E39b4DBD84';
  
  // For WOPN pairs, always show the other token first (TOKEN/WOPN format)
  if (pair.token0?.toLowerCase() === wopnAddress.toLowerCase()) {
    return {
      display: `${token1Symbol}/${token0Symbol}`,
      baseToken: token1Symbol,
      quoteToken: token0Symbol,
      isInverted: true // Price needs to be inverted
    };
  } else if (pair.token1?.toLowerCase() === wopnAddress.toLowerCase()) {
    return {
      display: `${token0Symbol}/${token1Symbol}`,
      baseToken: token0Symbol,
      quoteToken: token1Symbol,
      isInverted: false
    };
  }
  
  // Default order for non-WOPN pairs
  return {
    display: `${token0Symbol}/${token1Symbol}`,
    baseToken: token0Symbol,
    quoteToken: token1Symbol,
    isInverted: false
  };
};

// Calculate USD price for a token based on its WOPN pair price
export const calculateTokenUSDPrice = (pair: any): number => {
  if (!pair || !pair.current_price) return 0;
  
  const rawPrice = typeof pair.current_price === 'string' ? parseFloat(pair.current_price) : pair.current_price;
  if (isNaN(rawPrice)) return 0;
  
  const OPN_PRICE_USD = 0.05;
  
  // If the price is > 1, it likely means we have the inverse
  // (e.g., 47 OPNT per WOPN instead of 0.02 WOPN per OPNT)
  if (rawPrice > 1) {
    return (1 / rawPrice) * OPN_PRICE_USD;
  }
  
  return rawPrice * OPN_PRICE_USD;
};

// Enhanced PriceCalculator class
export class PriceCalculator {
  static readonly WOPN_ADDRESS = '0xBc022C9dEb5AF250A526321d16Ef52E39b4DBD84'.toLowerCase();
  static readonly OPN_PRICE_USD = 0.05;

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
   * Format percentage with color
   */
  static formatPercentage(value: number): { text: string; color: string } {
    const formatted = `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
    const color = value >= 0 ? 'text-green-400' : 'text-red-400';
    return { text: formatted, color };
  }

  /**
   * Calculate price impact for a trade
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
}

// Format volume USD
export const formatVolumeUSD = (volumeInOPN: number | string): string => {
  const numVolume = typeof volumeInOPN === 'string' ? parseFloat(volumeInOPN) : volumeInOPN;
  if (isNaN(numVolume)) return '$0.00';
  
  const volumeUSD = numVolume * 0.05; // OPN price in USD
  return PriceCalculator.formatVolume(volumeUSD);
};

// Calculate volume in USD
export const calculateVolumeUSD = (volumeInOPN: number): number => {
  return volumeInOPN * 0.05;
};