import axios from 'axios'

const SEC  = 'https://data.sec.gov'
const HDR  = { 'User-Agent': 'arunimad@berkeley.edu', Accept: 'application/json' }
const CACHE_TTL = 4 * 60 * 60 * 1000

const cikCache     = { data: null, ts: 0 }
const conceptCache = new Map()
const subCache     = new Map()  // CIK → { sic, sicDescription }

// Map SIC code to approximate GICS-style sector name (matches FMP/Yahoo sector names).
function sicToSector(sic) {
  if (!sic) return null
  const n = Number(sic)
  if (n >= 100  && n <= 999)  return 'Consumer Defensive'
  if (n >= 1000 && n <= 1499) return 'Basic Materials'
  if (n >= 1500 && n <= 1799) return 'Industrials'
  if (n >= 2000 && n <= 2111) return 'Consumer Defensive'
  if (n >= 2112 && n <= 2199) return 'Consumer Defensive'
  if (n >= 2200 && n <= 2399) return 'Consumer Cyclical'
  if (n >= 2400 && n <= 2499) return 'Industrials'
  if (n >= 2500 && n <= 2599) return 'Consumer Cyclical'
  if (n >= 2600 && n <= 2699) return 'Basic Materials'
  if (n >= 2700 && n <= 2799) return 'Communication Services'
  if (n >= 2800 && n <= 2836) return 'Healthcare'
  if (n >= 2837 && n <= 2899) return 'Basic Materials'
  if (n >= 2900 && n <= 2999) return 'Energy'
  if (n >= 3000 && n <= 3299) return 'Industrials'
  if (n >= 3300 && n <= 3399) return 'Basic Materials'
  if (n >= 3400 && n <= 3499) return 'Industrials'
  if (n >= 3500 && n <= 3569) return 'Industrials'
  if (n >= 3570 && n <= 3579) return 'Technology'
  if (n >= 3580 && n <= 3599) return 'Industrials'
  if (n >= 3600 && n <= 3679) return 'Technology'
  if (n >= 3680 && n <= 3699) return 'Technology'
  if (n >= 3700 && n <= 3716) return 'Consumer Cyclical'
  if (n >= 3717 && n <= 3799) return 'Industrials'
  if (n >= 3800 && n <= 3899) return 'Industrials'
  if (n >= 3900 && n <= 3999) return 'Consumer Cyclical'
  if (n >= 4000 && n <= 4599) return 'Industrials'
  if (n >= 4600 && n <= 4699) return 'Energy'
  if (n >= 4800 && n <= 4899) return 'Communication Services'
  if (n >= 4900 && n <= 4991) return 'Utilities'
  if (n >= 5000 && n <= 5199) return 'Industrials'
  if (n >= 5200 && n <= 5399) return 'Consumer Cyclical'
  if (n >= 5400 && n <= 5499) return 'Consumer Defensive'
  if (n >= 5500 && n <= 5999) return 'Consumer Cyclical'
  if (n >= 6000 && n <= 6199) return 'Financial Services'
  if (n >= 6200 && n <= 6411) return 'Financial Services'
  if (n >= 6500 && n <= 6552) return 'Real Estate'
  if (n >= 6700 && n <= 6799) return 'Financial Services'
  if (n >= 7000 && n <= 7099) return 'Consumer Cyclical'
  if (n >= 7200 && n <= 7299) return 'Consumer Cyclical'
  if (n >= 7300 && n <= 7369) return 'Industrials'
  if (n >= 7370 && n <= 7379) return 'Technology'
  if (n >= 7380 && n <= 7389) return 'Industrials'
  if (n >= 7500 && n <= 7699) return 'Consumer Cyclical'
  if (n >= 7800 && n <= 7899) return 'Communication Services'
  if (n >= 7900 && n <= 7999) return 'Consumer Cyclical'
  if (n >= 8000 && n <= 8099) return 'Healthcare'
  if (n >= 8100 && n <= 8742) return 'Industrials'
  if (n >= 8900 && n <= 8999) return 'Industrials'
  return null
}

async function getCik(ticker) {
  if (!cikCache.data || Date.now() - cikCache.ts > CACHE_TTL) {
    const r = await axios.get('https://www.sec.gov/files/company_tickers.json', { headers: HDR, timeout: 10000 })
    cikCache.data = r.data
    cikCache.ts = Date.now()
  }
  const entry = Object.values(cikCache.data).find(e => e.ticker === ticker.toUpperCase())
  return entry ? String(entry.cik_str).padStart(10, '0') : null
}

async function getSubmissionsMeta(cik) {
  const hit = subCache.get(cik)
  if (hit && Date.now() - hit.ts < CACHE_TTL) return hit
  try {
    const r = await axios.get(`https://data.sec.gov/submissions/CIK${cik}.json`, { headers: HDR, timeout: 6000 })
    const sector = sicToSector(r.data?.sic) || null
    const filings = r.data?.filings?.recent || {}
    const forms = filings.form || []
    const accs  = filings.accessionNumber || []
    const dates = filings.reportDate || []
    let accession = null, fyEnd = null
    for (let i = 0; i < forms.length; i++) {
      if (forms[i] === '10-K') { accession = accs[i]; fyEnd = dates[i] || null; break }
    }
    const result = { sector, accession, fyEnd, ts: Date.now() }
    subCache.set(cik, result)
    return result
  } catch { return { sector: null, accession: null, fyEnd: null, ts: Date.now() } }
}

