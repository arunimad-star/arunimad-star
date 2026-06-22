import axios from 'axios'

const SEC = 'https://data.sec.gov'
const EDGAR = 'https://www.sec.gov'
const HDR = { 'User-Agent': 'arunimad@berkeley.edu', Accept: 'application/json' }
const CACHE_TTL = 8 * 60 * 60 * 1000
const cikCache = { data: null, ts: 0 }
const cache = new Map()

async function getCik(ticker) {
  if (!cikCache.data || Date.now() - cikCache.ts > CACHE_TTL) {
    const r = await axios.get('https://www.sec.gov/files/company_tickers.json', { headers: HDR, timeout: 10000 })
    cikCache.data = r.data; cikCache.ts = Date.now()
  }
  const entry = Object.values(cikCache.data).find(e => e.ticker === ticker.toUpperCase())
  return entry ? String(entry.cik_str).padStart(10, '0') : null
}

async function getLatest10K(cik) {
  const r = await axios.get(`${SEC}/submissions/CIK${cik}.json`, { headers: HDR, timeout: 10000 })
  const f = r.data?.filings?.recent
  if (!f) return null
  for (let i = 0; i < f.form.length; i++) {
    if (f.form[i] === '10-K') {
      return { accession: f.accessionNumber[i].replace(/-/g, ''), primaryDoc: f.primaryDocument[i], year: (f.reportDate?.[i] || '').slice(0, 4) }
    }
  }
  return null
}

// ── HTML helpers ─────────────────────────────────────────────────────────────

// Mark bold/heading elements before stripping — used for risk factor titles
function markHeadings(html) {
  return html
    .replace(/<(b|strong|h[1-6])[^>]*>([\s\S]*?)<\/\1>/gi, (_, _tag, inner) => `\x02${inner}\x03`)
    // Modern 10-Ks (e.g. AAPL) use <span style="font-weight:700"> instead of <b>/<strong>
    .replace(/<span[^>]*font-weight\s*:\s*(?:bold|[6-9]\d\d)[^>]*>([\s\S]*?)<\/span>/gi, (_, inner) => `\x02${inner}\x03`)
}

function stripTags(s) {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#\d+;/g, ' ').replace(/&[a-z]+;/g, ' ')
    .replace(/\s+/g, ' ').trim()
}

// Split text into sentences
function sentences(text) {
  return text.match(/[^.!?]+[.!?]+/g)?.map(s => s.trim()).filter(s => s.length > 20) || []
}

// ── Section extraction ────────────────────────────────────────────────────────

// Find position of "Item N." or "ITEM N." in plain text.
// 10-Ks have the item headers twice: once in the TOC and once at the actual section.
// We want the second (body) occurrence; fall back to first if only one exists.
function findItem(text, itemLabel) {
  const re = new RegExp(`(?:^|[ \\n])ITEM\\s+${itemLabel}\\.`, 'gim')
  const matches = []
  let m
  while ((m = re.exec(text)) !== null) matches.push(m.index)
  if (!matches.length) return -1
  // Use second occurrence (actual body section); fall back to first if only one
  return matches.length > 1 ? matches[1] : matches[0]
}

function extractItemRange(text, startLabel, endLabel) {
  const start = findItem(text, startLabel)
  if (start < 0) return ''
  const end = endLabel ? findItem(text, endLabel) : -1
  return end > start ? text.slice(start, end) : text.slice(start, start + 60000)
}

// ── Products & Services ───────────────────────────────────────────────────────

const PRODUCT_KW = ['product', 'service', 'platform', 'solution', 'software', 'hardware',
  'offer', 'provid', 'develop', 'manufactur', 'cloud', 'subscript', 'device', 'application',
  'technology', 'system', 'network', 'design', 'sell', 'distribut', 'market']

function extractProducts(item1Text) {
  if (!item1Text) return null
  // Remove the item header line
  const cleaned = item1Text.replace(/^[\s\S]{0,300}?ITEM\s+1\b[^a-z]/i, '').trim()
  const sents = sentences(cleaned)
  if (!sents.length) return null

  // Score each sentence by how many product/service keywords it contains
  const scored = sents.slice(0, 80).map(s => {
    const lower = s.toLowerCase()
    const hits = PRODUCT_KW.filter(k => lower.includes(k)).length
    return { s, hits }
  })

  // Prefer sentences that mention products/services; fall back to first 6
  const relevant = scored.filter(x => x.hits > 0)
  const use = relevant.length >= 3 ? relevant.slice(0, 6) : scored.slice(0, 6)
  return use.map(x => x.s).join(' ')
}

// ── Supply Chain ─────────────────────────────────────────────────────────────

