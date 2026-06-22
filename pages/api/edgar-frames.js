import axios from 'axios'

const HDR = { 'User-Agent': 'arunimad@berkeley.edu', Accept: 'application/json' }
const CACHE_TTL = 4 * 60 * 60 * 1000  // 4h

let cache = null
let cacheTs = 0

// Revenue uses two common XBRL tags — try both so AAPL/MSFT (ASC 606) and legacy companies all covered
const REVENUE_CONCEPTS = [
  'RevenueFromContractWithCustomerExcludingAssessedTax',
  'Revenues',
]
const OTHER_CONCEPTS = [
  'NetIncomeLoss',
  'GrossProfit',
  'OperatingIncomeLoss',
]
// CY2025 covers companies with fiscal year ending Jan–Dec 2025 (AAPL Sep, MSFT Jun, calendar-year Dec)
// CY2024 catches companies whose most recent annual ends in 2024
const PERIODS = ['CY2025', 'CY2024']

async function fetchFrame(concept, period) {
  try {
    const url = `https://data.sec.gov/api/xbrl/frames/us-gaap/${concept}/USD/${period}.json`
    const r = await axios.get(url, { headers: HDR, timeout: 30000 })
    return r.data?.data || []
  } catch { return [] }
}

export default async function handler(req, res) {
  if (cache && Date.now() - cacheTs < CACHE_TTL) {
    return res.status(200).json({ data: cache })
  }

  try {
    // 10 parallel requests (5 concepts × 2 periods) — vs 16 calls per company × 50 companies in old Phase 3
    const allConcepts = [...REVENUE_CONCEPTS, ...OTHER_CONCEPTS]
    const requests = allConcepts.flatMap(c => PERIODS.map(p => fetchFrame(c, p).then(rows => ({ concept: c, rows }))))
    const results = await Promise.all(requests)

    // Build per-concept map: CIK (int) → { val, end } keeping only most recent annual value
    const byConcept = {}
    for (const { concept, rows } of results) {
      if (!byConcept[concept]) byConcept[concept] = {}
      for (const row of rows) {
        const cik = row.cik
        const existing = byConcept[concept][cik]
        if (!existing || row.end > existing.end) {
          byConcept[concept][cik] = { val: row.val, end: row.end }
        }
      }
    }

    // Collect all CIKs that have at least one revenue value
    const revCiks = new Set([
      ...Object.keys(byConcept['RevenueFromContractWithCustomerExcludingAssessedTax'] || {}),
      ...Object.keys(byConcept['Revenues'] || {}),
    ].map(Number))

    const toMm = v => (v != null ? Math.round(v / 1e6) : null)
    const get = (concept, cik) => byConcept[concept]?.[cik]?.val ?? null

    const data = {}
    for (const cik of revCiks) {
      // Revenue: prefer ASC-606 concept, fall back to legacy Revenues
      const rev = get('RevenueFromContractWithCustomerExcludingAssessedTax', cik) ?? get('Revenues', cik)
      const ni  = get('NetIncomeLoss', cik)
      const gp  = get('GrossProfit', cik)
      const op  = get('OperatingIncomeLoss', cik)

      const revMm = toMm(rev)
      const niMm  = toMm(ni)
      const gpMm  = toMm(gp)

      if (revMm == null && niMm == null) continue  // skip companies with no useful P&L data

      data[cik] = {
        revenueMm:         revMm,
        netIncomeMm:       niMm,
        grossProfitMm:     gpMm,
        operatingIncomeMm: toMm(op),
        grossMargin:    gp != null && rev != null && rev > 0 ? Math.round(gp / rev * 1000) / 10 : null,
        operatingMargin: op != null && rev != null && rev > 0 ? Math.round(op / rev * 1000) / 10 : null,
        netMargin:      ni != null && rev != null && rev > 0 ? Math.round(ni / rev * 1000) / 10 : null,
      }
    }

    cache = data
    cacheTs = Date.now()
    res.setHeader('Cache-Control', 'public, max-age=3600')
    return res.status(200).json({ data })
  } catch (err) {
    console.error('edgar-frames error:', err.message)
    return res.status(500).json({ error: err.message })
  }
}
