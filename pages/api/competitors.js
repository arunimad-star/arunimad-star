const BASE = 'https://finnhub.io/api/v1'
const CACHE_TTL = 60 * 60 * 1000  // 1 hour

const peersCache   = new Map()
const profileCache = new Map()
const metricsCache = new Map()

async function fhGet(path, key) {
  const token = process.env.FINNHUB_API_KEY
  const url = `${BASE}${path}&token=${token}`
  const r = await fetch(url)
  if (!r.ok) throw new Error(`Finnhub ${r.status}: ${path}`)
  return r.json()
}

async function getPeers(symbol) {
  const hit = peersCache.get(symbol)
  if (hit && Date.now() - hit.ts < CACHE_TTL) return hit.data
  const data = await fhGet(`/stock/peers?symbol=${encodeURIComponent(symbol)}`)
  peersCache.set(symbol, { data, ts: Date.now() })
  return data
}

async function getProfile(symbol) {
  const hit = profileCache.get(symbol)
  if (hit && Date.now() - hit.ts < CACHE_TTL) return hit.data
  try {
    const data = await fhGet(`/stock/profile2?symbol=${encodeURIComponent(symbol)}`)
    profileCache.set(symbol, { data, ts: Date.now() })
    return data
  } catch { return null }
}

async function getMetrics(symbol) {
  const hit = metricsCache.get(symbol)
  if (hit && Date.now() - hit.ts < CACHE_TTL) return hit.data
  try {
    const data = await fhGet(`/stock/metric?symbol=${encodeURIComponent(symbol)}&metric=all`)
    metricsCache.set(symbol, { data, ts: Date.now() })
    return data
  } catch { return null }
}

function buildCompany(symbol, profile, metrics) {
  if (!profile || !metrics) return null
  const m = metrics.metric || {}
  const shares = profile.shareOutstanding    // millions
  const revPerShare = m.revenuePerShareTTM   // USD/share
  const revenue = (shares && revPerShare) ? shares * revPerShare : null  // $mm

  return {
    ticker: symbol,
    name: profile.name || symbol,
    logo: profile.logo || null,
    marketCap: profile.marketCapitalization || null,  // $mm
    revenue,                                          // $mm
    pe: m.peTTM ?? null,
    revGrowth: m.revenueGrowthTTMYoy ?? null,        // %
    grossMargin: m.grossMarginTTM ?? null,            // %
    netMargin: m.netProfitMarginTTM ?? null,          // %
    evRevenue: m.evRevenueTTM ?? null,
  }
}

export default async function handler(req, res) {
  const { ticker } = req.query
  const key = process.env.FINNHUB_API_KEY
  if (!ticker) return res.status(400).json({ error: 'Missing ticker' })
  if (!key)    return res.status(500).json({ error: 'FINNHUB_API_KEY not configured' })

  const sym = ticker.toUpperCase()

  try {
    const peerList = await getPeers(sym)
    const allTickers = Array.isArray(peerList) ? [sym, ...peerList.filter(t => t !== sym)] : [sym]
    const targets = allTickers.slice(0, 8)  // company + up to 7 peers

    const results = await Promise.all(
      targets.map(async t => {
        const [profile, metrics] = await Promise.all([getProfile(t), getMetrics(t)])
        return buildCompany(t, profile, metrics)
      })
    )

    const companies = results.filter(Boolean)
    const company = companies.find(c => c.ticker === sym) || null
    const peers = companies.filter(c => c.ticker !== sym)

    // Revenue-based share among peers with known revenue
    const allWithRev = companies.filter(c => c.revenue > 0)
    const totalRev = allWithRev.reduce((s, c) => s + c.revenue, 0)
    const companyRev = company?.revenue || 0
    const revenueShare = totalRev > 0 ? Math.round(companyRev / totalRev * 1000) / 10 : null

    return res.status(200).json({ ticker: sym, company, peers, revenueShare, totalRevPool: totalRev })
  } catch (err) {
    console.error('competitors error:', err.message)
    return res.status(200).json({ error: err.message })
  }
}
