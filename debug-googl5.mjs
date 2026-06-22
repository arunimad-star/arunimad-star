// Debug: show table at 2359364 and understand why window misses it
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

function extractLargeTableRows(html, tableStartPos, maxRows = 80) {
  let depth = 0, pos = tableStartPos, tableEnd = -1
  const limit = Math.min(html.length, tableStartPos + 600000)
  while (pos < limit) {
    if (html[pos] !== '<') { pos++; continue }
    const te = html.indexOf('>', pos)
    if (te < 0) break
    const tag = html.slice(pos+1, te).trim().toLowerCase()
    if (tag.startsWith('table') && (tag.length === 5 || (tag.length > 5 && /\s/.test(tag[5])))) depth++
    else if (tag === '/table') { depth--; if (depth === 0) { tableEnd = te + 1; break } }
    pos = te + 1
  }
  const tableHtml = html.slice(tableStartPos, tableEnd > 0 ? tableEnd : Math.min(limit, tableStartPos + 500000))
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
  return { rows: rows.slice(0, maxRows), tableEnd, tableSize: tableEnd > 0 ? tableEnd - tableStartPos : 0 }
}

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

  // Parse table at 2359364
  const tpos = 2359364
  const { rows, tableEnd, tableSize } = extractLargeTableRows(html, tpos)
  const ctxBefore = stripTags(html.slice(Math.max(0, tpos - 2000), tpos)).slice(-400)
  console.log(`=== Table at ${tpos} (size=${(tableSize/1024).toFixed(0)}KB, rows=${rows.length}) ===`)
  console.log('Context before:', ctxBefore)
  console.log('All rows:')
  rows.slice(0, 20).forEach((r, ri) => {
    const nums = r.filter(c => parseDollar(c) !== null).length
    console.log(`  Row ${ri}: [${r.slice(0, 5).map(c=>c.slice(0,30)).join(' | ')}] (${r.length} cells, ${nums} nums)`)
  })

  // Now understand WHY the 70KB window from pos 2366531 doesn't include this table
  // winStart = max(0, 2366531 - 2000) = 2364531
  // The table starts at 2359364, which is BEFORE winStart 2364531!
  console.log('\n--- Window analysis ---')
  console.log('Keyword pos:', 2366531)
  console.log('Window start (pos-2000):', 2366531 - 2000, '= 2364531')
  console.log('Table at:', 2359364)
  console.log('Table END:', tableEnd)
  console.log('Table start is BEFORE window start:', 2359364 < 2364531)

  // So the table starts at 2359364, window starts at 2364531
  // The table (if 44KB) ends at 2359364 + 44000 = 2403364
  // The table is partially outside the window start - extractTopLevelTables won't capture it
  // BUT the table ends after the window end? Let me check:
  console.log('Table ends at:', tableEnd)
  console.log('Does table span entire window?', tableEnd > 2364531 + 70000 ? 'YES - too large' : 'NO - within window')

  // The issue: table starts BEFORE winStart, so it appears to start at winStart offset 0
  // as an OPEN <table> tag (no matching start in window). extractTopLevelTables wouldn't
  // pick it up as a complete table.
  // The fallback (extractLargeTableRows) searches for the FIRST <table> in the window,
  // but since the table STARTS BEFORE the window, there's no <table> tag WITHIN the window.

  // What IS the first <table> in the 70KB window starting at 2364531?
  const win = html.slice(2364531, 2364531 + 70000)
  const firstTable = win.toLowerCase().indexOf('<table')
  console.log('\nFirst <table> in keyword window at offset:', firstTable, '(absolute:', 2364531 + firstTable, ')')
}

main().catch(console.error)
