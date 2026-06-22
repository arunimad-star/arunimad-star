import axios from 'axios'

const SEC = 'https://data.sec.gov'
const ARCHIVES = 'https://www.sec.gov/Archives/edgar/data'
const HDR = { 'User-Agent': 'arunimad@berkeley.edu', Accept: 'application/json' }
const CACHE_TTL = 4 * 60 * 60 * 1000

const cikCache = { data: null, ts: 0 }
const callCache = new Map()

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
    .replace(/<table[\s\S]*?<\/table>/gi, ' ') // strip dense financial tables
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#\d+;/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function splitSentences(text) {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z"$\d(])/)
    .map(s => s.trim())
    .filter(s => s.length >= 40 && s.length <= 400)
}

function extractGuidance(text) {
  // Find guidance / outlook section
  const sectionRe = /\b(outlook|guidance|financial guidance|business outlook|full.year guidance|q[1-4] guidance|fiscal \d{4} guidance|future outlook|forward.looking)\b/i
  const idx = text.search(sectionRe)
  const source = idx >= 0 ? text.slice(idx, idx + 3000) : text

  const guidanceRe = /\b(expect(?:s|ed)?|guid(?:ance|es|ed)?|outlook|forecast(?:s|ed)?|anticipate[sd]?|project(?:s|ed)?|approximately|estimated|estimated range|revenue.*(?:\$|billion|million)|eps.*(?:\$|per share)|\$\d[\d,.]*\s*(?:billion|million)|per.?share)/i

  return splitSentences(source)
    .filter(s => guidanceRe.test(s))
    .slice(0, 6)
}

function extractHighlights(text) {
  // Prefer bullets / highlights section
  const sectionRe = /\b(highlights?|key results?|operating results?|financial results?|business results?|first quarter|second quarter|third quarter|fourth quarter)\b/i
  const idx = text.search(sectionRe)
  const source = idx >= 0 ? text.slice(idx, idx + 4000) : text.slice(0, 4000)

  const keyRe = /\b(revenue|profit|growth|margin|customer[s]?|product|launch|acquisition|partnership|cloud|AI|recurring|subscription|churn|retention|backlog|pipeline|contract|win|demand|supply|pricing|expansion|headcount|operating income|adjusted|free cash flow|share repurchase)\b/i

  return splitSentences(source)
    .filter(s => keyRe.test(s))
    .slice(0, 6)
}

export default async function handler(req, res) {
  const { ticker } = req.query
  if (!ticker) return res.status(400).json({ error: 'Missing ticker' })

  const sym = ticker.toUpperCase()
  const hit = callCache.get(sym)
  if (hit && Date.now() - hit.ts < CACHE_TTL) return res.status(200).json(hit.data)

  try {
    const cik = await getCik(sym)
    if (!cik) return res.status(200).json({ error: `No SEC filing for ${sym}` })

    const filings = await getRecentEarnings8Ks(cik)
    if (!filings.length) return res.status(200).json({ ticker: sym, filingDate: null, guidance: [], highlights: [] })

    const latest = filings[0]
    const accNoSlashes = latest.accession.replace(/-/g, '')
    const cikInt = parseInt(cik, 10)
    const docUrl = `${ARCHIVES}/${cikInt}/${accNoSlashes}/${latest.primaryDoc}`

    const docRes = await axios.get(docUrl, {
      headers: { 'User-Agent': 'arunimad@berkeley.edu' },
      timeout: 20000,
      maxContentLength: 2 * 1024 * 1024, // 2 MB cap
      responseType: 'text',
    })

    const text = stripHtml(docRes.data).slice(0, 60000)
    const guidance = extractGuidance(text)
    const highlights = extractHighlights(text)

    const result = { ticker: sym, filingDate: latest.date, guidance, highlights }
    callCache.set(sym, { data: result, ts: Date.now() })
    return res.status(200).json(result)
  } catch (err) {
    console.error('earnings-call error:', err.message)
    return res.status(200).json({ error: err.message, ticker: sym, guidance: [], highlights: [] })
  }
}
