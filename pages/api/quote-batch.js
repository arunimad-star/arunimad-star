import axios from 'axios'

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

// Yahoo's multi-symbol quote endpoint — returns basic screener fields for up to 100 tickers
// in a single request. Much more efficient than individual chart calls for screener enrichment.
export default async function handler(req, res) {
  const { tickers } = req.query
  if (!tickers || typeof tickers !== 'string') {
    return res.status(400).json({ error: 'Missing tickers' })
  }

  const tickerList = tickers.split(',').map(t => t.trim()).filter(Boolean).slice(0, 100)
  if (tickerList.length === 0) return res.status(400).json({ error: 'No valid tickers' })

  try {
    const url = `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(tickerList.join(','))}`
    const r = await axios.get(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      timeout: 10000,
    })

    const results = r.data?.quoteResponse?.result || []

    const data = results.map(q => ({
      ticker: (q.symbol || '').toUpperCase(),
      exchangeTicker: (q.symbol || '').toUpperCase(),
      name: q.shortName || q.longName || q.symbol || '',
      price: typeof q.regularMarketPrice === 'number' ? q.regularMarketPrice : null,
      week52Low: typeof q.fiftyTwoWeekLow === 'number' ? q.fiftyTwoWeekLow : null,
      week52High: typeof q.fiftyTwoWeekHigh === 'number' ? q.fiftyTwoWeekHigh : null,
      // Yahoo returns raw USD; convert to $mm to match screener filter expectations
      marketCap: typeof q.marketCap === 'number' ? q.marketCap / 1e6 : null,
      pe: typeof q.forwardPE === 'number' ? q.forwardPE : (typeof q.trailingPE === 'number' ? q.trailingPE : null),
      beta: typeof q.beta === 'number' ? q.beta : null,
      primarySector: q.sector || '',
      primaryIndustry: q.industry || '',
    }))

    return res.status(200).json({ data })
  } catch (err) {
    console.warn('quote-batch error:', err.message)
    // Return empty rather than 500 — caller will just skip enrichment for this batch
    return res.status(200).json({ data: [] })
  }
}
