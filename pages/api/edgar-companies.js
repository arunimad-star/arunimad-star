const HDR = { 'User-Agent': 'arunimad@berkeley.edu', Accept: 'application/json' }
const CACHE_TTL = 24 * 60 * 60 * 1000 // 24h — EDGAR list changes infrequently

let _cache = null
let _cacheTs = 0

// Only include tickers that look like US common-stock tickers (1-5 uppercase letters, no dots/dashes).
// Filters out most ETFs, foreign ADRs, preferred shares, etc.
const isUsCommonStock = (ticker) => /^[A-Z]{1,5}$/.test(ticker)

export default async function handler(req, res) {
  if (_cache && Date.now() - _cacheTs < CACHE_TTL) {
    return res.status(200).json({ data: _cache })
  }

  try {
    // company_tickers_exchange.json is sorted approximately by market cap (descending),
    // so the first ~300 entries cover the largest companies across all sectors.
    // This ensures sector-seeding in the frontend hits meaningful companies first.
    const r = await fetch('https://www.sec.gov/files/company_tickers_exchange.json', {
      headers: HDR,
    })
    if (!r.ok) throw new Error(`EDGAR company_tickers_exchange.json returned HTTP ${r.status}`)
    const raw = await r.json()

    // raw.fields = ['cik', 'name', 'ticker', 'exchange'], raw.data = array of row arrays
    const fields = raw.fields || ['cik', 'name', 'ticker', 'exchange']
    const ciIdx     = fields.indexOf('cik')
    const nameIdx   = fields.indexOf('name')
    const tickerIdx = fields.indexOf('ticker')
    const exchIdx   = fields.indexOf('exchange')

    const companies = (raw.data || [])
      .filter(row => {
        if (!row[tickerIdx] || !isUsCommonStock(row[tickerIdx])) return false
        const ex = (row[exchIdx] || '').toLowerCase()
        return ex === 'nasdaq' || ex === 'nyse'
      })
      .map(row => ({
        id: row[tickerIdx],
        name: row[nameIdx],
        ticker: row[tickerIdx],
        exchangeTicker: row[tickerIdx],
        securityTickers: row[tickerIdx],
        cik: String(row[ciIdx]).padStart(10, '0'),
        exchange: exchIdx >= 0 ? (row[exchIdx] || '') : '',
        // All financial fields start null — FMP/Yahoo enriches them after initial load
        price: null,
        week52Low: null,
        week52High: null,
        marketCap: null,
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
        primarySector: '',
        primaryIndustry: '',
        description: '',
        earningsCadence: '',
        lastEarningsDate: null,
        nextEarningsDate: null,
        guidance: '',
        earningsSurprise: null,
        earningsBeatMiss: '',
      }))
    // Do NOT re-sort — preserve market-cap ordering from EDGAR so Phase 3
    // sector-seeding loads the most important companies first.

    _cache = companies
    _cacheTs = Date.now()
    res.setHeader('Cache-Control', 'public, max-age=86400')
    return res.status(200).json({ data: companies, total: companies.length })
  } catch (err) {
    console.error('edgar-companies error:', err.message)
    return res.status(500).json({ error: err.message })
  }
}
