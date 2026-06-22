// Full simulation of parseRevenueTable with all 3 fixes applied, for GOOGL
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
  if (t.endsWith('%')) return null
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

function getVal(row, valCol) {
  const v = parseDollar(row[valCol] || '')
  if (v !== null) return v
  if ((row[valCol] || '').replace(/[\s$£€¥,]/g, '') === '' && row[valCol + 1]) {
    return parseDollar(row[valCol + 1] || '')
  }
  return null
}

function fmtV(rawVal, mult) {
  const abs = Math.abs(rawVal) * mult
  if (abs >= 1e12) return `$${(abs/1e12).toFixed(1)}T`
  if (abs >= 1e9) return `$${(abs/1e9).toFixed(1)}B`
  if (abs >= 1e6) return `$${(abs/1e6).toFixed(0)}M`
  return `$${abs.toFixed(0)}`
}

// FIX 2: added "alphabet revenues?" to SKIP_LABELS
const SKIP_LABELS = /^(total|subtotal|consolidated|net\s+revenues?$|net\s+sales$|revenues?$|other\s*$|eliminations?|intersegment|corporate|alphabet\s+revenues?)/i
const BAD_LABELS = /cost\s+of|gross\s+profit|operating\s+income|operating\s+expense|selling,?\s+general|selling\s+and\s+marketing|marketing\s+expense|research\s+and\s+dev|income\s+tax|interest\s+expense|depreciation|amortization|ebitda|eps|earnings\s+per|weighted.average|diluted\s+shares|basic\s+shares|net\s+income|net\s+loss|net\s+earnings/i

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
  if (/cost\s+of|gross\s+profit|operating\s+income|selling,?\s+general/.test(allText)) score -= isSegmentRevenueNote ? 1 : 5
  if (/weighted.average|diluted\s+shares|basic\s+shares|earnings\s+per\s+share|per\s+share/.test(allText)) score -= 10
  if (/long.lived\s+assets|property,?\s+plant|right.of.use\s+asset|operating\s+lease\s+asset/.test(allText)) score -= 10
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

