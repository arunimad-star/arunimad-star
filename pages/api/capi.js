import axios from 'axios'
import { yahooSummary } from './_yahoo-auth'

const getTickerSymbol = (ticker) => {
  if (!ticker) return ''
  const raw = String(ticker).trim()
  if (raw.includes(':')) {
    return raw.split(':').pop().trim()
  }
  return raw
}

const mapYahooQuote = (item) => ({
  exchangeTicker: (item.symbol || '').toUpperCase(),
  ticker: (item.symbol || '').toUpperCase(),
  name: item.shortName || item.longName || '',
  price: typeof item.regularMarketPrice === 'number' ? item.regularMarketPrice : null,
  week52Low: typeof item.fiftyTwoWeekLow === 'number' ? item.fiftyTwoWeekLow : null,
  week52High: typeof item.fiftyTwoWeekHigh === 'number' ? item.fiftyTwoWeekHigh : null,
  marketCap: typeof item.marketCap === 'number' ? item.marketCap : null
})

const parseYahooEarningsSummary = (result) => {
  if (!result) return {}
  const calendar = result.calendarEvents || {}
  const earnings = result.earnings || {}
  const financial = result.financialData || {}
  const trend = result.earningsTrend || {}
  const stats = result.defaultKeyStatistics || {}
  const profile = result.assetProfile || {}

  // Yahoo nests EPS history under earnings.earningsChart
  const earningsChart = earnings?.earningsChart || {}
  const quarterly = earningsChart?.quarterly || []
  const lastQ = quarterly[quarterly.length - 1] || {}

  const nextEarningsDate = earningsChart?.earningsDate?.[0]?.fmt
    || calendar?.earnings?.earningsDate?.[0]?.fmt
    || null
  const lastEarningsDate = lastQ?.date || null
  const estimate = lastQ?.estimate?.raw
  const actual = lastQ?.actual?.raw
  const surprise = typeof estimate === 'number' && typeof actual === 'number' && estimate !== 0
    ? ((actual - estimate) / Math.abs(estimate)) * 100
    : null
  const nextEpsEstimate = earningsChart?.currentQuarterEstimate?.raw
  const guidance = nextEpsEstimate != null
    ? `Est. EPS ${earningsChart?.currentQuarterEstimateDate || ''} $${nextEpsEstimate.toFixed(2)}`
    : trend?.trend?.[0]?.growth?.fmt || ''
  const beatMiss = surprise != null ? `${surprise >= 0 ? 'Beat' : 'Miss'} ${Math.abs(surprise).toFixed(2)}%` : ''

  const toMm = (v) => typeof v === 'number' ? v / 1e6 : null
  const toNum = (v) => typeof v === 'number' ? v : null

  return {
    earningsCadence: quarterly.length > 0 ? 'Quarterly' : '',
    lastEarningsDate,
    nextEarningsDate,
    guidance,
    earningsSurprise: surprise != null ? Number(surprise.toFixed(2)) : null,
    earningsBeatMiss: beatMiss,
    earningsEstimate: typeof estimate === 'number' ? estimate : null,
    earningsActual: typeof actual === 'number' ? actual : null,
    // Live financial metrics (converted from raw USD to $mm)
    totalRevenue: toMm(financial?.totalRevenue?.raw),
    grossProfit: toMm(financial?.grossProfits?.raw),
    ebitda: toMm(financial?.ebitda?.raw),
    netIncome: toMm(stats?.netIncomeToCommon?.raw),
    totalDebt: toMm(financial?.totalDebt?.raw),
    beta: toNum(stats?.beta?.raw),
    shortInterest: typeof stats?.shortPercentOfFloat?.raw === 'number' ? stats.shortPercentOfFloat.raw * 100 : null,
    pe: toNum(stats?.forwardPE?.raw),
    tev: toMm(stats?.enterpriseValue?.raw),
    tevLtmRev: toNum(stats?.enterpriseToRevenue?.raw),
    // Margin ratios as percentages
    grossMargin: typeof financial?.grossMargins?.raw === 'number' ? financial.grossMargins.raw * 100 : null,
    operatingMargin: typeof financial?.operatingMargins?.raw === 'number' ? financial.operatingMargins.raw * 100 : null,
    netMargin: typeof financial?.profitMargins?.raw === 'number' ? financial.profitMargins.raw * 100 : null,
    // Company profile — from assetProfile module
    primarySector: profile.sector || null,
    primaryIndustry: profile.industry || null,
    description: profile.longBusinessSummary || null,
  }
}

