import { PriceCalculator } from '../services/PriceCalculator';

describe('PriceCalculator', () => {
  const WOPN_ADDRESS = '0xBc022C9dEb5AF250A526321d16Ef52E39b4DBD84';
  const OTHER_TOKEN = '0x1234567890123456789012345678901234567890';
  const OPN_PRICE_USD = 0.05;

  describe('calculateSwapPrice', () => {
    it('should calculate correct price for WOPN -> Other token swap', () => {
      const result = PriceCalculator.calculateSwapPrice(
        WOPN_ADDRESS,
        OTHER_TOKEN,
        BigInt(1e18), // 1 WOPN in
        BigInt(0),
        BigInt(0),
        BigInt(10e18), // 10 Other tokens out
        BigInt(1000e18), // 1000 WOPN reserve
        BigInt(10000e18) // 10000 Other token reserve
      );

      expect(result).not.toBeNull();
      expect(result!.token0Price.priceInOPN).toBe(1);
      expect(result!.token0Price.priceInUSD).toBe(OPN_PRICE_USD);
      expect(result!.token1Price.priceInOPN).toBeCloseTo(0.1); // 1 WOPN = 10 Other, so 1 Other = 0.1 WOPN
      expect(result!.token1Price.priceInUSD).toBeCloseTo(0.005); // 0.1 * 0.05
    });

    it('should calculate correct price for Other token -> WOPN swap', () => {
      const result = PriceCalculator.calculateSwapPrice(
        OTHER_TOKEN,
        WOPN_ADDRESS,
        BigInt(10e18), // 10 Other tokens in
        BigInt(0),
        BigInt(0),
        BigInt(1e18), // 1 WOPN out
        BigInt(10000e18), // 10000 Other token reserve
        BigInt(1000e18) // 1000 WOPN reserve
      );

      expect(result).not.toBeNull();
      expect(result!.token0Price.priceInOPN).toBeCloseTo(0.1);
      expect(result!.token0Price.priceInUSD).toBeCloseTo(0.005);
      expect(result!.token1Price.priceInOPN).toBe(1);
      expect(result!.token1Price.priceInUSD).toBe(OPN_PRICE_USD);
    });

    it('should return null for invalid swap amounts', () => {
      const result = PriceCalculator.calculateSwapPrice(
        WOPN_ADDRESS,
        OTHER_TOKEN,
        BigInt(0),
        BigInt(0),
        BigInt(0),
        BigInt(0),
        BigInt(1000e18),
        BigInt(10000e18)
      );

      expect(result).toBeNull();
    });
  });

  describe('formatPrice', () => {
    it('should format USD prices correctly', () => {
      expect(PriceCalculator.formatPrice(1234.56, true)).toBe('$1.2K');
      expect(PriceCalculator.formatPrice(123.456, true)).toBe('$123.46');
      expect(PriceCalculator.formatPrice(1.234, true)).toBe('$1.23');
      expect(PriceCalculator.formatPrice(0.1234, true)).toBe('$0.1234');
      expect(PriceCalculator.formatPrice(0.001234, true)).toBe('$0.001234');
    });

    it('should format OPN prices correctly', () => {
      expect(PriceCalculator.formatPrice(1234.56, false)).toBe('1.2K');
      expect(PriceCalculator.formatPrice(123.456, false)).toBe('123.4560');
      expect(PriceCalculator.formatPrice(1.234, false)).toBe('1.2340');
      expect(PriceCalculator.formatPrice(0.1234, false)).toBe('0.123400');
    });
  });

  describe('formatVolume', () => {
    it('should format volume with appropriate suffixes', () => {
      expect(PriceCalculator.formatVolume(1234567890, true)).toBe('$1.23B');
      expect(PriceCalculator.formatVolume(12345678, true)).toBe('$12.35M');
      expect(PriceCalculator.formatVolume(12345, true)).toBe('$12.35K');
      expect(PriceCalculator.formatVolume(123, true)).toBe('$123.00');
      
      expect(PriceCalculator.formatVolume(1234567890, false)).toBe('1.23B');
      expect(PriceCalculator.formatVolume(12345678, false)).toBe('12.35M');
    });
  });

  describe('calculatePriceChange', () => {
    it('should calculate price change percentage correctly', () => {
      expect(PriceCalculator.calculatePriceChange(120, 100)).toBe(20);
      expect(PriceCalculator.calculatePriceChange(80, 100)).toBe(-20);
      expect(PriceCalculator.calculatePriceChange(100, 100)).toBe(0);
      expect(PriceCalculator.calculatePriceChange(100, 0)).toBe(0);
    });
  });

  describe('calculatePriceImpact', () => {
    it('should calculate price impact correctly', () => {
      const impact = PriceCalculator.calculatePriceImpact(
        100, // 100 tokens in
        10000, // 10,000 reserve in
        10000 // 10,000 reserve out
      );
      
      expect(impact).toBeCloseTo(1.28, 2); // Actually ~1.28% impact with 0.3% fee
    });

    it('should handle large trades with high impact', () => {
      const impact = PriceCalculator.calculatePriceImpact(
        1000, // 1,000 tokens in (10% of reserve)
        10000, // 10,000 reserve in
        10000 // 10,000 reserve out
      );
      
      expect(impact).toBeGreaterThan(9); // >9% impact
    });
  });

  describe('calculateK', () => {
    it('should calculate constant product correctly', () => {
      const k = PriceCalculator.calculateK(BigInt(1000e18), BigInt(10000e18));
      expect(k).toBe(BigInt(1000e18) * BigInt(10000e18));
    });
  });
});