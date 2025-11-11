import { useState, useEffect, useCallback } from 'react'
import Head from 'next/head'
import dynamic from 'next/dynamic'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { io, Socket } from 'socket.io-client'
import SmartContextSidebar from '@/components/SmartContextSidebar'

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

// Add this function before your component (around line 68)
const getBaseTokenSymbol = (pairData: Pair | null): string => {
  if (!pairData) return 'TOKEN';
  
  const WOPN_ADDRESS = '0xBc022C9dEb5AF250A526321d16Ef52E39b4DBD84';
  
  if (pairData.token0.address.toLowerCase() === WOPN_ADDRESS.toLowerCase()) {
    return pairData.token1.symbol;
  } else if (pairData.token1.address.toLowerCase() === WOPN_ADDRESS.toLowerCase()) {
    return pairData.token0.symbol;
  }
  
  const token0Price = pairData.token0.priceUSD || 0;
  const token1Price = pairData.token1.priceUSD || 0;
  
  if (token0Price > 0 && token1Price > 0) {
    return token0Price < token1Price ? pairData.token0.symbol : pairData.token1.symbol;
  }
  
  return pairData.token0.symbol;
};


export default function Home() {
  const [selectedPair, setSelectedPair] = useState<Pair | null>(null)
  const [selectedToken, setSelectedToken] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState<'hot' | 'gainers' | 'losers' | 'new'>('hot')
  const [priceDisplay, setPriceDisplay] = useState<'usd' | 'opn'>('usd')
  const [socket, setSocket] = useState<Socket | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [realtimePrice, setRealtimePrice] = useState<number | null>(null)
  const [activeBottomTab, setActiveBottomTab] = useState<'trades' | 'pairs' | 'liquidity' | 'holders' | 'info'>('trades')

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
      if (selectedPair && data.pair === selectedPair.address) {
        setRealtimePrice(priceDisplay === 'usd' ? data.priceUSD : data.priceOPN)
      
      
      }
      
      queryClient.invalidateQueries({ queryKey: ['pairs'] })
      queryClient.invalidateQueries({ queryKey: ['trades', data.pair] })
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

  // Fetch pairs for selected token
  const { data: tokenPairsData } = useQuery({
    queryKey: ['tokenPairs', selectedToken],
    queryFn: async () => {
      if (!selectedToken) return []
      const response = await axios.get(`${API_URL}/api/tokens/${selectedToken}/pairs`)
      return response.data.pairs || []
    },
    enabled: !!selectedToken,
    refetchInterval: 30000
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
      const firstPair = pairsData.pairs[0]
      setSelectedPair(firstPair)
      // Set the non-WOPN token as selected
      const WOPN = '0xbc022c9deb5af250a526321d16ef52e39b4dbd84'
      if (firstPair.token0.address.toLowerCase() === WOPN.toLowerCase()) {
        setSelectedToken(firstPair.token1.address)
      } else {
        setSelectedToken(firstPair.token0.address)
      }
    }
  }, [pairsData, selectedPair])

  const handleTokenClick = (item: any) => {
    const isToken = item.symbol !== undefined
    
    if (isToken) {
      // Clicked a token - find its most liquid pair
      setSelectedToken(item.address)
      const tokenPair = pairsData?.pairs?.find((p: Pair) => 
        p.token0.address.toLowerCase() === item.address.toLowerCase() ||
        p.token1.address.toLowerCase() === item.address.toLowerCase()
      )
      if (tokenPair) {
        setSelectedPair(tokenPair)
        setRealtimePrice(null)
      }
    } else {
      // Clicked a pair
      setSelectedPair(item)
      setRealtimePrice(null)
      // Set the non-WOPN token as selected
      const WOPN = '0xbc022c9deb5af250a526321d16ef52e39b4dbd84'
      if (item.token0.address.toLowerCase() === WOPN.toLowerCase()) {
        setSelectedToken(item.token1.address)
      } else {
        setSelectedToken(item.token0.address)
      }
    }
  }

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

  const getSelectedTokenSymbol = () => {
    if (!selectedPair || !selectedToken) return 'Token'
    if (selectedPair.token0.address.toLowerCase() === selectedToken.toLowerCase()) {
      return selectedPair.token0.symbol
    }
    return selectedPair.token1.symbol
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
  <div className="absolute top-full left-0 right-0 mt-1 bg-[#1a1a1a] border border-gray-700 rounded-lg shadow-xl max-h-[500px] overflow-y-auto z-50">
    {searchResults.map((token: any) => (
      <div key={token.address} className="border-b border-gray-800 last:border-0">
        {/* Token Header */}
        <div className="px-4 py-2 bg-[#151515] border-b border-gray-800/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              {token.logo && (
                <img src={token.logo} alt={token.symbol} className="w-6 h-6 rounded-full" />
              )}
              <div>
                <div className="flex items-center space-x-2">
                  <span className="font-semibold text-white">{token.name}</span>
                  {token.honeypotStatus && token.honeypotStatus !== 'unknown' && (
                    <span className={`text-xs px-1.5 py-0.5 rounded ${
                      token.honeypotStatus === 'safe' ? 'bg-green-500/20 text-green-400' :
                      token.honeypotStatus === 'warning' ? 'bg-yellow-500/20 text-yellow-400' :
                      'bg-red-500/20 text-red-400'
                    }`}>
                      {token.honeypotStatus}
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-500">
                  {token.symbol}
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className="font-medium text-white">
                ${token.priceUSD?.toFixed(6) || '0.00'}
              </div>
              {token.priceChange24h !== undefined && (
                <div className={`text-xs ${
                  token.priceChange24h >= 0 ? 'text-green-400' : 'text-red-400'
                }`}>
                  {token.priceChange24h >= 0 ? '+' : ''}
                  {token.priceChange24h?.toFixed(2)}%
                </div>
              )}
            </div>
          </div>
        </div>
        
        
     {token.pairs && token.pairs.length > 0 && (
          <div className="divide-y divide-gray-800/30">
            {token.pairs.map((pair: any) => (
              <div
                key={pair.pairAddress}
                onClick={() => {
                  // Find the full pair data
                  const fullPair = pairsData?.pairs.find((p: Pair) => 
                    p.address.toLowerCase() === pair.pairAddress.toLowerCase()
                  )
                  if (fullPair) {
                    handleTokenClick(fullPair)
                  }
                  setSearchQuery('')
                }}
                className="px-4 py-2.5 hover:bg-gray-800/40 cursor-pointer transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="flex items-center space-x-1">
                      <ChartBarIcon className="w-4 h-4 text-gray-500" />
                    </div>
                    <div>
                      <div className="font-medium text-sm text-white">
                        {pair.pairDisplay}
                      </div>
                      <div className="text-xs text-gray-500">
                        Paired with {pair.pairedWithSymbol}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-gray-400">
                      Liq: ${pair.liquidity >= 1000 
                        ? `${(pair.liquidity / 1000).toFixed(1)}K` 
                        : pair.liquidity.toFixed(0)}
                    </div>
                    <div className="text-xs text-gray-500">
                      Vol: ${pair.volume24h >= 1000 
                        ? `${(pair.volume24h / 1000).toFixed(1)}K` 
                        : pair.volume24h.toFixed(0)}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}


        {(!token.pairs || token.pairs.length === 0) && (
          <div className="px-4 py-2 text-xs text-gray-500 italic">
            No trading pairs found
          </div>
        )}
    {searchResults.length === 0 && searchQuery.length >= 2 && (
      <div className="px-4 py-8 text-center text-gray-500">
        No tokens found for "{searchQuery}"
      </div>
    )}
      
        
        
        
        
        
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
        <SmartContextSidebar 
  selectedPair={selectedPair}
  onPairSelect={handleTokenClick}
/>
        
          

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
                          <a href={`https://testnet.opbnbscan.com/address/${selectedPair.address}`} target="_blank" rel="noopener noreferrer" className="hover:text-white">Explorer</a>
                        </div>
                      </div>
                      
                      <div className="flex items-center space-x-8">
                        <div>
                          <div className="text-sm text-gray-400">Price</div>
                          <div className="text-2xl font-bold">
                            {PriceCalculator.formatPrice(
                              realtimePrice || (priceDisplay === 'usd' ? selectedPair.token0.priceUSD : selectedPair.token0.priceOPN),
                              priceDisplay
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
                        
                       
                          <div>
                            <div className="text-sm text-gray-400">Market Cap</div>
                            <div className="text-xl font-bold">
                              {PriceCalculator.formatVolume(selectedPair.token0.marketCap)}
                            </div>
                          </div>
                        
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
                    </div>
                  </div>
                </div>

                {/* Main Chart - Larger! */}
                <div className="flex-1 bg-[#0d0d0d] p-6">
                  <DexChart 
                    pairAddress={selectedPair.address} 
                    priceDisplay={priceDisplay}
                  />
                </div>

                {/* Bottom Tabs */}
                <div className="bg-[#151515] border-t border-gray-800">
                  <div className="flex border-b border-gray-800">
                    <button 
                      onClick={() => setActiveBottomTab('trades')}
                      className={`px-6 py-3 text-sm font-medium ${
                        activeBottomTab === 'trades' 
                          ? 'text-blue-400 border-b-2 border-blue-400' 
                          : 'text-gray-400 hover:text-white'
                      }`}
                    >
                      Trades
                    </button>
                    <button 
                      onClick={() => setActiveBottomTab('pairs')}
                      className={`px-6 py-3 text-sm font-medium ${
                        activeBottomTab === 'pairs' 
                          ? 'text-blue-400 border-b-2 border-blue-400' 
                          : 'text-gray-400 hover:text-white'
                      }`}
                    >
                      Pairs
                    </button>
                    <button 
                      onClick={() => setActiveBottomTab('liquidity')}
                      className={`px-6 py-3 text-sm font-medium ${
                        activeBottomTab === 'liquidity' 
                          ? 'text-blue-400 border-b-2 border-blue-400' 
                          : 'text-gray-400 hover:text-white'
                      }`}
                    >
                      Liquidity
                    </button>
                    <button 
                      onClick={() => setActiveBottomTab('holders')}
                      className={`px-6 py-3 text-sm font-medium ${
                        activeBottomTab === 'holders' 
                          ? 'text-blue-400 border-b-2 border-blue-400' 
                          : 'text-gray-400 hover:text-white'
                      }`}
                    >
                      Holders
                    </button>
                    <button 
                      onClick={() => setActiveBottomTab('info')}
                      className={`px-6 py-3 text-sm font-medium ${
                        activeBottomTab === 'info' 
                          ? 'text-blue-400 border-b-2 border-blue-400' 
                          : 'text-gray-400 hover:text-white'
                      }`}
                    >
                      Info
                    </button>
                  </div>
                  
                  <div className="h-64 overflow-auto">
                    {/* Trades Tab */}
                  {activeBottomTab === 'trades' && (
 <TradeFeed 
  pairAddress={selectedPair.address}
  priceDisplay={priceDisplay}
  baseTokenSymbol={getBaseTokenSymbol(selectedPair)}  // ✅ Add this
/>
)}
                    
                    {/* Pairs Tab - NEW! */}
                  {activeBottomTab === 'pairs' && (
                      <div className="p-4">
                        <h3 className="text-lg font-semibold mb-4">
                          All Pairs for {getSelectedTokenSymbol()}
                        </h3>
                        
                        {!tokenPairsData || tokenPairsData.length === 0 ? (
                          <div className="text-sm text-gray-400 text-center py-8">
                            Loading pairs...
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {tokenPairsData.map((pair: Pair) => (
                              <div
                                key={pair.address}
                                onClick={() => {
                                  setSelectedPair(pair)
                                  setRealtimePrice(null)
                                }}
                                className={`p-4 rounded-lg border cursor-pointer transition-colors ${
                                  selectedPair?.address === pair.address
                                    ? 'border-blue-500 bg-blue-500/10'
                                    : 'border-gray-700 hover:border-gray-600 hover:bg-gray-800/50'
                                }`}
                              >
                                <div className="flex items-center justify-between">
                                  <div>
                                    <div className="font-semibold text-lg">
                                      {pair.token0.symbol}/{pair.token1.symbol}
                                    </div>
                                    <div className="text-sm text-gray-400 font-mono">
                                      {formatAddress(pair.address)}
                                    </div>
                                  </div>
                                  
                                  <div className="text-right">
                                    <div className="text-sm text-gray-400">Liquidity</div>
                                    <div className="font-semibold">
                                      {PriceCalculator.formatVolume(pair.liquidity.usd)}
                                    </div>
                                  </div>
                                  
                                  <div className="text-right">
                                    <div className="text-sm text-gray-400">24h Volume</div>
                                    <div className="font-semibold">
                                      {PriceCalculator.formatVolume(pair.volume24h)}
                                    </div>
                                  </div>
                                  
                                  <div className="text-right">
                                    <div className="text-sm text-gray-400">24h Change</div>
                                    <div className={`font-semibold ${
                                      pair.token0.priceChange24h >= 0 ? 'text-green-400' : 'text-red-400'
                                    }`}>
                                      {pair.token0.priceChange24h >= 0 ? '+' : ''}
                                      {pair.token0.priceChange24h.toFixed(2)}%
                                    </div>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    
                    {/* Liquidity Tab */}
                    {activeBottomTab === 'liquidity' && (
                      <div className="p-4">
                        <h3 className="text-lg font-semibold mb-4">Liquidity Events</h3>
                        <div className="text-sm text-gray-400 text-center py-8">
                          Coming soon...
                        </div>
                      </div>
                    )}
                    
                    {/* Holders Tab */}
                    {activeBottomTab === 'holders' && (
                      <div className="p-4">
                        <h3 className="text-lg font-semibold mb-4">Top Holders</h3>
                        <div className="text-sm text-gray-400 text-center py-8">
                          Coming soon...
                        </div>
                      </div>
                    )}
                    
                    {/* Info Tab */}
                    {activeBottomTab === 'info' && (
                      <div className="p-4 space-y-6">
                        <div className="grid grid-cols-2 gap-4">
                          {/* Token 0 Info */}
                          <div className="bg-[#1a1a1a] rounded-lg p-4">
                            <h4 className="text-sm font-semibold mb-3">{selectedPair.token0.symbol} Info</h4>
                            <div className="space-y-2 text-sm">
                              <div className="flex justify-between">
                                <span className="text-gray-400">Name</span>
                                <span>{selectedPair.token0.name}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-400">Price USD</span>
                                <span>${selectedPair.token0.priceUSD.toFixed(6)}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-400">Price OPN</span>
                                <span>{selectedPair.token0.priceOPN.toFixed(4)} OPN</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-400">24h Change</span>
                                <span className={selectedPair.token0.priceChange24h >= 0 ? 'text-green-400' : 'text-red-400'}>
                                  {selectedPair.token0.priceChange24h >= 0 ? '+' : ''}
                                  {selectedPair.token0.priceChange24h.toFixed(2)}%
                                </span>
                              </div>
                              {selectedPair.token0.marketCap && (
                                <div className="flex justify-between">
                                  <span className="text-gray-400">Market Cap</span>
                                  <span>{PriceCalculator.formatVolume(selectedPair.token0.marketCap)}</span>
                                </div>
                              )}
                              <div className="flex justify-between">
                                <span className="text-gray-400">Contract</span>
                                <a 
                                  href={`https://testnet.opbnbscan.com/address/${selectedPair.token0.address}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-blue-400 hover:text-blue-300 font-mono text-xs"
                                >
                                  {formatAddress(selectedPair.token0.address)}
                                </a>
                              </div>
                            </div>
                          </div>

                          {/* Token 1 Info */}
                          <div className="bg-[#1a1a1a] rounded-lg p-4">
                            <h4 className="text-sm font-semibold mb-3">{selectedPair.token1.symbol} Info</h4>
                            <div className="space-y-2 text-sm">
                              <div className="flex justify-between">
                                <span className="text-gray-400">Name</span>
                                <span>{selectedPair.token1.name}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-400">Price USD</span>
                                <span>${selectedPair.token1.priceUSD.toFixed(6)}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-400">Price OPN</span>
                                <span>{selectedPair.token1.priceOPN.toFixed(4)} OPN</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-400">24h Change</span>
                                <span className={selectedPair.token1.priceChange24h >= 0 ? 'text-green-400' : 'text-red-400'}>
                                  {selectedPair.token1.priceChange24h >= 0 ? '+' : ''}
                                  {selectedPair.token1.priceChange24h.toFixed(2)}%
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-400">Contract</span>
                                <a 
                                  href={`https://testnet.opbnbscan.com/address/${selectedPair.token1.address}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-blue-400 hover:text-blue-300 font-mono text-xs"
                                >
                                  {formatAddress(selectedPair.token1.address)}
                                </a>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Pair Info */}
                        <div className="bg-[#1a1a1a] rounded-lg p-4">
                          <h4 className="text-sm font-semibold mb-3">Pair Information</h4>
                          <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
                            <div className="flex justify-between">
                              <span className="text-gray-400">Pair Address</span>
                              <a 
                                href={`https://testnet.opbnbscan.com/address/${selectedPair.address}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-400 hover:text-blue-300 font-mono text-xs"
                              >
                                {formatAddress(selectedPair.address)}
                              </a>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-400">Total Liquidity</span>
                              <span>{PriceCalculator.formatVolume(selectedPair.liquidity.usd)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-400">24h Volume</span>
                              <span>{PriceCalculator.formatVolume(selectedPair.volume24h)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-400">Created</span>
                              <span>{new Date(selectedPair.createdAt).toLocaleDateString()}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
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