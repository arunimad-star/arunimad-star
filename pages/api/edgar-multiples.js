import axios from 'axios'

const SEC = 'https://data.sec.gov'
const YF  = 'https://query1.finance.yahoo.com'
const HDR = { 'User-Agent': 'arunimad@berkeley.edu', Accept: 'application/json' }

const tickerCikCache = { data: null, ts: 0 }
const conceptCache = new Map()
const CACHE_TTL = 4 * 60 * 60 * 1000

async function getCik(ticker) {
  if (!tickerCikCache.data || Date.now() - tickerCikCache.ts > CACHE_TTL) {
    const r = await axios.get('https://www.sec.gov/files/company_tickers.json', { headers: HDR, timeout: 10000 })
    tickerCikCache.data = r.data
    tickerCikCache.ts = Date.now()
  }
  const entry = Object.values(tickerCikCache.data).find(e => e.ticker === ticker)
  return entry ? String(entry.cik_str).padStart(10, '0') : null
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

function annualValues(concept) {
  if (!concept) return {}
  const units = concept.units || {}
  const arr = units['USD/shares'] || units['USD'] || units['shares'] || []
  const cutoff = new Date(); cutoff.setFullYear(cutoff.getFullYear() - 5)
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

function buildPriceLookup(ts, closes) {
  const map = {}
  ts.forEach((t, i) => { if (typeof closes[i] === 'number') map[new Date(t * 1000).toISOString().slice(0, 10)] = closes[i] })
  return (dateStr) => {
    const target = new Date(dateStr).getTime()
    let best = null, bestDiff = Infinity
    for (const [d, p] of Object.entries(map)) {
      const diff = Math.abs(new Date(d).getTime() - target)
      if (diff < bestDiff) { bestDiff = diff; best = p }
    }
    return bestDiff <= 100 * 86400000 ? best : null
  }
}

function buildSeries(values) {
  if (!values.length) return null
  const n = values.length
  const avg = values.reduce((a, b) => a + b, 0) / n
  const stdDev = Math.sqrt(values.reduce((a, b) => a + (b - avg) ** 2, 0) / n)
  const current = values[n - 1]
  const zScore = stdDev > 0 ? (current - avg) / stdDev : 0
  return {
    avg: Math.round(avg * 100) / 100,
    stdDev: Math.round(stdDev * 100) / 100,
    current: Math.round(current * 100) / 100,
    vsHistory: zScore > 1 ? 'expensive' : zScore < -1 ? 'cheap' : 'fair',
    zScore: Math.round(zScore * 100) / 100,
  }
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

    const ALL_CONCEPTS = [
      'EarningsPerShareDiluted', 'NetIncomeLoss',
      ...REVENUE_CONCEPTS,
      'NetCashProvidedByUsedInOperatingActivities',
      'PaymentsToAcquirePropertyPlantAndEquipment',
    ]

    const [priceRes, ...conceptResults] = await Promise.all([
      axios.get(`${YF}/v7/finance/chart/${encodeURIComponent(ticker)}`, {
        params: { range: '10y', interval: '3mo' },
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 8000,
      }),
      ...ALL_CONCEPTS.map(c => getConcept(cik, c)),
    ])

    const cm = {}
    ALL_CONCEPTS.forEach((c, i) => { cm[c] = conceptResults[i] })

    const priceResult = priceRes?.data?.chart?.result?.[0]
    if (!priceResult) return res.status(200).json({ error: 'No price data' })
    const getPriceNear = buildPriceLookup(priceResult.timestamp || [], priceResult.indicators?.quote?.[0]?.close || [])

    const epsByDate    = annualValues(cm['EarningsPerShareDiluted'])
    const netIncByDate = annualValues(cm['NetIncomeLoss'])

    if (!Object.keys(epsByDate).length) return res.status(200).json({ error: `No annual EPS data for ${ticker}` })

    let revByDate = {}
    for (const c of REVENUE_CONCEPTS) { revByDate = annualValues(cm[c]); if (Object.keys(revByDate).length) break }
    const ocfByDate   = annualValues(cm['NetCashProvidedByUsedInOperatingActivities'])
    const capexByDate = annualValues(cm['PaymentsToAcquirePropertyPlantAndEquipment'])

    const peLabels = [], peVals = []
    const psLabels = [], psVals = []
    const ocfLabels = [], ocfVals = []
    const fcfLabels = [], fcfVals = []

    for (const date of [...new Set(Object.keys(epsByDate))].sort()) {
      const eps    = epsByDate[date]
      const netInc = netIncByDate[date]
      const price  = getPriceNear(date)
      if (!price || !eps) continue
      const yr = date.slice(0, 4)

      const shares = (netInc && eps !== 0) ? Math.abs(netInc / eps) : null
      const mktCap = shares ? price * shares : null

      if (eps > 0) { peLabels.push(yr); peVals.push(Math.round(price / eps * 100) / 100) }

      if (mktCap) {
        const rev   = revByDate[date]
        const ocf   = ocfByDate[date]
        const capex = capexByDate[date]
        if (rev   > 0) { psLabels.push(yr);  psVals.push(Math.round(mktCap / rev  * 100) / 100) }
        if (ocf   > 0) { ocfLabels.push(yr); ocfVals.push(Math.round(mktCap / ocf * 100) / 100) }
        if (ocf != null && capex != null) {
          const fcf = ocf - Math.abs(capex)
          if (fcf > 0) { fcfLabels.push(yr); fcfVals.push(Math.round(mktCap / fcf * 100) / 100) }
        }
      }
    }

    const filter = (vals, max = 500) => vals.filter(v => v > 0 && v < max)

    const metrics = {}
    if (peVals.length)  metrics.pe       = { labels: peLabels,  values: filter(peVals),  ...buildSeries(filter(peVals)),  label: 'P/E' }
    if (psVals.length)  metrics.ps       = { labels: psLabels,  values: filter(psVals),  ...buildSeries(filter(psVals)),  label: 'P/S' }
    if (ocfVals.length) metrics.evEbitda = { labels: ocfLabels, values: filter(ocfVals), ...buildSeries(filter(ocfVals)), label: 'P/OCF' }
    if (fcfVals.length) metrics.pfcf     = { labels: fcfLabels, values: filter(fcfVals), ...buildSeries(filter(fcfVals)), label: 'P/FCF' }

    if (!Object.keys(metrics).length) return res.status(200).json({ error: `No computable multiples for ${ticker}` })

    return res.status(200).json({ ticker: ticker.toUpperCase(), metrics })
  } catch (err) {
    console.error('edgar-multiples error:', err.message)
    return res.status(200).json({ error: err.message })
  }
}
