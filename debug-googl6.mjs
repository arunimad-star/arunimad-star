// Simulate scrape10K behavior for the "other bets" keyword hit at 2366531 with 10KB lookback
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

  // The keyword "other bets" at position 2366531, with new 10KB lookback
  const pos = 2366531
  const winStart = Math.max(0, pos - 10000)  // 2356531
  const winEnd = Math.min(html.length, winStart + 70000)  // 2426531
  const win = html.slice(winStart, winEnd)

  console.log('Window:', winStart, '-', winEnd, '(size:', win.length, ')')

  const tables = extractTopLevelTables(win)
  console.log('Top-level tables found:', tables.length)

  // Check if the expected table at 2359364 is among them
  for (let i = 0; i < tables.length; i++) {
    const t = tables[i]
    const absPos = winStart + t.pos
    const rows = parseTableRows(t.html)
    const allText = rows.map(r => r.join(' ')).join(' ').toLowerCase()
    const hasOtherBets = allText.includes('other bets')
    const hasCloud = /google cloud|cloud/.test(allText)
    const ctx = stripTags(win.slice(Math.max(0, t.pos - 3000), t.pos + 300))
    console.log(`Table ${i+1} at abs=${absPos}: rows=${rows.length}, size=${(t.html.length/1024).toFixed(0)}KB, hasOtherBets=${hasOtherBets}, hasCloud=${hasCloud}`)
    if (hasOtherBets || rows.length >= 5) {
      console.log('  Context:', ctx.slice(-300))
      rows.slice(0, 10).forEach((r, ri) => {
        const nums = r.filter(c => parseDollar(c) !== null).length
        console.log(`  Row ${ri}: [${r.slice(0,5).map(c=>c.slice(0,25)).join(' | ')}] (${r.length} cells, ${nums} nums)`)
      })
    }
  }

  // Also check: are there any <table> tags in the win BEFORE offset 2833 (before the segment table)?
  const beforeTable = win.slice(0, 2359364 - winStart)
  const tableTagsInPreamble = (beforeTable.match(/<table[\s>]/gi) || []).length
  const closeTagsInPreamble = (beforeTable.match(/<\/table>/gi) || []).length
  console.log('\nBefore segment table (offset 0 to 2833):')
  console.log('  <table> tags:', tableTagsInPreamble)
  console.log('  </table> tags:', closeTagsInPreamble)

  if (tableTagsInPreamble > 0 || closeTagsInPreamble > 0) {
    // There might be unclosed tables from BEFORE the window that affect depth counting!
    console.log('  *** WARNING: Open/close table tags in preamble may affect depth counting ***')
    // Show raw HTML of preamble
    console.log('  Preamble HTML (first 500 chars):', win.slice(0, 500))
  }
}

main().catch(console.error)
