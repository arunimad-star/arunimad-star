export default async function handler(req, res) {
  const { ticker } = req.query
  const key = process.env.FINNHUB_API_KEY
  if (!ticker) return res.status(400).json({ error: 'Missing ticker' })
  if (!key) return res.status(500).json({ error: 'FINNHUB_API_KEY not configured in .env.local' })

  const now = new Date()
  const past = new Date(now)
  past.setDate(past.getDate() - 30)
  const toDate = now.toISOString().split('T')[0]
  const fromDate = past.toISOString().split('T')[0]

  try {
    const upstream = await fetch(
      `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(ticker)}&from=${fromDate}&to=${toDate}&token=${key}`
    )
    const json = await upstream.json()
    if (!Array.isArray(json)) {
      return res.status(200).json({ error: json?.error || 'Unexpected response from Finnhub' })
    }
    return res.status(200).json(json)
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
