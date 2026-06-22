// Debug: trace what extractLargeTableRows finds near pos 2366531
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
  return { rows: rows.slice(0, maxRows), tableEnd, tableSize: (tableEnd > 0 ? tableEnd - tableStartPos : 0) }
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
  const lower = html.toLowerCase()

  // Look at all <table> starts in the Note 15 range (2380000-2430000)
  const note15Range = html.slice(2380000, 2460000)
  const note15Lower = note15Range.toLowerCase()
  let tblPos = 0
  const tablestarts = []
  while ((tblPos = note15Lower.indexOf('<table', tblPos)) !== -1) {
    tablestarts.push(2380000 + tblPos)
    tblPos++
  }
  console.log('Table starts in 2380K-2460K range:', tablestarts.length)
  console.log('Absolute positions:', tablestarts.slice(0, 8))

  // Parse and show first 3 tables in this range
  for (let i = 0; i < Math.min(3, tablestarts.length); i++) {
    const tpos = tablestarts[i]
    const { rows, tableEnd, tableSize } = extractLargeTableRows(html, tpos)
    const ctxBefore = stripTags(html.slice(Math.max(0, tpos - 1000), tpos)).slice(-300)
    console.log(`\n=== Table ${i+1} at ${tpos} (size=${(tableSize/1024).toFixed(0)}KB, rows=${rows.length}) ===`)
    console.log('Context before:', ctxBefore.slice(-200))
    rows.slice(0, 10).forEach((r, ri) => {
      const nums = r.filter(c => parseDollar(c) !== null).length
      console.log(`  Row ${ri}: [${r.slice(0, 4).map(c=>c.slice(0,20)).join(' | ')}] (${r.length} cells, ${nums} nums)`)
    })
  }

  // Also: check what's at the FIRST <table> position in the 70KB window starting at 2364531
  const winStart = 2364531
  const win = html.slice(winStart, winStart + 70000)
  const tblOff = win.toLowerCase().indexOf('<table')
  console.log('\nFirst <table> in keyword window at offset:', tblOff, '(absolute:', winStart + tblOff, ')')
  if (tblOff >= 0) {
    const absPos = winStart + tblOff
    const { rows, tableSize } = extractLargeTableRows(html, absPos)
    console.log('Table size:', (tableSize/1024).toFixed(0), 'KB, rows:', rows.length)
    const ctxBefore = stripTags(html.slice(Math.max(0, absPos - 500), absPos)).slice(-200)
    console.log('Context before:', ctxBefore)
    rows.slice(0, 12).forEach((r, ri) => {
      const nums = r.filter(c => parseDollar(c) !== null).length
      console.log(`  Row ${ri}: [${r.slice(0, 4).map(c=>c.slice(0,25)).join(' | ')}] (${r.length} cells, ${nums} nums)`)
    })
  }
}

main().catch(console.error)
