import fs from 'fs'
import path from 'path'

const CACHE_TTL = 24 * 60 * 60 * 1000
let _cache = null
let _cacheTs = 0

// companies.json is pre-processed from vsv3.csv by the Python script in data/.
// Run: python3 data/preprocess.py  to regenerate after updating vsv3.csv.
export default function handler(req, res) {
  if (_cache && Date.now() - _cacheTs < CACHE_TTL) {
    return res.status(200).json({ data: _cache, total: _cache.length })
  }

  try {
    const jsonPath = path.join(process.cwd(), 'data', 'companies.json')
    const raw = fs.readFileSync(jsonPath, 'utf-8')
    const companies = JSON.parse(raw)

    _cache = companies
    _cacheTs = Date.now()
    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).json({ data: companies, total: companies.length })
  } catch (err) {
    console.error('csv-companies error:', err.message)
    return res.status(500).json({ error: err.message })
  }
}
