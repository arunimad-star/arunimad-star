import axios from 'axios'

const FINNHUB = 'https://finnhub.io/api/v1'
const CACHE_TTL = 6 * 60 * 60 * 1000
const cache = new Map()

export default async function handler(req, res) {
  const { ticker } = req.query
  if (!ticker) return res.status(400).json({ error: 'Missing ticker' })

  const sym = ticker.toUpperCase()
  const hit = cache.get(sym)
  if (hit && Date.now() - hit.ts < CACHE_TTL) return res.status(200).json(hit.data)

  const KEY = process.env.FINNHUB_API_KEY
  if (!KEY) return res.status(200).json({ ticker: sym, error: 'No Finnhub key' })

  const get = (url) => axios.get(url, { headers: { 'X-Finnhub-Token': KEY }, timeout: 8000 }).catch(() => null)

  const [execRes] = await Promise.all([
    get(`${FINNHUB}/stock/executive?symbol=${sym}`),
  ])

  const rawExecs = execRes?.data?.executive || []
  const executives = rawExecs
    .filter(e => e.posOfOfficer || e.posOfDirector)
    .sort((a, b) => {
      // Sort: CEO first, then by compensation desc
      const aIsCeo = /ceo|chief\s+exec/i.test(a.title)
      const bIsCeo = /ceo|chief\s+exec/i.test(b.title)
      if (aIsCeo && !bIsCeo) return -1
      if (!aIsCeo && bIsCeo) return 1
      return (b.totalCompensation || 0) - (a.totalCompensation || 0)
    })
    .slice(0, 8)
    .map(e => ({
      name: e.name || '—',
      title: e.title || '—',
      age: e.age || null,
      totalComp: e.totalCompensation || null,
      currency: e.currency || 'USD',
      isDirector: !!e.posOfDirector,
      isOfficer: !!e.posOfOfficer,
    }))

  const data = { ticker: sym, executives }
  cache.set(sym, { data, ts: Date.now() })
  return res.status(200).json(data)
}