// Pick the value from a specific 10-K filing by accession number.
// Falls back to null if the concept wasn't tagged in that filing.
function latestForAccn(concept, accn) {
  if (!concept || !accn) return null
  const units = concept.units || {}
  const arr = units['USD'] || units['USD/shares'] || units['shares'] || []
  const items = arr.filter(item => item.form === '10-K' && item.accn === accn && item.val != null)
  if (!items.length) return null
  items.sort((a, b) => b.end.localeCompare(a.end))
  return items[0].val
}

async function getConcept(cik, concept) {
  const key = `${cik}_${concept}`
  const hit = conceptCache.get(key)
  if (hit && Date.now() - hit.ts < CACHE_TTL) return hit.data
  try {
    const r = await axios.get(`${SEC}/api/xbrl/companyconcept/CIK${cik}/us-gaap/${concept}.json`, { headers: HDR, timeout: 10000 })
    conceptCache.set(key, { data: r.data, ts: Date.now() })
    return r.data
  } catch { return null }
}

// Pick most recent 10-K value per fiscal year end, up to N years
function annualSeries(concept, nYears = 6) {
  if (!concept) return {}
  const units = concept.units || {}
  const arr = units['USD/shares'] || units['USD'] || units['shares'] || []
  const cutoff = new Date(); cutoff.setFullYear(cutoff.getFullYear() - nYears)
  const byYear = {}
  for (const item of arr) {
    if (item.form !== '10-K' || !item.end || item.val == null) continue
    if (new Date(item.filed) < cutoff) continue
    const yr = item.end.slice(0, 4)
    if (!byYear[yr] || item.filed > byYear[yr].filed) byYear[yr] = item
  }
  const result = {}
  for (const item of Object.values(byYear)) result[item.end] = item.val
  return result
}

function latest(series) {
  const dates = Object.keys(series).sort()
  return dates.length ? series[dates[dates.length - 1]] : null
}

function prevYear(series) {
  const dates = Object.keys(series).sort()
  return dates.length >= 2 ? series[dates[dates.length - 2]] : null
}

function yoyGrowth(curr, prev) {
  if (curr == null || prev == null || prev === 0) return null
  return Math.round((curr / prev - 1) * 1000) / 10  // one decimal %
}

function fmtM(v) {
  if (v == null) return null
  if (Math.abs(v) >= 1e12) return `$${(v / 1e12).toFixed(2)}T`
  if (Math.abs(v) >= 1e9)  return `$${(v / 1e9).toFixed(2)}B`
  if (Math.abs(v) >= 1e6)  return `$${(v / 1e6).toFixed(0)}M`
  return `$${v.toLocaleString()}`
}

const REVENUE_CONCEPTS = [
  'RevenueFromContractWithCustomerExcludingAssessedTax',
  'Revenues', 'SalesRevenueNet', 'SalesRevenueGoodsNet',
]

