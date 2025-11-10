import { useState, useEffect, useCallback } from 'react'
import Head from 'next/head'
import dynamic from 'next/dynamic'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { io, Socket } from 'socket.io-client'

import { 
  MagnifyingGlassIcon, 
  ChartBarIcon, 
  ArrowUpIcon, 
  ArrowDownIcon, 
  FireIcon, 
  SparklesIcon,
  BellIcon,
  StarIcon,
  CurrencyDollarIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  XCircleIcon
} from '@heroicons/react/24/outline'
import { formatAddress, getPairDisplay, PriceCalculator } from '@/utils/tokenHelpers'
import toast, { Toaster } from 'react-hot-toast'

// Dynamic imports for heavy components
const DexChart = dynamic(() => import('@/components/DexChart'), { ssr: false })
const TradeFeed = dynamic(() => import('@/components/TradeFeed'), { ssr: false })
//const LiquidityChart = dynamic(() => import('@/components/LiquidityChart'), { ssr: false })

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'
const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:3002'

interface Token {
  address: string
  symbol: string
  name: string
  decimals: number
  priceUSD: number
  priceOPN: number
  priceChange24h: number
  logo?: string
  honeypotStatus: 'safe' | 'warning' | 'danger' | 'unknown'
  marketCap?: number
}

interface Pair {
  address: string
  token0: Token
  token1: Token
  liquidity: {
    usd: number
    token0: string
    token1: string
  }
  volume24h: number
  createdAt: string
}

interface Trade {
  hash: string
  timestamp: number
  type: 'buy' | 'sell'
  priceUSD: number
  priceOPN: number
  amountUSD: number
  maker: string
  priceImpact: number
}

