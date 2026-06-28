let _cache = null

export default async function handler(req, res) {
  if (_cache) {
    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).json({ data: _cache, total: _cache.length })
  }
  try {
    const base = process.env.URL || 'http://localhost:3000'
    const r = await fetch(`${base}/companies.json`)
    if (!r.ok) throw new Error(`Failed to fetch companies.json: ${r.status}`)
    const companies = await r.json()
    _cache = companies
    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).json({ data: companies, total: companies.length })
  } catch (err) {
    console.error('csv-companies error:', err.message)
    return res.status(500).json({ error: err.message })
  }
}
