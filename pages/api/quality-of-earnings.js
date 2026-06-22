const SEC = 'https://data.sec.gov'
const HDR = { 'User-Agent': 'arunimad@berkeley.edu', Accept: 'application/json' }
const CACHE_TTL = 6 * 60 * 60 * 1000

const cikCache = { data: null, ts: 0 }
const qoeCache = new Map()

async function getCik(ticker) {
  if (!cikCache.data || Date.now() - cikCache.ts > CACHE_TTL) {
    const r = await fetch('https://www.sec.gov/files/company_tickers.json', { headers: HDR })
    cikCache.data = await r.json()
    cikCache.ts = Date.now()
  }
  const entry = Object.values(cikCache.data).find(e => e.ticker === ticker.toUpperCase())
  return entry ? String(entry.cik_str).padStart(10, '0') : null
}

// Fetch annual XBRL income/cash-flow values (fiscal year periods: 330–410 days)
async function fetchAnnual(cik, concept, units = 'USD') {
  try {
    const r = await fetch(`${SEC}/api/xbrl/companyconcept/CIK${cik}/us-gaap/${concept}.json`, { headers: HDR })
    if (!r.ok) return []
    const data = await r.json()
    const arr = data.units?.[units] || []
    const byEnd = {}
    for (const item of arr) {
      if (!item.start || !item.end || item.val == null) continue
      const days = (new Date(item.end) - new Date(item.start)) / 86400000
      if (days < 330 || days > 410) continue
      if (!byEnd[item.end] || item.filed > byEnd[item.end].filed) byEnd[item.end] = item
    }
    return Object.entries(byEnd)
      .sort((a, b) => b[0].localeCompare(a[0]))
      .slice(0, 7)
      .map(([date, item]) => ({ date, val: item.val }))
  } catch { return [] }
}

// Fetch balance-sheet (instant/point-in-time) values — no duration filter
async function fetchInstant(cik, concept, units = 'USD') {
  try {
    const r = await fetch(`${SEC}/api/xbrl/companyconcept/CIK${cik}/us-gaap/${concept}.json`, { headers: HDR })
    if (!r.ok) return []
    const data = await r.json()
    const arr = data.units?.[units] || []
    const byEnd = {}
    for (const item of arr) {
      if (!item.end || item.val == null) continue
      // Instant items: start == end, or no start at all
      const days = item.start ? (new Date(item.end) - new Date(item.start)) / 86400000 : 0
      if (days > 10) continue
      if (!byEnd[item.end] || item.filed > byEnd[item.end].filed) byEnd[item.end] = item
    }
    return Object.entries(byEnd)
      .sort((a, b) => b[0].localeCompare(a[0]))
      .slice(0, 7)
      .map(([date, item]) => ({ date, val: item.val }))
  } catch { return [] }
}

function mean(arr) { return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null }
function trend(arr) {
  if (arr.length < 2) return 0
  // Simple slope: last vs first, normalized
  return (arr[arr.length - 1] - arr[0]) / (Math.abs(arr[0]) || 1)
}

function labelYear(dateStr) {
  // Return fiscal year label from period-end date
  const y = dateStr.slice(0, 4)
  return `FY${y}`
}

