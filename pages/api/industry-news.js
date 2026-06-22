const SECTOR_ETF = {
  'Technology':             'XLK',
  'Healthcare':             'XLV',
  'Financials':             'XLF',
  'Consumer Discretionary': 'XLY',
  'Consumer Staples':       'XLP',
  'Energy':                 'XLE',
  'Utilities':              'XLU',
  'Materials':              'XLB',
  'Industrials':            'XLI',
  'Real Estate':            'XLRE',
  'Communication Services': 'XLC',
}

export default async function handler(req, res) {
  const { sector } = req.query
  const key = process.env.FINNHUB_API_KEY
  if (!sector) return res.status(400).json({ error: 'Missing sector' })
  if (!key)    return res.status(500).json({ error: 'FINNHUB_API_KEY not configured' })

  const etf = SECTOR_ETF[sector]
  if (!etf) return res.status(200).json({ news: [], note: `No ETF mapping for ${sector}` })

  const now = new Date()
  const from = new Date(now)
  from.setDate(from.getDate() - 30)
  const fmt = d => d.toISOString().split('T')[0]

  try {
    const resp = await fetch(
      `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(etf)}&from=${fmt(from)}&to=${fmt(now)}&token=${key}`
    )
    const data = await resp.json()
    const items = Array.isArray(data) ? data : []
    const news = items.slice(0, 8).map(item => ({
      headline: item.headline,
      source: item.source,
      url: item.url,
      datetime: item.datetime,
    }))
    return res.status(200).json({ sector, etf, news })
  } catch (err) {
    console.error('industry-news error:', err.message)
    return res.status(200).json({ error: err.message, news: [] })
  }
}
