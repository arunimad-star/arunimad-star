import React, { useEffect, useState, useMemo } from 'react'

// ── Sentiment word lists ──────────────────────────────────────────────────────
const POS = new Set(['beat','beats','beating','surge','surges','surging','record','growth','profit','profits','gain','gains','strong','upgrade','upgraded','outperform','raised','raise','exceed','exceeds','exceeded','positive','improve','improved','improvement','recovery','rebound','bullish','opportunity','expand','expansion','partnership','launch','launches','boost','boosts','increase','increases','increased','dividend','buyback','approval','approved','higher','strong'])
const NEG = new Set(['miss','misses','missed','decline','declines','declining','loss','losses','cut','cuts','downgrade','downgraded','underperform','lower','lowered','weak','weakness','concern','concerns','risk','risks','lawsuit','investigation','fine','fined','recall','layoff','layoffs','warning','slowdown','deficit','fraud','penalty','violation','negative','disappointing','disappointed','bearish','drop','drops','fell','fallen','fall','pressure','probe','suspension','halt','debt','default','disappoints','writedown'])

function scoreSentiment(text) {
  const words = text.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/)
  let pos = 0, neg = 0
  for (const w of words) {
    if (POS.has(w)) pos++
    if (NEG.has(w)) neg++
  }
  return pos > neg ? 'positive' : neg > pos ? 'negative' : 'neutral'
}

// ── Catalyst keyword matching ─────────────────────────────────────────────────
const CATALYST_RE = {
  Earnings: /\b(eps|earnings|beat|miss|guidance|revenue|quarter|quarterly|results|fiscal|profit)\b/i,
  'M&A':    /\b(acqui|merger|deal|buyout|takeover|purchase|bid|combines|divest|combine)\b/i,
  Analyst:  /\b(upgrade|downgrade|price\s+target|overweight|underweight|buy\s+rating|outperform|hold|neutral|initiates|coverage)\b/i,
  Macro:    /\b(fed|federal\s+reserve|interest\s+rate|inflation|gdp|tariff|economy|recession|cpi|ppi|monetary|policy)\b/i,
  Legal:    /\b(lawsuit|sec\b|investigation|settlement|fine|litigation|probe|fraud|violation|regulatory|subpoena|penalty)\b/i,
}

export function tagCatalysts(text) {
  return Object.entries(CATALYST_RE)
    .filter(([, re]) => re.test(text))
    .map(([name]) => name)
}

// ── Source name mapping ───────────────────────────────────────────────────────
const SOURCE_MAP = {
  seekingalpha: 'Seeking Alpha', businesswire: 'Business Wire',
  globenewswire: 'GlobeNewswire', marketwatch: 'MarketWatch',
  reuters: 'Reuters', bloomberg: 'Bloomberg', wsj: 'WSJ',
  yahoo: 'Yahoo Finance', barrons: "Barron's", investopedia: 'Investopedia',
  cnbc: 'CNBC', thestreet: 'TheStreet', fool: 'Motley Fool',
  motleyfool: 'Motley Fool', prnewswire: 'PR Newswire', accesswire: 'AccessWire',
  benzinga: 'Benzinga', zacks: 'Zacks', thefly: 'The Fly',
}
const PREMIUM = new Set(['Reuters', 'Bloomberg', 'WSJ', "Barron's", 'CNBC', 'MarketWatch', 'Financial Times'])

function fmtSource(s) {
  if (!s) return 'Unknown'
  return SOURCE_MAP[s.toLowerCase().replace(/[.\s-]/g, '')] || s
}

function fmtDate(ts) {
  const d = new Date(ts * 1000)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ── Group articles by calendar day (last 30 days) ─────────────────────────────
function groupByDay(articles) {
  const now = new Date()
  const result = {}
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    result[d.toISOString().split('T')[0]] = 0
  }
  for (const a of articles) {
    const key = new Date(a.datetime * 1000).toISOString().split('T')[0]
    if (key in result) result[key]++
  }
  return result
}