function generateConclusion(points) {
  if (!points.length) return null

  const recent = points.slice(0, 3) // most recent 3 years (sorted newest first)
  const oldest = points.slice(-3)

  const ccValues = recent.map(p => p.cashConversion).filter(v => v != null)
  const accValues = recent.map(p => p.accrualsRatio).filter(v => v != null)
  const fcfValues = recent.map(p => p.fcfMargin).filter(v => v != null)
  const niValues = recent.map(p => p.netMargin).filter(v => v != null)

  const avgCC = mean(ccValues)
  const avgAcc = mean(accValues)
  const avgFCF = mean(fcfValues)
  const avgNI = mean(niValues)

  // Trend: compare most recent year vs 3 years prior
  const ccTrend = points.length >= 2
    ? (points[0].cashConversion ?? 0) - (points[Math.min(points.length - 1, 3)].cashConversion ?? 0)
    : 0
  const fcfTrend = points.length >= 2
    ? (points[0].fcfMargin ?? 0) - (points[Math.min(points.length - 1, 3)].fcfMargin ?? 0)
    : 0

  // --- Verdict ---
  let verdict, quality
  if (avgCC == null && avgFCF == null) {
    return { verdict: 'Insufficient data', quality: 'neutral', text: 'Not enough EDGAR data to assess earnings quality.' }
  }

  const ccScore = avgCC != null ? (avgCC >= 1.2 ? 2 : avgCC >= 0.9 ? 1 : 0) : 1
  const accScore = avgAcc != null ? (avgAcc <= 0.01 ? 2 : avgAcc <= 0.04 ? 1 : 0) : 1
  const fcfScore = avgFCF != null ? (avgFCF >= 0.10 ? 2 : avgFCF >= 0.03 ? 1 : 0) : 1
  const total = ccScore + accScore + fcfScore

  if (total >= 5) { verdict = 'High'; quality = 'high' }
  else if (total >= 3) { verdict = 'Moderate'; quality = 'moderate' }
  else { verdict = 'Low'; quality = 'low' }

  // --- Sentence construction ---
  const sentences = []

  // Cash conversion sentence
  if (avgCC != null) {
    const dir = ccTrend > 0.1 ? 'improving' : ccTrend < -0.1 ? 'declining' : 'stable'
    if (avgCC >= 1.1) {
      sentences.push(`Cash conversion averages ${avgCC.toFixed(1)}x — earnings are well-backed by operating cash flow (${dir}).`)
    } else if (avgCC >= 0.85) {
      sentences.push(`Cash conversion averages ${avgCC.toFixed(1)}x, roughly in line with reported earnings, though with some accrual component (${dir}).`)
    } else {
      sentences.push(`Cash conversion averages only ${avgCC.toFixed(1)}x — reported earnings materially outpace actual cash generation (${dir}), a red flag for earnings quality.`)
    }
  }

  // Accruals sentence
  if (avgAcc != null) {
    if (avgAcc < -0.02) {
      sentences.push(`Cash earnings exceed reported earnings (accruals avg ${(avgAcc * 100).toFixed(1)}% of assets) — a hallmark of conservative accounting where cash outpaces paper profits.`)
    } else if (Math.abs(avgAcc) <= 0.02) {
      sentences.push(`Accruals are minimal (avg ${(avgAcc * 100).toFixed(1)}% of assets), suggesting earnings closely track real cash generation.`)
    } else if (avgAcc > 0.04) {
      sentences.push(`Elevated accruals (avg ${(avgAcc * 100).toFixed(1)}% of assets) indicate earnings include a meaningful non-cash component that may not persist.`)
    }
  }

  // FCF sentence
  if (avgFCF != null) {
    const fcfDir = fcfTrend > 0.02 ? 'expanding' : fcfTrend < -0.02 ? 'compressing' : 'stable'
    if (avgFCF >= 0.15) {
      sentences.push(`FCF margin is strong at ${(avgFCF * 100).toFixed(1)}% avg and ${fcfDir}, indicating durable cash generation.`)
    } else if (avgFCF >= 0.05) {
      sentences.push(`FCF margin of ${(avgFCF * 100).toFixed(1)}% avg is adequate and ${fcfDir}.`)
    } else if (avgFCF != null) {
      sentences.push(`FCF margin is thin at ${(avgFCF * 100).toFixed(1)}% avg and ${fcfDir} — limited cash left after capex.`)
    }
  }

  // NI vs FCF divergence warning
  if (avgFCF != null && avgNI != null && avgNI > 0) {
    const ratio = avgFCF / avgNI
    if (ratio < 0.5) {
      sentences.push(`Free cash flow consistently runs well below net income, suggesting aggressive revenue recognition or high capex intensity.`)
    } else if (ratio > 1.5) {
      sentences.push(`Free cash flow runs ahead of net income, a hallmark of conservative accounting.`)
    }
  }

  return { verdict, quality, text: sentences.join(' ') }
}

