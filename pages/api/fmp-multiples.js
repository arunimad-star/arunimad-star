const FMP = 'https://financialmodelingprep.com/stable'

// Which field lives in which endpoint
const METRIC_SOURCE = {
  pe:       { endpoint: 'ratios',      field: 'priceToEarningsRatio' },
  evEbitda: { endpoint: 'key-metrics', field: 'evToEBITDA' },
  ps:       { endpoint: 'ratios',      field: 'priceToSalesRatio' },
  pfcf:     { endpoint: 'ratios',      field: 'priceToFreeCashFlowRatio' },
}

const calY = (dateStr) => new Date(dateStr).getFullYear().toString()

const toArr = (d) => (Array.isArray(d) ? d : d?.data && Array.isArray(d.data) ? d.data : [])

export default async function handler(req, res) {
  const { ticker, metric = 'pe' } = req.query
  const key = process.env.FMP_API_KEY
  if (!ticker) return res.status(400).json({ error: 'Missing ticker' })
  if (!key) return res.status(500).json({ error: 'FMP_API_KEY not set in .env.local' })

  const { endpoint, field } = METRIC_SOURCE[metric] || METRIC_SOURCE.pe

  try {
    const raw = await fetch(
      `${FMP}/${endpoint}?symbol=${encodeURIComponent(ticker)}&limit=5&apikey=${key}`
    )
    const text = await raw.text()
    let parsed
    try { parsed = JSON.parse(text) } catch {
      console.error('fmp-multiples non-JSON:', text.slice(0, 200))
      return res.status(200).json({ error: text.slice(0, 150) })
    }
    const data = toArr(parsed)

    if (!data.length) {
      return res.status(200).json({ error: `No ${metric} data available` })
    }

    // stable API returns newest-first — reverse to chronological
    const items = data
      .filter(m => m[field] != null && Number(m[field]) > 0 && Number(m[field]) < 2000)
      .reverse()

    if (!items.length) {
      return res.status(200).json({ error: `No valid ${metric} data found` })
    }

    const labels = items.map(m => calY(m.date))
    const values = items.map(m => Math.round(Number(m[field]) * 100) / 100)

    const n = values.length
    const avg = values.reduce((a, b) => a + b, 0) / n
    const stdDev = Math.sqrt(values.reduce((a, b) => a + (b - avg) ** 2, 0) / n)
    const current = values[n - 1]
    const zScore = stdDev > 0 ? (current - avg) / stdDev : 0
    const vsHistory = zScore > 1 ? 'expensive' : zScore < -1 ? 'cheap' : 'fair'

    return res.status(200).json({
      ticker: ticker.toUpperCase(),
      metric,
      labels,
      values,
      avg: Math.round(avg * 100) / 100,
      stdDev: Math.round(stdDev * 100) / 100,
      current: Math.round(current * 100) / 100,
      vsHistory,
      zScore: Math.round(zScore * 100) / 100,
      earningsDates: [],
    })
  } catch (err) {
    console.error('fmp-multiples error:', err)
    return res.status(500).json({ error: err.message })
  }
}
