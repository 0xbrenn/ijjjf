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
    const response = await axios.get(`${API_URL}/api/pairs/${pairAddress}`)
    return response.data.recentTrades || []
  }
})

// ✅ Use useEffect to handle the data
useEffect(() => {
  if (initialTrades) {
    setTrades(initialTrades.slice(0, 100)) // Keep last 100 trades
  }
}, [initialTrades])

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

// Complete redesigned TradeFeed.tsx for horizontal compact layout
// Replace the entire return statement in frontend/components/TradeFeed.tsx

const getTimeAgo = (timestamp: number) => {
  try {
    return formatDistanceToNowStrict(new Date(timestamp * 1000), { addSuffix: true })
  } catch {
    return 'just now'
  }
}

const getPriceImpactColor = (impact: number) => {
  if (impact < 1) return 'text-green-400'
  if (impact < 3) return 'text-yellow-400'
  return 'text-red-400'
}

return (
  <div className="h-full flex flex-col bg-[#0d0d0d]">
    {/* Header with stats */}
    <div className="px-4 py-2 border-b border-gray-800 flex items-center justify-between">
      <div className="flex items-center space-x-6 text-sm">
        <div>
          <span className="text-gray-400">24h Trades</span>
          <span className="ml-2 font-semibold">{trades.length}</span>
        </div>
        <div>
          <span className="text-gray-400">Buyers/Sellers</span>
          <span className="ml-2">
            <span className="text-green-400">{trades.filter(t => t.type === 'buy').length}</span>
            <span className="text-gray-500">/</span>
            <span className="text-red-400">{trades.filter(t => t.type === 'sell').length}</span>
          </span>
        </div>
      </div>
    </div>

    {/* Compact trade list */}
    <div className="flex-1 overflow-auto" ref={tradesContainerRef}>
      {trades.length === 0 ? (
        <div className="p-8 text-center text-gray-500">
          No recent trades
        </div>
      ) : (
        trades.map((trade, index) => (
          <div 
            key={`${trade.hash}-${index}`}
            className="px-4 py-2 border-b border-gray-800/50 hover:bg-gray-900/30 transition-colors flex items-center justify-between text-sm"
          >
            {/* Type & Time */}
            <div className="flex items-center space-x-3 w-32">
              {trade.type === 'buy' ? (
                <div className="flex items-center text-green-400">
                  <ArrowUpIcon className="w-3 h-3 mr-1" />
                  <span className="text-xs font-medium">BUY</span>
                </div>
              ) : (
                <div className="flex items-center text-red-400">
                  <ArrowDownIcon className="w-3 h-3 mr-1" />
                  <span className="text-xs font-medium">SELL</span>
                </div>
              )}
              <span className="text-xs text-gray-500">
                {getTimeAgo(trade.timestamp).replace(' ago', '')}
              </span>
            </div>

            {/* Price */}
            <div className="w-28 text-right">
              <div className="text-xs text-gray-400">Price</div>
              <div className="font-mono text-sm">
                {PriceCalculator.formatPrice(
                  priceDisplay === 'usd' ? trade.priceUSD : trade.priceOPN,
                  priceDisplay
                )}
              </div>
            </div>

            {/* Amount */}
            <div className="w-24 text-right">
              <div className="text-xs text-gray-400">Amount</div>
              <div className="font-mono text-sm">
                {(trade.amountUSD / 0.05).toFixed(2)} OPN
              </div>
            </div>

            {/* Impact */}
            <div className="w-20 text-right">
              <div className="text-xs text-gray-400">Impact</div>
              <div className={`font-mono text-sm ${getPriceImpactColor(trade.priceImpact)}`}>
                {trade.priceImpact.toFixed(2)}%
              </div>
            </div>

            {/* Maker */}
            <div className="w-32 text-right">
              <div className="text-xs text-gray-400">Maker</div>
              <a
                href={`https://testnet.opbnbscan.com/address/${trade.maker}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-sm text-blue-400 hover:text-blue-300"
              >
                {formatAddress(trade.maker)}
              </a>
            </div>

            {/* Link */}
            <div className="w-8">
              <a
                href={`https://testnet.opbnbscan.com/tx/${trade.hash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-400 hover:text-white"
              >
                <LinkIcon className="w-4 h-4" />
              </a>
            </div>
          </div>
        ))
      )}
    </div>

    {/* Live indicator */}
    <div className="px-4 py-2 border-t border-gray-800 flex items-center justify-center space-x-2">
      <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
      <span className="text-xs text-gray-400">Live data streaming</span>
    </div>
  </div>
)}