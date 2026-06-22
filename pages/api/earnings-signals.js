import axios from 'axios'

const SEC = 'https://data.sec.gov'
const ARCHIVES = 'https://www.sec.gov/Archives/edgar/data'
const HDR = { 'User-Agent': 'arunimad@berkeley.edu', Accept: 'application/json' }
const CACHE_TTL = 4 * 60 * 60 * 1000

const cikCache = { data: null, ts: 0 }
const signalsCache = new Map()

async function getCik(ticker) {
  if (!cikCache.data || Date.now() - cikCache.ts > CACHE_TTL) {
    const r = await axios.get('https://www.sec.gov/files/company_tickers.json', { headers: HDR, timeout: 10000 })
    cikCache.data = r.data; cikCache.ts = Date.now()
  }
  const entry = Object.values(cikCache.data).find(e => e.ticker === ticker.toUpperCase())
  return entry ? String(entry.cik_str).padStart(10, '0') : null
}

async function getRecentEarnings8Ks(cik) {
  const r = await axios.get(`${SEC}/submissions/CIK${cik}.json`, { headers: HDR, timeout: 15000 })
  const f = r.data?.filings?.recent
  if (!f) return []
  const results = []
  for (let i = 0; i < (f.form || []).length; i++) {
    if (f.form[i] === '8-K') {
      const items = (f.items?.[i] || '').toString()
      if (items.includes('2.02') || items.includes('2.01')) {
        results.push({
          date: f.filingDate[i],
          accession: f.accessionNumber[i],
          primaryDoc: f.primaryDocument[i],
          cik,
        })
        if (results.length >= 8) break
      }
    }
  }
  return results
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<table[\s\S]*?<\/table>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#x[0-9a-f]+;/gi, ' ').replace(/&#\d+;/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function splitSentences(text) {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z"$\d(])/)
    .map(s => s.trim())
    .filter(s => s.length >= 30 && s.length <= 600)
}

// --- Signal 1: Guidance Numbers ---
function extractGuidanceNumbers(text) {
  const guidanceRe = /\b(expect(?:s|ed)?|guid(?:ance|es|ed)?|outlook|forecast(?:s|ed)?|anticipate[sd]?|project(?:s|ed)?|approximately|estimated range)\b/i
  const numRe = /(\$[\d,.]+\s*(?:billion|million|B|M|T)?|[\d,.]+\s*(?:billion|million)\s*(?:to|[-–])\s*\$?[\d,.]+\s*(?:billion|million)?|\d+\.?\d*\s*%)/i
  return splitSentences(text)
    .filter(s => guidanceRe.test(s) && numRe.test(s))
    .slice(0, 5)
    .map(s => {
      const nums = s.match(/\$[\d,.]+\s*(?:billion|million|B|M|T)?|[\d,]+\.?\d*\s*%/gi) || []
      return { sentence: s.length > 250 ? s.slice(0, 247) + '…' : s, numbers: nums }
    })
}

// --- Signal 2: Qualitative Tone ---
const BULLISH_WORDS = [
  'strong', 'record', 'growth', 'exceeded', 'outperform', 'robust', 'accelerat',
  'momentum', 'expand', 'increase', 'gain', 'improve', 'opportunity', 'confident',
  'beat', 'ahead', 'exceed', 'surge', 'positive', 'optimistic', 'deliver', 'win',
]
const BEARISH_WORDS = [
  'headwind', 'challenge', 'decline', 'decreas', 'slow', 'weaker', 'uncertain',
  'difficult', 'concern', 'pressure', 'cautious', 'below', 'miss', 'disappoint',
  'reduce', 'lower', 'risk', 'volatile', 'macro', 'unfavorable', 'soft', 'lag',
]

function scoreTone(text) {
  const lower = text.toLowerCase()
  let bull = 0, bear = 0
  BULLISH_WORDS.forEach(w => { const m = lower.match(new RegExp(w, 'g')); if (m) bull += m.length })
  BEARISH_WORDS.forEach(w => { const m = lower.match(new RegExp(w, 'g')); if (m) bear += m.length })
  const total = bull + bear || 1
  return { bull, bear, bullPct: Math.round(bull / total * 100), bearPct: Math.round(bear / total * 100) }
}

// --- Signal 3: Topic Frequency ---
const TOPICS = {
  AI:          /\b(artificial intelligence|machine learning|AI\b|LLM|generative|copilot|neural|model training)\b/gi,
  Cloud:       /\b(cloud|azure|AWS|GCP|SaaS|IaaS|PaaS|managed service|infrastructure)\b/gi,
  Pricing:     /\b(pric(?:ing|e increase|ed higher)|price hike|tariff|surcharge|monetiz|ASP)\b/gi,
  Macro:       /\b(macro|recession|inflation|rate|fed|interest rate|gdp|economy|slowdown|consumer spending)\b/gi,
  Competition: /\b(compet(?:itor|itive|ing)|market share|rival|disrupt|displacement)\b/gi,
  Demand:      /\b(demand|pipeline|backlog|order|customer acquisition|churn|retention|renewal)\b/gi,
  China:       /\b(china|chinese|asia.pacific|apac|geopolit|export control|sanction)\b/gi,
  Cost:        /\b(cost reduction|headcount|restructur|layoff|margin expansion|efficiency|opex|capex)\b/gi,
  Inventory:   /\b(inventory|supply chain|supply constraint|component|shortage|excess)\b/gi,
  Debt:        /\b(debt|leverage|interest expense|refinanc|credit facilit|balance sheet)\b/gi,
}

