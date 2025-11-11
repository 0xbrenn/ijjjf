import React, { useEffect, useRef, useState } from 'react'
import { createChart, IChartApi, ISeriesApi, ColorType, CrosshairMode } from 'lightweight-charts'
import { useQuery } from '@tanstack/react-query'
import axios from 'axios'
import { io, Socket } from 'socket.io-client'
import { 
  ChartBarIcon,
  ArrowsPointingOutIcon,
  MinusIcon,
  PlusIcon,
  ArrowPathIcon,
  PhotoIcon,
  Bars3Icon
} from '@heroicons/react/24/outline'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'
const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:3002'

interface DexChartProps {
  pairAddress: string
  priceDisplay: 'usd' | 'opn'
}

const TIMEFRAMES = [
  { label: '1m', value: '1m' },
  { label: '5m', value: '5m' },
  { label: '15m', value: '15m' },
  { label: '1h', value: '1h' },
  { label: '4h', value: '4h' },
  { label: '1d', value: '1d' },
]

const DexChart: React.FC<DexChartProps> = ({ pairAddress, priceDisplay }) => {
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const lineSeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  const areaSeriesRef = useRef<ISeriesApi<'Area'> | null>(null)
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const [socket, setSocket] = useState<Socket | null>(null)
  
  const [timeframe, setTimeframe] = useState('15m')
  const [chartType, setChartType] = useState<'candlestick' | 'line' | 'area'>('candlestick')

  // Fetch candle data with auto-refresh
  const { data: candleData } = useQuery({
    queryKey: ['candles', pairAddress, timeframe],
    queryFn: async () => {
      const response = await axios.get(`${API_URL}/api/pairs/${pairAddress}/candles`, {
        params: { timeframe, limit: 500 }
      })
      return response.data.candles || []
    },
    enabled: !!pairAddress,
    refetchInterval: 5000, // Refresh every 5 seconds
  })

  // Initialize WebSocket
  useEffect(() => {
    const newSocket = io(WS_URL, {
      transports: ['websocket'],
      reconnection: true,
    })

    newSocket.on('connect', () => {
      console.log('Chart WebSocket connected')
      newSocket.emit('subscribe', { pairs: [pairAddress] })
    })

    // Listen for candle updates (from backend candle generation)
    newSocket.on('candle', (data) => {
      if (data.pair === pairAddress && data.timeframe === timeframe) {
        updateRealtimeCandle(data)
      }
    })

    setSocket(newSocket)
    return () => newSocket.close()
  }, [pairAddress, timeframe])

  // Initialize chart
  useEffect(() => {
    if (!chartContainerRef.current) return

    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: chartContainerRef.current.clientHeight,
      layout: {
        background: { type: ColorType.Solid, color: '#0d0d0d' },
        textColor: '#d1d5db',
      },
      grid: {
        vertLines: { color: '#1a1a1a' },
        horzLines: { color: '#1a1a1a' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: '#9ca3af',
          width: 1,
          style: 3,
          labelBackgroundColor: '#374151',
        },
        horzLine: {
          color: '#9ca3af',
          width: 1,
          style: 3,
          labelBackgroundColor: '#374151',
        },
      },
      rightPriceScale: {
        borderColor: '#2d2d2d',
        scaleMargins: {
          top: 0.05,
          bottom: 0.15, // Only 15% for volume
        },
        autoScale: true,
        alignLabels: true,
        borderVisible: true,
        entireTextOnly: false,
        visible: true,
        drawTicks: true,
        // Show more decimals for small numbers
        minimumWidth: 60,
      },
      timeScale: {
        borderColor: '#2d2d2d',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 12,
        barSpacing: 8,
        minBarSpacing: 3,
        fixLeftEdge: false,
        fixRightEdge: false,
        lockVisibleTimeRangeOnResize: false,
        rightBarStaysOnScroll: true,
        borderVisible: true,
        visible: true,
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: true,
      },
      handleScale: {
        axisPressedMouseMove: true,
        mouseWheel: true,
        pinch: true,
      },
    })

    chartRef.current = chart

    // Add volume series - SMALL at bottom with hidden scale
    const volumeSeries = chart.addHistogramSeries({
      color: '#26a69a',
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
      scaleMargins: {
        top: 0.90,  // Start at 90% = only 10% height!
        bottom: 0,
      },
    })
    volumeSeriesRef.current = volumeSeries

    // Configure volume price scale to be invisible
    chart.priceScale('volume').applyOptions({
      scaleMargins: {
        top: 0.90,
        bottom: 0,
      },
    })

    // Handle resize
    const handleResize = () => {
      if (chartContainerRef.current && chart) {
        chart.resize(
          chartContainerRef.current.clientWidth,
          chartContainerRef.current.clientHeight
        )
      }
    }

    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      chart.remove()
    }
  }, [])

  // Update chart type
  useEffect(() => {
    if (!chartRef.current) return

    // Remove old series
    if (candleSeriesRef.current) {
      try { chartRef.current.removeSeries(candleSeriesRef.current) } catch (e) {}
      candleSeriesRef.current = null
    }
    if (lineSeriesRef.current) {
      try { chartRef.current.removeSeries(lineSeriesRef.current) } catch (e) {}
      lineSeriesRef.current = null
    }
    if (areaSeriesRef.current) {
      try { chartRef.current.removeSeries(areaSeriesRef.current) } catch (e) {}
      areaSeriesRef.current = null
    }

    // Add new series based on type with custom price format
    if (chartType === 'candlestick') {
      const candleSeries = chartRef.current.addCandlestickSeries({
        upColor: '#26a69a',
        downColor: '#ef5350',
        borderUpColor: '#26a69a',
        borderDownColor: '#ef5350',
        wickUpColor: '#26a69a',
        wickDownColor: '#ef5350',
        priceFormat: {
          type: 'custom',
          formatter: (price: number) => {
            if (price === 0) return '0.00'
            if (price < 0.0001) return price.toFixed(8)
            if (price < 0.01) return price.toFixed(6)
            if (price < 1) return price.toFixed(4)
            return price.toFixed(2)
          },
        },
      })
      candleSeriesRef.current = candleSeries
    } else if (chartType === 'line') {
      const lineSeries = chartRef.current.addLineSeries({
        color: '#2962FF',
        lineWidth: 2,
        priceFormat: {
          type: 'custom',
          formatter: (price: number) => {
            if (price === 0) return '0.00'
            if (price < 0.0001) return price.toFixed(8)
            if (price < 0.01) return price.toFixed(6)
            if (price < 1) return price.toFixed(4)
            return price.toFixed(2)
          },
        },
      })
      lineSeriesRef.current = lineSeries
    } else if (chartType === 'area') {
      const areaSeries = chartRef.current.addAreaSeries({
        topColor: 'rgba(41, 98, 255, 0.4)',
        bottomColor: 'rgba(41, 98, 255, 0.0)',
        lineColor: 'rgba(41, 98, 255, 1)',
        lineWidth: 2,
        priceFormat: {
          type: 'custom',
          formatter: (price: number) => {
            if (price === 0) return '0.00'
            if (price < 0.0001) return price.toFixed(8)
            if (price < 0.01) return price.toFixed(6)
            if (price < 1) return price.toFixed(4)
            return price.toFixed(2)
          },
        },
      })
      areaSeriesRef.current = areaSeries
    }

    if (candleData) {
      updateChartData(candleData)
      
      // Fit chart after switching type
      setTimeout(() => {
        if (chartRef.current) {
          chartRef.current.timeScale().fitContent()
        }
      }, 100)
    }
  }, [chartType, chartRef.current])

  // Update data
  useEffect(() => {
    if (candleData && candleData.length > 0) {
      updateChartData(candleData)
      
      // Auto-fit the chart to show all candles
      setTimeout(() => {
        if (chartRef.current) {
          chartRef.current.timeScale().fitContent()
        }
      }, 100)
    }
  }, [candleData, priceDisplay])

  const updateChartData = (data: any[]) => {
    if (!data || data.length === 0) return

    const formattedData = data.map((c: any) => {
      const price = priceDisplay === 'usd' 
        ? { open: c.open, high: c.high, low: c.low, close: c.close }
        : { open: c.openOPN, high: c.highOPN, low: c.lowOPN, close: c.closeOPN }
      
      return { time: c.time, ...price, value: price.close }
    })

    // Update main series
    if (chartType === 'candlestick' && candleSeriesRef.current) {
      candleSeriesRef.current.setData(formattedData)
    } else if (chartType === 'line' && lineSeriesRef.current) {
      lineSeriesRef.current.setData(formattedData.map(d => ({ time: d.time, value: d.close })))
    } else if (chartType === 'area' && areaSeriesRef.current) {
      areaSeriesRef.current.setData(formattedData.map(d => ({ time: d.time, value: d.close })))
    }

    // Update volume - make bars SMALL
    if (volumeSeriesRef.current) {
      const volumeData = data.map((c: any) => ({
        time: c.time,
        value: c.volume,
        color: c.close >= c.open ? '#26a69a40' : '#ef535040', // Semi-transparent
      }))
      volumeSeriesRef.current.setData(volumeData)
    }
  }

  const updateRealtimeCandle = (data: any) => {
    if (!chartRef.current) return

    const candle = priceDisplay === 'usd'
      ? { time: data.time, open: data.open, high: data.high, low: data.low, close: data.close }
      : { time: data.time, open: data.openOPN, high: data.highOPN, low: data.lowOPN, close: data.closeOPN }

    if (chartType === 'candlestick' && candleSeriesRef.current) {
      candleSeriesRef.current.update(candle)
    } else if (chartType === 'line' && lineSeriesRef.current) {
      lineSeriesRef.current.update({ time: candle.time, value: candle.close })
    } else if (chartType === 'area' && areaSeriesRef.current) {
      areaSeriesRef.current.update({ time: candle.time, value: candle.close })
    }

    if (volumeSeriesRef.current) {
      volumeSeriesRef.current.update({
        time: data.time,
        value: data.volume,
        color: data.close >= data.open ? '#26a69a40' : '#ef535040',
      })
    }
  }

  const handleZoomIn = () => {
    if (!chartRef.current) return
    const timeScale = chartRef.current.timeScale()
    const { from, to } = timeScale.getVisibleLogicalRange() || { from: 0, to: 100 }
    const range = to - from
    const newRange = range * 0.8
    const center = (from + to) / 2
    timeScale.setVisibleLogicalRange({
      from: center - newRange / 2,
      to: center + newRange / 2,
    })
  }

  const handleZoomOut = () => {
    if (!chartRef.current) return
    const timeScale = chartRef.current.timeScale()
    const { from, to } = timeScale.getVisibleLogicalRange() || { from: 0, to: 100 }
    const range = to - from
    const newRange = range * 1.2
    const center = (from + to) / 2
    timeScale.setVisibleLogicalRange({
      from: center - newRange / 2,
      to: center + newRange / 2,
    })
  }

  const handleResetZoom = () => {
    if (!chartRef.current) return
    chartRef.current.timeScale().fitContent()
  }

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      chartContainerRef.current?.parentElement?.requestFullscreen()
    } else {
      document.exitFullscreen()
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
    <div className="h-full flex bg-[#0d0d0d] rounded-lg border border-gray-800">
      {/* Left Sidebar - Like DEXTools */}
      <div className="w-12 bg-[#0a0a0a] border-r border-gray-800 flex flex-col items-center py-3 space-y-3">
        <button
          onClick={() => setChartType('candlestick')}
          className={`p-2 rounded transition-colors ${
            chartType === 'candlestick' ? 'bg-blue-500 text-white' : 'text-gray-400 hover:text-white'
          }`}
          title="Candlesticks"
        >
          <ChartBarIcon className="w-5 h-5" />
        </button>
        <button
          onClick={() => setChartType('line')}
          className={`p-2 rounded transition-colors ${
            chartType === 'line' ? 'bg-blue-500 text-white' : 'text-gray-400 hover:text-white'
          }`}
          title="Line Chart"
        >
          <Bars3Icon className="w-5 h-5" />
        </button>
        <button
          onClick={() => setChartType('area')}
          className={`p-2 rounded transition-colors ${
            chartType === 'area' ? 'bg-blue-500 text-white' : 'text-gray-400 hover:text-white'
          }`}
          title="Area Chart"
        >
          <ChartBarIcon className="w-5 h-5" />
        </button>
        
        <div className="flex-1" />
        
        <button
          onClick={handleZoomIn}
          className="p-2 text-gray-400 hover:text-white rounded transition-colors"
          title="Zoom In"
        >
          <PlusIcon className="w-5 h-5" />
        </button>
        <button
          onClick={handleZoomOut}
          className="p-2 text-gray-400 hover:text-white rounded transition-colors"
          title="Zoom Out"
        >
          <MinusIcon className="w-5 h-5" />
        </button>
        <button
          onClick={handleResetZoom}
          className="p-2 text-gray-400 hover:text-white rounded transition-colors"
          title="Reset"
        >
          <ArrowPathIcon className="w-5 h-5" />
        </button>
        <button
          onClick={downloadChart}
          className="p-2 text-gray-400 hover:text-white rounded transition-colors"
          title="Screenshot"
        >
          <PhotoIcon className="w-5 h-5" />
        </button>
        <button
          onClick={toggleFullscreen}
          className="p-2 text-gray-400 hover:text-white rounded transition-colors"
          title="Fullscreen"
        >
          <ArrowsPointingOutIcon className="w-5 h-5" />
        </button>
      </div>

      {/* Main Chart Area */}
      <div className="flex-1 flex flex-col">
        {/* Top Controls */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800">
          <div className="flex items-center space-x-1 bg-[#1a1a1a] rounded-lg p-1">
            {TIMEFRAMES.map(tf => (
              <button
                key={tf.value}
                onClick={() => setTimeframe(tf.value)}
                className={`px-3 py-1 text-sm font-medium rounded transition-colors ${
                  timeframe === tf.value
                    ? 'bg-blue-500 text-white'
                    : 'text-gray-400 hover:text-white hover:bg-gray-800'
                }`}
              >
                {tf.label}
              </button>
            ))}
          </div>
        </div>

        {/* Chart */}
        <div ref={chartContainerRef} className="flex-1" />
      </div>
    </div>
  )
}

export default DexChart