const MODULE_SETS = [
  'calendarEvents,earnings,earningsTrend,financialData,defaultKeyStatistics,assetProfile',
  'financialData,defaultKeyStatistics,calendarEvents,assetProfile',
  'financialData,defaultKeyStatistics,calendarEvents',
]

const fetchYahooSummary = async (ticker) => {
  for (const modules of MODULE_SETS) {
    try {
      const resp = await yahooSummary(ticker, modules)
      const result = resp?.data?.quoteSummary?.result?.[0]
      if (result) return parseYahooEarningsSummary(result)
    } catch (err) {
      if (modules === MODULE_SETS.at(-1)) {
        console.warn(`Yahoo summary fetch failed for ${ticker}:`, err.message)
      }
    }
  }
  return {
    earningsCadence: '',
    lastEarningsDate: null,
    nextEarningsDate: null,
    guidance: '',
    earningsSurprise: null,
    earningsBeatMiss: '',
    earningsEstimate: null,
    earningsActual: null,
    totalRevenue: null,
    grossProfit: null,
    ebitda: null,
    netIncome: null,
    totalDebt: null,
    beta: null,
    shortInterest: null,
    pe: null,
    tev: null,
    tevLtmRev: null,
    grossMargin: null,
    operatingMargin: null,
    netMargin: null,
    primarySector: null,
    primaryIndustry: null,
    description: null,
  }
}