// Note: bare 'manufactur' and 'distribution' are deliberately excluded — they match
// generic "designs, manufactures and markets" / customer-distribution boilerplate
// that appears before the real supply-chain section, exhausting the hit cap early.
const SUPPLY_KEYWORDS = ['supplier', 'vendor', 'logistics', 'procure', 'sourcing', 'warehouse',
  'third-party manufactur', 'contract manufactur', 'raw material', 'sole-source', 'sole source',
  'supply chain', 'limited source', 'single source', 'manufacturing capacit', 'component shortage',
  'outsourc', 'commodity pricing']

function extractSupplyChain(item1Text) {
  if (!item1Text) return null
  const sents = sentences(item1Text)
  const hits = []
  for (const s of sents) {
    const lower = s.toLowerCase()
    if (SUPPLY_KEYWORDS.some(kw => lower.includes(kw))) {
      hits.push(s)
      if (hits.length >= 6) break
    }
  }
  return hits.length ? hits.join(' ') : null
}

// ── Risk Factors ─────────────────────────────────────────────────────────────

function extractRiskFactors(item1aHtml) {
  if (!item1aHtml) return []
  // The HTML has bold/heading tags around risk factor titles
  const marked = markHeadings(item1aHtml)
  const text = stripTags(marked)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')

  const risks = []
  // Split on heading markers \x02...\x03
  const parts = text.split(/\x02/)
  for (let i = 1; i < parts.length; i++) {
    const endIdx = parts[i].indexOf('\x03')
    if (endIdx < 0) continue
    const heading = parts[i].slice(0, endIdx).trim()
    const body = parts[i].slice(endIdx + 1).trim()
    // Filter: heading should be 10-400 chars, not a financial label, not a short label
    if (heading.length < 10 || heading.length > 400) continue
    if (/^\d|table|exhibit|page \d|form 10/i.test(heading)) continue
    const summary = sentences(body).slice(0, 2).join(' ')
    risks.push({ heading, summary })
    if (risks.length >= 12) break
  }
  return risks
}

// ── Accounting Policies ───────────────────────────────────────────────────────

const ACCT_PATTERNS = [
  { key: 'revenueRecognition', re: /revenue\s+recognition/i },
  { key: 'inventory',          re: /inventor(?:y|ies)\s+(?:are\s+)?(?:stated|valued|recorded|carried)/i },
  { key: 'depreciation',       re: /depreciation|property,\s+plant/i },
  { key: 'goodwill',           re: /goodwill/i },
]

function extractAccountingPolicies(item8Text) {
  if (!item8Text) return {}
  const sents = sentences(item8Text)
  const result = {}
  for (const { key, re } of ACCT_PATTERNS) {
    const hit = sents.find(s => re.test(s) && s.length < 400)
    if (hit) result[key] = hit
  }
  // Also look for FIFO/LIFO/weighted average near inventory
  if (!result.inventory) {
    const s = sents.find(s => /FIFO|LIFO|weighted.average|first.in.*first.out/i.test(s))
    if (s) result.inventory = s
  }
  return result
}

// ── Porter's Five Forces ─────────────────────────────────────────────────────

function extractPorter(item1Text, item1aText) {
  const combined = (item1Text + ' ' + (item1aText || '')).toLowerCase()
  const cSents = sentences(item1Text + ' ' + (item1aText || ''))

  const score = (keywords) => {
    const lk = keywords.map(k => k.toLowerCase())
    return cSents.filter(s => lk.some(k => s.toLowerCase().includes(k))).length
  }

  const evidence = (keywords) => {
    const lk = keywords.map(k => k.toLowerCase())
    return cSents.find(s => lk.some(k => s.toLowerCase().includes(k)))?.slice(0, 200) || null
  }

  const rate = (n) => n >= 5 ? 'High' : n >= 2 ? 'Medium' : 'Low'

  // Existing competition
  const compN = score(['competition', 'competitor', 'competitive', 'market share', 'compete'])
  // New entrants
  const entrantN = score(['barrier to entry', 'barriers to entry', 'switching cost', 'network effect', 'capital requirement', 'regulatory approval', 'economies of scale'])
  // Supplier power
  const supplierN = score(['sole source', 'sole-source', 'limited supplier', 'single supplier', 'supplier concentration', 'depend on supplier', 'key supplier', 'critical supplier'])
  // Buyer power
  const buyerN = score(['customer concentration', 'significant customer', 'single customer', 'major customer', 'represented .{0,15}%', '10% of revenue', '10% of net revenue'])
  // Substitutes
  const subN = score(['substitute', 'alternative', 'disruption', 'disrupt', 'obsolescence', 'technological change'])

  return {
    competition:   { rating: rate(compN),     evidence: evidence(['competition', 'competitive market', 'compete directly']) },
    newEntrants:   { rating: rate(Math.max(0, 3 - entrantN)), evidence: evidence(['barrier to entry', 'switching cost', 'network effect']) },
    supplierPower: { rating: supplierN >= 2 ? 'High' : supplierN === 1 ? 'Medium' : 'Low', evidence: evidence(['sole source', 'limited supplier', 'key supplier']) },
    buyerPower:    { rating: buyerN >= 2 ? 'High' : buyerN === 1 ? 'Medium' : 'Low', evidence: evidence(['customer concentration', 'significant customer', 'major customer']) },
    substitutes:   { rating: rate(subN), evidence: evidence(['substitute', 'disruption', 'alternative technology']) },
  }
}

