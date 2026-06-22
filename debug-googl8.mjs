// Show ALL candidates found in scrape10K for GOOGL with their scores and parse results
import axios from 'axios'

const HDR = { 'User-Agent': 'arunimad@berkeley.edu', Accept: 'application/json' }

function stripTags(s) {
  return s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#\d+;/g, ' ')
    .replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim()
}

function parseDollar(s) {
  if (!s) return null
  const t = s.replace(/[\$,\s]/g, '').trim()
  if (/^\([\d.]+\)$/.test(t)) return -parseFloat(t.slice(1,-1))
  const n = parseFloat(t)
  return isNaN(n) || t === '' ? null : n
}

function detectMultiplier(s) {
  const lo = s.toLowerCase()
  if (/in\s+billions/.test(lo)) return 1e9
  if (/in\s+millions/.test(lo)) return 1e6
  if (/in\s+thousands/.test(lo)) return 1e3
  return 1
}

function findValueColumn(rows) {
  const maxCols = Math.max(...rows.map(r => r.length))
  for (let col = 1; col < Math.min(maxCols, 6); col++) {
    const vals = rows.map(r => r[col]).filter(Boolean)
    if (vals.length === 0) continue
    const numCount = vals.filter(v => parseDollar(v) !== null).length
    if (numCount / vals.length > 0.45) return col
  }
  return -1
}

function scoreTable(rows, context) {
  if (rows.length < 3 || rows.length > 80) return 0
  let score = 0
  const allText = rows.map(r => r.join(' ')).join(' ').toLowerCase()
  const ctx = context.toLowerCase()
  if (/unearned\s+revenue|deferred\s+revenue/.test(ctx)) score -= 8
  if (/disaggregat/.test(ctx)) score += 6
  if (/segment\s+information|segment\s+reporting|business\s+segment/.test(ctx)) score += 5
  if (/segment\s+revenue(?:,\s*cost|\s+and\s+cost)/.test(ctx)) score += 8
  if (/revenue\s+by|revenues\s+by|net\s+revenues\s+by/.test(ctx)) score += 5
  if (/geographic|geography|region/.test(ctx)) score += 3
  if (/product\s+line|product\s+category|service\s+line/.test(ctx)) score += 3
  if (allText.includes('total') || allText.includes('consolidated')) score += 2
  if (/cloud|platform|hardware|software|service|subscription|license|maintenance/.test(allText)) score += 3
  if (/americas|emea|apac|international|domestic|united\s+states/.test(allText)) score += 3
  if (/other\s+bets/.test(allText)) score += 8
  let numericColCount = 0
  const maxCols = Math.max(...rows.map(r => r.length))
  for (let col = 1; col < Math.min(maxCols, 5); col++) {
    const vals = rows.slice(1).map(r => r[col]).filter(Boolean)
    if (vals.length > 0 && vals.filter(v => parseDollar(v) !== null).length / vals.length > 0.5) numericColCount++
  }
  if (numericColCount >= 1) score += 4
  if (numericColCount >= 2) score += 1
  const isSegmentRevenueNote = /segment\s+revenue(?:,\s*cost|\s+and\s+cost)/.test(ctx)
  if (/cost\s+of|gross\s+profit|operating\s+income|operating\s+expense|selling,?\s+general/.test(allText)) score -= isSegmentRevenueNote ? 1 : 5
  if (/weighted.average|diluted\s+shares|basic\s+shares|earnings\s+per\s+share|per\s+share/.test(allText)) score -= 10
  if (rows.length >= 3 && rows.length <= 15) score += 2
  return score
}

function extractTopLevelTables(html) {
  const results = []
  let depth = 0, start = -1, i = 0
  while (i < html.length) {
    if (html[i] === '<') {
      const tagEnd = html.indexOf('>', i)
      if (tagEnd === -1) break
      const tag = html.slice(i+1, tagEnd).trim().toLowerCase()
      if (tag.startsWith('table') && (tag.length === 5 || /\s/.test(tag[5]))) {
        if (depth === 0) start = i
        depth++
      } else if (tag === '/table') {
        depth--
        if (depth === 0 && start >= 0) { results.push({ html: html.slice(start, tagEnd+1), pos: start }); start = -1 }
      }
      i = tagEnd + 1
    } else { i++ }
  }
  return results
}

function parseTableRows(tableHtml) {
  const rows = []
  const trRe = /<tr[\s\S]*?<\/tr>/gi
  let trM
  while ((trM = trRe.exec(tableHtml)) !== null) {
    const cells = []
    const tdRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi
    let tdM
    while ((tdM = tdRe.exec(trM[0])) !== null) cells.push(stripTags(tdM[1]))
    if (cells.some(c => c.trim())) rows.push(cells)
  }
  return rows
}