// ── Compute indicators for table row badges ───────────────────────────────────
export function computeIndicators(articles) {
  if (!articles?.length) return null
  const sevenDaysAgo = Date.now() - 7 * 86400000
  const recent = articles.filter(a => a.datetime * 1000 >= sevenDaysAgo)
  const dailyAvg = articles.length / 30
  const velocityState = dailyAvg > 0 && recent.length > dailyAvg * 2 * 7 ? 'spike' : 'normal'

  let pos = 0, neg = 0, neu = 0
  articles.forEach(a => {
    const s = scoreSentiment(a.headline || '')
    if (s === 'positive') pos++
    else if (s === 'negative') neg++
    else neu++
  })
  const sentimentState = pos > neg ? 'positive' : neg > pos ? 'negative' : 'neutral'

  const counts = { Earnings: 0, 'M&A': 0, Analyst: 0, Macro: 0, Legal: 0 }
  articles.forEach(a => tagCatalysts(a.headline || '').forEach(c => { if (c in counts) counts[c]++ }))
  const topCatalyst = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]

  const byDay = groupByDay(articles)
  const dayVals = Object.values(byDay)
  const week0 = dayVals.slice(-7).reduce((s, v) => s + v, 0)
  const week1 = dayVals.slice(-14, -7).reduce((s, v) => s + v, 0)

  const cutoff7 = Date.now() - 7 * 86400000
  const ind7 = articles.filter(a => a.datetime * 1000 >= cutoff7)
  const ind23 = articles.filter(a => a.datetime * 1000 < cutoff7)
  const sentScore = arr => !arr.length ? 0 : (arr.filter(a => scoreSentiment(a.headline || '') === 'positive').length - arr.filter(a => scoreSentiment(a.headline || '') === 'negative').length) / arr.length
  const s7 = sentScore(ind7), s23 = sentScore(ind23)
  const sentTrend = s7 > s23 + 0.1 ? 'improving' : s7 < s23 - 0.1 ? 'deteriorating' : 'stable'

  return {
    velocityState, sentimentState,
    topCatalyst: topCatalyst?.[1] > 0 ? topCatalyst[0] : null,
    byDay, week0, week1, avg30daily: dailyAvg,
    sentCounts: { pos, neg, neu },
    sentTrend,
  }
}

// ── SVG Donut chart ───────────────────────────────────────────────────────────
export function DonutChart({ pos, neg, neu }) {
  const total = pos + neg + neu
  if (!total) return <div style={{ width: 72, height: 72, borderRadius: '50%', background: '#f3f4f6' }} />
  const R = 24, cx = 36, cy = 36, sw = 14
  const circ = 2 * Math.PI * R
  const segs = [
    { count: pos, color: '#2a9d8f' },
    { count: neg, color: '#e76f51' },
    { count: neu, color: '#d1d5db' },
  ]
  let cumArc = 0
  return (
    <svg width="72" height="72" viewBox="0 0 72 72" style={{ flexShrink: 0 }}>
      <circle cx={cx} cy={cy} r={R} fill="none" stroke="#f3f4f6" strokeWidth={sw} />
      {segs.map((seg, i) => {
        const arc = (seg.count / total) * circ
        const offset = circ * 0.25 - cumArc
        cumArc += arc
        if (arc < 0.5) return null
        return (
          <circle key={i} cx={cx} cy={cy} r={R} fill="none"
            stroke={seg.color} strokeWidth={sw}
            strokeDasharray={`${arc} ${circ - arc}`}
            strokeDashoffset={offset}
          />
        )
      })}
      <text x={cx} y={cy - 2} textAnchor="middle" fontSize="11" fontWeight="700" fill="#1a2b3c">{total}</text>
      <text x={cx} y={cy + 9} textAnchor="middle" fontSize="8" fill="#6b7280">articles</text>
    </svg>
  )
}

// ── SVG velocity bar chart ────────────────────────────────────────────────────
export function VelocityChart({ byDay }) {
  const entries = Object.entries(byDay)
  const max = Math.max(...entries.map(([, c]) => c), 1)
  const W = 320, H = 44
  const slotW = W / entries.length

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 48 }}>
      {entries.map(([, count], i) => {
        const barW = slotW * 0.72
        const h = Math.max((count / max) * (H - 4), count > 0 ? 2 : 0)
        return (
          <rect key={i}
            x={i * slotW + slotW * 0.14}
            y={H - 4 - h}
            width={barW}
            height={h}
            fill={count > max * 0.6 ? '#0066cc' : '#93c5fd'}
            rx={1.5}
          />
        )
      })}
    </svg>
  )
}

