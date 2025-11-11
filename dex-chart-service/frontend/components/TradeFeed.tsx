// frontend/components/TradeFeed.tsx
// ✅ DETAILED DEXTOOLS TABLE - Complete trade information with all columns

import React, { useState, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import axios from 'axios'
import { io, Socket } from 'socket.io-client'
import { ArrowUpIcon, ArrowDownIcon, ArrowTopRightOnSquareIcon } from '@heroicons/react/24/solid'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'
const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:3002'

interface TradeFeedProps {
  pairAddress: string
  priceDisplay: 'usd' | 'opn'
  baseTokenSymbol?: string
  quoteTokenSymbol?: string
}

interface Trade {
  hash: string
  timestamp: number
  type: 'buy' | 'sell'
  priceUSD: number
  priceOPN: number
  totalUSD: number
  totalOPN: number
  amountToken0: number
  amountToken1: number
  maker: string
  priceImpact: number
}

export default function TradeFeed({ 
  pairAddress, 
  priceDisplay, 
  baseTokenSymbol = 'TOKEN',
  quoteTokenSymbol = 'WOPN'
}: TradeFeedProps) {
  const [trades, setTrades] = useState<Trade[]>([])
  const [socket, setSocket] = useState<Socket | null>(null)
  const [filter, setFilter] = useState<'all' | 'buy' | 'sell'>('all')
  const [autoScroll, setAutoScroll] = useState(true)
  const tableRef = useRef<HTMLDivElement>(null)

  // Fetch initial trades
  const { data: initialData } = useQuery({
    queryKey: ['trades', pairAddress],
    queryFn: async () => {
      const response = await axios.get(`${API_URL}/api/pairs/${pairAddress}`)
      return response.data
    }
  })

  useEffect(() => {
    if (initialData?.recentTrades) {
      const formattedTrades = initialData.recentTrades.map((t: any) => {
        // Get the actual token amounts from the database
        // The API should return token0_amount and token1_amount
        const token0Amount = parseFloat(t.token0Amount || '0') / 1e18;
        const token1Amount = parseFloat(t.token1Amount || '0') / 1e18;
        
        return {
          hash: t.hash,
          timestamp: t.timestamp,
          type: t.type,
          priceUSD: t.priceUSD,           // Token price in USD
          priceOPN: t.priceOPN,           // Token price in OPN
          totalUSD: t.amountUSD,          // Total trade value in USD
          totalOPN: t.amountUSD / 0.05,   // Total trade value in OPN
          amountToken0: token0Amount,     // Amount of token0 (base)
          amountToken1: token1Amount,     // Amount of token1 (quote)
          maker: t.maker,
          priceImpact: t.priceImpact || 0
        }
      })
      setTrades(formattedTrades.slice(0, 100))
    }
  }, [initialData])

  // Setup WebSocket
  useEffect(() => {
    const ws = io(WS_URL, { transports: ['websocket'] })

    ws.on('connect', () => {
      ws.emit('subscribe', { channel: `trades:${pairAddress}` })
    })

    ws.on('trade', (trade) => {
      if (trade.pair === pairAddress) {
        // Parse token amounts from the trade data
        const token0Amount = parseFloat(trade.token0Amount || '0') / 1e18;
        const token1Amount = parseFloat(trade.token1Amount || '0') / 1e18;
        
        const newTrade: Trade = {
          hash: trade.txHash,
          timestamp: trade.timestamp,
          type: trade.tradeType,
          priceUSD: trade.priceUSD,
          priceOPN: trade.priceOPN,
          totalUSD: trade.volumeUSD,
          totalOPN: trade.volumeUSD / 0.05,
          amountToken0: token0Amount,
          amountToken1: token1Amount,
          maker: trade.maker,
          priceImpact: trade.priceImpact
        }

        setTrades(prev => [newTrade, ...prev].slice(0, 100))

        if (autoScroll && tableRef.current) {
          tableRef.current.scrollTop = 0
        }
      }
    })

    setSocket(ws)
    return () => {
      ws.disconnect()
    }
  }, [pairAddress, autoScroll])

  const filteredTrades = trades.filter(t => {
    if (filter === 'all') return true
    return t.type === filter
  })

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp * 1000)
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    })
  }

  const formatNumber = (num: number, decimals: number = 2) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(decimals)}M`
    if (num >= 1000) return `${(num / 1000).toFixed(decimals)}K`
    if (num >= 1) return num.toFixed(decimals)
    if (num >= 0.01) return num.toFixed(4)
    if (num >= 0.0001) return num.toFixed(6)
    
    // Handle very small numbers
    const str = num.toFixed(20)
    const match = str.match(/^0\.(0+)/)
    if (match) {
      const zeros = match[1].length
      const significant = str.slice(match[0].length, match[0].length + 4)
      return `0.0₅${zeros}${significant}`
    }
    return num.toFixed(8)
  }

  const openTx = (hash: string) => {
    window.open(`https://testnet.bscscan.com/tx/${hash}`, '_blank')
  }

  return (
    <div className="flex flex-col h-full bg-[#0B0E11] border border-[#1C2127] rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 bg-[#0F1419] border-b border-[#1C2127] flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">Transactions</h3>
        
        {/* Filters */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setFilter('all')}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
              filter === 'all' 
                ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' 
                : 'bg-[#1C2127] text-gray-400 hover:text-white'
            }`}
          >
            All
          </button>
          <button
            onClick={() => setFilter('buy')}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
              filter === 'buy' 
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' 
                : 'bg-[#1C2127] text-gray-400 hover:text-white'
            }`}
          >
            Buys
          </button>
          <button
            onClick={() => setFilter('sell')}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
              filter === 'sell' 
                ? 'bg-red-500/20 text-red-400 border border-red-500/30' 
                : 'bg-[#1C2127] text-gray-400 hover:text-white'
            }`}
          >
            Sells
          </button>
        </div>
      </div>

      {/* Table */}
      <div 
        ref={tableRef}
        className="flex-1 overflow-x-auto overflow-y-auto scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent"
      >
        <table className="w-full text-sm">
          {/* Table Header */}
          <thead className="sticky top-0 bg-[#0F1419] border-b border-[#1C2127] z-10">
            <tr className="text-xs text-gray-400 font-medium">
              <th className="px-4 py-3 text-left whitespace-nowrap">Date</th>
              <th className="px-4 py-3 text-center whitespace-nowrap">Type</th>
              <th className="px-4 py-3 text-right whitespace-nowrap">Price USD</th>
              <th className="px-4 py-3 text-right whitespace-nowrap">Total USD</th>
              <th className="px-4 py-3 text-right whitespace-nowrap">Price OPN</th>
              <th className="px-4 py-3 text-right whitespace-nowrap">Amount {baseTokenSymbol}</th>
              <th className="px-4 py-3 text-right whitespace-nowrap">Amount {quoteTokenSymbol}</th>
              <th className="px-4 py-3 text-right whitespace-nowrap">Total OPN</th>
              <th className="px-4 py-3 text-right whitespace-nowrap">Maker</th>
              <th className="px-4 py-3 text-center whitespace-nowrap">Link</th>
            </tr>
          </thead>

          {/* Table Body */}
          <tbody className="divide-y divide-[#1C2127]">
            {filteredTrades.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-gray-500">
                  {trades.length === 0 ? 'Waiting for trades...' : 'No trades match filter'}
                </td>
              </tr>
            ) : (
              filteredTrades.map((trade, index) => (
                <tr
                  key={`${trade.hash}-${index}`}
                  className="hover:bg-[#0F1419] transition-colors cursor-pointer group"
                  onClick={() => openTx(trade.hash)}
                >
                  {/* Date */}
                  <td className="px-4 py-3 text-left text-gray-300 whitespace-nowrap">
                    {formatDate(trade.timestamp)}
                  </td>

                  {/* Type */}
                  <td className="px-4 py-3 text-center">
                    <span className={`
                      inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium
                      ${trade.type === 'buy' 
                        ? 'bg-emerald-500/10 text-emerald-400' 
                        : 'bg-red-500/10 text-red-400'
                      }
                    `}>
                      {trade.type === 'buy' ? (
                        <ArrowUpIcon className="w-3 h-3" />
                      ) : (
                        <ArrowDownIcon className="w-3 h-3" />
                      )}
                      {trade.type}
                    </span>
                  </td>

                  {/* Price USD */}
                  <td className="px-4 py-3 text-right text-white font-medium whitespace-nowrap">
                    ${formatNumber(trade.priceUSD, 6)}
                  </td>

                  {/* Total USD */}
                  <td className="px-4 py-3 text-right text-gray-300 whitespace-nowrap">
                    ${formatNumber(trade.totalUSD)}
                  </td>

                  {/* Price OPN */}
                  <td className="px-4 py-3 text-right text-white whitespace-nowrap">
                    {formatNumber(trade.priceOPN, 4)}
                  </td>

                  {/* Amount Token0 */}
                  <td className="px-4 py-3 text-right text-gray-300 whitespace-nowrap">
                    {formatNumber(trade.amountToken0)}
                  </td>

                  {/* Amount Token1 */}
                  <td className="px-4 py-3 text-right text-gray-300 whitespace-nowrap">
                    {formatNumber(trade.amountToken1)}
                  </td>

                  {/* Total OPN */}
                  <td className="px-4 py-3 text-right text-white whitespace-nowrap">
                    {formatNumber(trade.totalOPN, 4)}
                  </td>

                  {/* Maker */}
                  <td className="px-4 py-3 text-right text-blue-400 font-mono text-xs whitespace-nowrap">
                    {trade.maker.slice(0, 6)}...{trade.maker.slice(-4)}
                  </td>

                  {/* Link */}
                  <td className="px-4 py-3 text-center">
                    <ArrowTopRightOnSquareIcon className="w-4 h-4 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity inline-block" />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Footer with count */}
      <div className="px-4 py-2 bg-[#0F1419] border-t border-[#1C2127] text-xs text-gray-400 flex items-center justify-between">
        <span>Showing {filteredTrades.length} trades</span>
        <div className="flex items-center gap-2">
          <span>Auto-scroll</span>
          <div className={`w-2 h-2 rounded-full ${autoScroll ? 'bg-emerald-500' : 'bg-gray-600'}`} />
        </div>
      </div>
    </div>
  )
}