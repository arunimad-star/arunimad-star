import axios from 'axios'

const HDR = { 'User-Agent': 'arunimad@berkeley.edu', Accept: 'application/json' }
const CACHE_TTL = 24 * 60 * 60 * 1000

const cikCache  = { data: null, ts: 0 }
const subCache  = new Map()   // CIK → { accession, primaryDoc, cikNum, ts }
const descCache = new Map()   // ticker → { description, ts }  (only cached when non-null)

async function getCik(ticker) {
  if (!cikCache.data || Date.now() - cikCache.ts > CACHE_TTL) {
    const r = await axios.get('https://www.sec.gov/files/company_tickers.json', { headers: HDR, timeout: 10000 })
    cikCache.data = r.data
    cikCache.ts = Date.now()
  }
  const entry = Object.values(cikCache.data).find(e => e.ticker === ticker.toUpperCase())
  return entry ? String(entry.cik_str).padStart(10, '0') : null
}

async function getLatest10K(cik) {
  const hit = subCache.get(cik)
  if (hit && Date.now() - hit.ts < CACHE_TTL) return hit

  const r = await axios.get(`https://data.sec.gov/submissions/CIK${cik}.json`, { headers: HDR, timeout: 10000 })
  const filings = r.data?.filings?.recent || {}
  const forms = filings.form || []
  const accs  = filings.accessionNumber || []
  const docs  = filings.primaryDocument || []
  for (let i = 0; i < forms.length; i++) {
    if (forms[i] === '10-K') {
      const result = { accession: accs[i].replace(/-/g, ''), primaryDoc: docs[i], cikNum: parseInt(cik, 10), ts: Date.now() }
      subCache.set(cik, result)
      return result
    }
  }
  return null
}

// Strip all-caps/symbol heading artifacts (e.g. "> ITEM 1. B USINESS GENERAL ")
// and trim to a sentence boundary at ~900 chars.
function toExcerpt(text) {
  if (!text || text.length < 50) return null
  // Strip leading all-caps heading artifacts (e.g. "ITEM 1. B USINESS GENERAL ")
  // by advancing to the first word that starts with UpperCase then lowercase.
  const cleaned = text.replace(/^[\s\S]*?(?=\b[A-Z][a-z])/, '').trim()
  if (cleaned.length < 50) return null
  const excerpt = cleaned.slice(0, 900)
  const lp = excerpt.lastIndexOf('. ')
  return lp > 400 ? excerpt.slice(0, lp + 1) : excerpt
}

function cleanText(html) {
  return html
    .replace(/<ix:[^/][^>]*>/gi, '')
    .replace(/<\/ix:[^>]*>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&#8217;/g, "'")
    .replace(/&#8220;|&#8221;/g, '"')
    .replace(/&#8212;/g, '—')
    .replace(/&#8211;/g, '–')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#\d+;/g, ' ')
    .replace(/&[a-zA-Z]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function fetchBusinessDescription(cikNum, accession, primaryDoc) {
  const url = `https://www.sec.gov/Archives/edgar/data/${cikNum}/${accession}/${primaryDoc}`

  const r = await axios.get(url, {
    headers: { 'User-Agent': 'arunimad@berkeley.edu', Accept: 'text/html' },
    timeout: 30000,
    responseType: 'text',
  })
  const html = r.data

  // --- Strategy 1: anchor-based (works for iXBRL 10-Ks, MSFT-style table layouts) ---
  // Find the TOC hyperlink whose visible text is "Business" and which appears near "Item 1".
  // That href value tells us exactly where the real section starts.
  const tocLinkRe = /<a\b[^>]*href=["']#([^"']+)["'][^>]*>(?:\s|<[^>]+>|&[^;]+;)*Business/gi
  let tocMatch
  while ((tocMatch = tocLinkRe.exec(html)) !== null) {
    const before = html.slice(Math.max(0, tocMatch.index - 800), tocMatch.index)
    if (!/Item\s*1[.\s]/i.test(before)) continue
    const anchorId = tocMatch[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const targetRe = new RegExp('id=["\']-?' + anchorId + '["\']', 'i')
    const targetMatch = targetRe.exec(html)
    if (!targetMatch) continue
    const afterAnchor = html.slice(targetMatch.index + targetMatch[0].length, targetMatch.index + targetMatch[0].length + 80000)
    // Stop at Item 1A anchor or heading
    const stopRe = /id=["'][^"']*item[_-]?1[_-]?a[^"']*["']|>\s*Item\s*1A\b/i
    const stopMatch = stopRe.exec(afterAnchor)
    const sectionHtml = stopMatch ? afterAnchor.slice(0, stopMatch.index) : afterAnchor
    const text = toExcerpt(cleanText(sectionHtml))
    if (text && text.length > 80) return text
  }

  // --- Strategy 2: text scan (works for simpler inline 10-K formats, AAPL-style) ---
  // Find "Item 1" followed by "Business" within a short hop, skipping TOC entries by
  // checking that the content between Item 1 and Item 1A is substantial.
  const item1Re = /Item\s*1[\.\s]*(?:(?:&nbsp;|&#160;|\s){0,10})Business/gi
  let m
  while ((m = item1Re.exec(html)) !== null) {
    const afterHeading = html.slice(m.index + m[0].length)
    const mStop = /Item\s*(?:1A|2)[.\s]/i.exec(afterHeading)
    const sectionHtml = mStop ? afterHeading.slice(0, mStop.index) : afterHeading.slice(0, 80000)
    const text = toExcerpt(cleanText(sectionHtml))
    if (text && text.length > 80) return text
  }

  return null
}

export default async function handler(req, res) {
  const { ticker } = req.query
  if (!ticker) return res.status(400).json({ error: 'Missing ticker' })

  const sym = ticker.toUpperCase()

  // Only serve from cache if the description was successfully extracted
  const hit = descCache.get(sym)
  if (hit && Date.now() - hit.ts < CACHE_TTL) {
    return res.status(200).json({ ticker: sym, description: hit.description })
  }

  try {
    const cik = await getCik(sym)
    if (!cik) return res.status(200).json({ ticker: sym, description: null })

    const filing = await getLatest10K(cik)
    if (!filing) return res.status(200).json({ ticker: sym, description: null })

    const description = await fetchBusinessDescription(filing.cikNum, filing.accession, filing.primaryDoc)

    // Only cache successful extractions — failures will be retried next request
    if (description) descCache.set(sym, { description, ts: Date.now() })

    return res.status(200).json({ ticker: sym, description })
  } catch (err) {
    console.error('edgar-description error:', sym, err.response?.status || err.message)
    return res.status(200).json({ ticker: sym, description: null })
  }
}
