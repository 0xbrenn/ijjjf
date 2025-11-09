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
  if (isNaN(rawPrice) || rawPrice === 0) return 0;
  
  const wopnAddress = '0xBc022C9dEb5AF250A526321d16Ef52E39b4DBD84';
  const wopnPriceUSD = 0.05;
  
  // Check if this is a WOPN pair
  const isWOPNPair = pair.token0?.toLowerCase() === wopnAddress.toLowerCase() || 
                     pair.token1?.toLowerCase() === wopnAddress.toLowerCase();
  
  if (!isWOPNPair) {
    // Not a WOPN pair, can't calculate USD price directly
    return 0;
  }
  
  // Determine if we need to invert the price
  if (pair.token0?.toLowerCase() === wopnAddress.toLowerCase()) {
    // Price is WOPN per TOKEN, we need TOKEN per WOPN
    // So we invert: 1 / rawPrice * WOPN_USD_PRICE
    return rawPrice === 0 ? 0 : (1 / rawPrice) * wopnPriceUSD;
  } else {
    // Price is already TOKEN per WOPN
    return rawPrice * wopnPriceUSD;
  }
};

// Format price for display
export const formatPriceUSD = (price: number): string => {
  if (price === 0) return '$0.00';
  if (price > 1000) return `$${price.toFixed(0)}`;
  if (price > 1) return `$${price.toFixed(2)}`;
  if (price > 0.01) return `$${price.toFixed(4)}`;
  if (price > 0.0001) return `$${price.toFixed(6)}`;
  return `$${price.toFixed(8)}`;
};

// Calculate volume in USD
export const calculateVolumeUSD = (volume: number | string, tokenPrice: number): number => {
  const numVolume = typeof volume === 'string' ? parseFloat(volume) : volume;
  if (isNaN(numVolume)) return 0;
  
  // Volume is typically in base token amount, multiply by token USD price
  return numVolume * tokenPrice;
};

// Format volume for display
export const formatVolumeUSD = (volume: number): string => {
  if (volume === 0) return '$0';
  if (volume > 1e9) return `$${(volume / 1e9).toFixed(2)}B`;
  if (volume > 1e6) return `$${(volume / 1e6).toFixed(2)}M`;
  if (volume > 1e3) return `$${(volume / 1e3).toFixed(2)}K`;
  return `$${volume.toFixed(0)}`;
};