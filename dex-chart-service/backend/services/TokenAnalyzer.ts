import { ethers } from 'ethers';
import { Pool } from 'pg';
import axios from 'axios';
import { logger } from '../utils/logger';

interface TokenInfo {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  totalSupply: string;
  circulatingSupply?: string;
  owner?: string;
  logoUri?: string;
  website?: string;
  telegram?: string;
  twitter?: string;
  description?: string;
  honeypotStatus: 'safe' | 'warning' | 'danger' | 'unknown';
  buyTax?: number;
  sellTax?: number;
  maxBuy?: string;
  maxSell?: string;
  isRenounced: boolean;
  isVerified: boolean;
  creationBlock?: number;
  creationTime?: number;
  score: number; // Safety score 0-100
}

interface HoneypotResult {
  isHoneypot: boolean;
  buyTax: number;
  sellTax: number;
  transferTax: number;
  hasMaxBuy: boolean;
  hasMaxSell: boolean;
  canTakeBackOwnership: boolean;
  isBlacklisted: boolean;
  isPausable: boolean;
  isProxy: boolean;
  warnings: string[];
}

export class TokenAnalyzer {
  private provider: ethers.JsonRpcProvider;
  private db: Pool;
  private cache = new Map<string, TokenInfo>();
  
  // Common honeypot function signatures
  private readonly HONEYPOT_SIGNATURES = [
    'function _transfer(address,address,uint256) private',
    'function setMaxTxPercent(uint256)',
    'function setFee(uint256)',
    'function blacklist(address)',
    'function pause()',
    'function setSwapEnabled(bool)',
    'function renounceOwnership()',
    'function transferOwnership(address)'
  ];

  constructor(provider: ethers.JsonRpcProvider, db: Pool) {
    this.provider = provider;
    this.db = db;
  }

  /**
   * Comprehensive token analysis
   */
  async analyzeToken(tokenAddress: string): Promise<TokenInfo> {
    // Check cache first
    if (this.cache.has(tokenAddress)) {
      return this.cache.get(tokenAddress)!;
    }

    logger.info(`Analyzing token: ${tokenAddress}`);

    try {
      // Get basic token info
      const basicInfo = await this.getBasicTokenInfo(tokenAddress);
      
      // Perform honeypot analysis
      const honeypotResult = await this.analyzeHoneypot(tokenAddress);
      
      // Get contract verification status
      const verificationStatus = await this.checkContractVerification(tokenAddress);
      
      // Get token metadata from external sources
      const metadata = await this.getTokenMetadata(tokenAddress);
      
      // Calculate safety score
      const score = this.calculateSafetyScore(basicInfo, honeypotResult, verificationStatus);
      
      // Determine honeypot status
      let honeypotStatus: 'safe' | 'warning' | 'danger' | 'unknown' = 'unknown';
      if (score >= 80) honeypotStatus = 'safe';
      else if (score >= 50) honeypotStatus = 'warning';
      else if (score > 0) honeypotStatus = 'danger';

      const tokenInfo: TokenInfo = {
        ...basicInfo,
        ...metadata,
        honeypotStatus,
        buyTax: honeypotResult.buyTax,
        sellTax: honeypotResult.sellTax,
        isVerified: verificationStatus.isVerified,
        score
      };

      // Cache the result
      this.cache.set(tokenAddress, tokenInfo);
      
      // Store warnings in database
      if (honeypotResult.warnings.length > 0) {
        await this.storeWarnings(tokenAddress, honeypotResult.warnings);
      }

      return tokenInfo;
    } catch (error) {
      logger.error(`Token analysis failed for ${tokenAddress}:`, error);
      
      // Return basic info even if analysis fails
      return {
        address: tokenAddress,
        symbol: 'Unknown',
        name: 'Unknown Token',
        decimals: 18,
        totalSupply: '0',
        honeypotStatus: 'unknown',
        isRenounced: false,
        isVerified: false,
        score: 0
      };
    }
  }

