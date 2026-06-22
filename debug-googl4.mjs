// Debug: find the segment revenue table in GOOGL's Note 15
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
  const lower = html.toLowerCase()

  // Look backward from 2366531 for <table> starts in the 2280K-2380K range
  const rangeHtml = html.slice(2280000, 2380000)
  const rangeLower = rangeHtml.toLowerCase()
  let tblPos = 0
  const tablestarts = []
  while ((tblPos = rangeLower.indexOf('<table', tblPos)) !== -1) {
    tablestarts.push(2280000 + tblPos)
    tblPos++
  }
  console.log('Table starts in 2280K-2380K range:', tablestarts.length)
  console.log('Positions:', tablestarts)

  // Parse first 5 tables in this range
  for (let i = 0; i < Math.min(5, tablestarts.length); i++) {
    const tpos = tablestarts[i]
    const { rows, tableEnd, tableSize } = extractLargeTableRows(html, tpos)
    const ctxBefore = stripTags(html.slice(Math.max(0, tpos - 1000), tpos)).slice(-200)
    console.log(`\n=== Table ${i+1} at ${tpos} (size=${(tableSize/1024).toFixed(0)}KB, rows=${rows.length}) ===`)
    console.log('Context before:', ctxBefore)
    rows.slice(0, 12).forEach((r, ri) => {
      const nums = r.filter(c => parseDollar(c) !== null).length
      console.log(`  Row ${ri}: [${r.slice(0, 5).map(c=>c.slice(0,25)).join(' | ')}] (${r.length} cells, ${nums} nums)`)
    })
  }

  // Also show text content in the Note 15 area (2330K-2380K)
  const textArea = stripTags(html.slice(2330000, 2375000))
  console.log('\n--- Text 2330K-2375K ---')
  console.log(textArea.slice(0, 2000))
}

main().catch(console.error)
