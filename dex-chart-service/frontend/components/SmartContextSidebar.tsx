/**
 * Smart Context Sidebar Component
 * Shows market overview when no pair selected, or detailed pair stats when pair is selected
 */

import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import axios from 'axios'
import { 
  ChartBarIcon, 
  FireIcon, 
  SparklesIcon,
  ClockIcon,
  UserGroupIcon,
  ShieldCheckIcon,
  ExclamationTriangleIcon,
  ArrowTopRightOnSquareIcon,
  StarIcon,
  CheckCircleIcon,
  XCircleIcon
} from '@heroicons/react/24/outline'
import { StarIcon as StarIconSolid } from '@heroicons/react/24/solid'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'

interface SmartContextSidebarProps {
  selectedPair: any | null
  onPairSelect?: (pair: any) => void
}

export default function SmartContextSidebar({ selectedPair, onPairSelect }: SmartContextSidebarProps) {
  const [isInWatchlist, setIsInWatchlist] = useState(false)

  // Market Summary Data (when no pair selected)
  const { data: marketSummary } = useQuery({
    queryKey: ['marketSummary'],
    queryFn: async () => {
      const response = await axios.get(`${API_URL}/api/market/summary`)
      return response.data
    },
    refetchInterval: 30000,
    enabled: !selectedPair
  })

  // Top Volume Pairs
  const { data: topVolumePairs } = useQuery({
    queryKey: ['topVolume'],
    queryFn: async () => {
      const response = await axios.get(`${API_URL}/api/pairs?sort=volume_24h&limit=5`)
      return response.data.pairs || []
    },
    refetchInterval: 60000,
    enabled: !selectedPair
  })

  // Most Active Pairs (1h)
  const { data: activePairs } = useQuery({
    queryKey: ['activePairs'],
    queryFn: async () => {
      const response = await axios.get(`${API_URL}/api/pairs/active?timeframe=1h&limit=5`)
      return response.data.pairs || []
    },
    refetchInterval: 30000,
    enabled: !selectedPair
  })

  // New Pairs
  const { data: newPairs } = useQuery({
    queryKey: ['newPairs'],
    queryFn: async () => {
      const response = await axios.get(`${API_URL}/api/pairs/new?limit=5`)
      return response.data.pairs || []
    },
    refetchInterval: 60000,
    enabled: !selectedPair
  })

  // Pair Details (when pair is selected)
  const { data: pairDetails } = useQuery({
    queryKey: ['pairDetails', selectedPair?.address],
    queryFn: async () => {
      const response = await axios.get(`${API_URL}/api/pairs/${selectedPair.address}`)
      return response.data
    },
    refetchInterval: 10000,
    enabled: !!selectedPair
  })

  // Format numbers with null safety
  const formatNumber = (num: number, decimals: number = 2) => {
    if (num === null || num === undefined || isNaN(num) || !isFinite(num)) return '$0'
    const safeNum = Number(num)
    if (safeNum >= 1000000) return `$${(safeNum / 1000000).toFixed(decimals)}M`
    if (safeNum >= 1000) return `$${(safeNum / 1000).toFixed(decimals)}K`
    return `$${safeNum.toFixed(decimals)}`
  }

  const formatPrice = (price: number) => {
    if (price === null || price === undefined || isNaN(price) || !isFinite(price)) return '$0.00'
    const safePrice = Number(price)
    if (safePrice < 0.000001) return `$${safePrice.toFixed(10)}`
    if (safePrice < 0.01) return `$${safePrice.toFixed(6)}`
    return `$${safePrice.toFixed(4)}`
  }

  // Safe number parser
  const safeNumber = (value: any, defaultValue: number = 0): number => {
    if (value === null || value === undefined) return defaultValue
    const num = Number(value)
    if (isNaN(num) || !isFinite(num)) return defaultValue
    return num
  }

  const formatAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`
  }

  const getTimeAgo = (timestamp: string) => {
    const now = Date.now()
    const then = new Date(timestamp).getTime()
    const diff = now - then
    
    const minutes = Math.floor(diff / 60000)
    const hours = Math.floor(diff / 3600000)
    const days = Math.floor(diff / 86400000)
    
    if (minutes < 60) return `${minutes}m ago`
    if (hours < 24) return `${hours}h ago`
    return `${days}d ago`
  }

  // Toggle watchlist
  const toggleWatchlist = () => {
    // TODO: Implement watchlist functionality
    setIsInWatchlist(!isInWatchlist)
  }

  // Market Overview View (No pair selected)
  if (!selectedPair) {
    return (
      <div className="w-80 bg-[#0B0E11] border-r border-[#1C2127] overflow-y-auto">
        <div className="p-4">
          {/* Header */}
          <div className="mb-6">
            <h2 className="text-lg font-semibold text-white flex items-center">
              <ChartBarIcon className="w-5 h-5 mr-2 text-blue-400" />
              Market Overview
            </h2>
          </div>

          {/* Market Stats */}
          <div className="space-y-3 mb-6">
            <div className="bg-[#161B22] rounded-lg p-3">
              <div className="text-xs text-gray-400 mb-1">Total Pairs</div>
              <div className="text-xl font-bold text-white">
                {marketSummary?.totalPairs || 0}
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-[#161B22] rounded-lg p-3">
                <div className="text-xs text-gray-400 mb-1">24h Volume</div>
                <div className="text-lg font-bold text-white">
                  {formatNumber(marketSummary?.volume24h || 0)}
                </div>
              </div>
              
              <div className="bg-[#161B22] rounded-lg p-3">
                <div className="text-xs text-gray-400 mb-1">Active Traders</div>
                <div className="text-lg font-bold text-white">
                  {marketSummary?.activeTraders || 0}
                </div>
              </div>
            </div>
          </div>

          {/* Highest Volume */}
          <div className="mb-6">
            <h3 className="text-sm font-semibold text-gray-300 flex items-center mb-3">
              <FireIcon className="w-4 h-4 mr-2 text-orange-400" />
              Highest Volume (24h)
            </h3>
            <div className="space-y-2">
              {topVolumePairs?.slice(0, 5).map((pair: any, index: number) => {
                const token0Name = pair.token0?.name || pair.token0?.symbol || 'Unknown'
                const token1Name = pair.token1?.name || pair.token1?.symbol || 'Unknown'
                const displayName = `${token0Name} / ${token1Name}`
                
                return (
                  <div
                    key={pair.address}
                    onClick={() => onPairSelect?.(pair)}
                    className="flex items-center justify-between p-2 bg-[#161B22] rounded-lg hover:bg-[#1C2127] cursor-pointer transition-colors"
                  >
                    <div className="flex items-center space-x-2 flex-1 min-w-0">
                      <span className="text-xs font-medium text-gray-500 w-4 flex-shrink-0">{index + 1}</span>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-white truncate">
                          {displayName}
                        </div>
                        <div className="text-xs text-gray-500">
                          {pair.token0?.symbol}/{pair.token1?.symbol}
                        </div>
                      </div>
                    </div>
                    <span className="text-sm font-semibold text-blue-400 flex-shrink-0">
                      {formatNumber(pair.volume24h)}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Most Active (1h) */}
          <div className="mb-6">
            <h3 className="text-sm font-semibold text-gray-300 flex items-center mb-3">
              <ClockIcon className="w-4 h-4 mr-2 text-green-400" />
              Most Active (1h)
            </h3>
            <div className="space-y-2">
              {activePairs?.slice(0, 5).map((pair: any, index: number) => {
                const token0Name = pair.token0?.name || pair.token0?.symbol || 'Unknown'
                const token1Name = pair.token1?.name || pair.token1?.symbol || 'Unknown'
                const displayName = `${token0Name} / ${token1Name}`
                
                return (
                  <div
                    key={pair.address}
                    onClick={() => onPairSelect?.(pair)}
                    className="flex items-center justify-between p-2 bg-[#161B22] rounded-lg hover:bg-[#1C2127] cursor-pointer transition-colors"
                  >
                    <div className="flex items-center space-x-2 flex-1 min-w-0">
                      <span className="text-xs font-medium text-gray-500 w-4 flex-shrink-0">{index + 1}</span>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-white truncate">
                          {displayName}
                        </div>
                        <div className="text-xs text-gray-500">
                          {pair.token0?.symbol}/{pair.token1?.symbol}
                        </div>
                      </div>
                    </div>
                    <span className="text-xs text-gray-400 flex-shrink-0">
                      {pair.trades1h || 0} trades
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Recently Added */}
          <div>
            <h3 className="text-sm font-semibold text-gray-300 flex items-center mb-3">
              <SparklesIcon className="w-4 h-4 mr-2 text-purple-400" />
              Recently Added
            </h3>
            <div className="space-y-2">
              {newPairs?.slice(0, 5).map((pair: any) => {
                const token0Name = pair.token0?.name || pair.token0?.symbol || 'Unknown'
                const token1Name = pair.token1?.name || pair.token1?.symbol || 'Unknown'
                const displayName = `${token0Name} / ${token1Name}`
                
                return (
                  <div
                    key={pair.address}
                    onClick={() => onPairSelect?.(pair)}
                    className="flex items-center justify-between p-2 bg-[#161B22] rounded-lg hover:bg-[#1C2127] cursor-pointer transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-white truncate">
                        {displayName}
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="text-xs text-gray-500">
                          {pair.token0?.symbol}/{pair.token1?.symbol}
                        </div>
                        <div className="text-xs text-gray-500">
                          {getTimeAgo(pair.createdAt)}
                        </div>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0 ml-2">
                      <div className="text-xs text-gray-400">
                        Liq: {formatNumber(pair.liquidity?.usd || 0, 1)}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Pair Details View (Pair selected)
  const baseToken = selectedPair.token0?.symbol === 'WOPN' ? selectedPair.token1 : selectedPair.token0
  const quoteToken = selectedPair.token0?.symbol === 'WOPN' ? selectedPair.token0 : selectedPair.token1
  
  const baseTokenName = baseToken?.name || baseToken?.symbol || 'Unknown'
  const quoteTokenName = quoteToken?.name || quoteToken?.symbol || 'Unknown'
  const pairDisplayName = `${baseTokenName} / ${quoteTokenName}`
  const pairTickers = `${baseToken?.symbol} / ${quoteToken?.symbol}`

  return (
    <div className="w-80 bg-[#0B0E11] border-r border-[#1C2127] overflow-y-auto">
      <div className="p-4">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <div className="flex-1 min-w-0 mr-2">
              <h2 className="text-lg font-semibold text-white truncate">
                {pairDisplayName}
              </h2>
              <div className="text-xs text-gray-500">
                {pairTickers}
              </div>
            </div>
            <button
              onClick={toggleWatchlist}
              className="p-1 hover:bg-[#161B22] rounded transition-colors flex-shrink-0"
            >
              {isInWatchlist ? (
                <StarIconSolid className="w-5 h-5 text-yellow-400" />
              ) : (
                <StarIcon className="w-5 h-5 text-gray-400" />
              )}
            </button>
          </div>
          <div className="text-2xl font-bold text-white">
            {formatPrice(safeNumber(baseToken?.priceUSD, 0))}
          </div>
          <div className={`text-sm ${
            safeNumber(baseToken?.priceChange24h, 0) >= 0 ? 'text-green-400' : 'text-red-400'
          }`}>
            {safeNumber(baseToken?.priceChange24h, 0) >= 0 ? '+' : ''}
            {safeNumber(baseToken?.priceChange24h, 0).toFixed(2)}% (24h)
          </div>
        </div>

        {/* Quick Stats */}
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-gray-300 mb-3">Quick Stats</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-400">24h Volume</span>
              <span className="text-white font-medium">
                {formatNumber(safeNumber(pairDetails?.volume24h || selectedPair.volume24h, 0))}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Liquidity</span>
              <span className="text-white font-medium">
                {formatNumber(safeNumber(pairDetails?.liquidity || selectedPair.liquidity?.usd, 0))}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">24h Trades</span>
              <span className="text-white font-medium">
                {safeNumber(pairDetails?.trades24h, 0)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Unique Traders</span>
              <span className="text-white font-medium">
                {safeNumber(pairDetails?.uniqueTraders24h, 0)}
              </span>
            </div>
          </div>
        </div>

        {/* Key Levels */}
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-gray-300 mb-3">🎯 Key Levels</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-400">24h High</span>
              <span className="text-green-400 font-medium">
                {formatPrice(safeNumber(pairDetails?.high24h, 0))}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">24h Low</span>
              <span className="text-red-400 font-medium">
                {formatPrice(safeNumber(pairDetails?.low24h, 0))}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Support</span>
              <span className="text-blue-400 font-medium">
                {formatPrice(safeNumber(pairDetails?.support || pairDetails?.low24h * 0.95, 0))}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Resistance</span>
              <span className="text-orange-400 font-medium">
                {formatPrice(safeNumber(pairDetails?.resistance || pairDetails?.high24h * 1.05, 0))}
              </span>
            </div>
          </div>
        </div>

        {/* Top Holders */}
        {pairDetails?.topHolders && pairDetails.topHolders.length > 0 && (
          <div className="mb-6">
            <h3 className="text-sm font-semibold text-gray-300 flex items-center mb-3">
              <UserGroupIcon className="w-4 h-4 mr-2" />
              Top Holders
            </h3>
            <div className="space-y-2">
              {pairDetails.topHolders.slice(0, 3).map((holder: any, index: number) => (
                <div key={index} className="flex items-center justify-between text-sm">
                  <span className="text-gray-400 font-mono">
                    {formatAddress(holder.address)}
                  </span>
                  <span className="text-white font-medium">
                    {safeNumber(holder.percentage, 0).toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Token Safety */}
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-gray-300 flex items-center mb-3">
            <ShieldCheckIcon className="w-4 h-4 mr-2" />
            Token Safety
          </h3>
          <div className="space-y-2">
            <div className="flex items-center space-x-2 text-sm">
              {baseToken?.honeypotStatus === 'safe' ? (
                <>
                  <CheckCircleIcon className="w-4 h-4 text-green-400" />
                  <span className="text-green-400">No Honeypot Detected</span>
                </>
              ) : baseToken?.honeypotStatus === 'danger' ? (
                <>
                  <XCircleIcon className="w-4 h-4 text-red-400" />
                  <span className="text-red-400">Honeypot Risk</span>
                </>
              ) : (
                <>
                  <ExclamationTriangleIcon className="w-4 h-4 text-yellow-400" />
                  <span className="text-yellow-400">Not Verified</span>
                </>
              )}
            </div>
            
            {pairDetails?.liquidityLocked && (
              <div className="flex items-center space-x-2 text-sm">
                <CheckCircleIcon className="w-4 h-4 text-green-400" />
                <span className="text-gray-300">Liquidity Locked</span>
              </div>
            )}
            
            {pairDetails?.contractVerified && (
              <div className="flex items-center space-x-2 text-sm">
                <CheckCircleIcon className="w-4 h-4 text-green-400" />
                <span className="text-gray-300">Contract Verified</span>
              </div>
            )}
            
            {(baseToken?.buy_tax || baseToken?.sell_tax) && (
              <div className="flex items-center space-x-2 text-sm">
                <ExclamationTriangleIcon className="w-4 h-4 text-yellow-400" />
                <span className="text-yellow-400">
                  Tax: {baseToken.buy_tax}% buy / {baseToken.sell_tax}% sell
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Quick Links */}
        <div>
          <h3 className="text-sm font-semibold text-gray-300 mb-3">🔗 Quick Links</h3>
          <div className="space-y-2">
            <a
              href={`https://testnet.bscscan.com/address/${selectedPair.address}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between p-2 bg-[#161B22] rounded-lg hover:bg-[#1C2127] transition-colors text-sm"
            >
              <span className="text-gray-300">View on Explorer</span>
              <ArrowTopRightOnSquareIcon className="w-4 h-4 text-gray-400" />
            </a>
            
            <a
              href={`https://testnet.bscscan.com/token/${baseToken?.address}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between p-2 bg-[#161B22] rounded-lg hover:bg-[#1C2127] transition-colors text-sm"
            >
              <span className="text-gray-300">Token Contract</span>
              <ArrowTopRightOnSquareIcon className="w-4 h-4 text-gray-400" />
            </a>
            
            <button
              onClick={toggleWatchlist}
              className="w-full flex items-center justify-between p-2 bg-[#161B22] rounded-lg hover:bg-[#1C2127] transition-colors text-sm"
            >
              <span className="text-gray-300">
                {isInWatchlist ? 'Remove from Watchlist' : 'Add to Watchlist'}
              </span>
              <StarIcon className="w-4 h-4 text-gray-400" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}