export default function Home() {
  const [selectedPair, setSelectedPair] = useState<Pair | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState<'hot' | 'gainers' | 'losers' | 'new'>('hot')
  const [priceDisplay, setPriceDisplay] = useState<'usd' | 'opn'>('usd')
  const [socket, setSocket] = useState<Socket | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [realtimePrice, setRealtimePrice] = useState<number | null>(null)
  const queryClient = useQueryClient()

  // Initialize WebSocket connection
  useEffect(() => {
    const newSocket = io(WS_URL, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    })

    newSocket.on('connect', () => {
      console.log('WebSocket connected')
      setIsConnected(true)
      toast.success('Connected to real-time data')
    })

    newSocket.on('disconnect', () => {
      console.log('WebSocket disconnected')
      setIsConnected(false)
      toast.error('Disconnected from real-time data')
    })

    newSocket.on('trade', (data) => {
      // Update real-time price
      if (selectedPair && data.pair === selectedPair.address) {
        setRealtimePrice(priceDisplay === 'usd' ? data.priceUSD : data.priceOPN)
        
        // Show trade notification
        const tradeIcon = data.tradeType === 'buy' ? '🟢' : '🔴'
        toast(
          `${tradeIcon} ${data.tradeType.toUpperCase()} ${PriceCalculator.formatVolume(data.volumeUSD)}`,
          { duration: 3000 }
        )
      }
      
      // Invalidate queries to refresh data
      queryClient.invalidateQueries(['pairs'])
      queryClient.invalidateQueries(['trades', data.pair])
    })

    newSocket.on('liquidity_alert', (data) => {
      const changeIcon = data.change > 0 ? '💧⬆️' : '💧⬇️'
      toast(
        `${changeIcon} Liquidity ${data.change > 0 ? 'added' : 'removed'}: ${Math.abs(data.change).toFixed(2)}%`,
        { duration: 5000 }
      )
    })

    setSocket(newSocket)

    return () => {
      newSocket.close()
    }
  }, [selectedPair, priceDisplay, queryClient])

  // Subscribe to pair updates
  useEffect(() => {
    if (socket && selectedPair) {
      socket.emit('subscribe', { pairs: [selectedPair.address] })
      
      return () => {
        socket.emit('unsubscribe', { pairs: [selectedPair.address] })
      }
    }
  }, [socket, selectedPair])

  // Fetch all pairs
  const { data: pairsData, isLoading: loadingPairs } = useQuery({
    queryKey: ['pairs', { sort: 'volume_24h', minLiquidity: 0 }],
    queryFn: async () => {
      const response = await axios.get(`${API_URL}/api/pairs`, {
        params: { limit: 200, minLiquidity: 0 }
      })
      return response.data
    },
    refetchInterval: 30000
  })

  // Fetch trending
  const { data: trendingData } = useQuery({
    queryKey: ['trending'],
    queryFn: async () => {
      const [gainers, losers] = await Promise.all([
        axios.get(`${API_URL}/api/trending?type=gainers&limit=20`),
        axios.get(`${API_URL}/api/trending?type=losers&limit=20`)
      ])
      return {
        gainers: gainers.data.gainers || [],
        losers: losers.data.losers || []
      }
    },
    refetchInterval: 60000
  })

  // Fetch new pairs
  const { data: newPairsData } = useQuery({
    queryKey: ['newPairs'],
    queryFn: async () => {
      const response = await axios.get(`${API_URL}/api/pairs/new`, {
        params: { limit: 20, minLiquidity: 0 }
      })
      return response.data.pairs || []
    },
    refetchInterval: 60000
  })

  // Search functionality
  const { data: searchResults } = useQuery({
    queryKey: ['search', searchQuery],
    queryFn: async () => {
      if (!searchQuery || searchQuery.length < 2) return []
      const response = await axios.get(`${API_URL}/api/search`, {
        params: { q: searchQuery, limit: 10 }
      })
      return response.data.results || []
    },
    enabled: searchQuery.length >= 2
  })

  // Set default pair
  useEffect(() => {
    if (pairsData?.pairs && pairsData.pairs.length > 0 && !selectedPair) {
      setSelectedPair(pairsData.pairs[0])
    }
  }, [pairsData, selectedPair])

  const getTrendingList = useCallback(() => {
    switch (activeTab) {
      case 'hot':
        return pairsData?.pairs?.slice(0, 20) || []
      case 'gainers':
        return trendingData?.gainers || []
      case 'losers':
        return trendingData?.losers || []
      case 'new':
        return newPairsData || []
      default:
        return []
    }
  }, [activeTab, pairsData, trendingData, newPairsData])

  const getHoneypotBadge = (status: string) => {
    switch (status) {
      case 'safe':
        return (
          <span className="flex items-center text-xs text-green-400">
            <CheckCircleIcon className="w-3 h-3 mr-1" />
            Safe
          </span>
        )
      case 'warning':
        return (
          <span className="flex items-center text-xs text-yellow-400">
            <ExclamationTriangleIcon className="w-3 h-3 mr-1" />
            Warning
          </span>
        )
      case 'danger':
        return (
          <span className="flex items-center text-xs text-red-400">
            <XCircleIcon className="w-3 h-3 mr-1" />
            Danger
          </span>
        )
      default:
        return null
    }
  }

  return (
    <>
      <Head>
        <title>OPN DEX Analytics - Real-time DEX Charts & Analysis</title>
        <meta name="description" content="Professional DEX analytics platform for OpenBNB - Real-time charts, honeypot detection, and comprehensive token analysis" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <div className="min-h-screen bg-[#0d0d0d] text-gray-100">
        <Toaster 
          position="top-right"
          toastOptions={{
            style: {
              background: '#1a1a1a',
              color: '#fff',
              border: '1px solid #333'
            }
          }}
        />

        {/* Header */}
        <header className="bg-[#151515] border-b border-gray-800 sticky top-0 z-50">
          <div className="px-4 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-8">
                <h1 className="text-2xl font-bold flex items-center">
                  <SparklesIcon className="w-6 h-6 mr-2 text-blue-500" />
                  <span className="bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
                    OPN DEX Analytics
                  </span>
                </h1>
                <div className="flex items-center space-x-2 text-sm">
                  <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></div>
                  <span className="text-gray-400">
                    {isConnected ? 'Live' : 'Connecting...'} • OpenBNB Testnet
                  </span>
                  <span className="text-gray-500 text-xs">• OPN = $0.05</span>
                </div>
              </div>
              
              {/* Search Bar */}
              <div className="relative w-[450px]">
                <input
                  type="text"
                  placeholder="Search tokens or pairs by name, symbol, or address..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-[#1a1a1a] border border-gray-700 rounded-lg pl-10 pr-4 py-2 text-sm focus:outline-none focus:border-blue-500"
                />
                <MagnifyingGlassIcon className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                
                {/* Search Results Dropdown */}
                {searchResults && searchResults.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-[#1a1a1a] border border-gray-700 rounded-lg shadow-lg max-h-96 overflow-y-auto">
                    {searchResults.map((result: any) => (
                      <div
                        key={result.address}
                        onClick={() => {
                          if (result.type === 'pair') {
                            // Find and set the pair
                            const pair = pairsData?.pairs.find((p: Pair) => p.address === result.address)
                            if (pair) setSelectedPair(pair)
                          }
                          setSearchQuery('')
                        }}
                        className="px-4 py-3 hover:bg-gray-800 cursor-pointer border-b border-gray-800 last:border-0"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-3">
                            {result.logo && (
                              <img src={result.logo} alt="" className="w-6 h-6 rounded-full" />
                            )}
                            <div>
                              <div className="font-medium">
                                {result.type === 'token' ? result.symbol : `${result.token0Symbol}/${result.token1Symbol}`}
                              </div>
                              <div className="text-xs text-gray-400">
                                {result.name || result.token0Name}
                              </div>
                            </div>
                          </div>
                          <div className="text-right">
                            {result.type === 'token' && (
                              <>
                                <div className="text-sm">${result.priceUSD.toFixed(6)}</div>
                                <div className={`text-xs ${result.priceChange24h >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                  {result.priceChange24h >= 0 ? '+' : ''}{result.priceChange24h.toFixed(2)}%
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Price Display Toggle */}
              <div className="flex items-center space-x-4">
                <div className="flex bg-[#1a1a1a] rounded-lg p-1">
                  <button
                    onClick={() => setPriceDisplay('usd')}
                    className={`px-3 py-1 text-sm rounded ${priceDisplay === 'usd' ? 'bg-blue-500' : ''}`}
                  >
                    USD
                  </button>
                  <button
                    onClick={() => setPriceDisplay('opn')}
                    className={`px-3 py-1 text-sm rounded ${priceDisplay === 'opn' ? 'bg-blue-500' : ''}`}
                  >
                    OPN
                  </button>
                </div>
                <button className="p-2 hover:bg-gray-800 rounded-lg">
                  <BellIcon className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>
        </header>

        <div className="flex h-[calc(100vh-64px)]">
          {/* Left Sidebar - Token List */}
          <div className="w-80 bg-[#151515] border-r border-gray-800 overflow-hidden flex flex-col">
            {/* Tabs */}
            <div className="flex border-b border-gray-800">
 {[
  { id: 'hot', label: 'Hot', icon: FireIcon },
  { id: 'gainers', label: 'Gainers', icon: ArrowUpIcon },
  { id: 'losers', label: 'Losers', icon: ArrowDownIcon },
  { id: 'new', label: 'New', icon: SparklesIcon }
].map(tab => {
  const Icon = tab.icon; // Add this line
  return (
    <button
      key={tab.id}
      onClick={() => setActiveTab(tab.id as any)}
      className={`flex-1 flex items-center justify-center space-x-1 py-3 text-sm font-medium transition-colors ${
        activeTab === tab.id
          ? 'text-blue-400 border-b-2 border-blue-400'
          : 'text-gray-400 hover:text-white'
      }`}
    >
      <Icon className="w-4 h-4" /> {/* Change from tab.icon to Icon */}
      <span>{tab.label}</span>
    </button>
  )
})}
            </div>

            {/* Token List */}
            <div className="flex-1 overflow-y-auto">
              {loadingPairs ? (
                <div className="p-4 text-center text-gray-400">Loading...</div>
              ) : (
                getTrendingList().map((item: any) => {
                  const isToken = item.symbol !== undefined
                  const displayName = isToken
                    ? `${item.symbol} (${item.name})`
                    : `${item.token0?.symbol || 'Unknown'}/${item.token1?.symbol || 'Unknown'}`
                  
                  const price = isToken
                    ? (priceDisplay === 'usd' ? item.priceUSD : item.priceOPN)
                    : (priceDisplay === 'usd' ? item.token0?.priceUSD : item.token0?.priceOPN)
                  
                  const change = isToken ? item.priceChange : item.token0?.priceChange24h || 0
                  const volume = isToken ? item.volume24h : item.volume24h
                  const honeypotStatus = isToken ? item.honeypotStatus : item.token0?.honeypotStatus

                  return (
                    <div
                      key={item.address}
                      onClick={() => {
                        if (!isToken) {
                          setSelectedPair(item)
                          setRealtimePrice(null)
                        }
                      }}
                      className={`p-4 border-b border-gray-800 hover:bg-gray-800 cursor-pointer transition-colors ${
                        selectedPair?.address === item.address ? 'bg-gray-800' : ''
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center space-x-2">
                          <span className="font-medium text-sm">{displayName}</span>
                          {honeypotStatus && getHoneypotBadge(honeypotStatus)}
                        </div>
                        <StarIcon className="w-4 h-4 text-gray-600 hover:text-yellow-400" />
                      </div>
                      
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-lg font-semibold">
                          {priceDisplay === 'usd' ? '$' : ''}{PriceCalculator.formatPrice(price || 0, priceDisplay === 'usd')}
                        </span>
                        <span className={`text-sm font-medium ${change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {change >= 0 ? '+' : ''}{change.toFixed(2)}%
                        </span>
                      </div>
                      
                      <div className="flex justify-between text-xs text-gray-400">
                        <span>Vol: {PriceCalculator.formatVolume(volume || 0)}</span>
                        {item.liquidity && (
                          <span>Liq: {PriceCalculator.formatVolume(item.liquidity.usd || 0)}</span>
                        )}
                        {item.age && <span>{item.age}</span>}
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>

          {/* Main Content */}
          <div className="flex-1 flex flex-col">
            {selectedPair ? (
              <>
                {/* Pair Header */}
                <div className="bg-[#151515] border-b border-gray-800 px-6 py-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-6">
                      <div>
                        <h2 className="text-2xl font-bold flex items-center space-x-2">
                          <span>{selectedPair.token0.symbol}/{selectedPair.token1.symbol}</span>
                          {selectedPair.token0.honeypotStatus && getHoneypotBadge(selectedPair.token0.honeypotStatus)}
                        </h2>
                        <div className="flex items-center space-x-4 mt-1 text-sm text-gray-400">
                          <span>Contract: {formatAddress(selectedPair.address)}</span>
                          <button className="hover:text-white">Copy</button>
                          <a href="#" className="hover:text-white">Etherscan</a>
                        </div>
                      </div>
                      
                      <div className="flex items-center space-x-8">
                        <div>
                          <div className="text-sm text-gray-400">Price</div>
                          <div className="text-2xl font-bold">
                            {priceDisplay === 'usd' ? '$' : ''}
                            {PriceCalculator.formatPrice(
                              realtimePrice || (priceDisplay === 'usd' ? selectedPair.token0.priceUSD : selectedPair.token0.priceOPN),
                              priceDisplay === 'usd'
                            )}
                          </div>
                        </div>
                        
                        <div>
                          <div className="text-sm text-gray-400">24h Change</div>
                          <div className={`text-xl font-bold ${selectedPair.token0.priceChange24h >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {selectedPair.token0.priceChange24h >= 0 ? '+' : ''}
                            {selectedPair.token0.priceChange24h.toFixed(2)}%
                          </div>
                        </div>
                        
                        <div>
                          <div className="text-sm text-gray-400">24h Volume</div>
                          <div className="text-xl font-bold">
                            {PriceCalculator.formatVolume(selectedPair.volume24h)}
                          </div>
                        </div>
                        
                        <div>
                          <div className="text-sm text-gray-400">Liquidity</div>
                          <div className="text-xl font-bold">
                            {PriceCalculator.formatVolume(selectedPair.liquidity.usd)}
                          </div>
                        </div>
                        
                        {selectedPair.token0.marketCap && (
                          <div>
                            <div className="text-sm text-gray-400">Market Cap</div>
                            <div className="text-xl font-bold">
                              {PriceCalculator.formatVolume(selectedPair.token0.marketCap)}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                    
                    <div className="flex items-center space-x-2">
                      <button className="px-4 py-2 bg-green-500 hover:bg-green-600 rounded-lg font-medium">
                        Buy
                      </button>
                      <button className="px-4 py-2 bg-red-500 hover:bg-red-600 rounded-lg font-medium">
                        Sell
                      </button>
                      <button className="p-2 hover:bg-gray-800 rounded-lg">
                        <StarIcon className="w-5 h-5" />
                      </button>
                      <button className="p-2 hover:bg-gray-800 rounded-lg">
                        <StarIcon className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Charts and Data */}
                <div className="flex-1 flex">
                  {/* Chart */}
                  <div className="flex-1 p-6">
                    <DexChart 
                      pairAddress={selectedPair.address} 
                      priceDisplay={priceDisplay}
                    />
                  </div>

                  {/* Trade Feed */}
                  <div className="w-96 bg-[#151515] border-l border-gray-800">
                    <div className="p-4 border-b border-gray-800">
                      <h3 className="font-semibold flex items-center">
                        <ChartBarIcon className="w-4 h-4 mr-2" />
                        Live Trades
                      </h3>
                    </div>
                    <TradeFeed 
                      pairAddress={selectedPair.address}
                      priceDisplay={priceDisplay}
                    />
                  </div>
                </div>

                {/* Bottom Tabs */}
                <div className="bg-[#151515] border-t border-gray-800">
                  <div className="flex border-b border-gray-800">
                    <button className="px-6 py-3 text-sm font-medium text-blue-400 border-b-2 border-blue-400">
                      Trades
                    </button>
                    <button className="px-6 py-3 text-sm font-medium text-gray-400 hover:text-white">
                      Liquidity
                    </button>
                    <button className="px-6 py-3 text-sm font-medium text-gray-400 hover:text-white">
                      Holders
                    </button>
                    <button className="px-6 py-3 text-sm font-medium text-gray-400 hover:text-white">
                      Info
                    </button>
                  </div>
                  <div className="h-48">
                    {/* Tab content */}
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                  <ChartBarIcon className="w-16 h-16 text-gray-600 mx-auto mb-4" />
                  <p className="text-gray-400">Select a pair to view charts</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}