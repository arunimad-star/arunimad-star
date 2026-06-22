// Direct trace of parseRevenueTable on the Note 15 segment table
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

const SKIP_LABELS = /^(total|subtotal|consolidated|net\s+revenues?$|net\s+sales$|revenues?$|other\s*$|eliminations?|intersegment|corporate)/i
const BAD_LABELS = /cost\s+of|gross\s+profit|operating\s+income|operating\s+expense|selling,?\s+general|selling\s+and\s+marketing|marketing\s+expense|research\s+and\s+dev|income\s+tax|interest\s+expense|depreciation|amortization|ebitda|eps|earnings\s+per|weighted.average|diluted\s+shares|basic\s+shares|net\s+income|net\s+loss|net\s+earnings/i

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

  // Parse the Note 15 segment table at 2359364
  const winStart = 2356531
  const win = html.slice(winStart, winStart + 70000)
  const tables = extractTopLevelTables(win)

  console.log('Tables in window:', tables.length)

  // Find the segment table (Table 1 at abs=2359364)
  const segTable = tables.find(t => winStart + t.pos === 2359364)
  if (!segTable) {
    console.log('Segment table NOT found in window!')
    console.log('Table abs positions:', tables.map(t => winStart + t.pos))
    return
  }

  const rows = parseTableRows(segTable.html)
  console.log('Segment table rows:', rows.length)

  // Detect ascending years
  const yearRow = rows.find(r => r.filter(c => /^20[012]\d$/.test((c||'').trim())).length >= 2)
  const headerYears = yearRow ? yearRow.map(c => /^20[012]\d$/.test((c||'').trim()) ? parseInt(c) : null).filter(Boolean) : []
  const useRightmost = headerYears.length >= 2 && headerYears[0] < headerYears[headerYears.length - 1]
  console.log('yearRow:', yearRow)
  console.log('headerYears:', headerYears)
  console.log('useRightmost:', useRightmost)

  const valCol = useRightmost ? 1 : findValueColumn(rows)
  console.log('valCol:', valCol)

  const resolveVal = (row) => {
    if (useRightmost) {
      for (let c = row.length - 1; c >= 1; c--) {
        const v = parseDollar(row[c] || '')
        if (v !== null) return v
      }
      return null
    }
    return getVal(row, valCol)
  }

  // Find dataStart
  let dataStart = 0
  while (dataStart < rows.length && rows[dataStart].slice(1).every(c => parseDollar(c) === null)) dataStart++
  console.log('dataStart:', dataStart)

  // Simulate flat parse
  let totalVal = null
  const segments = []
  const seenLabels = new Set()

  for (let i = dataStart; i < Math.min(rows.length, 15); i++) {
    const row = rows[i]
    const label = (row[0] || '').trim()
    if (!label) { console.log(`Row ${i}: no label, skip`); continue }
    const val = resolveVal(row)
    console.log(`Row ${i}: label="${label}", val=${val}`)
    if (val === null) { console.log('  -> val null, skip'); continue }
    if (segments.length === 0 && Number.isInteger(val) && val >= 2018 && val <= 2030) { console.log('  -> year filter skip'); continue }
    if (/^\(?(?:dollars?|in)\s+(?:in\s+)?(?:millions|thousands|billions)\b/i.test(label)) { console.log('  -> currency annotation skip'); continue }
    if (SKIP_LABELS.test(label)) { console.log('  -> SKIP_LABELS, totalVal =', val); totalVal = val; continue }
    if (BAD_LABELS.test(label)) { console.log(`  -> BAD_LABELS ${segments.length>=2?'BREAK':'skip'}`); if (segments.length >= 2) break; else continue }
    if (label.length < 2 || label.length > 65) { console.log('  -> length filter skip'); continue }
    if (/^\d{4}$/.test(label) && +label >= 1990 && +label <= 2035) { console.log('  -> year label skip'); continue }
    const labelKey = label.toLowerCase()
    if (seenLabels.has(labelKey) && segments.length >= 2) { console.log('  -> SEEN LABEL BREAK'); break }
    seenLabels.add(labelKey)
    segments.push({ label, rawVal: val })
    console.log(`  -> PUSHED, segments.length=${segments.length}`)
  }

  console.log('\n=== Result ===')
  console.log('segments:', segments.length)
  segments.forEach(s => console.log(' ', s.label, s.rawVal))
  console.log('totalVal:', totalVal)
  const sum = segments.reduce((s, seg) => s + Math.abs(seg.rawVal), 0)
  const total = totalVal != null ? Math.abs(totalVal) : sum
  console.log('sum:', sum, 'total:', total, 'ratio:', sum/total)
  if (totalVal != null && sum > total * 1.5) console.log('=> REJECTED by double-counting check!')
  else console.log('=> PASSES double-counting check')
}

main().catch(console.error)
