const FMP = 'https://financialmodelingprep.com/stable'

const calQ = (fiscalDateEnding) => {
  const m = new Date(fiscalDateEnding).getMonth() + 1
  return m <= 3 ? 1 : m <= 6 ? 2 : m <= 9 ? 3 : 4
}

const toArr = (d) => (Array.isArray(d) ? d : d?.data && Array.isArray(d.data) ? d.data : [])

export default async function handler(req, res) {
  const { ticker } = req.query
  const key = process.env.FMP_API_KEY
  if (!ticker) return res.status(400).json({ error: 'Missing ticker' })
  if (!key) return res.status(500).json({ error: 'FMP_API_KEY not set in .env.local' })

  const now = new Date()
  const future = new Date(now); future.setFullYear(future.getFullYear() + 1)
  const fmt = d => d.toISOString().split('T')[0]

  try {
    const [calRes, histRes] = await Promise.all([
      fetch(`${FMP}/earnings-calendar?symbol=${encodeURIComponent(ticker)}&from=${fmt(now)}&to=${fmt(future)}&apikey=${key}`),
      fetch(`${FMP}/earnings-surprises?symbol=${encodeURIComponent(ticker)}&limit=20&apikey=${key}`)
    ])
    const [calRaw, histRaw] = await Promise.all([calRes.json(), histRes.json()])

    const histData = toArr(histRaw)
    if (!histData.length) {
      const msg = histRaw?.['Error Message'] || histRaw?.message || 'No data returned from FMP'
      return res.status(200).json({ error: msg })
    }

    // Next upcoming earnings
    const calData = toArr(calRaw)
    const upcoming = calData.find(e => new Date(e.date) >= now) || null

    // Process historical quarters — earnings-surprises returns newest first
    const history = histData.slice(0, 12).map(e => {
      const epsAct = e.actualEarningResult ?? e.eps ?? null
      const epsEst = e.estimatedEarning ?? e.epsEstimated ?? null
      const revAct = e.revenue != null ? Number(e.revenue) : null
      const revEst = e.revenueEstimated != null ? Number(e.revenueEstimated) : null
      const epsActN = epsAct != null ? Number(epsAct) : null
      const epsEstN = epsEst != null ? Number(epsEst) : null
      const epsSurp = epsEstN && epsEstN !== 0 ? ((epsActN - epsEstN) / Math.abs(epsEstN)) * 100 : null
      const revSurp = revEst && revEst !== 0 ? ((revAct - revEst) / Math.abs(revEst)) * 100 : null
      const fiscalEnd = e.fiscalDateEnding ? new Date(e.fiscalDateEnding) : new Date(e.date)
      const earningsDate = new Date(e.date)
      const daysAfter = Math.round((earningsDate - fiscalEnd) / 86400000)
      return {
        date: e.date,
        quarter: `Q${calQ(fiscalEnd)} ${fiscalEnd.getFullYear()}`,
        time: e.time || null,
        epsEstimate: epsEstN,
        epsActual: epsActN,
        epsSurprisePct: epsSurp != null ? Math.round(epsSurp * 100) / 100 : null,
        revenueEstimate: revEst,
        revenueActual: revAct,
        revenueSurprisePct: revSurp != null ? Math.round(revSurp * 100) / 100 : null,
        beatMiss: epsSurp != null ? (epsSurp >= 0 ? 'beat' : 'miss') : null,
        fiscalDateEnding: e.fiscalDateEnding || e.date,
        daysAfterQuarterEnd: daysAfter > 0 && daysAfter < 120 ? daysAfter : null,
      }
    })

    const withData = history.filter(q => q.beatMiss != null)
    const beats = withData.filter(q => q.beatMiss === 'beat').length
    const lags = history.map(q => q.daysAfterQuarterEnd).filter(d => d != null)
    const avgDays = lags.length ? Math.round(lags.reduce((a, b) => a + b, 0) / lags.length) : null

    return res.status(200).json({
      ticker: ticker.toUpperCase(),
      upcoming,
      history,
      streak: { beats, total: withData.length },
      avgDaysAfterQuarterEnd: avgDays,
    })
  } catch (err) {
    console.error('fmp-earnings error:', err)
    return res.status(500).json({ error: err.message })
  }
}