  /**
   * Get basic token information from contract
   */
  private async getBasicTokenInfo(tokenAddress: string): Promise<Partial<TokenInfo>> {
    const tokenAbi = [
      'function name() view returns (string)',
      'function symbol() view returns (string)',
      'function decimals() view returns (uint8)',
      'function totalSupply() view returns (uint256)',
      'function owner() view returns (address)',
      'function getOwner() view returns (address)',
      'event OwnershipRenounced(address indexed previousOwner)',
      'event OwnershipTransferred(address indexed previousOwner, address indexed newOwner)'
    ];

    const token = new ethers.Contract(tokenAddress, tokenAbi, this.provider);
    const info: Partial<TokenInfo> = {
      address: tokenAddress
    };

    try {
      // Get basic info
      const [name, symbol, decimals, totalSupply] = await Promise.all([
        token.name().catch(() => 'Unknown'),
        token.symbol().catch(() => 'Unknown'),
        token.decimals().catch(() => 18),
        token.totalSupply().catch(() => 0n)
      ]);

      info.name = name;
      info.symbol = symbol;
      info.decimals = decimals;
      info.totalSupply = totalSupply.toString();

      // Try to get owner
      try {
        info.owner = await token.owner();
      } catch {
        try {
          info.owner = await token.getOwner();
        } catch {
          info.owner = ethers.ZeroAddress;
        }
      }

      info.isRenounced = info.owner === ethers.ZeroAddress;

      // Get contract creation info
      const code = await this.provider.getCode(tokenAddress);
      if (code !== '0x') {
        // Get creation transaction (this is simplified, would need indexing service in production)
        const currentBlock = await this.provider.getBlockNumber();
        let low = 0;
        let high = currentBlock;
        
        // Binary search for contract creation block (simplified)
        while (low < high) {
          const mid = Math.floor((low + high) / 2);
          const code = await this.provider.getCode(tokenAddress, mid);
          if (code === '0x') {
            low = mid + 1;
          } else {
            high = mid;
          }
          
          // Limit iterations to prevent hanging
          if (high - low < 1000) break;
        }
        
        info.creationBlock = low;
        const block = await this.provider.getBlock(low);
        info.creationTime = block?.timestamp;
      }
    } catch (error) {
      logger.error('Error getting basic token info:', error);
    }

    return info;
  }

  /**
   * Analyze token for honeypot characteristics
   */
  private async analyzeHoneypot(tokenAddress: string): Promise<HoneypotResult> {
    const result: HoneypotResult = {
      isHoneypot: false,
      buyTax: 0,
      sellTax: 0,
      transferTax: 0,
      hasMaxBuy: false,
      hasMaxSell: false,
      canTakeBackOwnership: false,
      isBlacklisted: false,
      isPausable: false,
      isProxy: false,
      warnings: []
    };

    try {
      // Get contract code
      const code = await this.provider.getCode(tokenAddress);
      
      // Check for proxy pattern
      if (code.includes('delegatecall') || code.length < 1000) {
        result.isProxy = true;
        result.warnings.push('Contract appears to be a proxy');
      }

      // Simulate transactions to check taxes
      const simulationResult = await this.simulateTransactions(tokenAddress);
      result.buyTax = simulationResult.buyTax;
      result.sellTax = simulationResult.sellTax;
      result.transferTax = simulationResult.transferTax;

      // High tax warning
      if (result.buyTax > 10) {
        result.warnings.push(`High buy tax: ${result.buyTax}%`);
      }
      if (result.sellTax > 10) {
        result.warnings.push(`High sell tax: ${result.sellTax}%`);
      }

      // Check for dangerous functions in bytecode
      const dangerousFunctions = [
        'blacklist',
        'pause',
        'setMaxTx',
        'setFee',
        'excludeFromFee',
        'includeInFee'
      ];

      for (const func of dangerousFunctions) {
        if (code.toLowerCase().includes(func.toLowerCase())) {
          result.warnings.push(`Contract contains ${func} function`);
        }
      }

      // Check specific functions
      const checkAbi = [
        'function _maxTxAmount() view returns (uint256)',
        'function _maxWalletSize() view returns (uint256)',
        'function paused() view returns (bool)',
        'function isBlacklisted(address) view returns (bool)'
      ];

      const checkContract = new ethers.Contract(tokenAddress, checkAbi, this.provider);

      // Check max transaction limits
      try {
        const maxTx = await checkContract._maxTxAmount();
        const totalSupply = await this.getTotalSupply(tokenAddress);
        if (maxTx < totalSupply / 100n) { // Less than 1% of supply
          result.hasMaxBuy = true;
          result.warnings.push('Low max transaction amount');
        }
      } catch {}

      // Check if pausable
      try {
        const isPaused = await checkContract.paused();
        if (isPaused !== undefined) {
          result.isPausable = true;
          result.warnings.push('Contract is pausable');
        }
      } catch {}

      // Determine if honeypot based on findings
      result.isHoneypot = 
        result.buyTax > 50 ||
        result.sellTax > 50 ||
        result.warnings.length > 3 ||
        result.isPausable;

    } catch (error) {
      logger.error('Honeypot analysis error:', error);
      result.warnings.push('Could not complete honeypot analysis');
    }

    return result;
  }