const SECTION_KEYWORDS = [
  'disaggregation of revenue','disaggregated revenue','segment information','segment reporting',
  'segment revenue','revenue by segment','revenue by product','revenue by geography',
  'revenue by geographic','revenues by segment','revenues by product','business segments',
  'net revenues by','geographic data','net sales by category','net sales by product',
  'net sales by segment','sales by product','sales by geography','revenues by geography',
  'energy generation and storage','total automotive revenues','other bets',
]

async function main() {
  const r = await axios.get('https://www.sec.gov/files/company_tickers.json', { headers: HDR, timeout: 15000 })
  const entry = Object.values(r.data).find(e => e.ticker === 'GOOGL')
  const cik = String(entry.cik_str).padStart(10, '0')
  const sub = await axios.get(`https://data.sec.gov/submissions/CIK${cik}.json`, { headers: HDR, timeout: 15000 })
  const f = sub.data?.filings?.recent
  let accession, primaryDoc
  for (let i = 0; i < f.form.length; i++) {
    if (f.form[i] === '10-K') { accession = f.accessionNumber[i].replace(/-/g, ''); primaryDoc = f.primaryDocument[i]; break }
  }
  const cikInt = parseInt(cik, 10)
  const docUrl = `https://www.sec.gov/Archives/edgar/data/${cikInt}/${accession}/${primaryDoc}`
  const resp = await axios.get(docUrl, {
    headers: { 'User-Agent': HDR['User-Agent'], Accept: 'text/html,*/*' },
    timeout: 60000, maxContentLength: 15 * 1024 * 1024, responseType: 'text',
  })
  let html = resp.data
  html = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<!--[\s\S]*?-->/g, '')
  const lower = html.toLowerCase()

  // Collect keyword positions
  const kwPositions = []
  for (const kw of SECTION_KEYWORDS) {
    let idx = 0
    while ((idx = lower.indexOf(kw, idx)) !== -1) {
      if (idx > html.length * 0.05) kwPositions.push(idx)
      idx += kw.length
    }
  }
  const deduped = kwPositions.sort((a, b) => a - b).filter((p, i, arr) => i === 0 || p - arr[i-1] > 5000)
  console.log('Total deduped keyword positions:', deduped.length)
  console.log('First 14:', deduped.slice(0, 14).map(p => `${p}(${(p/html.length*100).toFixed(1)}%)`))

  // Collect candidates
  const seenAbsPos = new Set()
  const candidates = []
  for (const pos of deduped.slice(0, 14)) {
    const winStart = Math.max(0, pos - 10000)
    const winEnd = Math.min(html.length, winStart + 70000)
    const win = html.slice(winStart, winEnd)
    const topLevelTables = extractTopLevelTables(win)
    for (const t of topLevelTables) {
      const absPos = winStart + t.pos
      if (seenAbsPos.has(absPos)) continue
      seenAbsPos.add(absPos)
      const rows = parseTableRows(t.html)
      if (rows.length < 3) continue
      const ctxStart = Math.max(0, t.pos - 3000)
      const ctxEnd = Math.min(win.length, t.pos + 300)
      const context = stripTags(win.slice(ctxStart, ctxEnd))
      const mult = detectMultiplier(context)
      const score = scoreTable(rows, context)
      if (score >= 5) candidates.push({ absPos, rows, context, mult, score })
    }
  }

  candidates.sort((a, b) => b.score - a.score)
  console.log('\nTop 10 candidates by score:')
  candidates.slice(0, 10).forEach((c, i) => {
    const allText = c.rows.map(r => r.join(' ')).join(' ').toLowerCase().slice(0, 100)
    const ctx = c.context.toLowerCase().slice(-150)
    const valCol = findValueColumn(c.rows)
    const firstDataRow = c.rows.find(r => r.some(cell => parseDollar(cell) !== null))
    const firstVals = firstDataRow ? firstDataRow.slice(0, 5).map(c => c.slice(0, 20)) : []
    console.log(`\n#${i+1}: pos=${c.absPos}(${(c.absPos/html.length*100).toFixed(1)}%) score=${c.score} rows=${c.rows.length} mult=${c.mult} valCol=${valCol}`)
    console.log(`  ctx: ...${ctx}`)
    console.log(`  allText[:100]: ${allText}`)
    console.log(`  firstDataRow: ${JSON.stringify(firstVals)}`)
  })
}

main().catch(console.error)
