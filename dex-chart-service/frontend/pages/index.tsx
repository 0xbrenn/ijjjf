import { useState, useEffect } from 'react'
import Head from 'next/head'
import dynamic from 'next/dynamic'
import { useQuery } from '@tanstack/react-query'
import axios from 'axios'
import { MagnifyingGlassIcon, ChartBarIcon, ArrowUpIcon, ArrowDownIcon, FireIcon, SparklesIcon } from '@heroicons/react/24/outline'
import { formatAddress, getPairDisplay, calculateTokenUSDPrice, formatVolumeUSD, calculateVolumeUSD } from '@/utils/tokenHelpers'


// At the top of your index.tsx
const OPN_PRICE_USD = 0.05;

// Replace your formatPrice function
const formatPriceUSD = (priceInOPN: number | string): string => {
  const numPrice = typeof priceInOPN === 'string' ? parseFloat(priceInOPN) : priceInOPN;
  if (isNaN(numPrice)) return '$0.00';
  
  // Convert OPN price to USD
  const usdPrice = numPrice * OPN_PRICE_USD;
  
  // Format based on size
  if (usdPrice >= 1) return `$${usdPrice.toFixed(2)}`;
  if (usdPrice >= 0.01) return `$${usdPrice.toFixed(4)}`;
  if (usdPrice >= 0.0001) return `$${usdPrice.toFixed(6)}`;
  if (usdPrice >= 0.000001) return `$${usdPrice.toFixed(8)}`;
  return `$${usdPrice.toFixed(10)}`;
};

// Dynamic import to avoid SSR issues with chart library
const DexChart = dynamic(() => import('@/components/DexChart'), { ssr: false })

