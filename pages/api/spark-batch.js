import axios from 'axios'

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const CONCURRENCY = 12

const fetchChart = async (symbol) => {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=1y&interval=1mo`
    const r = await axios.get(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      timeout: 8000,
    })
    const result = r.data?.chart?.result?.[0]
    if (!result) return { ticker: symbol, exchangeTicker: symbol, history: null }

    const meta = result.meta || {}
    const rawTs = Array.isArray(result.timestamp) ? result.timestamp : []
    const rawCloses = result.indicators?.quote?.[0]?.close || []

    const pairs = rawCloses
      .map((c, i) => [c, rawTs[i]])
      .filter(([c]) => typeof c === 'number')

    return {
      ticker: symbol,
      exchangeTicker: symbol,
      price: typeof meta.regularMarketPrice === 'number' ? meta.regularMarketPrice : null,
      week52Low: typeof meta.fiftyTwoWeekLow === 'number' ? meta.fiftyTwoWeekLow : null,
      week52High: typeof meta.fiftyTwoWeekHigh === 'number' ? meta.fiftyTwoWeekHigh : null,
      history: pairs.length >= 2 ? { timestamps: pairs.map(([, t]) => t), closes: pairs.map(([c]) => c) } : null,
    }
  } catch {
    return { ticker: symbol, exchangeTicker: symbol, history: null }
  }
}

export default async function handler(req, res) {
  const { tickers } = req.query
  if (!tickers || typeof tickers !== 'string') {
    return res.status(400).json({ error: 'Missing tickers' })
  }

  const tickerList = tickers.split(',').map(t => t.trim()).filter(Boolean).slice(0, 100)
  if (tickerList.length === 0) return res.status(400).json({ error: 'No valid tickers' })

  const results = []
  for (let i = 0; i < tickerList.length; i += CONCURRENCY) {
    const batch = tickerList.slice(i, i + CONCURRENCY)
    const batchResults = await Promise.all(batch.map(fetchChart))
    results.push(...batchResults)
  }

  return res.status(200).json({ data: results })
}