export default async function handler(req, res) {
  const { ticker } = req.query
  if (!ticker) return res.status(400).json({ error: 'Missing ticker' })

  try {
    const cik = await getCik(ticker.toUpperCase())
    if (!cik) return res.status(200).json({ error: `No SEC filing found for ${ticker}` })

    const FETCH_CONCEPTS = [
      'NetIncomeLoss',
      'OperatingIncomeLoss',
      'GrossProfit',
      'DepreciationDepletionAndAmortization',
      'Assets',
      'AssetsCurrent',
      'LiabilitiesCurrent',
      'StockholdersEquity',
      'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest',
      'LongTermDebt',
      'LongTermDebtNoncurrent',
      'CashAndCashEquivalentsAtCarryingValue',
      'CashCashEquivalentsAndShortTermInvestments',
      ...REVENUE_CONCEPTS,
    ]

    // Fetch submissions metadata and all XBRL concepts in parallel
    const [submMeta, ...results] = await Promise.all([
      getSubmissionsMeta(cik),
      ...FETCH_CONCEPTS.map(c => getConcept(cik, c)),
    ])
    const primarySector = submMeta.sector
    const targetAccn    = submMeta.accession  // most recent 10-K accession number
    const fyEnd         = submMeta.fyEnd      // fiscal year end date, e.g. "2025-09-27"
    const cm = {}
    FETCH_CONCEPTS.forEach((c, i) => { cm[c] = results[i] })

    // Revenue — try pinned accession first, fall back to latest annual series
    let rev = null
    for (const c of REVENUE_CONCEPTS) {
      rev = latestForAccn(cm[c], targetAccn)
      if (rev != null) break
    }
    if (rev == null) {
      let revSeries = {}
      for (const c of REVENUE_CONCEPTS) {
        revSeries = annualSeries(cm[c])
        if (Object.keys(revSeries).length >= 1) break
      }
      rev = latest(revSeries)
    }

    // P&L snapshot — pinned to most recent 10-K filing, fallback to latest annual
    const pin = (concept) => latestForAccn(cm[concept], targetAccn) ?? latest(annualSeries(cm[concept]))

    const netInc = pin('NetIncomeLoss')
    const opInc  = pin('OperatingIncomeLoss')
    const gp     = pin('GrossProfit')
    const da     = pin('DepreciationDepletionAndAmortization')
    const assets = pin('Assets')
    const curAs  = pin('AssetsCurrent')
    const curLib = pin('LiabilitiesCurrent')

    let equity = pin('StockholdersEquity')
    if (equity == null) equity = pin('StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest')

    let cash = pin('CashAndCashEquivalentsAtCarryingValue')
    if (cash == null) cash = pin('CashCashEquivalentsAndShortTermInvestments')

    let debt = pin('LongTermDebt')
    if (debt == null) debt = pin('LongTermDebtNoncurrent')

    // Revenue prior year still uses annual series for YoY growth
    const revSeries = (() => {
      let s = {}
      for (const c of REVENUE_CONCEPTS) { s = annualSeries(cm[c]); if (Object.keys(s).length >= 2) break }
      return s
    })()
    const revPrev = prevYear(revSeries)

    // Computed metrics
    const ebitda      = opInc != null && da != null ? opInc + da : null
    const netDebt     = debt != null && cash != null ? debt - cash : null
    const currentRatio = curAs != null && curLib != null && curLib > 0 ? Math.round(curAs / curLib * 100) / 100 : null
    const dToE        = debt != null && equity != null && equity > 0 ? Math.round(debt / equity * 100) / 100 : null
    const roe         = netInc != null && equity != null && equity > 0 ? Math.round(netInc / equity * 1000) / 10 : null
    const roa         = netInc != null && assets != null && assets > 0 ? Math.round(netInc / assets * 1000) / 10 : null
    const grossMargin = gp != null && rev != null && rev > 0 ? Math.round(gp / rev * 1000) / 10 : null
    const opMargin    = opInc != null && rev != null && rev > 0 ? Math.round(opInc / rev * 1000) / 10 : null
    const ebitdaMargin = ebitda != null && rev != null && rev > 0 ? Math.round(ebitda / rev * 1000) / 10 : null
    const netMargin   = netInc != null && rev != null && rev > 0 ? Math.round(netInc / rev * 1000) / 10 : null
    const revGrowth   = yoyGrowth(rev, revPrev)

    // Annual series for 5-year trend sparklines
    const netIncSeries = annualSeries(cm['NetIncomeLoss'])
    const opIncSeries  = annualSeries(cm['OperatingIncomeLoss'])
    const daSeries     = annualSeries(cm['DepreciationDepletionAndAmortization'])

    // 5-year trend series (for sparklines) — use last 5 dates
    function trendSeries(series) {
      const dates = Object.keys(series).sort().slice(-5)
      return { labels: dates.map(d => d.slice(0, 4)), values: dates.map(d => series[d]) }
    }

    const toMm = v => v != null ? Math.round(v / 1e6) : null
    // Fiscal year label, e.g. "FY2025"
    const fyLabel = fyEnd ? `FY${fyEnd.slice(0, 4)}` : null

    return res.status(200).json({
      ticker: ticker.toUpperCase(),
      primarySector,
      fyEnd,    // fiscal year end date, e.g. "2025-09-27"
      fyLabel,  // e.g. "FY2025"
      snapshot: {
        revenue:      fmtM(rev),
        revGrowth,                              // % YoY
        grossMargin,                            // %
        opMargin,                               // %
        ebitdaMargin,                           // %
        netMargin,                              // %
        ebitda:       fmtM(ebitda),
        cash:         fmtM(cash),
        netDebt:      fmtM(netDebt),
        totalAssets:  fmtM(assets),
        equity:       fmtM(equity),
        ltDebt:       fmtM(debt),
        currentRatio,
        debtToEquity: dToE,
        roe,                                    // %
        roa,                                    // %
        // Raw $mm values for screener row merging
        revenueMm:    toMm(rev),
        grossProfitMm: toMm(gp),
        ebitdaMm:     toMm(ebitda),
        netIncomeMm:  toMm(netInc),
        totalDebtMm:  toMm(debt),
      },
      trends: {
        revenue:   trendSeries(revSeries),
        netIncome: trendSeries(netIncSeries),
        ebitda:    (() => {
          const dates = Object.keys(opIncSeries).filter(d => daSeries[d] != null).sort().slice(-5)
          return { labels: dates.map(d => d.slice(0, 4)), values: dates.map(d => opIncSeries[d] + daSeries[d]) }
        })(),
      },
    })
  } catch (err) {
    console.error('edgar-financials error:', err.message)
    return res.status(200).json({ error: err.message })
  }
}
