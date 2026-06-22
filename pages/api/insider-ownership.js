const BASE = 'https://finnhub.io/api/v1'
const CACHE_TTL = 30 * 60 * 1000

const insiderCache = new Map()
const ownershipCache = new Map()

async function fhGet(path) {
  const token = process.env.FINNHUB_API_KEY
  const r = await fetch(`${BASE}${path}&token=${token}`)
  if (!r.ok) throw new Error(`Finnhub ${r.status}: ${path}`)
  return r.json()
}

async function getInsiderTx(symbol) {
  const hit = insiderCache.get(symbol)
  if (hit && Date.now() - hit.ts < CACHE_TTL) return hit.data
  try {
    const data = await fhGet(`/stock/insider-transactions?symbol=${encodeURIComponent(symbol)}`)
    insiderCache.set(symbol, { data, ts: Date.now() })
    return data
  } catch { return null }
}

async function getOwnership(symbol) {
  const hit = ownershipCache.get(symbol)
  if (hit && Date.now() - hit.ts < CACHE_TTL) return hit.data
  try {
    const data = await fhGet(`/stock/ownership?symbol=${encodeURIComponent(symbol)}&limit=10`)
    ownershipCache.set(symbol, { data, ts: Date.now() })
    return data
  } catch { return null }
}

function fmtValue(v) {
  if (!v) return null
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`
  return `$${Math.round(v)}`
}

export default async function handler(req, res) {
  const { ticker } = req.query
  const key = process.env.FINNHUB_API_KEY
  if (!ticker) return res.status(400).json({ error: 'Missing ticker' })
  if (!key) return res.status(500).json({ error: 'FINNHUB_API_KEY not configured' })

  const sym = ticker.toUpperCase()

  try {
    const [insiderRaw, ownershipRaw] = await Promise.all([
      getInsiderTx(sym),
      getOwnership(sym),
    ])

    // Insider transactions — last 6 months
    const sixMonthsAgo = Date.now() - 180 * 24 * 60 * 60 * 1000
    const txRaw = insiderRaw?.data || []
    const transactions = txRaw
      .filter(t => t.transactionDate && new Date(t.transactionDate).getTime() >= sixMonthsAgo)
      .sort((a, b) => b.transactionDate.localeCompare(a.transactionDate))
      .map(t => {
        const code = t.transactionCode || ''
        // P = open market purchase, S = open market sale, A = award/grant, D = disposed
        const isBuy = code === 'P' || (code === '' && t.change > 0)
        const isSell = code === 'S' || code === 'D' || (code === '' && t.change < 0)
        if (!isBuy && !isSell) return null
        const shares = Math.abs(t.change || 0)
        const value = t.transactionPrice && shares ? shares * t.transactionPrice : null
        return {
          date: t.transactionDate,
          name: (t.name || '').replace(/\s+/g, ' ').trim(),
          type: isBuy ? 'Buy' : 'Sell',
          shares,
          price: t.transactionPrice || null,
          valueFmt: fmtValue(value),
        }
      })
      .filter(Boolean)
      .slice(0, 12)

    const buys = transactions.filter(t => t.type === 'Buy')
    const sells = transactions.filter(t => t.type === 'Sell')
    const buyVal = buys.reduce((s, t) => s + (t.price && t.shares ? t.price * t.shares : 0), 0)
    const sellVal = sells.reduce((s, t) => s + (t.price && t.shares ? t.price * t.shares : 0), 0)

    // Institutional ownership
    const ownRaw = ownershipRaw?.ownership || []
    const holders = ownRaw
      .slice(0, 8)
      .map(h => ({
        name: h.holder || '',
        pct: h.sharesPercent != null ? Math.round(h.sharesPercent * 100) / 100 : null,
        shares: h.shares || null,
        changePct: h.change && h.shares ? Math.round((h.change / h.shares) * 1000) / 10 : null,
      }))
      .filter(h => h.name)

    const totalInstPct = holders.reduce((s, h) => s + (h.pct || 0), 0)

    return res.status(200).json({
      ticker: sym,
      insider: {
        transactions,
        buyCount: buys.length,
        sellCount: sells.length,
        netBuyValueFmt: fmtValue(buyVal - sellVal),
        sentiment: buys.length > sells.length * 1.5 ? 'bullish' : sells.length > buys.length * 1.5 ? 'bearish' : 'neutral',
      },
      institutional: {
        holders,
        totalPct: Math.round(totalInstPct * 10) / 10,
      },
    })
  } catch (err) {
    console.error('insider-ownership error:', err.message)
    return res.status(200).json({ error: err.message })
  }
}
