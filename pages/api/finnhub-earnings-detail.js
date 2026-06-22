const SEC = 'https://data.sec.gov'
const HDR = { 'User-Agent': 'arunimad@berkeley.edu', Accept: 'application/json' }
const FINNHUB_KEY = process.env.FINNHUB_API_KEY

const cikCache   = { data: null, ts: 0 }
const xbrlCache  = new Map()
const CACHE_TTL  = 2 * 60 * 60 * 1000

async function getCik(ticker) {
  if (!cikCache.data || Date.now() - cikCache.ts > CACHE_TTL) {
    const r = await fetch('https://www.sec.gov/files/company_tickers.json', { headers: HDR })
    cikCache.data = await r.json()
    cikCache.ts = Date.now()
  }
  const entry = Object.values(cikCache.data).find(e => e.ticker === ticker.toUpperCase())
  return entry ? String(entry.cik_str).padStart(10, '0') : null
}

async function fetchQuarterlyConcept(cik, concept) {
  const r = await fetch(`${SEC}/api/xbrl/companyconcept/CIK${cik}/us-gaap/${concept}.json`, { headers: HDR })
  if (!r.ok) return {}
  const data = await r.json()
  const arr = data.units?.USD || []
  const byPeriod = {}
  for (const item of arr) {
    if (!item.start || !item.end || item.val == null) continue
    const days = (new Date(item.end) - new Date(item.start)) / 86400000
    if (days < 55 || days > 105) continue
    if (!byPeriod[item.end] || item.filed > byPeriod[item.end].filed) byPeriod[item.end] = item
  }
  const result = {}
  for (const [date, item] of Object.entries(byPeriod)) result[date] = item.val
  return result
}

async function fetchQuarterlyEPS(cik, concept) {
  const r = await fetch(`${SEC}/api/xbrl/companyconcept/CIK${cik}/us-gaap/${concept}.json`, { headers: HDR })
  if (!r.ok) return {}
  const data = await r.json()
  const arr = data.units?.['USD/shares'] || []
  const byPeriod = {}
  for (const item of arr) {
    if (!item.start || !item.end || item.val == null) continue
    const days = (new Date(item.end) - new Date(item.start)) / 86400000
    if (days < 55 || days > 105) continue
    if (!byPeriod[item.end] || item.filed > byPeriod[item.end].filed) byPeriod[item.end] = item
  }
  const result = {}
  for (const [date, item] of Object.entries(byPeriod)) result[date] = item.val
  return result
}

async function fetchFinnhubEarnings(ticker) {
  if (!FINNHUB_KEY) return []
  try {
    const r = await fetch(
      `https://finnhub.io/api/v1/stock/earnings?symbol=${ticker}&token=${FINNHUB_KEY}`,
      { headers: { 'Content-Type': 'application/json' } }
    )
    const data = await r.json()
    return Array.isArray(data) ? data : []
  } catch { return [] }
}

function fmtRev(v) {
  if (v == null) return null
  const a = Math.abs(v)
  return a >= 1e12 ? `$${(v / 1e12).toFixed(2)}T`
    : a >= 1e9  ? `$${(v / 1e9).toFixed(2)}B`
    : a >= 1e6  ? `$${(v / 1e6).toFixed(0)}M`
    : `$${v.toLocaleString()}`
}

function periodToQuarter(dateStr) {
  const [year, month] = dateStr.split('-').map(Number)
  const q = Math.ceil(month / 3)
  return `Q${q} ${year}`
}

// Match an EDGAR period-end date to a Finnhub entry by fiscal year+quarter
function matchFinnhub(dateStr, finnhubList) {
  const [year, month] = dateStr.split('-').map(Number)
  const q = Math.ceil(month / 3)
  // Try exact date first
  const exact = finnhubList.find(e => e.period === dateStr)
  if (exact) return exact
  // Fall back to same year+quarter (fiscal calendars often offset calendar months)
  return finnhubList.find(e => {
    if (!e.period) return false
    const [fy, fm] = e.period.split('-').map(Number)
    return fy === year && Math.ceil(fm / 3) === q
  }) || null
}

const REV_CONCEPTS = [
  'RevenueFromContractWithCustomerExcludingAssessedTax',
  'Revenues',
  'SalesRevenueNet',
  'SalesRevenueGoodsNet',
]

export default async function handler(req, res) {
  const { ticker } = req.query
  if (!ticker) return res.status(400).json({ error: 'Missing ticker' })

  const sym = ticker.toUpperCase()
  const hit = xbrlCache.get(sym)
  if (hit && Date.now() - hit.ts < CACHE_TTL) return res.status(200).json(hit.data)

  try {
    const cik = await getCik(sym)
    if (!cik) return res.status(200).json({ ticker: sym, history: [], lastEarningsDate: null, nextEarningsDate: null, guidance: '' })

    // Fetch EDGAR data and Finnhub estimates in parallel
    let revMap = {}
    const revFetch = (async () => {
      for (const concept of REV_CONCEPTS) {
        revMap = await fetchQuarterlyConcept(cik, concept)
        if (Object.keys(revMap).length >= 2) break
      }
    })()

    const [, [niMap, epsMap], finnhubList] = await Promise.all([
      revFetch,
      Promise.all([
        fetchQuarterlyConcept(cik, 'NetIncomeLoss'),
        fetchQuarterlyEPS(cik, 'EarningsPerShareDiluted'),
      ]),
      fetchFinnhubEarnings(sym),
    ])

    const allDates = new Set([...Object.keys(revMap), ...Object.keys(niMap)])
    const sorted = [...allDates].sort((a, b) => b.localeCompare(a)).slice(0, 8)

    const history = sorted.map(date => {
      const rev = revMap[date] ?? null
      const ni  = niMap[date]  ?? null
      const eps = epsMap[date] ?? null

      const fh = matchFinnhub(date, finnhubList)
      const epsEstimate = fh?.estimate ?? null
      const surprise    = fh?.surprise ?? null
      const surprisePct = fh?.surprisePercent ?? null
      const beatMiss    = surprise != null ? (surprise >= 0 ? 'beat' : 'miss') : null

      return {
        period:      date,
        quarter:     periodToQuarter(date),
        revenue:     fmtRev(rev),
        netIncome:   fmtRev(ni),
        eps:         eps != null ? Number(eps.toFixed(2)) : null,
        epsEstimate: epsEstimate != null ? Number(epsEstimate.toFixed(2)) : null,
        surprise:    surprise != null ? Number(surprise.toFixed(2)) : null,
        surprisePct: surprisePct != null ? Number(surprisePct.toFixed(1)) : null,
        beatMiss,
      }
    })

    // Consecutive beat/miss streak (most recent first)
    let streak = null
    const withBeat = history.filter(q => q.beatMiss)
    if (withBeat.length > 0) {
      const dir = withBeat[0].beatMiss
      streak = 0
      for (const q of withBeat) {
        if (q.beatMiss === dir) streak++
        else break
      }
      streak = { count: streak, dir }
    }

    const lastEarningsDate = sorted[0] || null

    const data = {
      ticker: sym,
      lastEarningsDate,
      nextEarningsDate: null,
      guidance: '',
      history,
      streak,
    }

    xbrlCache.set(sym, { data, ts: Date.now() })
    return res.status(200).json(data)
  } catch (err) {
    console.error('edgar-earnings error:', err)
    return res.status(500).json({ error: err.message })
  }
}