// ── Market Characteristics ────────────────────────────────────────────────────

function extractMarketChar(item1Text, item1aText) {
  const combined = item1Text + ' ' + (item1aText || '')
  const sents = sentences(combined)

  const find = (keywords) => sents.find(s => keywords.some(k => s.toLowerCase().includes(k.toLowerCase())))?.slice(0, 250) || null

  const cycMentions = sents.filter(s => /cycli|seasonal|economic downturn|recession|macroeconom/i.test(s)).length
  const b2b = /enterprise|business.to.business|B2B|commercial\s+customer|corporate\s+customer/i.test(combined)
  const b2c = /consumer|retail\s+customer|end.user|individual\s+customer|B2C/i.test(combined)
  const gov = /government|federal|state\s+and\s+local|public\s+sector|defense/i.test(combined)
  const intl = /international|global|worldwide|outside\s+(?:the\s+)?United\s+States|foreign/i.test(combined)

  return {
    cyclicality: cycMentions >= 3 ? 'High' : cycMentions >= 1 ? 'Moderate' : 'Low',
    cyclicalEvidence: find(['cyclical', 'seasonal', 'economic downturn', 'recession']),
    customerType: [b2b && 'B2B', b2c && 'B2C', gov && 'Government'].filter(Boolean),
    international: intl,
    tamMention: find(['total addressable market', 'TAM', 'market opportunity', 'market size', 'billion market', 'trillion market']),
  }
}

// ── Policy & Compliance ────────────────────────────────────────────────────────

const COMPLIANCE_THEMES = [
  { key: 'Tariffs/Trade', keywords: ['tariff', 'trade war', 'import duty', 'export control', 'trade restriction'] },
  { key: 'FDA/Healthcare', keywords: ['FDA', 'Food and Drug Administration', 'clinical trial', 'regulatory approval', 'CE marking'] },
  { key: 'Antitrust/FTC', keywords: ['antitrust', 'FTC', 'Federal Trade Commission', 'competition law', 'monopoly'] },
  { key: 'Data Privacy', keywords: ['GDPR', 'CCPA', 'data privacy', 'data protection', 'privacy regulation'] },
  { key: 'ESG/Climate', keywords: ['ESG', 'carbon', 'climate change', 'sustainability', 'greenhouse gas', 'emissions'] },
  { key: 'Financial Reg', keywords: ['SEC', 'FINRA', 'Dodd-Frank', 'banking regulation', 'financial regulation'] },
  { key: 'Cybersecurity', keywords: ['cybersecurity regulation', 'CMMC', 'NIST', 'data breach notification'] },
  { key: 'Labor/Employment', keywords: ['minimum wage', 'labor regulation', 'OSHA', 'employment law', 'union'] },
]

function extractCompliance(item1aText) {
  if (!item1aText) return []
  const sents = sentences(item1aText)
  const found = []
  for (const theme of COMPLIANCE_THEMES) {
    const lk = theme.keywords.map(k => k.toLowerCase())
    const evidence = sents.find(s => lk.some(k => s.toLowerCase().includes(k)))
    if (evidence) found.push({ theme: theme.key, evidence: evidence.slice(0, 220) })
  }
  return found
}