// ── Catalyst frequency bars (pure CSS divs) ───────────────────────────────────
function CatalystBars({ counts, activeFilter, onFilter }) {
  const entries = Object.entries(counts).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
  if (!entries.length) return <p style={{ color: '#999', fontSize: '0.83rem', margin: 0 }}>No catalyst tags identified.</p>
  const max = entries[0][1]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      {entries.map(([name, count]) => {
        const isActive = activeFilter === name
        return (
          <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
            onClick={() => onFilter(isActive ? 'All' : name)}>
            <span style={{ width: 62, fontSize: '0.78rem', flexShrink: 0, fontWeight: isActive ? 700 : 400, color: isActive ? '#0066cc' : '#555' }}>{name}</span>
            <div style={{ flex: 1, height: 9, background: '#f3f4f6', borderRadius: 999, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${(count / max) * 100}%`, background: isActive ? '#0066cc' : '#93c5fd', borderRadius: 999 }} />
            </div>
            <span style={{ fontSize: '0.78rem', color: '#777', width: 22, textAlign: 'right', flexShrink: 0 }}>{count}</span>
          </div>
        )
      })}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function NewsPanel({ ticker, onClose, onIndicatorsReady, inline = false, hideIndicators = false, externalFilter }) {
  const [articles, setArticles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeFilter, setActiveFilter] = useState('All')
  const effectiveFilter = externalFilter ?? activeFilter

  useEffect(() => {
    if (!ticker) return
    setLoading(true)
    setError('')
    setArticles([])
    setActiveFilter('All')

    const cacheKey = `fnews_${ticker}`
    try {
      const cached = sessionStorage.getItem(cacheKey)
      if (cached) {
        const parsed = JSON.parse(cached)
        setArticles(parsed)
        setLoading(false)
        const ind = computeIndicators(parsed)
        if (ind && onIndicatorsReady) onIndicatorsReady(ticker, ind)
        return
      }
    } catch {}

    fetch(`/api/finnhub-news?ticker=${encodeURIComponent(ticker)}`)
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) {
          setArticles(data)
          try { sessionStorage.setItem(cacheKey, JSON.stringify(data)) } catch {}
          const ind = computeIndicators(data)
          if (ind && onIndicatorsReady) onIndicatorsReady(ticker, ind)
        } else {
          setError(data?.error || 'No news data returned')
        }
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [ticker])

  // Enrich articles with sentiment + catalysts
  const processed = useMemo(() =>
    articles.map(a => {
      const text = `${a.headline || ''} ${a.summary || ''}`
      return {
        ...a,
        sentiment: scoreSentiment(text),
        catalysts: tagCatalysts(text),
        fmtDate: fmtDate(a.datetime),
        fmtSource: fmtSource(a.source),
      }
    }), [articles])

  // Velocity
  const byDay = useMemo(() => groupByDay(articles), [articles])
  const dayVals = Object.values(byDay)
  const avg30daily = articles.length / 30
  const week0 = dayVals.slice(-7).reduce((s, v) => s + v, 0)
  const week1 = dayVals.slice(-14, -7).reduce((s, v) => s + v, 0)
  const isSpike = avg30daily > 0 && week0 > avg30daily * 7 * 2

  // Sentiment breakdown
  const sentCounts = useMemo(() => {
    let pos = 0, neg = 0, neu = 0
    processed.forEach(a => {
      if (a.sentiment === 'positive') pos++
      else if (a.sentiment === 'negative') neg++
      else neu++
    })
    return { pos, neg, neu }
  }, [processed])

  // Sentiment trend: last 7 days vs prior 23
  const sevenDaysAgo = Date.now() - 7 * 86400000
  const last7 = processed.filter(a => a.datetime * 1000 >= sevenDaysAgo)
  const prior23 = processed.filter(a => a.datetime * 1000 < sevenDaysAgo)
  const sentScore = arr => {
    if (!arr.length) return 0
    return (arr.filter(a => a.sentiment === 'positive').length - arr.filter(a => a.sentiment === 'negative').length) / arr.length
  }
  const s7 = sentScore(last7), s23 = sentScore(prior23)
  const sentTrend = s7 > s23 + 0.1 ? 'improving' : s7 < s23 - 0.1 ? 'deteriorating' : 'stable'
  const sentShift = last7.length > 2 && Math.abs(s7 - s23) > 0.2

  // Catalyst counts
  const catalystCounts = useMemo(() => {
    const c = { Earnings: 0, 'M&A': 0, Analyst: 0, Macro: 0, Legal: 0 }
    processed.forEach(a => a.catalysts.forEach(cat => { if (cat in c) c[cat]++ }))
    return c
  }, [processed])

  // Filtered headline list
  const filtered = useMemo(() =>
    effectiveFilter === 'All' ? processed : processed.filter(a => a.catalysts.includes(effectiveFilter)),
    [processed, effectiveFilter])

  const FILTERS = ['All', 'Earnings', 'M&A', 'Analyst', 'Macro', 'Legal']

  const trendColor = sentTrend === 'improving' ? '#2a9d8f' : sentTrend === 'deteriorating' ? '#e76f51' : '#666'

  const innerContent = (
    <>
      {/* Loading skeleton */}
      {loading && (
        <div className="news-skeleton">
          {[1, 2, 3, 4].map(i => <div key={i} className="news-skel-row" style={{ width: i % 2 === 0 ? '70%' : '90%' }} />)}
        </div>
      )}

      {!loading && error && <div className="error" style={{ margin: '12px 0' }}>{error}</div>}

      {!loading && !error && articles.length === 0 && (
        <p className="info">No news found for {ticker} in the last 30 days.</p>
      )}

      {!loading && !error && articles.length > 0 && (
        <>
            {/* ── Velocity + Sentiment (hidden when shown in overview panel) ── */}
            {!hideIndicators && (
              <>
                <div className="news-section">
                  <div className="news-sec-title">
                    News Velocity
                    {isSpike && <span className="news-spike-badge">⚡ Spike</span>}
                  </div>
                  <VelocityChart byDay={byDay} />
                  <div className="news-vel-summary">
                    <strong>{week0}</strong> this week · <strong>{week1}</strong> prior week
                    {' · '}avg <strong>{avg30daily.toFixed(1)}/day</strong>
                    {isSpike && <span style={{ color: '#e76f51', marginLeft: 6, fontWeight: 600 }}>— unusual activity</span>}
                  </div>
                </div>

                <div className="news-section">
                  <div className="news-sec-title">Sentiment</div>
                  <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                    <DonutChart pos={sentCounts.pos} neg={sentCounts.neg} neu={sentCounts.neu} />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: '0.83rem', paddingTop: 4 }}>
                      <span><span style={{ color: '#2a9d8f', fontWeight: 700 }}>●</span> {sentCounts.pos} positive</span>
                      <span><span style={{ color: '#e76f51', fontWeight: 700 }}>●</span> {sentCounts.neg} negative</span>
                      <span><span style={{ color: '#9ca3af', fontWeight: 700 }}>●</span> {sentCounts.neu} neutral</span>
                      <div style={{ marginTop: 6, fontSize: '0.82rem' }}>
                        Trend:{' '}
                        <span style={{ fontWeight: 700, color: trendColor }}>{sentTrend}</span>
                        {sentShift && <span className="news-shift-badge">shift detected</span>}
                      </div>
                      {last7.length > 0 && (
                        <div style={{ fontSize: '0.78rem', color: '#888' }}>
                          Last 7 days: {last7.filter(a => a.sentiment === 'positive').length}+ {last7.filter(a => a.sentiment === 'negative').length}−
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* ── Headline Feed ────────────────────────────────────── */}
            <div className="news-section" style={{ flex: 1 }}>
              {filtered.length === 0
                ? <p className="info" style={{ margin: '12px 0 0' }}>No articles match this filter.</p>
                : (
                  <div className="news-article-list">
                    {filtered.slice(0, 60).map(a => (
                      <a key={a.id} href={a.url} target="_blank" rel="noopener noreferrer" className="news-article">
                        <div className="news-art-meta">
                          <span className={`news-src-badge${PREMIUM.has(a.fmtSource) ? ' premium' : ''}`}>{a.fmtSource}</span>
                          <span className="news-art-date">{a.fmtDate}</span>
                          <span className={`news-sent-dot ns-${a.sentiment}`} title={a.sentiment} />
                          {a.catalysts.slice(0, 2).map(c => (
                            <span key={c} className="news-cat-tag">{c}</span>
                          ))}
                        </div>
                        <div className="news-art-headline">{a.headline}</div>
                        {a.summary && (
                          <div className="news-art-summary">
                            {a.summary.slice(0, 130)}{a.summary.length > 130 ? '…' : ''}
                          </div>
                        )}
                      </a>
                    ))}
                  </div>
                )
              }
            </div>
          </>
        )}
    </>
  )

  if (inline) return <div style={{ minHeight: 200 }}>{innerContent}</div>

  return (
    <>
      <div className="news-overlay" onClick={onClose} />
      <div className="news-panel">
        <div className="news-panel-hdr">
          <div>
            <div className="news-panel-ticker">{ticker}</div>
            <div className="news-panel-sub">News Intelligence · Last 30 days</div>
          </div>
          <button type="button" className="detail-close" onClick={onClose}>×</button>
        </div>
        {innerContent}
      </div>
    </>
  )
}