function parseRevenueTable(rows, mult, context, label = '') {
  const yearRow = rows.find(r => r.filter(c => /^20[012]\d$/.test((c||'').trim())).length >= 2)
  const headerYears = yearRow
    ? yearRow.map(c => /^20[012]\d$/.test((c||'').trim()) ? parseInt(c) : null).filter(Boolean) : []
  const useRightmost = headerYears.length >= 2 && headerYears[0] < headerYears[headerYears.length - 1]
  const valCol = useRightmost ? 1 : findValueColumn(rows)
  if (!useRightmost && valCol < 0) return { ok: false, reason: 'no value column', valCol, useRightmost }

  // FIX 1: skip numeric value when next cell is bare "%"
  const resolveVal = (row) => {
    if (useRightmost) {
      for (let c = row.length - 1; c >= 1; c--) {
        const v = parseDollar(row[c] || '')
        if (v !== null) {
          const nextIsPercent = c + 1 < row.length && (row[c+1] || '').replace(/\s/g, '') === '%'
          if (!nextIsPercent) return v
        }
      }
      return null
    }
    return getVal(row, valCol)
  }

  const earlyText = rows.slice(0, Math.min(5, rows.length)).map(r => r.join(' ')).join(' ')
  const inlineMult = detectMultiplier(earlyText)
  if (inlineMult > 1) mult = inlineMult

  let dataStart = 0
  while (dataStart < rows.length && rows[dataStart].slice(1).every(c => parseDollar(c) === null)) dataStart++
  if (dataStart >= rows.length) return { ok: false, reason: 'no data rows', dataStart }

  let totalVal = null
  const segments = []
  const seenLabels = new Set()

  for (let i = dataStart; i < rows.length; i++) {
    const row = rows[i]
    const lbl = (row[0] || '').trim()
    if (!lbl) continue
    const val = resolveVal(row)
    if (val === null) continue
    if (segments.length === 0 && Number.isInteger(val) && val >= 2018 && val <= 2030) continue
    if (/^\(?(?:dollars?|in)\s+(?:in\s+)?(?:millions|thousands|billions)\b/i.test(lbl)) continue
    if (SKIP_LABELS.test(lbl)) { totalVal = val; continue }
    if (BAD_LABELS.test(lbl)) { if (segments.length >= 2) break; else continue }
    if (lbl.length < 2 || lbl.length > 65) continue
    if (/^\d{4}$/.test(lbl) && +lbl >= 1990 && +lbl <= 2035) continue
    const labelKey = lbl.toLowerCase()
    if (seenLabels.has(labelKey) && segments.length >= 2) break
    seenLabels.add(labelKey)
    segments.push({ label: lbl, rawVal: val })
  }

  if (segments.length < 2) return { ok: false, reason: `only ${segments.length} segments`, segments }

  const sum = segments.reduce((s, seg) => s + Math.abs(seg.rawVal), 0)
  const total = totalVal != null ? Math.abs(totalVal) : sum
  if (total === 0) return { ok: false, reason: 'total=0' }
  if (totalVal != null && sum > total * 1.5) return { ok: false, reason: `double-count sum=${sum} total=${total}` }

  const result = segments
    .map(s => ({ label: s.label, value: Math.abs(s.rawVal) * mult, pct: Math.round(Math.abs(s.rawVal) / total * 1000) / 10, fmtValue: fmtV(s.rawVal, mult) }))
    .filter(s => s.pct >= 0.3)
    .sort((a, b) => b.value - a.value)
    .slice(0, 8)

  if (result.length < 2) return { ok: false, reason: `only ${result.length} result after filter` }

  // FIX 3: type classification by label content first
  const labelText = rows.slice(dataStart).map(r => (r[0] || '').trim()).join(' ').toLowerCase()
  const geoInLabels = /\b(americas|emea|apac|asia.pacific|europe|middle.east|africa|latin.america|north.america|south.america|united\s+states|other\s+americas|rest\s+of\s+world|international)\b/.test(labelText)
  const bizInLabels = /\b(cloud|advertising|services|search|gaming|devices|hardware|subscription|licensing|automotive|energy|platform|productivity|computing|content|streaming)\b/.test(labelText)
  const ctx = context.toLowerCase()
  const type = (geoInLabels && !bizInLabels) ? 'geographic'
    : (bizInLabels && !geoInLabels) ? 'product'
    : /geographic|geography|region|international|domestic|americas|emea|apac/.test(ctx) ? 'geographic'
    : /product|service|platform|solution|segment/.test(ctx) ? 'product'
    : 'segment'

  return { ok: true, segments: result, type, totalFmt: fmtV(total, mult), sum, totalVal, mult, useRightmost, dataStart }
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
  console.log('Fetching GOOGL 10-K...')
  const resp = await axios.get(docUrl, {
    headers: { 'User-Agent': HDR['User-Agent'], Accept: 'text/html,*/*' },
    timeout: 60000, maxContentLength: 15 * 1024 * 1024, responseType: 'text',
  })
  let html = resp.data
  html = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<!--[\s\S]*?-->/g, '')
  console.log(`HTML size: ${(html.length/1024/1024).toFixed(1)}MB`)
  const lower = html.toLowerCase()

  const kwPositions = []
  for (const kw of SECTION_KEYWORDS) {
    let idx = 0
    while ((idx = lower.indexOf(kw, idx)) !== -1) {
      if (idx > html.length * 0.05) kwPositions.push(idx)
      idx += kw.length
    }
  }
  const deduped = kwPositions.sort((a, b) => a - b).filter((p, i, arr) => i === 0 || p - arr[i-1] > 5000)
  console.log(`Deduped positions: ${deduped.length}`)
  console.log('First 5:', deduped.slice(0,5).map(p => `${p}(${(p/html.length*100).toFixed(1)}%)`))
  console.log('Last 5:', deduped.slice(-5).map(p => `${p}(${(p/html.length*100).toFixed(1)}%)`))

  const seenAbsPos = new Set()
  const candidates = []

  for (const pos of deduped.slice(0, 25)) {
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
  console.log(`\nTotal candidates: ${candidates.length}`)
  console.log('Top 10 by score:')

  let winner = null
  for (let i = 0; i < Math.min(candidates.length, 10); i++) {
    const c = candidates[i]
    const allText = c.rows.map(r => r.join(' ')).join(' ').toLowerCase().slice(0, 80)
    const parsed = parseRevenueTable(c.rows, c.mult, c.context)
    const status = parsed.ok ? `OK type=${parsed.type}` : `FAIL: ${parsed.reason}`
    console.log(`\n  #${i+1}: pos=${c.absPos}(${(c.absPos/html.length*100).toFixed(1)}%) score=${c.score} rows=${c.rows.length} mult=${c.mult}`)
    console.log(`    allText: ${allText}`)
    console.log(`    -> ${status}`)
    if (parsed.ok) {
      console.log(`    segments: ${parsed.segments.map(s => `${s.label}(${s.fmtValue})`).join(', ')}`)
      if (!winner) { winner = parsed; console.log(`    *** WINNER ***`) }
    }
  }

  if (winner) {
    console.log('\n=== FINAL RESULT ===')
    console.log(`type: ${winner.type} | total: ${winner.totalFmt}`)
    winner.segments.forEach(s => console.log(`  ${s.label}: ${s.fmtValue} (${s.pct}%)`))
  } else {
    console.log('\n=== NO WINNER FOUND ===')
  }
}

main().catch(console.error)