const REV_CONCEPTS = [
  'RevenueFromContractWithCustomerExcludingAssessedTax',
  'Revenues',
  'SalesRevenueNet',
]

export default async function handler(req, res) {
  const { ticker } = req.query
  if (!ticker) return res.status(400).json({ error: 'Missing ticker' })

  const sym = ticker.toUpperCase()
  const hit = qoeCache.get(sym)
  if (hit && Date.now() - hit.ts < CACHE_TTL) return res.status(200).json(hit.data)

  try {
    const cik = await getCik(sym)
    if (!cik) return res.status(200).json({ ticker: sym, points: [], conclusion: null })

    // Revenue: try each concept until one returns data
    let revData = []
    for (const c of REV_CONCEPTS) {
      revData = await fetchAnnual(cik, c)
      if (revData.length >= 2) break
    }

    // Fetch remaining concepts in parallel
    const [niData, ocfData, capexData, assetsData] = await Promise.all([
      fetchAnnual(cik, 'NetIncomeLoss'),
      fetchAnnual(cik, 'NetCashProvidedByUsedInOperatingActivities'),
      fetchAnnual(cik, 'PaymentsToAcquirePropertyPlantAndEquipment'),
      fetchInstant(cik, 'Assets'), // balance sheet: point-in-time, not a period
    ])

    // Build lookup maps by date
    const byDate = {}
    const addToMap = (arr, key) => arr.forEach(({ date, val }) => {
      if (!byDate[date]) byDate[date] = { date }
      byDate[date][key] = val
    })

    addToMap(revData, 'revenue')
    addToMap(niData, 'netIncome')
    addToMap(ocfData, 'ocf')
    addToMap(capexData, 'capex')
    addToMap(assetsData, 'assets')

    // Use revenue dates as spine; supplement with NI dates
    const allDates = new Set([
      ...revData.map(d => d.date),
      ...niData.map(d => d.date),
    ])

    const sorted = [...allDates].sort((a, b) => b.localeCompare(a)).slice(0, 6)

    const points = sorted.map(date => {
      const d = byDate[date] || { date }
      const rev = d.revenue ?? null
      const ni = d.netIncome ?? null
      const ocf = d.ocf ?? null
      const capex = d.capex != null ? Math.abs(d.capex) : null
      const assets = d.assets ?? null
      const fcf = ocf != null && capex != null ? ocf - capex : null

      const cashConversion = ocf != null && ni != null && ni !== 0 ? ocf / ni : null
      const accrualsRatio = ni != null && ocf != null && assets != null && assets !== 0
        ? (ni - ocf) / assets : null
      const fcfMargin = fcf != null && rev != null && rev !== 0 ? fcf / rev : null
      const netMargin = ni != null && rev != null && rev !== 0 ? ni / rev : null
      const ocfMargin = ocf != null && rev != null && rev !== 0 ? ocf / rev : null

      return {
        date,
        label: labelYear(date),
        revenue: rev,
        netIncome: ni,
        ocf,
        fcf,
        cashConversion: cashConversion != null ? Math.round(cashConversion * 100) / 100 : null,
        accrualsRatio: accrualsRatio != null ? Math.round(accrualsRatio * 1000) / 1000 : null,
        fcfMargin: fcfMargin != null ? Math.round(fcfMargin * 1000) / 1000 : null,
        netMargin: netMargin != null ? Math.round(netMargin * 1000) / 1000 : null,
        ocfMargin: ocfMargin != null ? Math.round(ocfMargin * 1000) / 1000 : null,
      }
    })

    const conclusion = generateConclusion(points)

    const data = { ticker: sym, points, conclusion }
    qoeCache.set(sym, { data, ts: Date.now() })
    return res.status(200).json(data)
  } catch (err) {
    console.error('quality-of-earnings error:', err.message)
    return res.status(200).json({ ticker: sym, points: [], conclusion: null, error: err.message })
  }
}