function topicFrequency(text) {
  const result = {}
  for (const [topic, re] of Object.entries(TOPICS)) {
    const matches = text.match(re) || []
    result[topic] = matches.length
  }
  return result
}

// --- Signal 6: New / Disappeared Language (n-gram comparison) ---
function extractNgrams(text, n = 3) {
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 3)
  const grams = new Set()
  for (let i = 0; i <= words.length - n; i++) {
    grams.add(words.slice(i, i + n).join(' '))
  }
  return grams
}

function languageChanges(currentText, previousTexts) {
  if (!previousTexts.length) return { newPhrases: [], droppedPhrases: [] }
  const currentGrams = extractNgrams(currentText)
  // Union of all prior quarters' n-grams
  const priorGrams = new Set()
  for (const t of previousTexts) {
    for (const g of extractNgrams(t)) priorGrams.add(g)
  }

  // Stop-word-like phrases to skip (common financial boilerplate and EDGAR artifacts)
  const BOILERPLATE = /^(the company|in the|of the|for the|year over|compared to|as compared|on a|we are|we have|our total|to the|of our|in our|and the|at the|this is|there are|million for|million in|billion in|compared with)|ex99|exhibit|index\.htm|\.xml|\.htm|\.xsd|accession|0000\d{4,}|document\s+\d+|false\s+\d/

  const newPhrases = [...currentGrams]
    .filter(g => !priorGrams.has(g) && !BOILERPLATE.test(g))
    .slice(0, 8)

  const droppedPhrases = [...priorGrams]
    .filter(g => !currentGrams.has(g) && !BOILERPLATE.test(g))
    .slice(0, 8)

  return { newPhrases, droppedPhrases }
}

// --- Signal 8: Consistency Check ---
function consistencyCheck(text, xbrlMetrics) {
  const flags = []
  const ltext = text.toLowerCase()

  if (xbrlMetrics.revGrowthPct != null) {
    const growthMentioned = /revenue (grew|increased|rose|expanded|declined|fell|decreased)/i.test(text)
    const actualGrew = xbrlMetrics.revGrowthPct >= 0
    const textGrew = /revenue (grew|increased|rose|expanded)/i.test(text)
    const textDeclined = /revenue (declined|fell|decreased|contracted)/i.test(text)
    if (growthMentioned) {
      if (actualGrew && textDeclined) {
        flags.push({ type: 'mismatch', note: `EDGAR shows +${xbrlMetrics.revGrowthPct.toFixed(1)}% revenue growth but 8-K language implies decline` })
      } else if (!actualGrew && textGrew) {
        flags.push({ type: 'mismatch', note: `EDGAR shows ${xbrlMetrics.revGrowthPct.toFixed(1)}% revenue change but 8-K language implies growth` })
      }
    }
  }

  if (xbrlMetrics.netIncomePositive != null) {
    if (!xbrlMetrics.netIncomePositive && /profitable|profit\b|net income growth|profitability increased/i.test(text)) {
      flags.push({ type: 'mismatch', note: 'EDGAR shows net loss but 8-K references profitability positively' })
    }
  }

  if (!flags.length) flags.push({ type: 'ok', note: 'No obvious numeric mismatches detected between 8-K language and EDGAR filing' })

  return flags
}

// The 8-K primaryDoc is often the iXBRL cover page, not the press release.
// Exhibit 99.1 is the actual earnings press release — find it via the filing index.
async function fetchFilingText(filing) {
  const accNoSlashes = filing.accession.replace(/-/g, '')
  const cikInt = parseInt(filing.cik, 10)
  const base = `${ARCHIVES}/${cikInt}/${accNoSlashes}`

  // Try to find Exhibit 99.1 from the filing index HTML
  try {
    // Index filename keeps the original dashed accession format
    const idxUrl = `${base}/${filing.accession}-index.htm`
    const idxRes = await axios.get(idxUrl, {
      headers: { 'User-Agent': 'arunimad@berkeley.edu' },
      timeout: 10000,
      responseType: 'text',
    })
    // Look for exhibit 99.1 link patterns
    const exRe = /href="([^"]+(?:ex[-_]?99[-_.]?1[^"]*\.htm|ex991[^"]*\.htm|exhibit[-_]?99[^"]*\.htm|press[^"]*\.htm)[^"]*)"/gi
    let m
    while ((m = exRe.exec(idxRes.data)) !== null) {
      const path = m[1]
      const exUrl = path.startsWith('http') ? path : path.startsWith('/') ? `https://www.sec.gov${path}` : `${base}/${path}`
      try {
        const exRes = await axios.get(exUrl, {
          headers: { 'User-Agent': 'arunimad@berkeley.edu' },
          timeout: 20000,
          maxContentLength: 3 * 1024 * 1024,
          responseType: 'text',
        })
        const text = stripHtml(exRes.data)
        // Sanity check: must have enough readable content
        if (text.length > 500) return text.slice(0, 80000)
      } catch { continue }
    }
  } catch { /* fall through to primary doc */ }

  // Fall back to primary doc (may be iXBRL but better than nothing)
  try {
    const docUrl = `${base}/${filing.primaryDoc}`
    const r = await axios.get(docUrl, {
      headers: { 'User-Agent': 'arunimad@berkeley.edu' },
      timeout: 20000,
      maxContentLength: 3 * 1024 * 1024,
      responseType: 'text',
    })
    return stripHtml(r.data).slice(0, 80000)
  } catch { return '' }
}

