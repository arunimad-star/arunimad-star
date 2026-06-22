import axios from 'axios'

const SEC = 'https://data.sec.gov'
const EDGAR = 'https://www.sec.gov'
const HDR = { 'User-Agent': 'arunimad@berkeley.edu', Accept: 'application/json' }
const CACHE_TTL = 6 * 60 * 60 * 1000

const cikCache = { data: null, ts: 0 }
const segmentCache = new Map()

async function getCik(ticker) {
  if (!cikCache.data || Date.now() - cikCache.ts > CACHE_TTL) {
    const r = await axios.get('https://www.sec.gov/files/company_tickers.json', { headers: HDR, timeout: 10000 })
    cikCache.data = r.data; cikCache.ts = Date.now()
  }
  const entry = Object.values(cikCache.data).find(e => e.ticker === ticker.toUpperCase())
  return entry ? String(entry.cik_str).padStart(10, '0') : null
}

// Get most recent 10-K filing metadata from EDGAR submissions
async function getLatest10K(cik) {
  const r = await axios.get(`${SEC}/submissions/CIK${cik}.json`, { headers: HDR, timeout: 10000 })
  const f = r.data?.filings?.recent
  if (!f) return null
  for (let i = 0; i < f.form.length; i++) {
    if (f.form[i] === '10-K') {
      return {
        accession: f.accessionNumber[i].replace(/-/g, ''),
        year: (f.reportDate?.[i] || f.filingDate?.[i] || '').slice(0, 4),
        primaryDoc: f.primaryDocument[i],
      }
    }
  }
  return null
}

// ── HTML helpers ──────────────────────────────────────────────────────────────

