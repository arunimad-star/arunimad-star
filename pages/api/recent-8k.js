import axios from 'axios'

const SEC = 'https://data.sec.gov'
const HDR = { 'User-Agent': 'arunimad@berkeley.edu', Accept: 'application/json' }
const CACHE_TTL = 2 * 60 * 60 * 1000
const cikCache = { data: null, ts: 0 }
const cache = new Map()

const ITEM_LABELS = {
  '1.01': 'Material Agreement',
  '1.02': 'Agreement Terminated',
  '1.05': 'Cybersecurity Incident',
  '2.01': 'Acquisition / Disposition',
  '2.02': 'Earnings Results',
  '2.03': 'New Financial Obligation',
  '2.05': 'Officer/Director Departure',
  '2.06': 'Material Impairment',
  '3.01': 'Delisting Notice',
  '4.01': 'Auditor Change',
  '4.02': 'Non-Reliance on Financials',
  '5.01': 'Change in Control',
  '5.02': 'Executive Change',
  '5.03': 'Bylaw/Charter Amendment',
  '5.07': 'Shareholder Vote',
  '5.08': 'Shareholder Rights Plan',
  '7.01': 'Regulation FD Disclosure',
  '8.01': 'Other Events',
  '9.01': 'Financial Statements / Exhibits',
}

async function getCik(ticker) {
  if (!cikCache.data || Date.now() - cikCache.ts > CACHE_TTL) {
    const r = await axios.get('https://www.sec.gov/files/company_tickers.json', { headers: HDR, timeout: 10000 })
    cikCache.data = r.data; cikCache.ts = Date.now()
  }
  const entry = Object.values(cikCache.data).find(e => e.ticker === ticker.toUpperCase())
  return entry ? String(entry.cik_str).padStart(10, '0') : null
}

function parseItems(itemsStr) {
  if (!itemsStr) return []
  return itemsStr.split(',').map(s => s.trim()).filter(Boolean).map(code => ({
    code,
    label: ITEM_LABELS[code] || `Item ${code}`,
  }))
}

export default async function handler(req, res) {
  const { ticker, limit = 5 } = req.query
  if (!ticker) return res.status(400).json({ error: 'Missing ticker' })

  const sym = ticker.toUpperCase()
  const hit = cache.get(sym)
  if (hit && Date.now() - hit.ts < CACHE_TTL) return res.status(200).json(hit.data)

  try {
    const cik = await getCik(sym)
    if (!cik) return res.status(200).json({ ticker: sym, filings: [] })

    const r = await axios.get(`${SEC}/submissions/CIK${cik}.json`, { headers: HDR, timeout: 10000 })
    const f = r.data?.filings?.recent
    if (!f) return res.status(200).json({ ticker: sym, filings: [] })

    const filings = []
    const n = parseInt(limit, 10)
    for (let i = 0; i < f.form.length && filings.length < n; i++) {
      if (f.form[i] !== '8-K') continue
      const items = parseItems(f.items?.[i] || '')
      // Skip 9.01-only filings (just exhibits) and 5.07 (routine votes)
      const meaningful = items.filter(it => !['9.01','5.07'].includes(it.code))
      filings.push({
        date: f.filingDate[i],
        accession: f.accessionNumber[i],
        items: meaningful.length ? meaningful : items,
        primaryDoc: f.primaryDocument[i],
        cikInt: parseInt(cik, 10),
      })
    }

    const data = { ticker: sym, filings }
    cache.set(sym, { data, ts: Date.now() })
    return res.status(200).json(data)
  } catch (err) {
    console.error('recent-8k error:', err.message)
    return res.status(200).json({ ticker: sym, filings: [] })
  }
}
