import axios from 'axios'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'public, s-maxage=3600')
  const { ticker, range = '1y' } = req.query
  if (!ticker) return res.status(400).json({ error: 'ticker required' })

  const interval = range === '5y' ? '1mo' : '1d'
  const url = `https://query1.finance.yahoo.com/v7/finance/chart/${encodeURIComponent(ticker)}?range=${range}&interval=${interval}`

  try {
    const r = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000 })
    const result = r.data?.chart?.result?.[0]
    if (!result) return res.status(200).json({ closes: [], timestamps: [] })

    const rawCloses = result.indicators?.quote?.[0]?.close || []
    const rawTs = result.timestamp || []
    const pairs = rawCloses.map((c, i) => [c, rawTs[i]]).filter(([c]) => typeof c === 'number')

    return res.status(200).json({
      closes: pairs.map(([c]) => c),
      timestamps: pairs.map(([, t]) => t),
    })
  } catch (err) {
    console.warn(`chart-history fetch failed for ${ticker}:`, err.message)
    return res.status(200).json({ closes: [], timestamps: [] })
  }
}
