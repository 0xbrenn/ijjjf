import React, { useEffect, useRef, useState } from 'react'
import { createChart, IChartApi, ISeriesApi, Time, ColorType, CrosshairMode } from 'lightweight-charts'
import { useQuery } from '@tanstack/react-query'
import axios from 'axios'
import { io, Socket } from 'socket.io-client'
import { 
  ChartBarIcon, 
  CogIcon, 
  ArrowsPointingOutIcon,
  CursorArrowRaysIcon,
  ArrowTrendingUpIcon,
  Square2StackIcon,
  PencilIcon,
  SparklesIcon,
  CheckIcon
} from '@heroicons/react/24/outline'
import { PriceCalculator } from '@/utils/tokenHelpers'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'
const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:3002'

interface DexChartProps {
  pairAddress: string
  priceDisplay: 'usd' | 'opn'
}

interface Candle {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
  openOPN?: number
  highOPN?: number
  lowOPN?: number
  closeOPN?: number
  buyVolume?: number
  sellVolume?: number
  trades?: number
}

const TIMEFRAMES = [
  { label: '1m', value: '1m' },
  { label: '5m', value: '5m' },
  { label: '15m', value: '15m' },
  { label: '30m', value: '30m' },
  { label: '1H', value: '1h' },
  { label: '4H', value: '4h' },
  { label: '1D', value: '1d' },
  { label: '1W', value: '1w' }
]

const CHART_TYPES = [
  { label: 'Candles', value: 'candles', icon: ChartBarIcon },
  { label: 'Line', value: 'line', icon: ArrowTrendingUpIcon },
  { label: 'Area', value: 'area', icon: Square2StackIcon }
]

const INDICATORS = [
  { label: 'Volume', value: 'volume', enabled: true },
  { label: 'MA 7', value: 'ma7', enabled: false },
  { label: 'MA 25', value: 'ma25', enabled: false },
  { label: 'MA 99', value: 'ma99', enabled: false },
  { label: 'EMA 12', value: 'ema12', enabled: false },
  { label: 'EMA 26', value: 'ema26', enabled: false },
  { label: 'RSI', value: 'rsi', enabled: false },
  { label: 'MACD', value: 'macd', enabled: false },
  { label: 'Bollinger', value: 'bb', enabled: false }
]

