import axios from 'axios'
import { yahooSummary } from './_yahoo-auth'

const FINNHUB = 'https://finnhub.io/api/v1'
const CACHE_TTL = 4 * 60 * 60 * 1000
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

  const [mRes, recRes, ptRes, yRes] = await Promise.all([
    get(`${FINNHUB}/stock/metric?symbol=${sym}&metric=all`),
    get(`${FINNHUB}/stock/recommendation?symbol=${sym}`),
    get(`${FINNHUB}/stock/price-target?symbol=${sym}`),
    yahooSummary(sym, 'defaultKeyStatistics').catch(() => null),
  ])

  const m = mRes?.data?.metric || {}
  const rec = recRes?.data?.[0] || {}   // most recent recommendation period
  const pt = ptRes?.data || {}
  const stats = yRes?.data?.quoteSummary?.result?.[0]?.defaultKeyStatistics || {}

  // Short interest from Yahoo (Finnhub free tier doesn't provide these fields)
  const shortPctRaw   = typeof stats.shortPercentOfFloat?.raw === 'number' ? stats.shortPercentOfFloat.raw * 100 : null
  const sharesShort      = typeof stats.sharesShort?.raw === 'number' ? stats.sharesShort.raw : null
  const shortSharesK     = sharesShort != null ? Math.round(sharesShort / 1000) : null
  const sharesShortPrior = typeof stats.sharesShortPriorMonth?.raw === 'number' ? stats.sharesShortPriorMonth.raw : null
  const shortPriorK      = sharesShortPrior != null ? Math.round(sharesShortPrior / 1000) : null
  const dateShortCurrent = typeof stats.dateShortInterest?.raw === 'number' ? new Date(stats.dateShortInterest.raw * 1000).toISOString().slice(0, 7) : null
  const dateShortPrior   = typeof stats.sharesShortPreviousMonthDate?.raw === 'number' ? new Date(stats.sharesShortPreviousMonthDate.raw * 1000).toISOString().slice(0, 7) : null
  // DTC: prefer Yahoo's pre-calculated shortRatio; fall back to sharesShort / adv3m
  const adv3m            = m['3MonthAverageTradingVolume'] ?? null  // thousands of shares/day
  const dtcYahoo         = typeof stats.shortRatio?.raw === 'number' ? stats.shortRatio.raw : null
  const dtcCalc          = sharesShort != null && adv3m != null && adv3m > 0
    ? Math.round((sharesShort / (adv3m * 1000)) * 10) / 10
    : null
  const daysToCover      = dtcYahoo ?? dtcCalc

  const data = {
    ticker: sym,
    // Performance
    ytdReturn:        m['yearToDatePriceReturnDaily'] ?? null,
    beta:             m['beta'] ?? null,
    adv3m,
    adv10d:           m['10DayAverageTradingVolume'] ?? null,
    // Ownership
    institutionalPct: m['institutionalOwnershipPercentage'] ?? null,
    insiderPct:       m['insiderOwnershipPercentage'] ?? null,
    // Short interest (from Yahoo; Finnhub free tier lacks these)
    shortPct:         shortPctRaw,
    shortSharesK,
    shortPriorK,
    dateShortCurrent,
    dateShortPrior,
    daysToCover,
    divYield: typeof stats.dividendYield?.raw === 'number' ? stats.dividendYield.raw * 100 : null,
    // Analyst consensus (most recent period)
    buy:              (rec.strongBuy ?? 0) + (rec.buy ?? 0),
    hold:             rec.hold ?? 0,
    sell:             (rec.sell ?? 0) + (rec.strongSell ?? 0),
    // Price target
    ptMean:           typeof pt.targetMean === 'number' ? pt.targetMean : null,
    ptHigh:           typeof pt.targetHigh === 'number' ? pt.targetHigh : null,
    ptLow:            typeof pt.targetLow === 'number' ? pt.targetLow : null,
  }

  cache.set(sym, { data, ts: Date.now() })
  return res.status(200).json(data)
}