// ── Main handler ──────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const { ticker } = req.query
  if (!ticker) return res.status(400).json({ error: 'Missing ticker' })

  const sym = ticker.toUpperCase()
  const hit = cache.get(sym)
  if (hit && Date.now() - hit.ts < CACHE_TTL) return res.status(200).json(hit.data)

  try {
    const cik = await getCik(sym)
    if (!cik) return res.status(200).json({ ticker: sym, error: 'No SEC filing' })

    const filing = await getLatest10K(cik)
    if (!filing) return res.status(200).json({ ticker: sym, error: 'No 10-K found' })

    const docUrl = `${EDGAR}/Archives/edgar/data/${parseInt(cik, 10)}/${filing.accession}/${filing.primaryDoc}`
    let html
    try {
      const resp = await axios.get(docUrl, {
        headers: { 'User-Agent': HDR['User-Agent'], Accept: 'text/html,*/*' },
        timeout: 45000, maxContentLength: 14 * 1024 * 1024, responseType: 'text',
      })
      html = resp.data
    } catch (e) {
      return res.status(200).json({ ticker: sym, error: 'Failed to fetch 10-K: ' + e.message })
    }

    // Remove scripts/styles/comments
    html = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')

    const plainText = stripTags(html).replace(/\s+/g, ' ')

    const item1Start  = findItem(plainText, '1(?![A-Z0-9])')
    const item1aStart = findItem(plainText, '1A')
    const item2Start  = findItem(plainText, '2(?![A-Z0-9])')
    const item7Start  = findItem(plainText, '7(?![A-Z0-9])')
    const item7aStart = findItem(plainText, '7A')
    const item8Start  = findItem(plainText, '8(?![A-Z0-9])')
    const item9Start  = findItem(plainText, '9(?![A-Z0-9])')

    const getSec = (s, e) => {
      if (s < 0) return ''
      const end = e > s ? e : s + 50000
      return plainText.slice(s, end)
    }

    const item1Text = getSec(item1Start, item1aStart > item1Start ? item1aStart : item2Start)
    const item1aText = getSec(item1aStart, item2Start)
    const item7Text  = getSec(item7Start, item7aStart > item7Start ? item7aStart : item8Start)
    const item8Text  = getSec(item8Start, item9Start)

    // Extract Item 1A HTML directly (for bold-heading risk factor detection).
    // We search the raw HTML rather than using plainText positions (which don't map to HTML offsets).
    const item1aHtml = (() => {
      const lower = html.toLowerCase()
      const re1a = /item\s+1a[\s.<]/g
      const hits1a = []
      let m1a
      while ((m1a = re1a.exec(lower)) !== null) hits1a.push(m1a.index)
      if (!hits1a.length) return ''

      // Strip tags WITHOUT inserting a space — some filers (e.g. MSFT) split a heading
      // word across two adjacent <span> tags ("RIS</span><span>K FACTORS"), and a
      // space-inserting strip would break "RISK" into two tokens and miss the match.
      const tightText = (idx, len) => html.slice(idx, idx + len)
        .replace(/<[^>]+>/g, '')
        .replace(/&#160;|&nbsp;/gi, ' ')
        .replace(/&#\d+;/g, '')
        .toLowerCase()

      // TOC rows read like "Item 1A. Risk Factors 5 Item 1B." — a page number immediately
      // follows "Risk Factors", then the next item label. The real section heading is
      // followed by prose, not a number.
      const isTocRow = (idx) => /risk\s*factors?\s*\d{1,4}\b/.test(tightText(idx, 250))
      const isCrossRef = (idx) => /item\s+1a\s+of\s+this/.test(lower.slice(idx, idx + 150))
      const isTocLink = (idx) => /<\/a>/.test(lower.slice(idx, idx + 60))

      const candidates = hits1a.filter(idx => !isTocLink(idx) && !isCrossRef(idx) && !isTocRow(idx))
      // Prefer the occurrence immediately followed by "risk factor(s)" — the actual section heading.
      // Window must be generous: style attributes on intervening tags can run hundreds of chars.
      let start = candidates.find(idx => /risk\s*factors?/.test(tightText(idx, 600)))
      if (start === undefined) start = candidates[0]
      if (start === undefined) start = hits1a.length > 1 ? hits1a[1] : hits1a[0]

      // Find the next "item 2" in the HTML after this point
      const re2 = /item\s+2[\s.<]/g
      re2.lastIndex = start + 1
      const hits2 = []
      let m2
      while ((m2 = re2.exec(lower)) !== null) hits2.push(m2.index)
      const end = hits2.length > 0 ? hits2[0] : start + 300000
      return html.slice(start, Math.min(end, start + 300000))
    })()

    const data = {
      ticker: sym,
      year: filing.year,
      products:       extractProducts(item1Text),
      supplyChain:    extractSupplyChain(item1Text),
      riskFactors:    extractRiskFactors(item1aHtml),
      accounting:     extractAccountingPolicies(item8Text),
      porter:         extractPorter(item1Text, item1aText),
      marketChar:     extractMarketChar(item1Text, item1aText),
      compliance:     extractCompliance(item1aText),
    }

    cache.set(sym, { data, ts: Date.now() })
    return res.status(200).json(data)
  } catch (err) {
    console.error('tenk-items error:', err.message)
    return res.status(200).json({ ticker: sym, error: err.message })
  }
}