export default function DexChart({ pairAddress, priceDisplay }: DexChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const lineSeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  const areaSeriesRef = useRef<ISeriesApi<'Area'> | null>(null)
  const maSeriesRefs = useRef<Record<string, ISeriesApi<'Line'>>>({})
  
  const [timeframe, setTimeframe] = useState('15m')
  const [chartType, setChartType] = useState<'candles' | 'line' | 'area'>('candles')
  const [indicators, setIndicators] = useState(INDICATORS)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [socket, setSocket] = useState<Socket | null>(null)
  const [lastPrice, setLastPrice] = useState<number | null>(null)

  // Fetch candles data
  const { data: candlesData, isLoading } = useQuery({
    queryKey: ['candles', pairAddress, timeframe],
    queryFn: async () => {
      const response = await axios.get(`${API_URL}/api/pairs/${pairAddress}/candles`, {
        params: { timeframe, limit: 500 }
      })
      return response.data.candles
    },
    refetchInterval: timeframe === '1m' ? 5000 : timeframe === '5m' ? 30000 : 60000,
    enabled: !!pairAddress
  })

  // Initialize WebSocket for real-time updates
  useEffect(() => {
    const ws = io(WS_URL, { transports: ['websocket'] })
    
    ws.on('connect', () => {
      console.log('Chart WebSocket connected')
      ws.emit('subscribe', { 
        channel: `candles:${pairAddress}:${timeframe}` 
      })
    })

    ws.on(`candle`, (data) => {
      if (data.pair === pairAddress && data.timeframe === timeframe) {
        updateLatestCandle(data)
      }
    })

    ws.on('trade', (data) => {
      if (data.pair === pairAddress) {
        const price = priceDisplay === 'usd' ? data.priceUSD : data.priceOPN
        setLastPrice(price)
        updatePriceLine(price)
      }
    })

    setSocket(ws)

    return () => {
      ws.emit('unsubscribe', { 
        channel: `candles:${pairAddress}:${timeframe}` 
      })
      ws.close()
    }
  }, [pairAddress, timeframe, priceDisplay])

  // Initialize chart
  useEffect(() => {
    if (!chartContainerRef.current || !candlesData || candlesData.length === 0) return

    // Clean up previous chart
    if (chartRef.current) {
      chartRef.current.remove()
      chartRef.current = null
    }

    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: chartContainerRef.current.clientHeight,
      layout: {
        background: { type: ColorType.Solid, color: '#0d0d0d' },
        textColor: '#d1d4dc',
      },
      grid: {
        vertLines: { color: '#1a1a1a' },
        horzLines: { color: '#1a1a1a' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
      },
      rightPriceScale: {
        borderColor: '#2a2a2a',
        scaleMargins: {
          top: 0.1,
          bottom: indicators.find(i => i.value === 'volume' && i.enabled) ? 0.3 : 0.1,
        },
      },
      timeScale: {
        borderColor: '#2a2a2a',
        timeVisible: true,
        rightOffset: 12,
        barSpacing: 6,
        fixLeftEdge: true,
        fixRightEdge: true,
      },
      watermark: {
        visible: true,
        fontSize: 48,
        horzAlign: 'center',
        vertAlign: 'center',
        color: 'rgba(255, 255, 255, 0.03)',
        text: 'OPN DEX',
      },
    })

    chartRef.current = chart

    // Create main series based on chart type
    let mainSeries: ISeriesApi<any>
    const priceData = candlesData.map((c: Candle) => ({
      time: c.time as Time,
      open: priceDisplay === 'usd' ? c.open : c.openOPN!,
      high: priceDisplay === 'usd' ? c.high : c.highOPN!,
      low: priceDisplay === 'usd' ? c.low : c.lowOPN!,
      close: priceDisplay === 'usd' ? c.close : c.closeOPN!,
    }))

    if (chartType === 'candles') {
      mainSeries = chart.addCandlestickSeries({
        upColor: '#26a69a',
        downColor: '#ef5350',
        borderVisible: false,
        wickUpColor: '#26a69a',
        wickDownColor: '#ef5350',
      })
      candleSeriesRef.current = mainSeries as ISeriesApi<'Candlestick'>
      mainSeries.setData(priceData)
    } else if (chartType === 'line') {
      mainSeries = chart.addLineSeries({
        color: '#2962FF',
        lineWidth: 2,
        priceFormat: {
          type: 'price',
          precision: priceDisplay === 'usd' ? 6 : 8,
          minMove: priceDisplay === 'usd' ? 0.000001 : 0.00000001,
        },
      })
      lineSeriesRef.current = mainSeries as ISeriesApi<'Line'>
      const lineData = candlesData.map((c: Candle) => ({
        time: c.time as Time,
        value: priceDisplay === 'usd' ? c.close : c.closeOPN!,
      }))
      mainSeries.setData(lineData)
    } else if (chartType === 'area') {
      mainSeries = chart.addAreaSeries({
        lineColor: '#2962FF',
        topColor: 'rgba(41, 98, 255, 0.28)',
        bottomColor: 'rgba(41, 98, 255, 0.01)',
        lineWidth: 2,
        priceFormat: {
          type: 'price',
          precision: priceDisplay === 'usd' ? 6 : 8,
          minMove: priceDisplay === 'usd' ? 0.000001 : 0.00000001,
        },
      })
      areaSeriesRef.current = mainSeries as ISeriesApi<'Area'>
      const areaData = candlesData.map((c: Candle) => ({
        time: c.time as Time,
        value: priceDisplay === 'usd' ? c.close : c.closeOPN!,
      }))
      mainSeries.setData(areaData)
    }

    // Add volume if enabled
    if (indicators.find(i => i.value === 'volume' && i.enabled)) {
      const volumeSeries = chart.addHistogramSeries({
        color: '#26a69a',
        priceFormat: {
          type: 'volume',
        },
        priceScaleId: 'volume',
      })

      chart.priceScale('volume').applyOptions({
        scaleMargins: {
          top: 0.8,
          bottom: 0,
        },
      })

      const volumeData = candlesData.map((c: Candle) => ({
        time: c.time as Time,
        value: c.volume,
        color: c.close >= c.open ? '#26a69a' : '#ef5350',
      }))

      volumeSeries.setData(volumeData)
      volumeSeriesRef.current = volumeSeries
    }

    // Add moving averages
    indicators.forEach(indicator => {
      if (indicator.enabled && indicator.value.startsWith('ma')) {
        const period = parseInt(indicator.value.slice(2))
        addMovingAverage(chart, candlesData, period, indicator.value)
      } else if (indicator.enabled && indicator.value.startsWith('ema')) {
        const period = parseInt(indicator.value.slice(3))
        addEMA(chart, candlesData, period, indicator.value)
      }
    })

    // Handle resize
    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        })
      }
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [candlesData, chartType, indicators, priceDisplay])

  const addMovingAverage = (chart: IChartApi, data: Candle[], period: number, id: string) => {
    const ma = chart.addLineSeries({
      color: period === 7 ? '#2962FF' : period === 25 ? '#FF6B6B' : '#4ECDC4',
      lineWidth: 2,
      priceFormat: {
        type: 'price',
        precision: priceDisplay === 'usd' ? 6 : 8,
        minMove: priceDisplay === 'usd' ? 0.000001 : 0.00000001,
      },
    })

    const maData = data.map((candle, index) => {
      if (index < period - 1) return null
      
      const sum = data.slice(index - period + 1, index + 1)
        .reduce((acc, c) => acc + (priceDisplay === 'usd' ? c.close : c.closeOPN!), 0)
      
      return {
        time: candle.time as Time,
        value: sum / period,
      }
    }).filter(Boolean)

    ma.setData(maData as any)
    maSeriesRefs.current[id] = ma
  }

  const addEMA = (chart: IChartApi, data: Candle[], period: number, id: string) => {
    const ema = chart.addLineSeries({
      color: period === 12 ? '#9C27B0' : '#FF9800',
      lineWidth: 2,
      priceFormat: {
        type: 'price',
        precision: priceDisplay === 'usd' ? 6 : 8,
        minMove: priceDisplay === 'usd' ? 0.000001 : 0.00000001,
      },
    })

    const multiplier = 2 / (period + 1)
    const emaData: any[] = []
    
    data.forEach((candle, index) => {
      const closePrice = priceDisplay === 'usd' ? candle.close : candle.closeOPN!
      
      if (index === 0) {
        emaData.push({
          time: candle.time as Time,
          value: closePrice,
        })
      } else if (index < period - 1) {
        // Calculate SMA for initial EMA
        const sum = data.slice(0, index + 1)
          .reduce((acc, c) => acc + (priceDisplay === 'usd' ? c.close : c.closeOPN!), 0)
        emaData.push({
          time: candle.time as Time,
          value: sum / (index + 1),
        })
      } else {
        const prevEMA = emaData[index - 1].value
        const currentEMA = (closePrice * multiplier) + (prevEMA * (1 - multiplier))
        emaData.push({
          time: candle.time as Time,
          value: currentEMA,
        })
      }
    })

    ema.setData(emaData)
    maSeriesRefs.current[id] = ema
  }

  const updateLatestCandle = (candle: any) => {
    if (!chartRef.current) return

    const updatedCandle = {
      time: candle.time as Time,
      open: priceDisplay === 'usd' ? candle.open : candle.openOPN,
      high: priceDisplay === 'usd' ? candle.high : candle.highOPN,
      low: priceDisplay === 'usd' ? candle.low : candle.lowOPN,
      close: priceDisplay === 'usd' ? candle.close : candle.closeOPN,
    }

    if (candleSeriesRef.current) {
      candleSeriesRef.current.update(updatedCandle)
    } else if (lineSeriesRef.current) {
      lineSeriesRef.current.update({
        time: candle.time as Time,
        value: updatedCandle.close,
      })
    } else if (areaSeriesRef.current) {
      areaSeriesRef.current.update({
        time: candle.time as Time,
        value: updatedCandle.close,
      })
    }

    if (volumeSeriesRef.current) {
      volumeSeriesRef.current.update({
        time: candle.time as Time,
        value: candle.volume,
        color: candle.close >= candle.open ? '#26a69a' : '#ef5350',
      })
    }
  }

  const updatePriceLine = (price: number) => {
    if (!chartRef.current || !price) return

    if (candleSeriesRef.current) {
      candleSeriesRef.current.createPriceLine({
        price,
        color: '#FF6B6B',
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: 'Current',
      })
    }
  }

  const toggleIndicator = (indicatorValue: string) => {
    setIndicators(prev => prev.map(ind => 
      ind.value === indicatorValue 
        ? { ...ind, enabled: !ind.enabled }
        : ind
    ))
  }

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      chartContainerRef.current?.requestFullscreen()
      setIsFullscreen(true)
    } else {
      document.exitFullscreen()
      setIsFullscreen(false)
    }
  }

  const downloadChart = () => {
    if (!chartRef.current) return
    
    const canvas = chartRef.current.takeScreenshot()
    if (canvas) {
      const link = document.createElement('a')
      link.download = `chart-${pairAddress}-${Date.now()}.png`
      link.href = canvas.toDataURL()
      link.click()
    }
  }

  return (
    <div className="h-full flex flex-col bg-[#0d0d0d] rounded-lg border border-gray-800">
      {/* Chart Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-800">
        <div className="flex items-center space-x-4">
          {/* Timeframe Selector */}
          <div className="flex items-center space-x-1 bg-[#1a1a1a] rounded-lg p-1">
            {TIMEFRAMES.map(tf => (
              <button
                key={tf.value}
                onClick={() => setTimeframe(tf.value)}
                className={`px-3 py-1 text-sm rounded transition-colors ${
                  timeframe === tf.value
                    ? 'bg-blue-500 text-white'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                {tf.label}
              </button>
            ))}
          </div>

          {/* Chart Type Selector */}
          <div className="flex items-center space-x-1">
            {CHART_TYPES.map(type => (
              <button
                key={type.value}
                onClick={() => setChartType(type.value as any)}
                className={`p-2 rounded transition-colors ${
                  chartType === type.value
                    ? 'bg-gray-800 text-white'
                    : 'text-gray-400 hover:text-white hover:bg-gray-800'
                }`}
                title={type.label}
              >
                <type.icon className="w-4 h-4" />
              </button>
            ))}
          </div>

          {/* Indicators */}
          <div className="relative">
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="flex items-center space-x-2 px-3 py-1.5 text-sm text-gray-400 hover:text-white bg-[#1a1a1a] rounded-lg"
            >
              <SparklesIcon className="w-4 h-4" />
              <span>Indicators</span>
            </button>

            {showSettings && (
              <div className="absolute top-full left-0 mt-2 w-48 bg-[#1a1a1a] border border-gray-700 rounded-lg shadow-xl z-10">
                <div className="p-2">
                  {INDICATORS.map(indicator => (
                    <button
                      key={indicator.value}
                      onClick={() => toggleIndicator(indicator.value)}
                      className="flex items-center justify-between w-full px-3 py-2 text-sm text-gray-400 hover:text-white hover:bg-gray-800 rounded"
                    >
                      <span>{indicator.label}</span>
                      {indicator.enabled && <CheckIcon className="w-4 h-4 text-blue-500" />}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {/* Last Price */}
          {lastPrice && (
            <div className="px-3 py-1 bg-[#1a1a1a] rounded-lg">
              <span className="text-sm text-gray-400 mr-2">Last:</span>
              <span className="font-medium">
                {priceDisplay === 'usd' ? '$' : ''}{PriceCalculator.formatPrice(lastPrice, priceDisplay === 'usd')}
              </span>
            </div>
          )}

          {/* Tools */}
          <button
            onClick={downloadChart}
            className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded"
            title="Download Chart"
          >
            <ArrowTrendingUpIcon className="w-4 h-4" />
          </button>
          <button
            onClick={toggleFullscreen}
            className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded"
            title="Fullscreen"
          >
            <ArrowsPointingOutIcon className="w-4 h-4" />
          </button>
          <button
            className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded"
            title="Settings"
          >
            <CogIcon className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Chart Container */}
      <div className="flex-1 relative">
        <div ref={chartContainerRef} className="absolute inset-0" />
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#0d0d0d]/80">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
              <p className="mt-2 text-gray-400">Loading chart data...</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}