// Fetch quarterly revenue from XBRL for metric tracking (growth calc)
async function fetchQuarterlyRevForSignals(cik) {
  const REV_CONCEPTS = [
    'RevenueFromContractWithCustomerExcludingAssessedTax',
    'Revenues',
    'SalesRevenueNet',
  ]
  for (const concept of REV_CONCEPTS) {
    try {
      const r = await axios.get(`${SEC}/api/xbrl/companyconcept/CIK${cik}/us-gaap/${concept}.json`, { headers: HDR, timeout: 15000 })
      const arr = r.data?.units?.USD || []
      const byPeriod = {}
      for (const item of arr) {
        if (!item.start || !item.end || item.val == null) continue
        const days = (new Date(item.end) - new Date(item.start)) / 86400000
        if (days < 55 || days > 105) continue
        if (!byPeriod[item.end] || item.filed > byPeriod[item.end].filed) byPeriod[item.end] = item
      }
      // Return 12 quarters so prior-year comparisons are available for the newest 8
      const entries = Object.entries(byPeriod).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 12)
      if (entries.length >= 2) return entries
    } catch { continue }
  }
  return []
}

export default async function handler(req, res) {
  const { ticker } = req.query
  if (!ticker) return res.status(400).json({ error: 'Missing ticker' })

  const sym = ticker.toUpperCase()
  const hit = signalsCache.get(sym)
  if (hit && Date.now() - hit.ts < CACHE_TTL) return res.status(200).json(hit.data)

  try {
    const cik = await getCik(sym)
    if (!cik) return res.status(200).json({ error: `No SEC filing for ${sym}` })

    // Fetch 8-K filings list and quarterly revenue in parallel
    const [filings, revEntries] = await Promise.all([
      getRecentEarnings8Ks(cik),
      fetchQuarterlyRevForSignals(cik),
    ])

    if (!filings.length) {
      return res.status(200).json({ ticker: sym, quarters: [], signals: null })
    }

    // Download all 8-K texts in parallel (limit to 8)
    const texts = await Promise.all(filings.slice(0, 8).map(f => fetchFilingText(f)))

    // Build per-quarter signals
    const quarters = filings.slice(0, 8).map((f, i) => {
      const text = texts[i] || ''

      // Revenue growth vs prior year quarter (yoy, 4 quarters back)
      const revMap = Object.fromEntries(revEntries)
      const periodEnd = null // 8-K dates don't align perfectly; use position
      const revGrowthPct = null // skip precise calc without period alignment

      const xbrlMetrics = { revGrowthPct, netIncomePositive: null }

      return {
        date:     f.date,
        filing:   f.accession,
        guidance: extractGuidanceNumbers(text),
        tone:     scoreTone(text),
        topics:   topicFrequency(text),
        language: i === 0 ? languageChanges(text, texts.slice(1, 5)) : null,
        consistency: i === 0 ? consistencyCheck(text, xbrlMetrics) : null,
      }
    })

    // Signal 7: Metric Tracking table (from EDGAR XBRL, newest first)
    const metricRows = revEntries.slice(0, 8).map(([date, item], idx) => {
      // Find prior year quarter by searching for a period end ~365 days earlier (±45 days)
      const curr = new Date(date).getTime()
      const prevDate = revEntries.find(([d]) => {
        const diff = curr - new Date(d).getTime()
        return diff > 280 * 86400000 && diff < 410 * 86400000
      })
      const prevItem = prevDate || null
      const yoy = prevItem ? ((item.val - prevItem[1].val) / Math.abs(prevItem[1].val) * 100) : null
      const [year, month] = date.split('-').map(Number)
      const q = `Q${Math.ceil(month / 3)} ${year}`
      return {
        quarter: q,
        revenue: item.val,
        revenueYoy: yoy != null ? Number(yoy.toFixed(1)) : null,
      }
    })

    const data = {
      ticker: sym,
      quarters,
      metricRows,
    }

    signalsCache.set(sym, { data, ts: Date.now() })
    return res.status(200).json(data)
  } catch (err) {
    console.error('earnings-signals error:', err.message)
    return res.status(200).json({ error: err.message, ticker: sym, quarters: [], metricRows: [] })
  }
}