interface Pair {
  address: string
  token0: string
  token1: string
  token0_symbol: string | null
  token1_symbol: string | null
  current_price: number | string
  volume_24h: number | string
  price_change_24h: number | string
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'

export default function Home() {
  const [selectedPair, setSelectedPair] = useState<Pair | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState<'hot' | 'gainers' | 'losers' | 'new'>('hot')

  // Fetch trending pairs
  const { data: trendingPairs, isLoading: loadingTrending } = useQuery({
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
    refetchInterval: 30000
  })

  // Search pairs
  const { data: searchResults } = useQuery({
    queryKey: ['search', searchQuery],
    queryFn: async () => {
      if (!searchQuery || searchQuery.length < 2) return []
      const response = await axios.get(`${API_URL}/api/search`, {
        params: { q: searchQuery }
      })
      return response.data.results || []
    },
    enabled: searchQuery.length >= 2
  })

  // Fetch all pairs
  const { data: allPairs, isLoading: loadingPairs } = useQuery({
    queryKey: ['pairs'],
    queryFn: async () => {
      const response = await axios.get(`${API_URL}/api/pairs`, {
        params: { limit: 100 }
      })
      return response.data.pairs || []
    }
  })

  // Set default pair
  useEffect(() => {
    if (allPairs && allPairs.length > 0 && !selectedPair) {
      setSelectedPair(allPairs[0])
    }
  }, [allPairs, selectedPair])

  const formatPercentage = (value: any) => {
    const num = typeof value === 'string' ? parseFloat(value) : value;
    if (isNaN(num)) return '0.00%';
    return `${num >= 0 ? '+' : ''}${num.toFixed(2)}%`;
  }

  const getTrendingList = () => {
    switch (activeTab) {
      case 'hot':
        return allPairs?.sort((a, b) => {
          const volA = typeof a.volume_24h === 'string' ? parseFloat(a.volume_24h) : a.volume_24h;
          const volB = typeof b.volume_24h === 'string' ? parseFloat(b.volume_24h) : b.volume_24h;
          return volB - volA;
        }).slice(0, 20) || [];
      case 'gainers':
        return trendingPairs?.gainers || [];
      case 'losers':
        return trendingPairs?.losers || [];
      case 'new':
        return allPairs?.slice(-20).reverse() || [];
      default:
        return [];
    }
  }

  return (
    <>
      <Head>
        <title>DEX Analytics - OpenBNB Testnet</title>
        <meta name="description" content="Real-time DEX analytics and charts for OpenBNB testnet" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <div className="min-h-screen bg-[#0d0d0d] text-gray-100">
        {/* Header */}
        <header className="bg-[#151515] border-b border-gray-800">
          <div className="px-4 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-8">
                <h1 className="text-2xl font-bold flex items-center">
                  <SparklesIcon className="w-6 h-6 mr-2 text-blue-500" />
                  <span className="bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
                    DEX Analytics
                  </span>
                </h1>
                <div className="flex items-center space-x-2 text-sm">
                  <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                  <span className="text-gray-400">OpenBNB Testnet</span>
                  <span className="text-gray-500 text-xs">• WOPN = $0.05</span>
                </div>
              </div>
              
              {/* Search Bar */}
              <div className="relative w-[450px]">
                <input
                  type="text"
                  placeholder="Search by token name, symbol or address..."
                  className="w-full bg-[#1a1a1a] text-white rounded-full pl-12 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 border border-gray-700 hover:border-gray-600 transition-colors"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                <MagnifyingGlassIcon className="absolute left-4 top-3 h-5 w-5 text-gray-400" />
                
                {/* Search Results */}
                {searchResults && searchResults.length > 0 && (
                  <div className="absolute top-full mt-2 w-full bg-[#1a1a1a] rounded-xl shadow-xl z-50 border border-gray-700 overflow-hidden">
                    {searchResults.map((pair: Pair) => {
                      const pairInfo = getPairDisplay(pair);
                      const usdPrice = calculateTokenUSDPrice(pair);
                      return (
                        <button
                          key={pair.address}
                          className="w-full px-4 py-3 text-left hover:bg-[#252525] transition-colors"
                          onClick={() => {
                            setSelectedPair(pair)
                            setSearchQuery('')
                          }}
                        >
                          <div className="flex justify-between items-center">
                            <div>
                              <span className="font-medium text-white">{pairInfo.display}</span>
                              <span className="text-xs text-gray-500 ml-2">
                                {formatAddress(pair.address)}
                              </span>
                            </div>
                            <span className="text-sm text-gray-400">
                              {formatPriceUSD(usdPrice)}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <button className="px-4 py-2 text-sm font-medium text-gray-300 hover:text-white bg-[#1a1a1a] hover:bg-[#252525] rounded-lg transition-colors border border-gray-700">
                Connect Wallet
              </button>
            </div>
          </div>
        </header>

        <div className="flex h-[calc(100vh-64px)]">
          {/* Left Sidebar */}
          <div className="w-[460px] bg-[#151515] border-r border-gray-800 flex flex-col">
            {/* Tabs */}
            <div className="p-4 border-b border-gray-800">
              <div className="flex space-x-2">
                {[
                  { id: 'hot', label: 'Hot', icon: FireIcon, gradient: 'from-orange-500 to-red-500' },
                  { id: 'gainers', label: 'Gainers', icon: ArrowUpIcon, gradient: 'from-green-500 to-emerald-500' },
                  { id: 'losers', label: 'Losers', icon: ArrowDownIcon, gradient: 'from-red-500 to-pink-500' },
                  { id: 'new', label: 'New', icon: SparklesIcon, gradient: 'from-blue-500 to-purple-500' }
                ].map(tab => {
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id as any)}
                      className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                        activeTab === tab.id 
                          ? `bg-gradient-to-r ${tab.gradient} text-white shadow-lg` 
                          : 'bg-[#1a1a1a] text-gray-400 hover:text-white hover:bg-[#252525]'
                      }`}
                    >
                      <Icon className="w-4 h-4 inline-block mr-1.5 -mt-0.5" />
                      {tab.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Pair List */}
            <div className="flex-1 overflow-y-auto">
              {/* Table Header */}
              <div className="grid grid-cols-12 gap-2 px-4 py-3 text-xs text-gray-500 font-medium uppercase tracking-wider border-b border-gray-800 sticky top-0 bg-[#151515]">
                <div className="col-span-5">Pair</div>
                <div className="col-span-3 text-right">Price</div>
                <div className="col-span-2 text-right">24h %</div>
                <div className="col-span-2 text-right">Volume</div>
              </div>

              {/* Pairs */}
              <div>
                {loadingPairs && activeTab === 'hot' ? (
                  <div className="flex items-center justify-center py-20 text-gray-500">
                    <div className="loading-spinner mr-3"></div>
                    Loading pairs...
                  </div>
                ) : (
                  getTrendingList().map((pair: Pair) => {
                    const pairInfo = getPairDisplay(pair);
                    const priceChange = parseFloat(pair.price_change_24h as string);
                    const isPositive = priceChange >= 0;
                    const usdPrice = calculateTokenUSDPrice(pair);
                    const volumeUSD = calculateVolumeUSD(pair.volume_24h, usdPrice);

                    return (
                      <button
                        key={pair.address}
                        className={`w-full grid grid-cols-12 gap-2 px-4 py-3.5 transition-all border-b border-gray-800/50 ${
                          selectedPair?.address === pair.address 
                            ? 'bg-blue-500/10 border-l-2 border-l-blue-500' 
                            : 'hover:bg-[#1a1a1a]'
                        }`}
                        onClick={() => setSelectedPair(pair)}
                      >
                        <div className="col-span-5 text-left">
                          <div className="flex flex-col">
                            <span className="font-medium text-sm text-white">
                              {pairInfo.display}
                            </span>
                            <span className="text-xs text-gray-500 mt-0.5">
                              {formatAddress(pair.address)}
                            </span>
                          </div>
                        </div>
                        
                        <div className="col-span-3 text-right">
                          <div className="text-sm font-medium text-white">
                            {formatPriceUSD(usdPrice)}
                          </div>
                        </div>
                        
                        <div className="col-span-2 text-right">
                          <div className={`text-sm font-medium ${
                            isPositive ? 'text-green-400' : 'text-red-400'
                          }`}>
                            {formatPercentage(priceChange)}
                          </div>
                        </div>
                        
                        <div className="col-span-2 text-right">
                          <div className="text-sm text-gray-300">
                            {formatVolumeUSD(volumeUSD)}
                          </div>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {/* Chart Area */}
          <div className="flex-1 bg-[#0d0d0d]">
            {selectedPair ? (
              <DexChart
                pairAddress={selectedPair.address}
                token0Symbol={getPairDisplay(selectedPair).baseToken}
                token1Symbol={getPairDisplay(selectedPair).quoteToken}
                pair={selectedPair}
              />
            ) : (
              <div className="h-full flex items-center justify-center">
                <div className="text-center">
                  <ChartBarIcon className="w-20 h-20 text-gray-700 mx-auto mb-4" />
                  <p className="text-gray-500 text-lg">Select a pair to view chart</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}