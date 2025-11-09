import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createChart, IChartApi, ISeriesApi, UTCTimestamp } from 'lightweight-charts';
import { io, Socket } from 'socket.io-client';
import axios from 'axios';

interface ChartProps {
  pairAddress: string;
  token0Symbol: string;
  token1Symbol: string;
  pair?: any;
}

interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface Trade {
  price: number;
  timestamp: number;
  volume: number;
  type: 'buy' | 'sell';
}

const TIMEFRAMES = [
  { label: '1m', value: '1m' },
  { label: '5m', value: '5m' },
  { label: '15m', value: '15m' },
  { label: '30m', value: '30m' },
  { label: '1H', value: '1h' },
  { label: '4H', value: '4h' },
  { label: '1D', value: '1d' },
];

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:3002';

export const DexChart: React.FC<ChartProps> = ({ pairAddress, token0Symbol, token1Symbol, pair }) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const socketRef = useRef<Socket | null>(null);

  const [timeframe, setTimeframe] = useState('1h');
  const [currentPrice, setCurrentPrice] = useState<number>(0);
  const [priceChange24h, setPriceChange24h] = useState<number>(0);
  const [volume24h, setVolume24h] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [trades, setTrades] = useState<Trade[]>([]);

  // Calculate USD price based on WOPN pair
  const calculateUSDValue = (price: number) => {
    if (!pair) return price;
    
    const wopnAddress = '0xBc022C9dEb5AF250A526321d16Ef52E39b4DBD84'.toLowerCase();
    const isWOPNPair = pair.token0?.toLowerCase() === wopnAddress || pair.token1?.toLowerCase() === wopnAddress;
    
    if (!isWOPNPair) return price;
    
    // WOPN price is $0.05
    const wopnPriceUSD = 0.05;
    
    if (pair.token0?.toLowerCase() === wopnAddress) {
      // Price is WOPN per TOKEN, need to invert
      return price === 0 ? 0 : (1 / price) * wopnPriceUSD;
    } else {
      // Price is TOKEN per WOPN
      return price * wopnPriceUSD;
    }
  };

  // Initialize chart
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: chartContainerRef.current.clientHeight,
      layout: {
        backgroundColor: '#0d0d0d',
        textColor: '#d1d4dc',
      },
      grid: {
        vertLines: {
          color: '#1a1a1a',
        },
        horzLines: {
          color: '#1a1a1a',
        },
      },
      crosshair: {
        mode: 1,
      },
      rightPriceScale: {
        borderColor: '#2B2B43',
      },
      timeScale: {
        borderColor: '#2B2B43',
        timeVisible: true,
        secondsVisible: false,
      },
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: '#089981',
      downColor: '#F23645',
      borderVisible: false,
      wickUpColor: '#089981',
      wickDownColor: '#F23645',
    });

    const volumeSeries = chart.addHistogramSeries({
      color: '#26a69a',
      priceFormat: {
        type: 'volume',
      },
      priceScaleId: '',
    });

    chart.priceScale('').applyOptions({
      scaleMargins: {
        top: 0.8,
        bottom: 0,
      },
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        });
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, []);

  // Fetch candle data
  const fetchCandles = useCallback(async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${API_URL}/api/pairs/${pairAddress}/candles`, {
        params: {
          timeframe,
          limit: 300,
        },
      });

      const candles = response.data.candles.map((c: Candle) => ({
        time: c.time as UTCTimestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }));

      // Filter out duplicate timestamps
      const uniqueCandles = candles.filter((candle, index, self) =>
        index === self.findIndex(c => c.time === candle.time)
      );

      const volumes = response.data.candles.map((c: Candle) => ({
        time: c.time as UTCTimestamp,
        value: c.volume,
        color: c.close >= c.open ? '#089981' : '#F23645',
      }));

      const uniqueVolumes = volumes.filter((vol, index, self) =>
        index === self.findIndex(v => v.time === vol.time)
      );

      if (candleSeriesRef.current && volumeSeriesRef.current) {
        if (uniqueCandles.length > 0) {
          candleSeriesRef.current.setData(uniqueCandles);
          volumeSeriesRef.current.setData(uniqueVolumes);
        }
      }

      if (uniqueCandles.length > 0) {
        setCurrentPrice(uniqueCandles[uniqueCandles.length - 1].close);
      }
    } catch (error) {
      console.error('Error fetching candles:', error);
    } finally {
      setLoading(false);
    }
  }, [pairAddress, timeframe]);

  // Fetch pair details
  const fetchPairDetails = useCallback(async () => {
    try {
      const response = await axios.get(`${API_URL}/api/pairs/${pairAddress}`);
      const data = response.data;
      
      setCurrentPrice(parseFloat(data.price || '0'));
      setVolume24h(parseFloat(data.volume_24h || '0'));
      
      // Calculate price change (would need historical price)
      // setPriceChange24h(calculated_change);
    } catch (error) {
      console.error('Error fetching pair details:', error);
    }
  }, [pairAddress]);

  // Fetch recent trades
  const fetchTrades = useCallback(async () => {
    try {
      const response = await axios.get(`${API_URL}/api/pairs/${pairAddress}/trades`, {
        params: { limit: 20 },
      });
      
      const formattedTrades = response.data.trades.map((trade: any) => ({
        price: parseFloat(trade.price || '0'),
        timestamp: parseInt(trade.timestamp || '0'),
        volume: parseFloat(trade.volume_usd || trade.volume || '0'),
        type: parseFloat(trade.token0_amount || '0') > 0 ? 'buy' : 'sell',
      }));
      
      setTrades(formattedTrades);
    } catch (error) {
      console.error('Error fetching trades:', error);
    }
  }, [pairAddress]);

  // WebSocket connection
  useEffect(() => {
    socketRef.current = io(WS_URL);
    
    socketRef.current.on('connect', () => {
      console.log('WebSocket connected');
      socketRef.current?.emit('subscribe', { pairs: [pairAddress] });
      socketRef.current?.emit('subscribe_candles', { 
        pair: pairAddress, 
        timeframe 
      });
    });

    socketRef.current.on('price_update', (data) => {
      if (data.pair === pairAddress) {
        setCurrentPrice(data.price);
        
        // Add new trade to list
        const newTrade: Trade = {
          price: data.price || 0,
          timestamp: data.timestamp || Date.now() / 1000,
          volume: data.volume || 0,
          type: data.price > currentPrice ? 'buy' : 'sell',
        };
        
        setTrades(prev => [newTrade, ...prev.slice(0, 19)]);
      }
    });

    socketRef.current.on('candle_update', (data) => {
      if (data.pair === pairAddress && data.timeframe === timeframe) {
        if (candleSeriesRef.current) {
          candleSeriesRef.current.update({
            time: data.candle.time as UTCTimestamp,
            open: data.candle.open,
            high: data.candle.high,
            low: data.candle.low,
            close: data.candle.close,
          });
        }
        
        if (volumeSeriesRef.current) {
          volumeSeriesRef.current.update({
            time: data.candle.time as UTCTimestamp,
            value: data.candle.volume,
            color: data.candle.close >= data.candle.open ? '#089981' : '#F23645',
          });
        }
      }
    });

    return () => {
      if (socketRef.current) {
        socketRef.current.emit('unsubscribe', { pairs: [pairAddress] });
        socketRef.current.disconnect();
      }
    };
  }, [pairAddress, timeframe, currentPrice]);

  // Fetch data on mount and timeframe change
  useEffect(() => {
    fetchCandles();
    fetchPairDetails();
    fetchTrades();
  }, [fetchCandles, fetchPairDetails, fetchTrades]);

  const formatPrice = (price: number) => {
    const usdValue = calculateUSDValue(price);
    if (usdValue > 1) return `$${usdValue.toFixed(2)}`;
    if (usdValue > 0.01) return `$${usdValue.toFixed(4)}`;
    if (usdValue > 0.0001) return `$${usdValue.toFixed(6)}`;
    return `$${usdValue.toFixed(8)}`;
  };

  const formatVolume = (volume: number) => {
    // Assume volume is in tokens, multiply by USD price
    const usdVolume = volume * calculateUSDValue(1);
    if (usdVolume > 1e9) return `$${(usdVolume / 1e9).toFixed(2)}B`;
    if (usdVolume > 1e6) return `$${(usdVolume / 1e6).toFixed(2)}M`;
    if (usdVolume > 1e3) return `$${(usdVolume / 1e3).toFixed(2)}K`;
    return `$${usdVolume.toFixed(2)}`;
  };

  return (
    <div className="h-full flex flex-col bg-[#0d0d0d]">
      {/* Header */}
      <div className="bg-[#151515] border-b border-gray-800 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-white">
              {token0Symbol}/{token1Symbol}
            </h2>
            <p className="text-xs text-gray-500 mt-1">
              {pairAddress.slice(0, 6)}...{pairAddress.slice(-4)}
            </p>
          </div>
          
          <div className="text-right">
            <div className="text-2xl font-bold text-white">
              {formatPrice(currentPrice)}
            </div>
            <div className={`text-sm ${priceChange24h >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {priceChange24h >= 0 ? '+' : ''}{priceChange24h.toFixed(2)}%
            </div>
          </div>
          
          <div className="text-sm text-gray-400">
            <div>24h Volume: {formatVolume(volume24h)}</div>
          </div>
        </div>

        {/* Timeframe selector */}
        <div className="flex space-x-2 mt-4">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf.value}
              onClick={() => setTimeframe(tf.value)}
              className={`px-3 py-1 rounded text-sm ${
                timeframe === tf.value
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >
              {tf.label}
            </button>
          ))}
        </div>
      </div>

      {/* Chart and trades container */}
      <div className="flex-1 flex">
        {/* Chart */}
        <div className="flex-1 relative">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-[#0d0d0d] bg-opacity-75 z-10">
              <div className="text-gray-400">Loading chart data...</div>
            </div>
          )}
          <div ref={chartContainerRef} className="w-full h-full" />
        </div>

        {/* Recent trades */}
        <div className="w-[320px] bg-[#151515] border-l border-gray-800">
          <div className="p-4 border-b border-gray-800">
            <h3 className="font-semibold text-white">Recent Trades</h3>
          </div>
          
          <div className="overflow-y-auto" style={{ height: 'calc(100% - 60px)' }}>
            <div className="text-xs text-gray-500 grid grid-cols-3 gap-2 px-4 py-2 border-b border-gray-800">
              <span>Price</span>
              <span className="text-right">Amount</span>
              <span className="text-right">Time</span>
            </div>
            
            {trades.map((trade, index) => (
              <div
                key={index}
                className="grid grid-cols-3 gap-2 px-4 py-2 text-sm border-b border-gray-800/50 hover:bg-gray-800/30"
              >
                <span className={trade.type === 'buy' ? 'text-green-400' : 'text-red-400'}>
                  {formatPrice(trade.price)}
                </span>
                <span className="text-gray-300 text-right">
                  ${trade.volume?.toFixed(2) || '0.00'}
                </span>
                <span className="text-gray-400 text-right">
                  {new Date(trade.timestamp * 1000).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default DexChart;