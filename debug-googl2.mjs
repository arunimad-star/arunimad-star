// Debug: parse tables near Note 15 "other bets" hits
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

  // Focus on position 2366531 (Note 15 "other bets" hit with revenue value)
  const pos = 2366531
  const winStart = Math.max(0, pos - 2000)
  const winEnd = Math.min(html.length, winStart + 70000)
  const win = html.slice(winStart, winEnd)

  console.log('Window:', winStart, '-', winEnd)
  const tables = extractTopLevelTables(win)
  console.log('Top-level tables in window:', tables.length)

  for (let i = 0; i < Math.min(tables.length, 8); i++) {
    const t = tables[i]
    const rows = parseTableRows(t.html)
    console.log(`\n--- Table ${i+1} (pos=${winStart + t.pos}, rows=${rows.length}) ---`)
    rows.slice(0, 8).forEach((r, ri) => {
      const numCells = r.filter(c => parseDollar(c) !== null).length
      console.log(`  Row ${ri}: [${r.slice(0,4).map(c=>c.slice(0,25)).join(' | ')}] nums=${numCells}`)
    })
  }

  // Also check the text between pos 2350000 and 2380000 for segment table structure
  const section = html.slice(2340000, 2390000)
  const sectionText = stripTags(section).slice(0, 2000)
  console.log('\n--- Text in Note 15 area (2340K-2390K) ---')
  console.log(sectionText)
}

main().catch(console.error)
