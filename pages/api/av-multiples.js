import axios from 'axios'

const AV = 'https://www.alphavantage.co/query'
const HDR = { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' }

// Simple in-process cache to avoid burning the 25/day AV free limit on repeats
const cache = new Map()
const CACHE_TTL = 60 * 60 * 1000 // 1 hour

const avGet = (params) => axios.get(AV, { params: { ...params }, headers: HDR, timeout: 12000 })

const cached = async (key, fn) => {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.ts < CACHE_TTL) return hit.data
  const data = await fn()
  cache.set(key, { data, ts: Date.now() })
  return data
}

export default async function handler(req, res) {
  const { ticker, metric = 'pe' } = req.query
  const key = process.env.AV_API_KEY
  if (!ticker) return res.status(400).json({ error: 'Missing ticker' })
  if (!key)    return res.status(500).json({ error: 'AV_API_KEY not set in .env.local' })

  const sym = ticker.toUpperCase()

  try {
    // Fetch INCOME_STATEMENT, EARNINGS, and (if P/FCF) CASH_FLOW in parallel
    const fetches = [
      cached(`IS_${sym}`, () => avGet({ function: 'INCOME_STATEMENT', symbol: sym, apikey: key }).then(r => r.data)),
      cached(`EAR_${sym}`, () => avGet({ function: 'EARNINGS', symbol: sym, apikey: key }).then(r => r.data)),
    ]
    if (metric === 'pfcf') {
      fetches.push(cached(`CF_${sym}`, () => avGet({ function: 'CASH_FLOW', symbol: sym, apikey: key }).then(r => r.data)))
    }
    // Monthly adjusted price series (needed for year-end prices)
    fetches.push(cached(`PR_${sym}`, () => avGet({ function: 'TIME_SERIES_MONTHLY_ADJUSTED', symbol: sym, apikey: key }).then(r => r.data)))

    const results = await Promise.all(fetches)
    const isData  = results[0]
    const earData = results[1]
    const cfData  = metric === 'pfcf' ? results[2] : null
    const prData  = results[metric === 'pfcf' ? 3 : 2]

    // AV rate-limit / error responses
    const note = isData?.Note || isData?.Information || earData?.Note || earData?.Information
    if (note) return res.status(200).json({ error: note })

    const annualIS  = isData?.annualReports   || []
    const annualEPS = earData?.annualEarnings  || []

    if (!annualIS.length) return res.status(200).json({ error: 'No income statement data' })

    // Build EPS lookup by fiscal year end date
    const epsByDate = {}
    annualEPS.forEach(r => { epsByDate[r.fiscalDateEnding] = Number(r.reportedEPS) })

    // Build cash-flow lookup
    const cfByDate = {}
    if (cfData) {
      ;(cfData.annualReports || []).forEach(r => {
        const ocf  = Number(r.operatingCashflow)
        const capex = Math.abs(Number(r.capitalExpenditures))
        if (!isNaN(ocf) && !isNaN(capex)) cfByDate[r.fiscalDateEnding] = ocf - capex
      })
    }

    // Build price lookup from monthly series: date string → close
    const monthly = prData?.['Monthly Adjusted Time Series'] || {}
    const getPriceNear = (dateStr) => {
      const target = new Date(dateStr).getTime()
      let best = null, bestDiff = Infinity
      for (const [d, vals] of Object.entries(monthly)) {
        const diff = Math.abs(new Date(d).getTime() - target)
        if (diff < bestDiff) { bestDiff = diff; best = Number(vals['5. adjusted close']) }
      }
      return best
    }

    const dataPoints = []
    for (const r of annualIS.slice(0, 10)) {
      const date   = r.fiscalDateEnding
      const price  = getPriceNear(date)
      if (!price) continue

      const eps    = epsByDate[date]
      const netInc = Number(r.netIncome)
      const rev    = Number(r.totalRevenue)
      const ebitda = Number(r.ebitda)

      // Derive approximate shares from netIncome / EPS to get market cap
      const shares = (eps && eps !== 0 && netInc) ? Math.abs(netInc / eps) : null
      const mktCap = shares ? price * shares : null

      let value = null
      if (metric === 'pe'       && eps   > 0)              value = price / eps
      if (metric === 'ps'       && mktCap && rev    > 0)   value = mktCap / rev
      if (metric === 'evEbitda' && mktCap && ebitda > 0)   value = mktCap / ebitda
      if (metric === 'pfcf') {
        const fcf = cfByDate[date]
        if (mktCap && fcf != null && fcf > 0) value = mktCap / fcf
      }

      if (value != null && value > 0 && value < 1000) {
        dataPoints.push({ year: date.slice(0, 4), value: Math.round(value * 100) / 100 })
      }
    }

    dataPoints.reverse() // oldest first

    if (!dataPoints.length) return res.status(200).json({ error: `No computable ${metric} history for ${sym}` })

    const labels = dataPoints.map(d => d.year)
    const values = dataPoints.map(d => d.value)
    const n = values.length
    const avg = values.reduce((a, b) => a + b, 0) / n
    const stdDev = Math.sqrt(values.reduce((a, b) => a + (b - avg) ** 2, 0) / n)
    const current = values[n - 1]
    const zScore = stdDev > 0 ? (current - avg) / stdDev : 0
    const vsHistory = zScore > 1 ? 'expensive' : zScore < -1 ? 'cheap' : 'fair'

    return res.status(200).json({
      ticker: sym, metric, labels, values,
      avg: Math.round(avg * 100) / 100,
      stdDev: Math.round(stdDev * 100) / 100,
      current: Math.round(current * 100) / 100,
      vsHistory,
      zScore: Math.round(zScore * 100) / 100,
      earningsDates: [],
    })
  } catch (err) {
    console.error('av-multiples error:', err.message)
    return res.status(200).json({ error: err.message })
  }
}
