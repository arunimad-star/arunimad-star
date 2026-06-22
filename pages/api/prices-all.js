import axios from 'axios'
import fs from 'fs'
import path from 'path'

const FINNHUB_KEY = process.env.FINNHUB_API_KEY
// Finnhub free tier: ~60 calls/minute sustained.
// 1 ticker = 1 call (quote only; 52W now from CIQ CSV) → safe at 1 call/1100ms = ~55 calls/min
const CONCURRENCY = 1
const BATCH_DELAY_MS = 1100
const MAX_TICKERS = 500        // top 500 by market cap; ~9 min first load, then disk-cached
const CACHE_TTL = 12 * 60 * 60 * 1000
const DISK_CACHE_PATH = path.join(process.cwd(), 'data', 'prices-cache.json')
const DISK_CACHE_TTL = 20 * 60 * 60 * 1000

// Persist across Next.js dev-mode module reloads
if (!global._pricesAll) {
  global._pricesAll = { cache: {}, loaded: 0, total: 0, complete: false, ts: 0, started: false }
}
const G = global._pricesAll

function chunk(arr, n) {
  const out = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}
const sleep = ms => new Promise(r => setTimeout(r, ms))

function loadDiskCache() {
  try {
    if (!fs.existsSync(DISK_CACHE_PATH)) return null
    const stat = fs.statSync(DISK_CACHE_PATH)
    if (Date.now() - stat.mtimeMs > DISK_CACHE_TTL) return null
    const data = JSON.parse(fs.readFileSync(DISK_CACHE_PATH, 'utf-8'))
    return Object.keys(data).length > 0 ? data : null
  } catch { return null }
}

function saveDiskCache(cache) {
  try { fs.writeFileSync(DISK_CACHE_PATH, JSON.stringify(cache)) } catch {}
}

async function loadTicker(ticker) {
  try {
    const r = await axios.get(
      `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(ticker)}&token=${FINNHUB_KEY}`,
      { timeout: 8000 }
    )
    const price = r.data?.c || null
    if (!price) return  // 0 means unknown ticker on Finnhub
    // Only store price — 52W high/low now come from Capital IQ CSV
    G.cache[ticker.toUpperCase()] = { price, history: null }
    G.loaded++
  } catch {
    // skip silently
  }
}

async function startBackgroundLoad(tickers) {
  G.total = tickers.length
  const batches = chunk(tickers, CONCURRENCY)
  const etaMin = Math.round(tickers.length * BATCH_DELAY_MS / 1000 / 60)
  console.log(`prices-all: loading ${tickers.length} tickers via Finnhub (~${etaMin} min)`)
  for (const batch of batches) {
    await Promise.all(batch.map(loadTicker))
    if (BATCH_DELAY_MS > 0) await sleep(BATCH_DELAY_MS)
  }
  G.complete = true
  G.ts = Date.now()
  console.log(`prices-all: done — ${G.loaded}/${G.total} loaded`)
  if (G.loaded > 0) saveDiskCache(G.cache)
}

function getTickers() {
  const jsonPath = path.join(process.cwd(), 'data', 'companies.json')
  const companies = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'))
  return companies
    .filter(c => c.ticker)
    .sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0))
    .slice(0, MAX_TICKERS)
    .map(c => c.ticker)
    .filter((t, i, arr) => arr.indexOf(t) === i)
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  if (req.query.reset === '1') {
    G.cache = {}; G.loaded = 0; G.total = 0; G.complete = false; G.started = false
    return res.status(200).json({ reset: true })
  }

  if (G.complete && G.ts && Date.now() - G.ts > CACHE_TTL) {
    G.cache = {}; G.loaded = 0; G.total = 0; G.complete = false; G.started = false
  }

  if (!G.started) {
    G.started = true
    try {
      const disk = loadDiskCache()
      if (disk) {
        console.log(`prices-all: ${Object.keys(disk).length} tickers from disk cache`)
        G.cache = disk
        G.loaded = Object.keys(disk).length
        G.total = G.loaded
        G.complete = true
        G.ts = Date.now()
      } else {
        const tickers = getTickers()
        startBackgroundLoad(tickers)  // fire and forget
      }
    } catch (err) {
      console.error('prices-all: start error:', err.message)
      G.started = false
    }
  }

  return res.status(200).json({
    data: G.cache,
    loaded: G.loaded,
    total: G.total,
    complete: G.complete,
  })
}