function stripTags(s) {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#\d+;/g, ' ')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Parse "$1,234", "(1,234)", "1234.5" → number; null if not numeric
function parseDollar(s) {
  if (!s) return null
  const t = s.replace(/[\$,\s]/g, '').trim()
  if (t.endsWith('%')) return null  // reject percentage values (e.g. "48 %")
  if (/^\([\d.]+\)$/.test(t)) return -parseFloat(t.slice(1, -1))
  const n = parseFloat(t)
  return isNaN(n) || t === '' ? null : n
}

// Like parseDollar(row[valCol]) but handles a standalone '$' cell before the value
// (e.g. AAPL table where iPhone row is ['iPhone', '$', '209,586', ...])
function getVal(row, valCol) {
  const v = parseDollar(row[valCol] || '')
  if (v !== null) return v
  if ((row[valCol] || '').replace(/[\s$£€¥,]/g, '') === '' && row[valCol + 1]) {
    return parseDollar(row[valCol + 1] || '')
  }
  return null
}

// Extract top-level tables only (handles nesting by tracking depth)
function extractTopLevelTables(html) {
  const results = []
  let depth = 0, start = -1
  let i = 0
  while (i < html.length) {
    if (html[i] === '<') {
      const tagEnd = html.indexOf('>', i)
      if (tagEnd === -1) break
      const tag = html.slice(i + 1, tagEnd).trim().toLowerCase()
      if (tag.startsWith('table') && (tag.length === 5 || /\s/.test(tag[5]))) {
        if (depth === 0) start = i
        depth++
      } else if (tag === '/table') {
        depth--
        if (depth === 0 && start >= 0) {
          results.push({ html: html.slice(start, tagEnd + 1), pos: start })
          start = -1
        }
      }
      i = tagEnd + 1
    } else {
      i++
    }
  }
  return results
}

// Parse a single table HTML into rows of cell text
function parseTableRows(tableHtml) {
  const rows = []
  const trRe = /<tr[\s\S]*?<\/tr>/gi
  let trM
  while ((trM = trRe.exec(tableHtml)) !== null) {
    const cells = []
    const tdRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi
    let tdM
    while ((tdM = tdRe.exec(trM[0])) !== null) {
      cells.push(stripTags(tdM[1]))
    }
    if (cells.some(c => c.trim())) rows.push(cells)
  }
  return rows
}

// For tables that span more than the 70KB search window, find the matching </table>
// (even if 200KB away) and then parse the rows within the known bounds.
function extractLargeTableRows(html, tableStartPos, maxRows = 80) {
  // Walk forward to find the matching </table>, tracking nesting depth
  let depth = 0
  let pos = tableStartPos
  let tableEnd = -1
  const limit = Math.min(html.length, tableStartPos + 600000)
  while (pos < limit) {
    if (html[pos] !== '<') { pos++; continue }
    const te = html.indexOf('>', pos)
    if (te < 0) break
    const tag = html.slice(pos + 1, te).trim().toLowerCase()
    if (tag.startsWith('table') && (tag.length === 5 || (tag.length > 5 && /\s/.test(tag[5])))) {
      depth++
    } else if (tag === '/table') {
      depth--
      if (depth === 0) { tableEnd = te + 1; break }
    }
    pos = te + 1
  }
  // Parse rows strictly within the first complete table
  const tableHtml = html.slice(tableStartPos, tableEnd > 0 ? tableEnd : Math.min(limit, tableStartPos + 500000))
  const rows = parseTableRows(tableHtml).slice(0, maxRows)
  return rows.length >= 3 ? rows : null
}

// Detect unit multiplier from surrounding text
function detectMultiplier(context) {
  const s = context.toLowerCase()
  if (/in\s+billions/.test(s)) return 1e9
  if (/in\s+millions/.test(s)) return 1e6
  if (/in\s+thousands/.test(s)) return 1e3
  return 1
}

// Score a table as a candidate revenue segment breakdown
function scoreTable(rows, context) {
  if (rows.length < 3 || rows.length > 80) return 0
  let score = 0
  const allText = rows.map(r => r.join(' ')).join(' ').toLowerCase()
  const ctx = context.toLowerCase()

  // Penalize unearned/deferred revenue tables — we want recognized revenue
  if (/unearned\s+revenue|deferred\s+revenue/.test(ctx)) score -= 8

  // Context bonuses
  if (/disaggregat/.test(ctx)) score += 6
  if (/segment\s+information|segment\s+reporting|business\s+segment/.test(ctx)) score += 5
  // "segment revenue, cost of revenue" is the exact MSFT segment note header
  if (/segment\s+revenue(?:,\s*cost|\s+and\s+cost)/.test(ctx)) score += 8
  if (/revenue\s+by|revenues\s+by|net\s+revenues\s+by/.test(ctx)) score += 5
  if (/geographic|geography|region/.test(ctx)) score += 3
  if (/product\s+line|product\s+category|service\s+line/.test(ctx)) score += 3

  // Table content bonuses
  if (allText.includes('total') || allText.includes('consolidated')) score += 2
  if (/cloud|platform|hardware|software|service|subscription|license|maintenance/.test(allText)) score += 3
  if (/americas|emea|apac|international|domestic|united\s+states/.test(allText)) score += 3
  // Alphabet/GOOGL: strongly favor the 3-segment table (which has "other bets" as a row)
  // over the geographic breakdown that also appears in Note 15.
  if (/other\s+bets/.test(allText)) score += 8

  // Check numeric column(s)
  let numericColCount = 0
  const maxCols = Math.max(...rows.map(r => r.length))
  for (let col = 1; col < Math.min(maxCols, 5); col++) {
    const vals = rows.slice(1).map(r => r[col]).filter(Boolean)
    if (vals.length > 0 && vals.filter(v => parseDollar(v) !== null).length / vals.length > 0.5) numericColCount++
  }
  if (numericColCount >= 1) score += 4
  if (numericColCount >= 2) score += 1

  // Penalize income-statement / EPS tables.
  // Only reduce the penalty if this is specifically the segment revenue note (MSFT-style)
  const isSegmentRevenueNote = /segment\s+revenue(?:,\s*cost|\s+and\s+cost)/.test(ctx)
  if (/cost\s+of|gross\s+profit|operating\s+income|selling,?\s+general/.test(allText)) score -= isSegmentRevenueNote ? 1 : 5
  if (/weighted.average|diluted\s+shares|basic\s+shares|earnings\s+per\s+share|per\s+share/.test(allText)) score -= 10

  // Penalize balance-sheet asset/liability tables — they appear near segment notes but
  // contain property, long-lived assets, etc., not revenue.
  if (/long.lived\s+assets|property,?\s+plant|right.of.use\s+asset|operating\s+lease\s+asset/.test(allText)) score -= 10

  // Reward clean segment count (5-12 rows is typical for product/geographic breakdowns)
  if (rows.length >= 3 && rows.length <= 15) score += 2

  return score
}

// Find the most recent data column (skip label col 0, find first col with mostly numbers)
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

function fmtV(rawVal, mult) {
  const abs = Math.abs(rawVal) * mult
  if (abs >= 1e12) return `$${(abs / 1e12).toFixed(1)}T`
  if (abs >= 1e9) return `$${(abs / 1e9).toFixed(1)}B`
  if (abs >= 1e6) return `$${(abs / 1e6).toFixed(0)}M`
  if (abs >= 1e3) return `$${(abs / 1e3).toFixed(0)}K`
  return `$${abs.toFixed(0)}`
}

const SKIP_LABELS = /^(total|subtotal|consolidated|net\s+revenues?$|net\s+sales$|revenues?$|other\s*$|eliminations?|intersegment|corporate|alphabet\s+revenues?)/i
const BAD_LABELS = /cost\s+of|gross\s+profit|operating\s+income|operating\s+expense|selling,?\s+general|selling\s+and\s+marketing|marketing\s+expense|research\s+and\s+dev|income\s+tax|interest\s+expense|depreciation|amortization|ebitda|eps|earnings\s+per|weighted.average|diluted\s+shares|basic\s+shares|net\s+income|net\s+loss|net\s+earnings/i

function parseRevenueTable(rows, mult, context) {
  // Detect if the header row lists years in ascending order (e.g. "2023 | 2024 | 2025").
  // Alphabet/GOOGL and some other filers put the oldest year first; in that case the
  // rightmost numeric cell per row is the most recent year's value.
  const yearRow = rows.find(r => r.filter(c => /^20[012]\d$/.test((c||'').trim())).length >= 2)
  const headerYears = yearRow
    ? yearRow.map(c => /^20[012]\d$/.test((c||'').trim()) ? parseInt(c) : null).filter(Boolean) : []
  const useRightmost = headerYears.length >= 2 && headerYears[0] < headerYears[headerYears.length - 1]

  const valCol = useRightmost ? 1 : findValueColumn(rows)
  if (!useRightmost && valCol < 0) return null

  // Resolve the value for a row: rightmost numeric cell (ascending-year tables) or
  // the standard value column with '$'-cell fallback (descending-year tables).
  const resolveVal = (row) => {
    if (useRightmost) {
      for (let c = row.length - 1; c >= 1; c--) {
        const v = parseDollar(row[c] || '')
        if (v !== null) {
          // Skip if the immediately following cell is a bare "%" — indicates a
          // percentage table where numbers like "48" represent "48%", not "$48M".
          const nextIsPercent = c + 1 < row.length && (row[c+1] || '').replace(/\s/g, '') === '%'
          if (!nextIsPercent) return v
        }
      }
      return null
    }
    return getVal(row, valCol)
  }

  // Check the first few rows for an inline unit hint — some tables embed "(Dollars in millions)"
  // as a header row rather than in surrounding prose, so detectMultiplier(context) misses it.
  const earlyText = rows.slice(0, Math.min(5, rows.length)).map(r => r.join(' ')).join(' ')
  const inlineMult = detectMultiplier(earlyText)
  if (inlineMult > 1) mult = inlineMult

  // Find first data row (skip all-text header rows)
  let dataStart = 0
  while (dataStart < rows.length && rows[dataStart].slice(1).every(c => parseDollar(c) === null)) dataStart++
  if (dataStart >= rows.length) return null

  let totalVal = null
  const segments = []
  const seenLabels = new Set()  // detect tables that repeat labels (e.g. revenue + op.income)

  // First pass: simple flat table
  for (let i = dataStart; i < rows.length; i++) {
    const row = rows[i]
    const label = (row[0] || '').trim()
    if (!label) continue
    const val = resolveVal(row)
    if (val === null) continue
    // Skip column-header rows where a year (2018–2030) ended up in the value column.
    // Only apply before collecting any real segments — after that, values like $1,993M or
    // $2,024M are legitimate revenue figures, not year labels.
    if (segments.length === 0 && Number.isInteger(val) && val >= 2018 && val <= 2030) continue
    // Skip currency-unit annotation rows like "(Dollars in millions)", "(in millions)"
    if (/^\(?(?:dollars?|in)\s+(?:in\s+)?(?:millions|thousands|billions)\b/i.test(label)) continue
    if (SKIP_LABELS.test(label)) { totalVal = val; continue }
    // Once we have 2+ segments, stop at the first cost/expense line — this trims income
    // statement tables cleanly after the revenue section without affecting pure segment tables.
    if (BAD_LABELS.test(label)) { if (segments.length >= 2) break; else continue }
    if (label.length < 2 || label.length > 65) continue
    // Skip year-like labels (e.g. "2025", "2024" from column headers bleeding into col 0)
    if (/^\d{4}$/.test(label) && +label >= 1990 && +label <= 2035) continue
    // If we encounter a label we already collected, we've entered a new sub-section
    // (e.g. operating income section after revenue section). Stop collecting.
    const labelKey = label.toLowerCase()
    if (seenLabels.has(labelKey) && segments.length >= 2) break
    seenLabels.add(labelKey)
    segments.push({ label, rawVal: val })
  }

  // If flat parse failed, try hierarchical structure (e.g. MSFT: parent section headers
  // with no values, then sub-rows "Revenue", "Cost of revenue", etc.)
  if (segments.length < 2) {
    const hSegments = []
    let pendingParent = null
    for (let i = dataStart; i < rows.length; i++) {
      const row = rows[i]
      const label = (row[0] || '').trim()
      if (!label) continue
      const val = getVal(row, valCol)
      if (val === null) {
        // Section header (no numeric value)
        if (!SKIP_LABELS.test(label) && !BAD_LABELS.test(label) && label.length > 5
            && !(/^\d{4}$/.test(label) && +label >= 1990 && +label <= 2035)) {
          pendingParent = label
        }
      } else if (pendingParent && /^revenues?$/i.test(label)) {
        // First "Revenue" sub-row under a section header = segment revenue
        hSegments.push({ label: pendingParent, rawVal: val })
        pendingParent = null
      } else if (SKIP_LABELS.test(label)) {
        totalVal = val
        pendingParent = null
      }
    }
    if (hSegments.length >= 2) {
      segments.length = 0
      segments.push(...hSegments)
    }
  }

  if (segments.length < 2) return null

  const sum = segments.reduce((s, seg) => s + Math.abs(seg.rawVal), 0)
  const total = totalVal != null ? Math.abs(totalVal) : sum
  if (total === 0) return null

  // Reject hierarchical tables where sub-items AND their subtotals are both collected,
  // causing double-counting (sum >> total). E.g. GOOGL's MD&A table has "Google Search",
  // "YouTube", "Google advertising" (subtotal), "Google Services total" (parent subtotal)
  // all collected, making sum ~2.6× total. Clean segment tables have sum ≈ total.
  if (totalVal != null && sum > total * 1.5) return null

  const result = segments
    .map(s => ({
      label: s.label,
      value: Math.abs(s.rawVal) * mult,
      pct: Math.round(Math.abs(s.rawVal) / total * 1000) / 10,
      fmtValue: fmtV(s.rawVal, mult),
    }))
    .filter(s => s.pct >= 0.3)
    .sort((a, b) => b.value - a.value)
    .slice(0, 8)

  if (result.length < 2) return null

  // Classify by the actual segment labels first — more reliable than context.
  // The context may say "Geographic Areas" even when the table contains business
  // segment labels (e.g. GOOGL Note 15: "Google Services", "Google Cloud", "Other Bets").
  const labelText = rows.slice(dataStart).map(r => (r[0] || '').trim()).join(' ').toLowerCase()
  const geoInLabels = /\b(americas|emea|apac|asia.pacific|europe|middle.east|africa|latin.america|north.america|south.america|united\s+states|other\s+americas|rest\s+of\s+world|international)\b/.test(labelText)
  const bizInLabels = /\b(cloud|advertising|services|search|gaming|devices|hardware|subscription|licensing|automotive|energy|platform|productivity|computing|content|streaming)\b/.test(labelText)
  const ctx = context.toLowerCase()
  const type = (geoInLabels && !bizInLabels) ? 'geographic'
    : (bizInLabels && !geoInLabels) ? 'product'
    : /geographic|geography|region|international|domestic|americas|emea|apac/.test(ctx) ? 'geographic'
    : /product|service|platform|solution|segment/.test(ctx) ? 'product'
    : 'segment'

  return { segments: result, type, totalFmt: fmtV(total, mult) }
}

// ── 10-K scraper ──────────────────────────────────────────────────────────────

// Keywords that mark a revenue/segment section in a 10-K
const SECTION_KEYWORDS = [
  'disaggregation of revenue',
  'disaggregated revenue',
  'segment information',
  'segment reporting',
  'segment revenue',
  'revenue by segment',
  'revenue by product',
  'revenue by geography',
  'revenue by geographic',
  'revenues by segment',
  'revenues by product',
  'business segments',
  'net revenues by',
  'geographic data',
  'net sales by category',
  'net sales by product',
  'net sales by segment',
  'sales by product',
  'sales by geography',
  'revenues by geography',
  // Tesla: Automotive / Energy generation / Services revenue section markers
  'energy generation and storage',
  'total automotive revenues',
  // Alphabet/GOOGL: the "Other Bets" label is unique to Alphabet's segment note
  'other bets',
]

async function scrape10K(cik) {
  const filing = await getLatest10K(cik)
  if (!filing) return null

  const cikInt = parseInt(cik, 10)
  const docUrl = `${EDGAR}/Archives/edgar/data/${cikInt}/${filing.accession}/${filing.primaryDoc}`

  let html
  try {
    const resp = await axios.get(docUrl, {
      headers: { 'User-Agent': HDR['User-Agent'], Accept: 'text/html,*/*' },
      timeout: 45000,
      maxContentLength: 12 * 1024 * 1024,
      responseType: 'text',
    })
    html = resp.data
  } catch (err) {
    console.warn('10-K fetch failed:', err.message)
    return null
  }

  if (!html || html.length < 5000) return null

  // Remove script/style/comments to reduce noise
  html = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')

  const lower = html.toLowerCase()

  // Collect all keyword hit positions (skip TOC hits at beginning)
  const kwPositions = []
  for (const kw of SECTION_KEYWORDS) {
    let idx = 0
    while ((idx = lower.indexOf(kw, idx)) !== -1) {
      // Skip occurrences in the first 5% (likely TOC)
      if (idx > html.length * 0.05) kwPositions.push(idx)
      idx += kw.length
    }
  }
  // Deduplicate nearby positions (within 5KB = same section hit)
  const deduped = kwPositions.sort((a, b) => a - b).filter((p, i, arr) => i === 0 || p - arr[i - 1] > 5000)
  // Also add a fallback window in the last 55% of the document if no hits
  if (!deduped.length) deduped.push(Math.floor(html.length * 0.45))

  // Collect ALL candidate tables scored ≥ 5, deduplicated by absolute position.
  // We try them in score order; the top-scorer may fail parseRevenueTable (e.g. GOOGL's
  // MD&A hierarchical table is rejected by double-counting check), so we fall through
  // to the next candidate (e.g. GOOGL's clean 3-segment Note 15 table).
  const seenAbsPos = new Set()
  const candidates = []

  for (const pos of deduped.slice(0, 25)) {
    // Search a 70KB window around each keyword position.
    // Look back 10KB so we catch tables that START just before the keyword hit.
    const winStart = Math.max(0, pos - 10000)
    const winEnd = Math.min(html.length, winStart + 70000)
    const win = html.slice(winStart, winEnd)

    const topLevelTables = extractTopLevelTables(win)

    if (topLevelTables.length > 0) {
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
        if (score >= 5) candidates.push({ rows, context, mult, score })
      }
    } else {
      // No complete top-level table found — the table may span more than the window.
      // Search for the first <table> within 40KB of the keyword position.
      const lowerWin = win.toLowerCase()
      const tblOffset = lowerWin.indexOf('<table')
      const tblAbsPos = tblOffset >= 0 ? winStart + tblOffset : -1
      if (tblAbsPos >= 0 && tblAbsPos - pos < 40000 && !seenAbsPos.has(tblAbsPos)) {
        seenAbsPos.add(tblAbsPos)
        const ctxText = stripTags(win.slice(Math.max(0, tblOffset - 3000), tblOffset + 2000))
        const mult = detectMultiplier(ctxText)
        const rows = extractLargeTableRows(html, tblAbsPos)
        if (rows && rows.length >= 3) {
          const score = scoreTable(rows, ctxText)
          if (score >= 5) candidates.push({ rows, context: ctxText, mult, score })
        }
      }
    }
  }

  // Try candidates from highest to lowest score
  candidates.sort((a, b) => b.score - a.score)
  for (const cand of candidates.slice(0, 8)) {
    const parsed = parseRevenueTable(cand.rows, cand.mult, cand.context)
    if (parsed) return { ...parsed, year: filing.year, source: '10k' }
  }
  return null
}

// ── XBRL fallback (original approach) ────────────────────────────────────────

const REVENUE_CONCEPTS = [
  'RevenueFromContractWithCustomerExcludingAssessedTax',
  'Revenues', 'SalesRevenueNet', 'SalesRevenueGoodsNet',
  'RevenueFromContractWithCustomerIncludingAssessedTax',
]

function cleanLabel(raw = '') {
  return raw
    .replace(/Member$/, '').replace(/Segment$/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/^[a-z]+:/, '').trim()
}

async function xbrlSegments(cik) {
  const r = await axios.get(`${SEC}/api/xbrl/companyfacts/CIK${cik}.json`, {
    headers: HDR, timeout: 30000, maxContentLength: 25 * 1024 * 1024,
  })
  const gaap = r.data?.facts?.['us-gaap'] || {}

  for (const concept of REVENUE_CONCEPTS) {
    const items = gaap[concept]?.units?.USD || []
    const withSeg = items.filter(i => i.form === '10-K' && i.segment?.label)
    if (withSeg.length < 2) continue

    const latestFiled = withSeg.reduce((m, i) => i.filed > m ? i.filed : m, '')
    const latestAccn = withSeg.find(i => i.filed === latestFiled)?.accn
    const periodItems = withSeg.filter(i => i.accn === latestAccn)
    if (periodItems.length < 2) continue

    const classify = dim => {
      if (!dim) return 'other'
      if (/StatementBusinessSegments|BusinessSegments|ProductOrService|Product|Service/.test(dim)) return 'product'
      if (/Geographical|Geographic|StatementGeo/.test(dim)) return 'geographic'
      return 'other'
    }
    const productItems = periodItems.filter(i => classify(i.segment.dimension) === 'product')
    const geoItems = periodItems.filter(i => classify(i.segment.dimension) === 'geographic')
    const useItems = productItems.length >= 2 ? productItems : geoItems.length >= 2 ? geoItems : periodItems
    const type = productItems.length >= 2 ? 'product' : geoItems.length >= 2 ? 'geographic' : 'segment'
    if (useItems.length < 2) continue

    const byLabel = {}
    for (const item of useItems) {
      const label = item.segment.label || cleanLabel(item.segment.member || '')
      if (!byLabel[label] || item.val > byLabel[label]) byLabel[label] = item.val
    }
    const total = Object.values(byLabel).reduce((s, v) => s + v, 0)
    if (!total || Object.keys(byLabel).length < 2) continue

    const f = v => {
      const a = Math.abs(v)
      if (a >= 1e12) return `$${(v/1e12).toFixed(1)}T`
      if (a >= 1e9) return `$${(v/1e9).toFixed(1)}B`
      if (a >= 1e6) return `$${(v/1e6).toFixed(0)}M`
      return `$${v}`
    }
    const segments = Object.entries(byLabel)
      .map(([label, value]) => ({ label, value, pct: Math.round(value / total * 1000) / 10, fmtValue: f(value) }))
      .sort((a, b) => b.value - a.value).slice(0, 8)

    return { segments, type, year: periodItems[0]?.end?.slice(0, 4) || latestFiled.slice(0, 4), totalFmt: f(total), source: 'xbrl' }
  }
  return null
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const { ticker } = req.query
  if (!ticker) return res.status(400).json({ error: 'Missing ticker' })

  const sym = ticker.toUpperCase()
  const hit = segmentCache.get(sym)
  if (hit && Date.now() - hit.ts < CACHE_TTL) return res.status(200).json(hit.data)

  try {
    const cik = await getCik(sym)
    if (!cik) return res.status(200).json({ error: `No SEC filing for ${sym}`, ticker: sym, segments: [] })

    // Try 10-K scrape first
    let result = null
    try { result = await scrape10K(cik) } catch (e) { console.warn('10K scrape error:', e.message) }

    // If 10-K returned only a geographic breakdown (less informative), try XBRL which
    // already knows how to prefer product/segment breakdowns over geographic ones.
    if (!result || result.type === 'geographic') {
      let xbrl = null
      try { xbrl = await xbrlSegments(cik) } catch (e) { console.warn('XBRL fallback error:', e.message) }
      // Use XBRL when it has a product breakdown, or when 10-K found nothing at all
      if (xbrl && (!result || xbrl.type === 'product')) result = xbrl
    }

    const data = result
      ? { ticker: sym, ...result }
      : { ticker: sym, segments: [], type: null }

    segmentCache.set(sym, { data, ts: Date.now() })
    return res.status(200).json(data)
  } catch (err) {
    console.error('revenue-segments error:', err.message)
    return res.status(200).json({ error: err.message, ticker: sym, segments: [] })
  }
}