export default async function handler(req, res) {
  const API_URL = process.env.CIQ_API_URL
  const API_KEY = process.env.CIQ_API_KEY
  const { tickers } = req.query

  if (!tickers || typeof tickers !== 'string') {
    return res.status(400).json({ error: 'Missing tickers query parameter' })
  }

  const tickerList = tickers
    .split(',')
    .map((item) => getTickerSymbol(item))
    .filter(Boolean)

  if (tickerList.length === 0) {
    return res.status(400).json({ error: 'No valid tickers provided' })
  }

  if (API_URL && API_KEY) {
    try {
      const url = new URL(API_URL)
      url.searchParams.set('tickers', tickerList.join(','))

      const upstream = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${API_KEY}`
        }
      })

      if (!upstream.ok) {
        const text = await upstream.text()
        return res.status(upstream.status).json({ error: 'Upstream error', details: text })
      }

      const json = await upstream.json()
      const rows = json.data || json.results || json
      const arr = Array.isArray(rows) ? rows : [rows]

      const mapped = arr.map((item) => ({
        exchangeTicker: item.exchangeTicker || item.ticker || item.symbol || '',
        ticker: item.ticker || item.symbol || item.id || '',
        name: item.name || item.companyName || '',
        price: Number(item.price || item.lastPrice || item.last_price || item.close || null) || null,
        week52Low:
          Number(item.week52Low || item['52wkLow'] || item.low52wk || item['52 Week Low'] || null) || null,
        week52High:
          Number(item.week52High || item['52wkHigh'] || item.high52wk || item['52 Week High'] || null) || null,
        marketCap:
          Number(item.marketCap || item.market_cap || item.marketCapMillions || null) || null
      }))

      return res.status(200).json({ source: 'capitaliq', data: mapped })
    } catch (err) {
      console.error('CIQ proxy error:', err)
      return res.status(500).json({ error: 'Request failed', message: err.message })
    }
  }

  // Try fetching per-ticker via Yahoo chart endpoint using axios (with User-Agent).
  // Batch the requests to avoid too many concurrent connections.
  const chunk = (arr, size) => {
    const out = []
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
    return out
  }

      const fetchChartForTicker = async (ticker) => {
    try {
      const url = `https://query1.finance.yahoo.com/v7/finance/chart/${encodeURIComponent(ticker)}`
      const resp = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 5000 })
      const result = resp?.data?.chart?.result?.[0]
      if (!result) return {
        exchangeTicker: ticker,
        ticker,
        price: null,
        week52Low: null,
        week52High: null,
        marketCap: null,
        history: null,
        earningsCadence: '',
        lastEarningsDate: null,
        nextEarningsDate: null,
        guidance: '',
        earningsSurprise: null,
        earningsBeatMiss: '',
        earningsEstimate: null,
        earningsActual: null
      }
      const meta = result.meta || {}
      const rawCloses = Array.isArray(result.indicators?.quote?.[0]?.close) ? result.indicators.quote[0].close : []
      const rawTs = Array.isArray(result.timestamp) ? result.timestamp : []
      // Keep timestamps aligned with closes (filter both together)
      const pairs = rawCloses.map((c, i) => [c, rawTs[i]]).filter(([c]) => typeof c === 'number')
      const closes = pairs.map(([c]) => c)
      const timestamps = pairs.map(([, t]) => t)
      const summary = await fetchYahooSummary(ticker)
      return {
        exchangeTicker: String(ticker).toUpperCase(),
        ticker: String(ticker).toUpperCase(),
        name: meta.shortName || meta.exchangeName || ticker,
        price: typeof meta.regularMarketPrice === 'number' ? meta.regularMarketPrice : null,
        week52Low: typeof meta.fiftyTwoWeekLow === 'number' ? meta.fiftyTwoWeekLow : null,
        week52High: typeof meta.fiftyTwoWeekHigh === 'number' ? meta.fiftyTwoWeekHigh : null,
        marketCap: typeof meta.marketCap === 'number' ? meta.marketCap : null,
        history: closes.length > 0 ? { timestamps, closes } : null,
        ...summary
      }
    } catch (err) {
      // If Yahoo blocks or errors, return nulls for this ticker
      console.warn(`chart fetch failed for ${ticker}:`, err.message)
      return { exchangeTicker: String(ticker).toUpperCase(), ticker: String(ticker).toUpperCase(), price: null, week52Low: null, week52High: null, marketCap: null }
    }
  }
  

  try {
    const batches = chunk(tickerList, 10)
    const results = []
    for (const batchTickers of batches) {
      // fetch batch in parallel
      const promises = batchTickers.map((t) => fetchChartForTicker(t))
      // await batch
      // eslint-disable-next-line no-await-in-loop
      const batchResults = await Promise.all(promises)
      results.push(...batchResults)
      // small delay to avoid hitting the remote endpoint too aggressively
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 25))
    }

    // If all results are null prices, fall back to randomized mock values so UI shows something
    const anyPrice = results.some((r) => typeof r.price === 'number' && r.price !== null)
    if (!anyPrice) {
      const mocked = results.map((r) => {
        const normalized = r.ticker.trim()
        const price = Math.round((Math.random() * 90 + 10) * 100) / 100
        const low = Math.round(price * 0.15 * 100) / 100
        const high = Math.round(price * 2.5 * 100) / 100
        return { ...r, price, week52Low: low, week52High: high, source: 'mock' }
      })
      return res.status(200).json({ source: 'mock', data: mocked })
    }

    return res.status(200).json({ source: 'yahoo-chart', data: results })
  } catch (err) {
    console.error('chart batch fetch error:', err)
    const mockQuotes = tickerList.map((ticker) => {
      const normalized = ticker.trim()
      const price = Math.round((Math.random() * 90 + 10) * 100) / 100
      const low = Math.round(price * 0.15 * 100) / 100
      const high = Math.round(price * 2.5 * 100) / 100
      return {
        exchangeTicker: normalized,
        ticker: normalized,
        price,
        week52Low: low,
        week52High: high,
        marketCap: null,
        source: 'mock'
      }
    })
    return res.status(200).json({ source: 'mock', data: mockQuotes })
  }
}
