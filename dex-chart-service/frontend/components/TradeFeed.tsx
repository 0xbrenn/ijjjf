import React, { useState, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import axios from 'axios'
import { io, Socket } from 'socket.io-client'
import { formatDistanceToNowStrict } from 'date-fns'
import { ArrowUpIcon, ArrowDownIcon, LinkIcon } from '@heroicons/react/24/outline'
import { formatAddress, PriceCalculator } from '@/utils/tokenHelpers'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'
const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:3002'

interface TradeFeedProps {
  pairAddress: string
  priceDisplay: 'usd' | 'opn'
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

export default function TradeFeed({ pairAddress, priceDisplay }: TradeFeedProps) {
  const [trades, setTrades] = useState<Trade[]>([])
  const [socket, setSocket] = useState<Socket | null>(null)
  const tradesContainerRef = useRef<HTMLDivElement>(null)
  const shouldScrollRef = useRef(true)

  // Fetch initial trades
  const { data: initialTrades } = useQuery({
    queryKey: ['trades', pairAddress],
    queryFn: async () => {
      const response = await axios.get(`${API_URL}/api/pairs/${pairAddress}`, {
        params: { includeRecentTrades: true }
      })
      return response.data.recentTrades || []
    },
    onSuccess: (data) => {
      setTrades(data.slice(0, 100)) // Keep last 100 trades
    }
  })

  // Setup WebSocket for real-time trades
  useEffect(() => {
    const ws = io(WS_URL, { transports: ['websocket'] })

    ws.on('connect', () => {
      console.log('Trade feed connected')
      ws.emit('subscribe', { channel: `trades:${pairAddress}` })
    })

    ws.on('trade', (trade) => {
      if (trade.pair === pairAddress) {
        const newTrade: Trade = {
          hash: trade.txHash,
          timestamp: trade.timestamp,
          type: trade.tradeType,
          priceUSD: trade.priceUSD,
          priceOPN: trade.priceOPN,
          amountUSD: trade.volumeUSD,
          maker: trade.maker,
          priceImpact: trade.priceImpact || 0
        }
        
        setTrades(prev => [newTrade, ...prev.slice(0, 99)])
      }
    })

    setSocket(ws)

    return () => {
      ws.emit('unsubscribe', { channel: `trades:${pairAddress}` })
      ws.close()
    }
  }, [pairAddress])

  // Auto-scroll logic
  useEffect(() => {
    if (shouldScrollRef.current && tradesContainerRef.current) {
      tradesContainerRef.current.scrollTop = 0
    }
  }, [trades])

  const handleScroll = () => {
    if (tradesContainerRef.current) {
      shouldScrollRef.current = tradesContainerRef.current.scrollTop === 0
    }
  }

  const getTimeAgo = (timestamp: number) => {
    try {
      return formatDistanceToNowStrict(new Date(timestamp * 1000), { addSuffix: true })
    } catch {
      return 'unknown'
    }
  }

  const getPriceImpactColor = (impact: number) => {
    if (impact < 0.5) return 'text-gray-400'
    if (impact < 1) return 'text-yellow-400'
    if (impact < 3) return 'text-orange-400'
    return 'text-red-400'
  }

  return (
    <div className="h-full flex flex-col">
      {/* Stats Bar */}
      <div className="p-4 border-b border-gray-800 space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-400">24h Trades</span>
          <span className="font-medium">{trades.length > 0 ? '1,234' : '0'}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-400">Buyers/Sellers</span>
          <span className="font-medium text-green-400">
            {trades.filter(t => t.type === 'buy').length} / 
            <span className="text-red-400"> {trades.filter(t => t.type === 'sell').length}</span>
          </span>
        </div>
      </div>

      {/* Trade List */}
      <div 
        ref={tradesContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto"
      >
        {trades.length === 0 ? (
          <div className="p-4 text-center text-gray-500">
            No recent trades
          </div>
        ) : (
          trades.map((trade, index) => (
            <div 
              key={`${trade.hash}-${index}`}
              className="border-b border-gray-800 p-3 hover:bg-gray-900/50 transition-colors"
            >
              {/* Trade Header */}
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center space-x-2">
                  {trade.type === 'buy' ? (
                    <div className="flex items-center text-green-400">
                      <ArrowUpIcon className="w-4 h-4 mr-1" />
                      <span className="text-sm font-medium">BUY</span>
                    </div>
                  ) : (
                    <div className="flex items-center text-red-400">
                      <ArrowDownIcon className="w-4 h-4 mr-1" />
                      <span className="text-sm font-medium">SELL</span>
                    </div>
                  )}
                  <span className="text-xs text-gray-500">
                    {getTimeAgo(trade.timestamp)}
                  </span>
                </div>
                <a
                  href={`https://etherscan.io/tx/${trade.hash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-400 hover:text-white"
                >
                  <LinkIcon className="w-4 h-4" />
                </a>
              </div>

              {/* Trade Details */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-400">Price</span>
                  <span className="font-mono">
                    {priceDisplay === 'usd' 
                      ? PriceCalculator.formatPrice(trade.priceUSD, true)
                      : PriceCalculator.formatPrice(trade.priceOPN, false)
                    }
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-400">Amount</span>
                  <span className="font-mono">
                    {PriceCalculator.formatVolume(trade.amountUSD)}
                  </span>
                </div>
                {trade.priceImpact > 0 && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-400">Impact</span>
                    <span className={`font-mono ${getPriceImpactColor(trade.priceImpact)}`}>
                      {trade.priceImpact.toFixed(2)}%
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-400">Maker</span>
                  <a
                    href={`https://etherscan.io/address/${trade.maker}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-blue-400 hover:text-blue-300"
                  >
                    {formatAddress(trade.maker)}
                  </a>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Live Indicator */}
      <div className="p-3 border-t border-gray-800 text-center">
        <div className="flex items-center justify-center space-x-2 text-sm">
          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
          <span className="text-gray-400">Live data streaming</span>
        </div>
      </div>
    </div>
  )
}