// Debug script: fetch GOOGL 10-K and analyze "other bets" keyword hits
import axios from 'axios'

const HDR = { 'User-Agent': 'arunimad@berkeley.edu', Accept: 'application/json' }

async function main() {
  // Get GOOGL CIK
  const r = await axios.get('https://www.sec.gov/files/company_tickers.json', { headers: HDR, timeout: 15000 })
  const entry = Object.values(r.data).find(e => e.ticker === 'GOOGL')
  const cik = String(entry.cik_str).padStart(10, '0')
  console.log('CIK:', cik)

  // Get latest 10-K
  const sub = await axios.get(`https://data.sec.gov/submissions/CIK${cik}.json`, { headers: HDR, timeout: 15000 })
  const f = sub.data?.filings?.recent
  let accession, primaryDoc
  for (let i = 0; i < f.form.length; i++) {
    if (f.form[i] === '10-K') { accession = f.accessionNumber[i].replace(/-/g, ''); primaryDoc = f.primaryDocument[i]; break }
  }
  console.log('Filing:', accession, primaryDoc)

  const cikInt = parseInt(cik, 10)
  const docUrl = `https://www.sec.gov/Archives/edgar/data/${cikInt}/${accession}/${primaryDoc}`
  console.log('Fetching:', docUrl)

  const resp = await axios.get(docUrl, {
    headers: { 'User-Agent': HDR['User-Agent'], Accept: 'text/html,*/*' },
    timeout: 60000, maxContentLength: 15 * 1024 * 1024, responseType: 'text',
  })
  let html = resp.data
  html = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<!--[\s\S]*?-->/g, '')

  const lower = html.toLowerCase()
  console.log('HTML size:', (html.length / 1024 / 1024).toFixed(1), 'MB')
  console.log('Total length:', html.length)

  // Find "other bets" positions
  const hits = []
  let idx = 0
  while ((idx = lower.indexOf('other bets', idx)) !== -1) {
    hits.push(idx); idx += 10
  }
  console.log('"other bets" hits:', hits.length)
  console.log('First 5 positions:', hits.slice(0, 5))
  console.log('Last 5 positions:', hits.slice(-5))

  // Check positions after 5% threshold
  const threshold = html.length * 0.05
  const valid = hits.filter(p => p > threshold)
  console.log('After 5% threshold:', valid.length, 'hits')

  // Show what's near the last few hits (likely Note 15 area)
  console.log('\n--- Content near last 3 "other bets" hits ---')
  for (const pos of valid.slice(-3)) {
    const snippet = html.slice(Math.max(0, pos - 200), pos + 500)
      .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300)
    console.log(`\nPos ${pos} (${(pos / html.length * 100).toFixed(1)}%):`)
    console.log(snippet)
  }

  // Count tables in final 30% of document
  const lastThird = html.slice(Math.floor(html.length * 0.7))
  const tableCount = (lastThird.match(/<table/gi) || []).length
  console.log('\nTables in last 30% of doc:', tableCount)
}

main().catch(console.error)
