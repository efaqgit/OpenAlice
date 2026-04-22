import { useEffect, useRef, useState } from 'react'
import { createChart, ColorType, IChartApi, ISeriesApi, CandlestickData, UTCTimestamp, CandlestickSeries, LineSeries, HistogramSeries, MouseEventParams } from 'lightweight-charts'

interface KLineChartProps {
  data: Array<{
    timestamp: string | number | Date
    open: number
    high: number
    low: number
    close: number
    volume?: number
  }>
  height?: number
  symbol?: string
  periods?: number[]
}

function calculateSMA(data: CandlestickData[], period: number) {
  const smaData = []
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) continue
    let sum = 0
    for (let j = 0; j < period; j++) {
      sum += (data[i - j].close as number)
    }
    smaData.push({
      time: data[i].time,
      value: sum / period,
    })
  }
  return smaData
}

export function KLineChart({ data, height = 500, symbol, periods = [5, 20, 60] }: KLineChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const maSeriesRefs = useRef<ISeriesApi<'Line'>[]>([])
  const [initError, setInitError] = useState<string | null>(null)
  const [legendValues, setLegendValues] = useState<Record<string, number | null>>({})

  useEffect(() => {
    if (!chartContainerRef.current || data.length === 0) return

    const timer = setTimeout(() => {
      try {
        if (!chartContainerRef.current) return

        const chart = createChart(chartContainerRef.current, {
          width: chartContainerRef.current.clientWidth,
          height: height,
          layout: {
            background: { type: ColorType.Solid, color: '#0B0E14' },
            textColor: '#D1D5DB',
          },
          grid: {
            vertLines: { color: '#1F2937' },
            horzLines: { color: '#1F2937' },
          },
          crosshair: {
            mode: 0,
          },
          timeScale: {
            borderColor: '#374151',
            timeVisible: true,
          },
        })

        const candlestickSeries = chart.addSeries(CandlestickSeries, {
          upColor: '#10B981',
          downColor: '#EF4444',
          borderVisible: false,
          wickUpColor: '#10B981',
          wickDownColor: '#EF4444',
        })

        // Add Volume series
        const volumeSeries = chart.addSeries(HistogramSeries, {
          color: '#26a69a',
          priceFormat: {
            type: 'volume',
          },
          priceScaleId: '', // Overlay mode
        })
        
        // Position volume at the bottom
        chart.priceScale('').applyOptions({
          scaleMargins: {
            top: 0.8, // 80% from top
            bottom: 0,
          },
        })

        // Add MA lines
        const colors = ['#3B82F6', '#EAB308', '#A855F7']
        maSeriesRefs.current = periods.map((p, i) => 
          chart.addSeries(LineSeries, { 
            color: colors[i % colors.length], 
            lineWidth: 1, 
            title: `MA${p}`,
            priceLineVisible: false,
          })
        )

        chartRef.current = chart
        seriesRef.current = candlestickSeries
        volumeSeriesRef.current = volumeSeries

        const formattedData: CandlestickData[] = data
          .map(item => ({
            time: Math.floor(new Date(item.timestamp).getTime() / 1000) as UTCTimestamp,
            open: item.open,
            high: item.high,
            low: item.low,
            close: item.close,
          }))
          .sort((a, b) => (a.time as number) - (b.time as number))

        const volumeData = data
          .map(item => ({
            time: Math.floor(new Date(item.timestamp).getTime() / 1000) as UTCTimestamp,
            value: item.volume ?? 0,
            color: item.close >= item.open ? 'rgba(16, 185, 129, 0.4)' : 'rgba(239, 68, 68, 0.4)',
          }))
          .sort((a, b) => (a.time as number) - (b.time as number))

        candlestickSeries.setData(formattedData)
        volumeSeries.setData(volumeData)
        
        maSeriesRefs.current.forEach((series, i) => {
          series.setData(calculateSMA(formattedData, periods[i]))
        })

        chart.timeScale().fitContent()

        chart.subscribeCrosshairMove((param: MouseEventParams) => {
          if (param.time) {
            const newValues: Record<string, number | null> = {}
            // MA values
            maSeriesRefs.current.forEach((series, i) => {
              const d = param.seriesData.get(series) as any
              newValues[`MA${periods[i]}`] = d?.value ?? null
            })
            // Volume value
            const vol = param.seriesData.get(volumeSeries) as any
            newValues['VOL'] = vol?.value ?? null
            
            setLegendValues(newValues)
          }
        })

        const handleResize = () => {
          if (chartContainerRef.current) {
            chart.applyOptions({ width: chartContainerRef.current.clientWidth })
          }
        }
        window.addEventListener('resize', handleResize);
        (chart as any)._resizeHandler = handleResize
      } catch (err) {
        setInitError(String(err))
      }
    }, 100)

    return () => {
      clearTimeout(timer)
      if (chartRef.current) {
        const handler = (chartRef.current as any)._resizeHandler
        if (handler) window.removeEventListener('resize', handler)
        chartRef.current.remove()
        chartRef.current = null
      }
    }
  }, [height, periods.join(',')])

  useEffect(() => {
    if (!seriesRef.current || !data || data.length === 0) return
    const formattedData: CandlestickData[] = data
      .map(item => ({
        time: Math.floor(new Date(item.timestamp).getTime() / 1000) as UTCTimestamp,
        open: item.open,
        high: item.high,
        low: item.low,
        close: item.close,
      }))
      .sort((a, b) => (a.time as number) - (b.time as number))

    const volumeData = data
      .map(item => ({
        time: Math.floor(new Date(item.timestamp).getTime() / 1000) as UTCTimestamp,
        value: item.volume ?? 0,
        color: item.close >= item.open ? 'rgba(16, 185, 129, 0.4)' : 'rgba(239, 68, 68, 0.4)',
      }))
      .sort((a, b) => (a.time as number) - (b.time as number))

    seriesRef.current.setData(formattedData)
    if (volumeSeriesRef.current) volumeSeriesRef.current.setData(volumeData)
    
    maSeriesRefs.current.forEach((series, i) => {
      series.setData(calculateSMA(formattedData, periods[i]))
    })
  }, [data])

  if (initError) return <div className="p-10 text-red">{initError}</div>

  const colors = ['text-[#3B82F6]', 'text-[#EAB308]', 'text-[#A855F7]']

  return (
    <div className="relative w-full rounded-lg overflow-hidden border border-border bg-[#0B0E14]" style={{ height }}>
      <div className="absolute top-2 left-4 z-20 pointer-events-none flex flex-col gap-1">
        <div className="flex items-center gap-3">
          <span className="text-[12px] font-bold text-text-muted opacity-50 uppercase">{symbol}</span>
          {legendValues['VOL'] && (
            <span className="text-[10px] text-text-muted font-mono">
              VOL: <span className="text-text">{legendValues['VOL'].toLocaleString()}</span>
            </span>
          )}
        </div>
        <div className="flex gap-4 text-[10px] font-mono">
          {periods.map((p, i) => (
            <div key={p} className={colors[i % colors.length]}>
              MA{p}: <span className="text-text-muted">{legendValues[`MA${p}`]?.toFixed(2) ?? '—'}</span>
            </div>
          ))}
        </div>
      </div>
      <div ref={chartContainerRef} className="w-full h-full" />
    </div>
  )
}
