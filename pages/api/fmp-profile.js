// Returns FMP sector, description, and annual financials for one ticker.
// Used as the authoritative source for business overview and P&L waterfall when
// Yahoo quoteSummary is unavailable (crumb auth issues or rate limiting).
const KEY = process.env.FMP_API_KEY
const BASE = 'https://financialmodelingprep.com/stable'
const toMm = v => typeof v === 'number' ? Math.round(v / 1e6) : null

export default async function handler(req, res) {
  const { ticker } = req.query
  if (!ticker) return res.status(400).json({ error: 'Missing ticker' })
  if (!KEY) return res.status(200).json({ error: 'No FMP key' })

  const sym = ticker.toUpperCase()

  try {
    const [profileRes, incomeRes] = await Promise.all([
      fetch(`${BASE}/profile?symbol=${sym}&apikey=${KEY}`).then(r => r.json()).catch(() => []),
      fetch(`${BASE}/income-statement?symbol=${sym}&period=annual&limit=1&apikey=${KEY}`).then(r => r.json()).catch(() => []),
    ])

    const profile = Array.isArray(profileRes) && profileRes.length ? profileRes[0] : {}
    const income  = Array.isArray(incomeRes)  && incomeRes.length  ? incomeRes[0]  : {}

    // Skip ETFs / ADRs / funds — they don't have useful screener data
    if (profile.isEtf || profile.isFund || profile.isAdr) {
      return res.status(200).json({ ticker: sym, skip: true })
    }

    return res.status(200).json({
      ticker: sym,
      exchangeTicker: sym,
      name: profile.companyName || null,
      price: typeof profile.price === 'number' ? profile.price : null,
      // FMP returns raw USD; convert to $mm to match screener expectations
      marketCap: typeof profile.marketCap === 'number' ? profile.marketCap / 1e6 : null,
      beta: typeof profile.beta === 'number' ? profile.beta : null,
      primarySector: profile.sector || null,
      primaryIndustry: profile.industry || null,
      description: profile.description || null,
      // Annual income statement (most recent fiscal year)
      totalRevenue: toMm(income.revenue),
      grossProfit: toMm(income.grossProfit),
      ebitda: toMm(income.ebitda),
      netIncome: toMm(income.netIncome),
    })
  } catch (err) {
    console.warn('fmp-profile error for', sym, err.message)
    return res.status(200).json({ ticker: sym, error: err.message })
  }
}
