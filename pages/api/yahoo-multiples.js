import axios from 'axios'

const METRIC_TYPES = {
  pe:       'annualPeRatio',
  evEbitda: 'annualEnterprisesValueEBITDARatio',
  ps:       'annualPsRatio',
  pfcf:     'annualPriceToBook',  // fallback — Yahoo has no annual P/FCF
}

const METRIC_LABELS_SERVER = {
  pe:       'P/E',
  evEbitda: 'EV/EBITDA',
  ps:       'P/S',
  pfcf:     'P/B',
}

export default async function handler(req, res) {
  const { ticker, metric = 'pe' } = req.query
  if (!ticker) return res.status(400).json({ error: 'Missing ticker' })

  const type = METRIC_TYPES[metric] || METRIC_TYPES.pe

  try {
    const url = `https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(ticker)}`
    const resp = await axios.get(url, {
      params: {
        type,
        period1: 1262304000,   // 2010-01-01
        period2: 9999999999,
      },
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
      timeout: 7000,
    })

    const result = resp?.data?.timeseries?.result?.[0]
    if (!result) return res.status(200).json({ error: 'No timeseries data' })

    const series = result[type]
    if (!Array.isArray(series) || !series.length) {
      return res.status(200).json({ error: `No ${METRIC_LABELS_SERVER[metric]} history for ${ticker}` })
    }

    const valid = series.filter(p => p?.reportedValue?.raw != null && Number(p.reportedValue.raw) > 0 && Number(p.reportedValue.raw) < 2000)
    if (!valid.length) return res.status(200).json({ error: 'No valid data points' })

    const labels = valid.map(p => p.date.slice(0, 4))
    const values = valid.map(p => Math.round(Number(p.reportedValue.raw) * 100) / 100)

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
    console.error('yahoo-multiples error:', err.message)
    return res.status(200).json({ error: err.message })
  }
}