  /**
   * Simulate buy/sell transactions to detect taxes
   */
  private async simulateTransactions(tokenAddress: string): Promise<{
    buyTax: number;
    sellTax: number;
    transferTax: number;
  }> {
    try {
      // This is a simplified version. In production, you would:
      // 1. Fork the chain locally
      // 2. Simulate actual swaps through the DEX
      // 3. Calculate exact tax percentages
      
      const routerAbi = [
        'function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts)'
      ];

      // For now, return default values
      // In production, implement proper simulation
      return {
        buyTax: 0,
        sellTax: 0,
        transferTax: 0
      };
    } catch (error) {
      logger.error('Transaction simulation error:', error);
      return { buyTax: 0, sellTax: 0, transferTax: 0 };
    }
  }

  /**
   * Check contract verification status
   */
  private async checkContractVerification(tokenAddress: string): Promise<{
    isVerified: boolean;
    compiler?: string;
    optimization?: boolean;
  }> {
    // In production, this would check block explorer API
    // For now, return placeholder
    return {
      isVerified: false
    };
  }

  /**
   * Get token metadata from external sources
   */
  private async getTokenMetadata(tokenAddress: string): Promise<Partial<TokenInfo>> {
    const metadata: Partial<TokenInfo> = {};

    try {
      // Try to get metadata from various sources
      // 1. Check token lists (Uniswap, 1inch, etc.)
      // 2. Check CoinGecko/CoinMarketCap
      // 3. Check project websites
      
      // For now, return empty metadata
      // In production, implement proper metadata fetching
    } catch (error) {
      logger.error('Metadata fetch error:', error);
    }

    return metadata;
  }

  /**
   * Calculate safety score based on various factors
   */
  private calculateSafetyScore(
    basicInfo: Partial<TokenInfo>,
    honeypotResult: HoneypotResult,
    verificationStatus: { isVerified: boolean }
  ): number {
    let score = 100;

    // Deduct for honeypot characteristics
    if (honeypotResult.isHoneypot) score -= 50;
    if (honeypotResult.buyTax > 5) score -= Math.min(honeypotResult.buyTax, 20);
    if (honeypotResult.sellTax > 5) score -= Math.min(honeypotResult.sellTax, 20);
    if (honeypotResult.isPausable) score -= 10;
    if (honeypotResult.isProxy) score -= 15;
    if (honeypotResult.warnings.length > 0) score -= honeypotResult.warnings.length * 5;

    // Add points for positive factors
    if (basicInfo.isRenounced) score += 10;
    if (verificationStatus.isVerified) score += 10;
    
    // Token age bonus
    if (basicInfo.creationTime) {
      const ageInDays = (Date.now() / 1000 - basicInfo.creationTime) / 86400;
      if (ageInDays > 30) score += 5;
      if (ageInDays > 90) score += 5;
    }

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Get total supply for a token
   */
  private async getTotalSupply(tokenAddress: string): Promise<bigint> {
    try {
      const token = new ethers.Contract(
        tokenAddress,
        ['function totalSupply() view returns (uint256)'],
        this.provider
      );
      return await token.totalSupply();
    } catch {
      return 0n;
    }
  }

  /**
   * Store warnings in database
   */
  private async storeWarnings(tokenAddress: string, warnings: string[]) {
    try {
      // Store each warning
      for (const warning of warnings) {
        await this.db.query(
          `INSERT INTO token_warnings (token_address, warning, created_at) 
           VALUES ($1, $2, CURRENT_TIMESTAMP)
           ON CONFLICT DO NOTHING`,
          [tokenAddress, warning]
        );
      }
    } catch (error) {
      logger.error('Failed to store warnings:', error);
    }
  }

  /**
   * Analyze liquidity locks
   */
  async analyzeLiquidityLocks(pairAddress: string): Promise<{
    isLocked: boolean;
    lockPercentage: number;
    unlockDate?: Date;
    lockPlatform?: string;
  }> {
    // Check common liquidity lock contracts
    // This would integrate with services like Unicrypt, PinkLock, etc.
    return {
      isLocked: false,
      lockPercentage: 0
    };
  }

  /**
   * Get holder distribution analysis
   */
  async analyzeHolderDistribution(tokenAddress: string): Promise<{
    holderCount: number;
    top10Percentage: number;
    top20Percentage: number;
    isConcentrated: boolean;
  }> {
    // In production, this would analyze actual holder data
    return {
      holderCount: 0,
      top10Percentage: 0,
      top20Percentage: 0,
      isConcentrated: false
    };
  }
}