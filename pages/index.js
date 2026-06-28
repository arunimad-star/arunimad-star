import React, { useEffect, useState, useMemo } from 'react'
import NewsPanel, { computeIndicators, VelocityChart, DonutChart } from '../components/NewsPanel'

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(err) { return { error: err } }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 20, background: '#fff1f2', border: '1px solid #fca5a5', borderRadius: 8, margin: 12, fontFamily: 'monospace' }}>
          <div style={{ fontWeight: 700, color: '#be123c', marginBottom: 8 }}>Render Error (detail panel)</div>
          <div style={{ color: '#7f1d1d', fontSize: '0.85rem', marginBottom: 8 }}>{this.state.error.message}</div>
          <pre style={{ fontSize: '0.72rem', color: '#991b1b', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 300, overflow: 'auto' }}>{this.state.error.stack}</pre>
          <button onClick={() => this.setState({ error: null })} style={{ marginTop: 8, padding: '4px 12px', fontSize: '0.8rem', cursor: 'pointer' }}>Dismiss</button>
        </div>
      )
    }
    return this.props.children
  }
}

// TAM estimates by industry/sector (public research estimates, ~2030 horizon)
const INDUSTRY_TAM = {
  'Software':                       { tam: '$1.2T', cagr: '11%', note: 'Enterprise & cloud software' },
  'Application Software':           { tam: '$1.0T', cagr: '12%', note: 'Business application software' },
  'Systems Software':               { tam: '$600B', cagr: '10%', note: 'OS, infrastructure software' },
  'Semiconductors':                 { tam: '$1.0T', cagr: '14%', note: 'Global semiconductor market' },
  'Hardware':                       { tam: '$450B', cagr: '5%',  note: 'Computing hardware & peripherals' },
  'IT Services':                    { tam: '$1.8T', cagr: '9%',  note: 'Global IT services & consulting' },
  'Internet Software & Services':   { tam: '$800B', cagr: '15%', note: 'Digital platforms & services' },
  'Interactive Media & Services':   { tam: '$700B', cagr: '12%', note: 'Digital media & advertising' },
  'Biotechnology':                  { tam: '$800B', cagr: '13%', note: 'Global biotech market' },
  'Pharmaceuticals':                { tam: '$1.5T', cagr: '6%',  note: 'Global pharmaceutical market' },
  'Medical Devices':                { tam: '$600B', cagr: '8%',  note: 'Global medical devices' },
  'Health Care Services':           { tam: '$500B', cagr: '7%',  note: 'Healthcare services market' },
  'Banks':                          { tam: '$8T+',  cagr: '5%',  note: 'Global banking revenue pool' },
  'Insurance':                      { tam: '$8T',   cagr: '6%',  note: 'Global insurance premiums' },
  'Capital Markets':                { tam: '$500B', cagr: '8%',  note: 'Asset mgmt & capital markets fees' },
  'Consumer Finance':               { tam: '$1.2T', cagr: '7%',  note: 'Global consumer finance market' },
  'Oil, Gas & Consumable Fuels':    { tam: '$5T',   cagr: '1%',  note: 'Global O&G market' },
  'Electric Utilities':             { tam: '$2T',   cagr: '6%',  note: 'Global power market' },
  'Specialty Retail':               { tam: '$3T',   cagr: '5%',  note: 'Global specialty retail' },
  'Internet & Direct Marketing':    { tam: '$6T',   cagr: '10%', note: 'Global e-commerce market' },
  'Automobiles':                    { tam: '$4T',   cagr: '5%',  note: 'Global auto market incl. EV' },
  'Wireless Telecommunication':     { tam: '$1.5T', cagr: '4%',  note: 'Global wireless services' },
  'Media':                          { tam: '$2.5T', cagr: '5%',  note: 'Global media & entertainment' },
  'Real Estate Management':         { tam: '$3T',   cagr: '6%',  note: 'Global real estate services' },
}

const SECTOR_TAM = {
  'Technology':             { tam: '$5T+',  cagr: '12%', note: 'Global technology market by 2030' },
  'Healthcare':             { tam: '$12T',  cagr: '7%',  note: 'Global healthcare market by 2030' },
  'Financials':             { tam: '$20T+', cagr: '5%',  note: 'Global financial services' },
  'Consumer Discretionary': { tam: '$5T',   cagr: '8%',  note: 'Global discretionary consumer market' },
  'Consumer Staples':       { tam: '$8T',   cagr: '4%',  note: 'Global consumer staples market' },
  'Energy':                 { tam: '$8T',   cagr: '2%',  note: 'Global energy market' },
  'Utilities':              { tam: '$3T',   cagr: '5%',  note: 'Global utilities market' },
  'Industrials':            { tam: '$4T',   cagr: '6%',  note: 'Global industrials market' },
  'Materials':              { tam: '$2T',   cagr: '5%',  note: 'Global materials market' },
  'Real Estate':            { tam: '$3T',   cagr: '6%',  note: 'Global real estate market' },
  'Communication Services': { tam: '$2.5T', cagr: '7%',  note: 'Global communications & media' },
}

const SECTOR_MULTIPLES = {
  'Technology':              ['P/E', 'P/S', 'EV/EBITDA'],
  'Healthcare':              ['P/E', 'EV/EBITDA', 'EV/Rev'],
  'Financials':              ['P/E', 'P/B', 'P/TBV'],
  'Energy':                  ['EV/EBITDA', 'P/CF', 'EV/EBIT'],
  'Utilities':               ['EV/EBITDA', 'P/E', 'P/B'],
  'Industrials':             ['P/E', 'EV/EBITDA', 'EV/EBIT'],
  'Consumer Discretionary':  ['P/E', 'EV/EBITDA', 'P/S'],
  'Consumer Staples':        ['P/E', 'EV/EBITDA', 'P/S'],
  'Real Estate':             ['P/FFO', 'EV/EBITDA', 'P/B'],
  'Materials':               ['EV/EBITDA', 'P/E', 'P/B'],
  'Communication Services':  ['EV/EBITDA', 'P/E', 'P/S'],
}


// ── Financial Signals Engine ──────────────────────────────────────────────
// Pure function: takes raw EDGAR data + sector string, returns array of signal objects.
// Every defined signal always appears in the output:
//   status:'triggered'   → condition met, show with severity color
//   status:'not_triggered' → condition not met, omit from UI
//   status:'coming_soon' → required data is missing
function analyzeSignals(rawData, sector) {
  const signals = []
  if (!rawData) return signals

  const ann = rawData.annual || {}
  const qtr = rawData.quarterly || {}

  // ── helpers ──
  const last = arr => {
    const v = (arr || []).filter(x => x != null)
    return v.length ? v[v.length - 1] : null
  }
  const prev = arr => {
    const v = (arr || []).filter(x => x != null)
    return v.length >= 2 ? v[v.length - 2] : null
  }
  const gr = (curr, prv) => {
    if (curr == null || prv == null || prv === 0) return null
    return (curr - prv) / Math.abs(prv) * 100
  }
  const pct = v => v != null ? `${v > 0 ? '+' : ''}${v.toFixed(1)}%` : '-'
  const fmtV = v => {
    if (v == null) return '-'
    const a = Math.abs(v)
    if (a >= 1e12) return `$${(v / 1e12).toFixed(1)}T`
    if (a >= 1e9)  return `$${(v / 1e9).toFixed(1)}B`
    if (a >= 1e6)  return `$${(v / 1e6).toFixed(0)}M`
    return `$${Math.round(v).toLocaleString()}`
  }
  const absCpx = v => v != null ? Math.abs(v) : null

  // sig() registers a signal; check() returns null=coming_soon, false=not_triggered, or {severity,detail}
  function sig(title, category, check) {
    let result
    try { result = check() } catch (e) {
      console.log(`[signals] error "${title}":`, e.message)
      result = null
    }
    if (result === null) {
      console.log(`[signals] coming_soon: "${title}"`)
      signals.push({ title, category, status: 'coming_soon' })
    } else if (result === false) {
      signals.push({ title, category, status: 'not_triggered' })
    } else {
      signals.push({ title, category, status: 'triggered', severity: result.severity, detail: result.detail })
    }
  }

  // ── pre-compute annual values ──
  const revCurr  = last(ann.revenue),        revPrev  = prev(ann.revenue)
  const gpCurr   = last(ann.grossProfit),     gpPrev   = prev(ann.grossProfit)
  const niCurr   = last(ann.netIncome),       niPrev   = prev(ann.netIncome)
  const oiCurr   = last(ann.operatingIncome), oiPrev   = prev(ann.operatingIncome)
  const daCurr   = last(ann.da),              daPrev   = prev(ann.da)
  const ocfCurr  = last(ann.ocf),             ocfPrev  = prev(ann.ocf)
  const capRaw   = last(ann.capex),           capRawP  = prev(ann.capex)
  const capexCurr = absCpx(capRaw),           capexPrev = absCpx(capRawP)
  const sgaCurr  = last(ann.sga),             sgaPrev  = prev(ann.sga)
  const rdCurr   = last(ann.rd),              rdPrev   = prev(ann.rd)
  const invCurr  = last(ann.inventory),       invPrev  = prev(ann.inventory)
  const recCurr  = last(ann.receivables),     recPrev  = prev(ann.receivables)
  const payCurr  = last(ann.payables),        payPrev  = prev(ann.payables)
  const defCurr  = last(ann.deferredRevenue), defPrev  = prev(ann.deferredRevenue)
  const cashCurr = last(ann.cash)
  const ltDebt   = last(ann.longTermDebt)
  const stDebt   = last(ann.shortTermDebt)
  const sbcCurr  = last(ann.sbc)
  const shCurr   = last(ann.shares),          shPrev   = prev(ann.shares)
  const gwCurr   = last(ann.goodwill)
  const assCurr  = last(ann.assets)

  const ebitdaCurr = (oiCurr != null && daCurr != null) ? oiCurr + daCurr : null
  const ebitdaPrev = (oiPrev != null && daPrev != null) ? oiPrev + daPrev : null
  const fcfCurr    = (ocfCurr != null && capexCurr != null) ? ocfCurr - capexCurr : null
  const fcfPrev    = (ocfPrev != null && capexPrev != null) ? ocfPrev - capexPrev : null
  const gmCurr     = (gpCurr != null && revCurr != null && revCurr > 0) ? gpCurr / revCurr * 100 : null
  const gmPrev     = (gpPrev != null && revPrev != null && revPrev > 0) ? gpPrev / revPrev * 100 : null
  const revGrowth  = gr(revCurr, revPrev)
  const invGrowth  = gr(invCurr, invPrev)
  const recGrowth  = gr(recCurr, recPrev)
  const payGrowth  = gr(payCurr, payPrev)
  const sgaGrowth  = gr(sgaCurr, sgaPrev)
  const totalDebt  = (ltDebt != null || stDebt != null) ? (ltDebt ?? 0) + (stDebt ?? 0) : null

  // Sector flags
  const sl       = (sector || '').toLowerCase()
  const isTech   = sl.includes('tech') || sl.includes('software') || sl.includes('semiconductor') || sl.includes('internet')
  const isRetail = sl.includes('retail') || sl.includes('consumer discret') || sl.includes('consumer staple')
  const isBank   = sl.includes('bank') || sl.includes('financ') || sl.includes('capital market') || sl.includes('insurance')
  const isEnergy = sl.includes('energy') || sl.includes('oil') || sl.includes('gas') || sl.includes('utilities')
  const isBio    = sl.includes('health') || sl.includes('biotech') || sl.includes('pharma') || sl.includes('medical')

  // ═══════════════════════════ GROWTH SIGNALS ═══════════════════════════

  sig('Inventory outpacing revenue', 'growth', () => {
    if (invGrowth == null || revGrowth == null) return null
    if (revGrowth <= 0 || invGrowth <= 0) return false
    if (invGrowth > 1.5 * revGrowth) {
      return { severity: 'red', detail: `Inventory ${pct(invGrowth)} YoY vs revenue ${pct(revGrowth)} - potential demand weakness` }
    }
    return false
  })

  sig('Receivables outpacing revenue', 'growth', () => {
    if (recGrowth == null || revGrowth == null) return null
    if (revGrowth <= 0 || recGrowth <= 0) return false
    if (recGrowth > 1.5 * revGrowth) {
      return { severity: 'yellow', detail: `Receivables ${pct(recGrowth)} YoY vs revenue ${pct(revGrowth)} - watch collection quality` }
    }
    return false
  })

  sig('Losing supplier leverage', 'growth', () => {
    if (payGrowth == null || revGrowth == null) return null
    if (revGrowth > 2 && payGrowth < 0) {
      return { severity: 'yellow', detail: `Payables ${pct(payGrowth)} YoY while revenue ${pct(revGrowth)} - paying suppliers faster` }
    }
    return false
  })

  sig('Revenue growth not dropping to gross profit', 'growth', () => {
    if (revGrowth == null || gpCurr == null || gpPrev == null) return null
    const gpGrowth = gr(gpCurr, gpPrev)
    if (gpGrowth == null) return null
    if (revGrowth > 3 && gpGrowth < revGrowth * 0.4) {
      return { severity: 'red', detail: `Revenue ${pct(revGrowth)} YoY but gross profit ${pct(gpGrowth)} - margin leakage` }
    }
    return false
  })

  sig('Backlog shrinking', 'growth', () => {
    const qd = qtr.deferredRevenue
    if (!qd || qd.length < 2) return null
    const qL = last(qd), qP = prev(qd)
    if (qL == null || qP == null) return null
    const g = gr(qL, qP)
    if (g == null) return null
    if (g < -5) return { severity: 'yellow', detail: `Deferred revenue ${pct(g)} QoQ - backlog contracting` }
    return false
  })

  sig('Revenue momentum building', 'growth', () => {
    const qr = (qtr.revenue || []).filter(v => v != null)
    if (qr.length < 4) return null
    const g1 = gr(qr[qr.length - 3], qr[qr.length - 4])
    const g2 = gr(qr[qr.length - 2], qr[qr.length - 3])
    const g3 = gr(qr[qr.length - 1], qr[qr.length - 2])
    if (g1 == null || g2 == null || g3 == null) return null
    if (g3 > g2 && g2 > g1 && g3 > 0) {
      return { severity: 'green', detail: `Revenue growth accelerating 3 consecutive quarters: ${pct(g1)} → ${pct(g2)} → ${pct(g3)} QoQ` }
    }
    return false
  })

  // ═══════════════════════════ MARGIN SIGNALS ═══════════════════════════

  sig('Gross margin under pressure', 'margins', () => {
    if (gmCurr == null || gmPrev == null) return null
    const delta = gmCurr - gmPrev
    if (delta < -1) return { severity: 'red', detail: `Gross margin ${gmPrev.toFixed(1)}% → ${gmCurr.toFixed(1)}% (${delta.toFixed(1)}pp YoY)` }
    return false
  })

  sig('Gross margin expanding', 'margins', () => {
    if (gmCurr == null || gmPrev == null) return null
    const delta = gmCurr - gmPrev
    if (delta > 1) return { severity: 'green', detail: `Gross margin ${gmPrev.toFixed(1)}% → ${gmCurr.toFixed(1)}% (+${delta.toFixed(1)}pp YoY)` }
    return false
  })

  sig('Operating leverage deteriorating', 'margins', () => {
    if (sgaGrowth == null || revGrowth == null) return null
    if (sgaGrowth > revGrowth + 3 && sgaGrowth > 5) {
      return { severity: 'yellow', detail: `SG&A ${pct(sgaGrowth)} YoY vs revenue ${pct(revGrowth)} - costs outgrowing sales` }
    }
    return false
  })

  sig('Below-the-line costs rising', 'margins', () => {
    if (ebitdaCurr == null || ebitdaPrev == null || niCurr == null || niPrev == null || revCurr == null || revCurr <= 0 || revPrev == null || revPrev <= 0) return null
    const eMCurr = ebitdaCurr / revCurr * 100
    const eMPrev = ebitdaPrev / revPrev * 100
    const nMCurr = niCurr / revCurr * 100
    const nMPrev = niPrev / revPrev * 100
    if (eMCurr > eMPrev + 0.5 && nMCurr < nMPrev - 0.5) {
      return { severity: 'yellow', detail: `EBITDA margin +${(eMCurr - eMPrev).toFixed(1)}pp but net margin ${(nMCurr - nMPrev).toFixed(1)}pp - interest/tax drag` }
    }
    return false
  })

  sig('R&D investment declining', 'margins', () => {
    if (!isTech) return false
    if (rdCurr == null || rdPrev == null || revCurr == null || revCurr <= 0 || revPrev == null || revPrev <= 0) return null
    const rdPCurr = rdCurr / revCurr * 100
    const rdPPrev = rdPrev / revPrev * 100
    if (rdPCurr < rdPPrev - 1) {
      return { severity: 'yellow', detail: `R&D as % of revenue: ${rdPPrev.toFixed(1)}% → ${rdPCurr.toFixed(1)}% - reduced investment intensity` }
    }
    return false
  })

  sig('Rule of 40 deteriorating', 'margins', () => {
    if (!isTech) return false
    if (revGrowth == null || fcfCurr == null || revCurr == null || revCurr <= 0) return null
    const fcfMargin = fcfCurr / revCurr * 100
    const rule40 = revGrowth + fcfMargin
    if (rule40 < 20) {
      return { severity: 'red', detail: `Rule of 40: ${revGrowth.toFixed(1)}% rev growth + ${fcfMargin.toFixed(1)}% FCF margin = ${rule40.toFixed(1)} (below 20 threshold)` }
    }
    return false
  })

  // ═══════════════════════════ CASH QUALITY ═════════════════════════════

  sig('Earnings not converting to cash', 'cash', () => {
    if (niCurr == null || niPrev == null || fcfCurr == null || fcfPrev == null) return null
    const niGr  = gr(niCurr, niPrev)
    const fcfGr = gr(fcfCurr, fcfPrev)
    if (niGr == null || fcfGr == null) return null
    if (niGr > 5 && fcfGr < -10) {
      return { severity: 'red', detail: `Net income ${pct(niGr)} YoY but FCF ${pct(fcfGr)} - accruals diverging from cash` }
    }
    return false
  })

  sig('SBC masking profitability', 'cash', () => {
    if (sbcCurr == null || niCurr == null || niCurr <= 0) return null
    const sbcPct = sbcCurr / niCurr * 100
    if (sbcPct > 50) {
      return { severity: 'red', detail: `SBC at ${sbcPct.toFixed(0)}% of net income (${fmtV(sbcCurr)}) - significantly masking profitability` }
    }
    return false
  })

  sig('High SBC dilution', 'cash', () => {
    if (sbcCurr == null || niCurr == null || niCurr <= 0) return null
    const sbcPct = sbcCurr / niCurr * 100
    if (sbcPct > 15 && sbcPct <= 50) {
      return { severity: 'yellow', detail: `SBC at ${sbcPct.toFixed(0)}% of net income (${fmtV(sbcCurr)}) - meaningful dilution` }
    }
    return false
  })

  sig('Heavy capex without revenue follow-through', 'cash', () => {
    if (capexCurr == null || capexPrev == null || revGrowth == null) return null
    const capGr = gr(capexCurr, capexPrev)
    if (capGr == null) return null
    if (capGr > 30 && revGrowth < 5) {
      return { severity: 'yellow', detail: `Capex ${pct(capGr)} YoY (${fmtV(capexCurr)}) with revenue only ${pct(revGrowth)}` }
    }
    return false
  })

  sig('Cash burn accelerating', 'cash', () => {
    const qc = qtr.cash
    if (!qc || qc.length < 2) return null
    const qL = last(qc), qP = prev(qc)
    if (qL == null || qP == null || qP <= 0) return null
    const cg = gr(qL, qP)
    if (cg == null) return null
    if (cg < -20) return { severity: 'red', detail: `Cash ${pct(cg)} QoQ (${fmtV(qP)} → ${fmtV(qL)})` }
    return false
  })

  sig('Strong free cash flow generation', 'cash', () => {
    if (fcfCurr == null || revCurr == null || revCurr <= 0) return null
    const fcfMgn = fcfCurr / revCurr * 100
    if (fcfMgn > 15) {
      return { severity: 'green', detail: `FCF margin at ${fcfMgn.toFixed(1)}% (${fmtV(fcfCurr)}) - strong cash conversion` }
    }
    return false
  })

  // ═══════════════════════ BALANCE SHEET SIGNALS ════════════════════════

  sig('High leverage', 'balance_sheet', () => {
    if (ebitdaCurr == null || ebitdaCurr <= 0 || totalDebt == null || cashCurr == null) return null
    const netDebt = totalDebt - cashCurr
    const lev = netDebt / ebitdaCurr
    if (lev > 4) return { severity: 'red', detail: `Net debt/EBITDA at ${lev.toFixed(1)}x (${fmtV(netDebt)} net debt vs ${fmtV(ebitdaCurr)} EBITDA)` }
    return false
  })

  sig('Leverage elevated', 'balance_sheet', () => {
    if (ebitdaCurr == null || ebitdaCurr <= 0 || totalDebt == null || cashCurr == null) return null
    const netDebt = totalDebt - cashCurr
    const lev = netDebt / ebitdaCurr
    if (lev > 2 && lev <= 4) return { severity: 'yellow', detail: `Net debt/EBITDA at ${lev.toFixed(1)}x - elevated leverage` }
    return false
  })

  sig('Clean balance sheet', 'balance_sheet', () => {
    if (ebitdaCurr == null || ebitdaCurr <= 0 || totalDebt == null || cashCurr == null) return null
    const netDebt = totalDebt - cashCurr
    const lev = netDebt / ebitdaCurr
    if (lev < 1) return { severity: 'green', detail: `Net debt/EBITDA at ${lev.toFixed(1)}x - clean balance sheet` }
    return false
  })

  sig('Goodwill heavy - acquisition risk', 'balance_sheet', () => {
    if (gwCurr == null || assCurr == null || assCurr <= 0) return null
    const gwPct = gwCurr / assCurr * 100
    if (gwPct > 40) return { severity: 'yellow', detail: `Goodwill at ${gwPct.toFixed(0)}% of total assets (${fmtV(gwCurr)}) - impairment risk` }
    return false
  })

  sig('Share count dilution', 'balance_sheet', () => {
    if (shCurr == null || shPrev == null) return null
    const shGr = gr(shCurr, shPrev)
    if (shGr == null) return null
    if (shGr > 2) return { severity: 'yellow', detail: `Share count +${shGr.toFixed(1)}% YoY - dilution` }
    return false
  })

  sig('Buybacks reducing share count', 'balance_sheet', () => {
    if (shCurr == null || shPrev == null) return null
    const shGr = gr(shCurr, shPrev)
    if (shGr == null) return null
    if (shGr < -1) return { severity: 'green', detail: `Share count ${pct(shGr)} YoY - buybacks reducing dilution` }
    return false
  })

  // ═══════════════════════ SECTOR-SPECIFIC SIGNALS ══════════════════════

  sig('Inventory buildup trend', 'sector', () => {
    if (!isRetail) return false
    const qi = qtr.inventory, qr = qtr.revenue
    if (!qi || !qr || qi.length < 3 || qr.length < 3) return null
    const n = Math.min(qi.length, qr.length)
    const ratios = []
    for (let i = n - 3; i < n; i++) {
      if (qi[i] != null && qr[i] != null && qr[i] > 0) ratios.push(qi[i] / qr[i])
      else ratios.push(null)
    }
    if (ratios.some(r => r == null)) return null
    if (ratios[2] > ratios[1] && ratios[1] > ratios[0]) {
      return { severity: 'red', detail: `Inv/rev ratio rising 3 consecutive quarters: ${ratios.map(r => (r * 100).toFixed(1) + '%').join(' → ')}` }
    }
    return false
  })

  sig('Inventory turning slower', 'sector', () => {
    if (!isRetail) return false
    if (invCurr == null || invPrev == null || revCurr == null || revCurr <= 0 || revPrev == null || revPrev <= 0) return null
    const dioCurr = invCurr / (revCurr / 365)
    const dioPrev = invPrev / (revPrev / 365)
    if (dioCurr - dioPrev > 5) {
      return { severity: 'yellow', detail: `DIO ${Math.round(dioPrev)}d → ${Math.round(dioCurr)}d YoY (+${(dioCurr - dioPrev).toFixed(0)} days)` }
    }
    return false
  })

  sig('Software-like gross margins', 'sector', () => {
    if (!isTech) return false
    if (gmCurr == null) return null
    if (gmCurr > 70) return { severity: 'green', detail: `Gross margin at ${gmCurr.toFixed(1)}% - software-like economics with strong pricing power` }
    return false
  })

  sig('Credit quality deteriorating', 'sector', () => {
    if (!isBank) return false
    // Loan loss provisions require specific bank concepts - coming soon
    return null
  })

  sig('Net interest margin under pressure', 'sector', () => {
    if (!isBank) return false
    // NIM calculation requires interest income/expense concepts - coming soon
    return null
  })

  sig('Spending beyond cash generation', 'sector', () => {
    if (!isEnergy) return false
    if (capexCurr == null || ocfCurr == null) return null
    if (capexCurr > ocfCurr) {
      return { severity: 'yellow', detail: `Capex ${fmtV(capexCurr)} exceeds operating cash flow ${fmtV(ocfCurr)} - external financing likely needed` }
    }
    return false
  })

  sig('Cash runway', 'sector', () => {
    if (!isBio) return false
    const qc = qtr.cash, qo = qtr.ocf
    if (!qc || !qo || qc.length < 2 || qo.length < 2) return null
    const recentCash = last(qc)
    const recentOcf = (qo || []).filter(v => v != null).slice(-2)
    if (recentCash == null || recentOcf.length < 2) return null
    const avgBurn = recentOcf.reduce((s, v) => s + v, 0) / recentOcf.length
    if (avgBurn >= 0) return false
    const qRwy = recentCash / Math.abs(avgBurn)
    if (qRwy < 4) return { severity: 'red', detail: `Cash runway ~${qRwy.toFixed(1)} quarters (${fmtV(recentCash)} cash, burning ${fmtV(Math.abs(avgBurn))}/qtr)` }
    if (qRwy < 8) return { severity: 'yellow', detail: `Cash runway ~${qRwy.toFixed(1)} quarters - watch closely` }
    return false
  })

  return signals
}

// Main page component for the Capital IQ financial dashboard.
export default function Home() {
  // UI state and data storage.
  const [data, setData] = useState([])
  const [csvMode, setCsvMode] = useState(false)   // true when loaded from CIQ CSV (vs EDGAR)
  const [loading, setLoading] = useState(false)
  const [priceLoading, setPriceLoading] = useState(false)
  const [priceProgress, setPriceProgress] = useState({ loaded: 0, total: 0 })
  const [error, setError] = useState('')
  const [selectedSectors, setSelectedSectors] = useState([])
  const [selectedExchanges, setSelectedExchanges] = useState([])
  const [selectedMarketCaps, setSelectedMarketCaps] = useState([])
  const [selectedShortInterests, setSelectedShortInterests] = useState([])
  const [selectedDistFromLow, setSelectedDistFromLow] = useState([])
  const [selectedGrossMargins, setSelectedGrossMargins] = useState([])
  const [selectedOperatingMargins, setSelectedOperatingMargins] = useState([])
  const [selectedNetMargins, setSelectedNetMargins] = useState([])
  const [selectedBeta, setSelectedBeta] = useState([])
  const [selectedCfo, setSelectedCfo] = useState([])
  const [selectedSbcRev, setSelectedSbcRev] = useState([])
  const [selectedHfOwn, setSelectedHfOwn] = useState([])
  const [selectedAnalysts, setSelectedAnalysts] = useState([])
  const [selectedPpeRev, setSelectedPpeRev] = useState([])
  const [selectedRdRev, setSelectedRdRev] = useState([])
  const [selectedRoic, setSelectedRoic] = useState([])
  const [selectedTamGrowth, setSelectedTamGrowth] = useState([])
  const [mktShareGainFilter, setMktShareGainFilter] = useState(false)
  const [watchlistSides, setWatchlistSides] = useState({})
  const [sortBy, setSortBy] = useState(null)
  const [sortAsc, setSortAsc] = useState(true)
  const [selectedRow, setSelectedRow] = useState(null)
  const [viewMode, setViewMode] = useState('screener')
  const [watchlist, setWatchlist] = useState([])
  const [wlExtras, setWlExtras] = useState({})   // synthetic rows for tickers not in CSV (ETFs etc.)
  const [savedScreens, setSavedScreens] = useState([])
  const [showSaveModal, setShowSaveModal] = useState(false)
  const [newScreenName, setNewScreenName] = useState('')
  const [newsPanel, setNewsPanel] = useState(null)
  const [newsIndicators, setNewsIndicators] = useState({})
  const [selectedVelocity, setSelectedVelocity] = useState([])
  const [selectedSentiment, setSelectedSentiment] = useState([])
  const [newsLoadingAll, setNewsLoadingAll] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [multiplesData, setMultiplesData] = useState(null)
  const [multiplesError, setMultiplesError] = useState(null)
  const [multiplesLoading, setMultiplesLoading] = useState(false)
  const [detailEarnings, setDetailEarnings] = useState(null)
  const [industryNews, setIndustryNews] = useState(null)
  const [industryNewsLoading, setIndustryNewsLoading] = useState(false)
  const [financialsData, setFinancialsData] = useState(null)
  const [financialsLoading, setFinancialsLoading] = useState(false)
  const [competitorsData, setCompetitorsData] = useState(null)
  const [competitorsLoading, setCompetitorsLoading] = useState(false)
  const [insiderData, setInsiderData] = useState(null)
  const [insiderLoading, setInsiderLoading] = useState(false)
  const [sectorMetrics, setSectorMetrics] = useState(null)
  const [sectorMetricsLoading, setSectorMetricsLoading] = useState(false)
  const [earningsCall, setEarningsCall] = useState(null)
  const [earningsCallLoading, setEarningsCallLoading] = useState(false)
  const [earningsSignals, setEarningsSignals] = useState(null)
  const [earningsSignalsLoading, setEarningsSignalsLoading] = useState(false)
  const [qualityOfEarnings, setQualityOfEarnings] = useState(null)
  const [qualityOfEarningsLoading, setQualityOfEarningsLoading] = useState(false)
  const [chartRange, setChartRange] = useState('1y')
  const [chart1yData, setChart1yData] = useState(null)
  const [chart1yLoading, setChart1yLoading] = useState(false)
  const [chart5yData, setChart5yData] = useState(null)
  const [chart5yLoading, setChart5yLoading] = useState(false)
  const [chartHover, setChartHover] = useState(null)
  const [qoeMetric, setQoeMetric] = useState('cashConversion')
  const [detailPanelTab, setDetailPanelTab] = useState('overview')
  const [insiderFilter, setInsiderFilter] = useState(null)
  const [insiderSentimentCache, setInsiderSentimentCache] = useState({})
  const [insiderLoadingAll, setInsiderLoadingAll] = useState(false)
  const [allSignalsCache, setAllSignalsCache] = useState({})
  const [signalsLoadingAll, setSignalsLoadingAll] = useState(false)
  const [selectedSignalSeverity, setSelectedSignalSeverity] = useState([])
  const [selectedSignalCategories, setSelectedSignalCategories] = useState([])
  const [activePresetId, setActivePresetId] = useState(null)
  const [revenueSegments, setRevenueSegments] = useState(null)
  const [revenueSegmentsLoading, setRevenueSegmentsLoading] = useState(false)
  const [segTab, setSegTab] = useState('segment')
  const [newsFilter, setNewsFilter] = useState('all')
  const [signalsData, setSignalsData] = useState(null)
  const [signalsLoading, setSignalsLoading] = useState(false)
  const [signalsPanelOpen, setSignalsPanelOpen] = useState(null)
  const [snapshotData, setSnapshotData] = useState(null)
  const [hfHoldings, setHfHoldings] = useState(null)
  const [hfLoading, setHfLoading] = useState(false)
  const [congressTrades, setCongressTrades] = useState(null)
  const [congressLoading, setCongressLoading] = useState(false)
  const [managementData, setManagementData] = useState(null)
  const [tenkData, setTenkData] = useState(null)
  const [tenkLoading, setTenkLoading] = useState(false)
  const [recent8k, setRecent8k] = useState(null)
  const [productsExpanded, setProductsExpanded] = useState(false)
  const [supplyExpanded, setSupplyExpanded] = useState(false)
  const [descExpanded, setDescExpanded] = useState(false)
  const [expandedRiskFactors, setExpandedRiskFactors] = useState({})
  // Merge price/quote data from the API back into the current CSV rows.
  const mergeQuoteBatch = (currentRows, quotes) => {
    const quoteMap = new Map(
      quotes.map((quote) => [getTickerSymbol(quote.exchangeTicker || quote.ticker), quote])
    )
    return currentRows.map((row) => {
      const key = getTickerSymbol(row.exchangeTicker || row.securityTickers)
      const quote = quoteMap.get(key)
      if (!quote) return row
      return {
        ...row,
        ...quote,
        // Preserve EDGAR identity fields - enrichment sources must not overwrite
        exchangeTicker: row.exchangeTicker || quote.exchangeTicker,
        name: row.name || quote.name,
        exchange: row.exchange || quote.exchange || '',
        // Yahoo chart API returns marketCap in raw USD; convert to $mm for filters
        marketCap: quote.marketCap != null ? quote.marketCap / 1e6 : row.marketCap,
        // Preserve CIQ CSV 52W values — only override if quote has non-null values
        week52Low:  quote.week52Low  ?? row.week52Low,
        week52High: quote.week52High ?? row.week52High,
        // Financial data: use ?? so a null from one source never overwrites a real value from another
        totalRevenue: quote.totalRevenue ?? row.totalRevenue,
        grossProfit: quote.grossProfit ?? row.grossProfit,
        ebit: quote.ebit ?? row.ebit,
        ebitda: quote.ebitda ?? row.ebitda,
        netIncome: quote.netIncome ?? row.netIncome,
        totalDebt: quote.totalDebt ?? row.totalDebt,
        grossMargin: quote.grossMargin ?? row.grossMargin,
        operatingMargin: quote.operatingMargin ?? row.operatingMargin,
        netMargin: quote.netMargin ?? row.netMargin,
        beta: quote.beta ?? row.beta,
        shortInterest: quote.shortInterest ?? row.shortInterest,
        pe: quote.pe ?? row.pe,
        tev: quote.tev ?? row.tev,
        tevLtmRev: quote.tevLtmRev ?? row.tevLtmRev,
        // Sector/industry/description from Yahoo assetProfile / EDGAR
        fyLabel: quote.fyLabel || row.fyLabel || null,
        primarySector: quote.primarySector || row.primarySector || '',
        primaryIndustry: quote.primaryIndustry || row.primaryIndustry || '',
        description: quote.description || row.description || '',
        // Earnings info from Yahoo
        earningsCadence: row.earningsCadence || quote.earningsCadence || '',
        lastEarningsDate: row.lastEarningsDate || quote.lastEarningsDate || null,
        nextEarningsDate: row.nextEarningsDate || quote.nextEarningsDate || null,
        guidance: row.guidance || quote.guidance || '',
        earningsSurprise: row.earningsSurprise != null ? row.earningsSurprise : quote.earningsSurprise,
        earningsBeatMiss: row.earningsBeatMiss || quote.earningsBeatMiss || '',
      }
    })
  }

  // Load company universe from CIQ CSV (vsv2.xls), then enrich with live Yahoo prices.
  const handleLoadCSVCompanies = async () => {
    setLoading(true)
    setPriceLoading(false)
    setError('')
    setData([])
    setCsvMode(true)

    try {
      const res = await fetch('/companies.json')
      if (!res.ok) {
        setError(`Failed to load company list (${res.status} ${res.statusText})`)
        return
      }
      const companies = await res.json()
      const json = { data: companies, total: companies.length }

      let rows = json.data || []
      setData(rows)
      setLoading(false)

      if (rows.length === 0) return

      // ── Priority: load watchlist sparklines immediately before full price poll ──
      try {
        const wl = JSON.parse(localStorage.getItem('watchlist') || '[]')
        if (wl.length > 0) {
          const r = await fetch(`/api/spark-batch?tickers=${encodeURIComponent(wl.slice(0, 50).join(','))}`)
          const sparkJson = await r.json()
          if (r.ok && Array.isArray(sparkJson.data) && sparkJson.data.length > 0) {
            // Split into known (merge into rows) vs unknown (ETFs etc. → wlExtras)
            const rowTickerSet = new Set(rows.map(r => (r.ticker || r.exchangeTicker || '').toUpperCase()).filter(Boolean))
            const extras = {}
            for (const s of sparkJson.data) {
              const t = (s.ticker || s.exchangeTicker || '').toUpperCase()
              if (!t) continue
              if (!rowTickerSet.has(t) && (s.history || s.price != null)) {
                extras[t] = { ticker: t, exchangeTicker: t, name: t, price: s.price ?? null, week52Low: s.week52Low ?? null, week52High: s.week52High ?? null, history: s.history ?? null, primarySector: '', primaryIndustry: '', _isExtra: true }
              }
            }
            if (Object.keys(extras).length) setWlExtras(extras)
            rows = mergeQuoteBatch(rows, sparkJson.data)
            setData([...rows])
          }
        }
      } catch {}

      // Load prices via server-side background loader — poll until complete
      setPriceLoading(true)
      const applyPriceMap = (currentRows, priceMap) => {
        const quotes = currentRows
          .map(r => {
            const p = priceMap[r.ticker?.toUpperCase()]
            if (!p) return null
            return { ticker: r.ticker, exchangeTicker: r.ticker, ...p }
          })
          .filter(Boolean)
        return quotes.length > 0 ? mergeQuoteBatch(currentRows, quotes) : currentRows
      }

      const pollPrices = async () => {
        try {
          const pr = await fetch('/api/prices-all')
          if (!pr.ok) return
          const prJson = await pr.json()
          const priceMap = prJson.data || {}
          setPriceProgress({ loaded: prJson.loaded || 0, total: prJson.total || 0 })
          if (Object.keys(priceMap).length > 0) {
            rows = applyPriceMap(rows, priceMap)
            setData([...rows])
          }
          if (!prJson.complete) {
            setTimeout(pollPrices, 8000)  // poll again until all prices loaded
          } else {
            setPriceLoading(false)
          }
        } catch (err) {
          console.warn('prices-all poll failed', err)
          setPriceLoading(false)
        }
      }
      pollPrices()
    } catch (err) {
      setError(err.message)
      setPriceLoading(false)
    } finally {
      setLoading(false)
    }
  }

  // Load company universe from EDGAR, then enrich with Yahoo Finance data.
  const handleLoadEdgarCompanies = async (exchangeFilter = selectedExchanges) => {
    setLoading(true)
    setPriceLoading(false)
    setError('')
    setData([])
    setViewMode('screener')

    try {
      const res = await fetch('/api/edgar-companies')
      const json = await res.json()
      if (!res.ok || json.error) {
        setError(json.error || 'Failed to load EDGAR company list')
        return
      }

      let rows = json.data || []
      setData(rows)
      setLoading(false)

      // If exchanges were pre-selected on the setup page, only enrich matching companies.
      // Exchange is available directly from EDGAR, so we can filter before any API calls.
      const matchesExchange = (row) => {
        if (exchangeFilter.length === 0) return true
        const ex = (row.exchange || '').toLowerCase()
        return exchangeFilter.some(sel => ex === sel.toLowerCase())
      }

      const enrichRows = rows.filter(matchesExchange)
      const enrichTickers = Array.from(new Set(
        enrichRows.map(r => r.ticker || r.exchangeTicker).filter(Boolean)
      ))

      if (enrichTickers.length > 0) {
        setPriceLoading(true)
        const chunks = chunkArray(enrichTickers, 100)
        const maxConcurrent = 4

        // Phase 1: quote-batch (Yahoo batch - currently returns 401, kept for future)
        for (let i = 0; i < chunks.length; i += maxConcurrent) {
          const batch = chunks.slice(i, i + maxConcurrent)
          try {
            const results = await Promise.all(
              batch.map(async (chunk) => {
                const r = await fetch(`/api/quote-batch?tickers=${encodeURIComponent(chunk.join(','))}`)
                const quoteJson = await r.json()
                return r.ok && Array.isArray(quoteJson.data) ? quoteJson.data : []
              })
            )
            const quotes = results.flat()
            if (quotes.length > 0) { rows = mergeQuoteBatch(rows, quotes); setData(rows) }
          } catch (err) {
            console.warn('Quote-batch fetch failed', err)
          }
        }

        // Phase 2: spark-batch - 1-year monthly chart history for sparklines
        for (let i = 0; i < chunks.length; i += maxConcurrent) {
          const batch = chunks.slice(i, i + maxConcurrent)
          try {
            const results = await Promise.all(
              batch.map(async (chunk) => {
                const r = await fetch(`/api/spark-batch?tickers=${encodeURIComponent(chunk.join(','))}`)
                const sparkJson = await r.json()
                return r.ok && Array.isArray(sparkJson.data) ? sparkJson.data : []
              })
            )
            const sparks = results.flat()
            if (sparks.length > 0) { rows = mergeQuoteBatch(rows, sparks); setData(rows) }
          } catch (err) {
            console.warn('Spark-batch fetch failed', err)
          }
        }

        // Phase 3: SEC XBRL frames bulk seed - 10 API calls cover ALL ~7000 companies
        // (vs 16 calls per company × 50 = 800 calls with the old per-ticker approach).
        // Frames give revenue/GP/NI/margins for every company with a 10-K on EDGAR.
        // EBITDA and fyLabel still come from on-demand edgar-financials when a company is clicked.
        try {
          const framesResp = await fetch('/api/edgar-frames')
          const framesJson = await framesResp.json()
          const framesMap = framesJson.data || {}  // keyed by integer CIK (as string in JSON)

          const frameQuotes = enrichRows
            .filter(row => row.cik)
            .map(row => {
              const cikKey = parseInt(row.cik, 10)
              const fin = framesMap[cikKey]
              if (!fin) return null
              const ticker = row.ticker || row.exchangeTicker
              return {
                ticker,
                exchangeTicker:  ticker,
                totalRevenue:    fin.revenueMm         ?? null,
                grossProfit:     fin.grossProfitMm     ?? null,
                netIncome:       fin.netIncomeMm       ?? null,
                grossMargin:     fin.grossMargin       ?? null,
                operatingMargin: fin.operatingMargin   ?? null,
                netMargin:       fin.netMargin         ?? null,
              }
            })
            .filter(Boolean)

          if (frameQuotes.length > 0) { rows = mergeQuoteBatch(rows, frameQuotes); setData(rows) }
        } catch (err) {
          console.warn('EDGAR frames seed failed', err)
        }
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
      setPriceLoading(false)
    }
  }

  useEffect(() => { handleLoadCSVCompanies() }, [])

  useEffect(() => {
    try {
      const wl = JSON.parse(localStorage.getItem('watchlist') || '[]')
      const ss = JSON.parse(localStorage.getItem('savedScreens') || '[]')
      setWatchlist(wl)
      setSavedScreens(ss)
      const sides = JSON.parse(localStorage.getItem('watchlistSides') || '{}')
      setWatchlistSides(sides)
    } catch {}
  }, [])

  // Hydrate news indicators from sessionStorage (populated on previous panel opens)
  useEffect(() => {
    setMounted(true)
    try {
      const ind = {}
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i)
        if (k?.startsWith('fnews_ind_')) {
          const t = k.replace('fnews_ind_', '')
          const v = JSON.parse(sessionStorage.getItem(k))
          if (v) ind[t] = v
        }
      }
      if (Object.keys(ind).length > 0) setNewsIndicators(ind)
    } catch {}
  }, [])

  // Reset chart state when selected company changes
  useEffect(() => {
    setChartRange('1y')
    setChart1yData(null)
    setChart5yData(null)
    setChartHover(null)
  }, [selectedRow?.name])

  // Fetch 1Y daily chart data whenever row changes
  useEffect(() => {
    if (!selectedRow) return
    const ticker = getTickerSymbol(selectedRow.exchangeTicker || selectedRow.securityTickers)
    if (!ticker) return
    setChart1yLoading(true)
    fetch(`/api/chart-history?ticker=${encodeURIComponent(ticker)}&range=1y`)
      .then(r => r.json())
      .then(d => { setChart1yData(d); setChart1yLoading(false) })
      .catch(() => setChart1yLoading(false))
  }, [selectedRow?.name])

  // Fetch 5Y chart data on demand
  useEffect(() => {
    if (!selectedRow || chartRange !== '5y') return
    const ticker = getTickerSymbol(selectedRow.exchangeTicker || selectedRow.securityTickers)
    if (!ticker) return
    setChart5yLoading(true)
    fetch(`/api/chart-history?ticker=${encodeURIComponent(ticker)}&range=5y`)
      .then(r => r.json())
      .then(d => { setChart5yData(d); setChart5yLoading(false) })
      .catch(() => setChart5yLoading(false))
  }, [selectedRow?.name, chartRange])

  // Fetch Finnhub earnings whenever the selected row changes
  useEffect(() => {
    if (!selectedRow) { setDetailEarnings(null); return }
    const ticker = getTickerSymbol(selectedRow.exchangeTicker || selectedRow.securityTickers)
    if (!ticker) return
    setDetailEarnings(null)
    fetch(`/api/finnhub-earnings-detail?ticker=${encodeURIComponent(ticker)}`)
      .then(r => r.json())
      .then(d => { if (!d.error) setDetailEarnings(d) })
      .catch(() => {})
  }, [selectedRow?.name])

  // Fetch Quality of Earnings whenever the selected row changes
  useEffect(() => {
    if (!selectedRow) { setQualityOfEarnings(null); return }
    const ticker = getTickerSymbol(selectedRow.exchangeTicker || selectedRow.securityTickers)
    if (!ticker) return
    setQualityOfEarnings(null)
    setQualityOfEarningsLoading(true)
    fetch(`/api/quality-of-earnings?ticker=${encodeURIComponent(ticker)}`)
      .then(r => r.json())
      .then(d => setQualityOfEarnings(d.error ? null : d))
      .catch(() => {})
      .finally(() => setQualityOfEarningsLoading(false))
  }, [selectedRow?.name])

  // Fetch earnings signals (8-K analysis) whenever the selected row changes
  useEffect(() => {
    if (!selectedRow) { setEarningsSignals(null); return }
    const ticker = getTickerSymbol(selectedRow.exchangeTicker || selectedRow.securityTickers)
    if (!ticker) return
    setEarningsSignals(null)
    setEarningsSignalsLoading(true)
    fetch(`/api/earnings-signals?ticker=${encodeURIComponent(ticker)}`)
      .then(r => r.json())
      .then(d => setEarningsSignals(d.error ? null : d))
      .catch(() => {})
      .finally(() => setEarningsSignalsLoading(false))
  }, [selectedRow?.name])

  // Fetch FMP multiples whenever the selected row or metric changes
  useEffect(() => {
    if (!selectedRow) { setMultiplesData(null); return }
    const ticker = getTickerSymbol(selectedRow.exchangeTicker || selectedRow.securityTickers)
    if (!ticker) return
    setMultiplesData(null)
    setMultiplesError(null)
    setMultiplesLoading(true)
    fetch(`/api/edgar-multiples?ticker=${encodeURIComponent(ticker)}`)
      .then(r => r.json())
      .then(d => { if (d.error) setMultiplesError(d.error); else setMultiplesData(d.metrics || null) })
      .catch(e => setMultiplesError(e.message))
      .finally(() => setMultiplesLoading(false))
  }, [selectedRow?.name])

  // Fetch sector ETF news whenever the selected row changes
  useEffect(() => {
    if (!selectedRow?.primarySector) { setIndustryNews(null); return }
    setIndustryNews(null)
    setIndustryNewsLoading(true)
    fetch(`/api/industry-news?sector=${encodeURIComponent(selectedRow.primarySector)}`)
      .then(r => r.json())
      .then(d => setIndustryNews(d.news || []))
      .catch(() => setIndustryNews([]))
      .finally(() => setIndustryNewsLoading(false))
  }, [selectedRow?.name])

  // Fetch competitor data whenever the selected row changes
  useEffect(() => {
    if (!selectedRow) { setCompetitorsData(null); return }
    const ticker = getTickerSymbol(selectedRow.exchangeTicker || selectedRow.securityTickers)
    if (!ticker) return
    setCompetitorsData(null)
    setCompetitorsLoading(true)
    fetch(`/api/competitors?ticker=${encodeURIComponent(ticker)}`)
      .then(r => r.json())
      .then(d => { if (!d.error) setCompetitorsData(d) })
      .catch(() => {})
      .finally(() => setCompetitorsLoading(false))
  }, [selectedRow?.name])

  // Fetch insider + institutional data whenever the selected row changes
  useEffect(() => {
    if (!selectedRow) { setInsiderData(null); return }
    const ticker = getTickerSymbol(selectedRow.exchangeTicker || selectedRow.securityTickers)
    if (!ticker) return
    setInsiderData(null)
    setInsiderLoading(true)
    fetch(`/api/insider-ownership?ticker=${encodeURIComponent(ticker)}`)
      .then(r => r.json())
      .then(d => {
        if (!d.error) {
          setInsiderData(d)
          if (d.insider?.sentiment) setInsiderSentimentCache(prev => ({ ...prev, [ticker]: d.insider.sentiment }))
        }
      })
      .catch(() => {})
      .finally(() => setInsiderLoading(false))
  }, [selectedRow?.name])

  // Fetch HF 13F holdings whenever the selected row changes
  useEffect(() => {
    if (!selectedRow) { setHfHoldings(null); return }
    const ticker = getTickerSymbol(selectedRow.exchangeTicker || selectedRow.securityTickers)
    if (!ticker) return
    setHfHoldings(null)
    setHfLoading(true)
    fetch(`/api/hf-holdings?ticker=${encodeURIComponent(ticker)}`)
      .then(r => r.json())
      .then(d => setHfHoldings(d))
      .catch(() => {})
      .finally(() => setHfLoading(false))
  }, [selectedRow?.name])

  // Fetch congressional trades whenever the selected row changes
  useEffect(() => {
    if (!selectedRow) { setCongressTrades(null); return }
    const ticker = getTickerSymbol(selectedRow.exchangeTicker || selectedRow.securityTickers)
    if (!ticker) return
    setCongressTrades(null)
    setCongressLoading(true)
    fetch(`/api/congress-trades?ticker=${encodeURIComponent(ticker)}`)
      .then(r => r.json())
      .then(d => setCongressTrades(d))
      .catch(() => {})
      .finally(() => setCongressLoading(false))
  }, [selectedRow?.name])

  // Fetch 8-K earnings call highlights whenever the selected row changes
  useEffect(() => {
    if (!selectedRow) { setEarningsCall(null); return }
    const ticker = getTickerSymbol(selectedRow.exchangeTicker || selectedRow.securityTickers)
    if (!ticker) return
    setEarningsCall(null)
    setEarningsCallLoading(true)
    fetch(`/api/earnings-call?ticker=${encodeURIComponent(ticker)}`)
      .then(r => r.json())
      .then(d => setEarningsCall(d))
      .catch(() => {})
      .finally(() => setEarningsCallLoading(false))
  }, [selectedRow?.name])

  // Fetch sector-specific EDGAR metrics whenever the selected row changes
  useEffect(() => {
    if (!selectedRow) { setSectorMetrics(null); return }
    const ticker = getTickerSymbol(selectedRow.exchangeTicker || selectedRow.securityTickers)
    if (!ticker) return
    setSectorMetrics(null)
    setSectorMetricsLoading(true)
    const sector = encodeURIComponent(selectedRow.primarySector || '')
    fetch(`/api/sector-metrics?ticker=${encodeURIComponent(ticker)}&sector=${sector}`)
      .then(r => r.json())
      .then(d => { if (!d.error) setSectorMetrics(d) })
      .catch(() => {})
      .finally(() => setSectorMetricsLoading(false))
  }, [selectedRow?.name])

  // Fetch EDGAR revenue segments whenever the selected row changes
  useEffect(() => {
    if (!selectedRow) { setRevenueSegments(null); return }
    const ticker = getTickerSymbol(selectedRow.exchangeTicker || selectedRow.securityTickers)
    if (!ticker) return
    setRevenueSegments(null)
    setRevenueSegmentsLoading(true)
    fetch(`/api/revenue-segments?ticker=${encodeURIComponent(ticker)}`)
      .then(r => r.json())
      .then(d => { setRevenueSegments(d); if (d?.type) setSegTab(d.type) })
      .catch(() => {})
      .finally(() => setRevenueSegmentsLoading(false))
  }, [selectedRow?.name])

  // Fetch financial signals data whenever the selected row changes
  useEffect(() => {
    setSignalsPanelOpen(null)
    if (!selectedRow) { setSignalsData(null); return }
    const ticker = getTickerSymbol(selectedRow.exchangeTicker || selectedRow.securityTickers)
    if (!ticker) return
    setSignalsData(null)
    setSignalsLoading(true)
    fetch(`/api/financial-signals?ticker=${encodeURIComponent(ticker)}`)
      .then(r => r.json())
      .then(d => setSignalsData(d))
      .catch(() => {})
      .finally(() => setSignalsLoading(false))
  }, [selectedRow?.name])

  // Fetch snapshot metrics, 10-K items, recent 8-Ks
  useEffect(() => {
    if (!selectedRow) { setSnapshotData(null); setManagementData(null); setTenkData(null); setRecent8k(null); return }
    const ticker = getTickerSymbol(selectedRow.exchangeTicker || selectedRow.securityTickers)
    if (!ticker) return
    setSnapshotData(null); setManagementData(null); setTenkData(null); setRecent8k(null)
    setProductsExpanded(false); setSupplyExpanded(false); setDescExpanded(false); setExpandedRiskFactors({})
    // Parallel fetches
    fetch(`/api/snapshot-metrics?ticker=${encodeURIComponent(ticker)}`).then(r => r.json()).then(setSnapshotData).catch(() => {})
    fetch(`/api/management?ticker=${encodeURIComponent(ticker)}`).then(r => r.json()).then(setManagementData).catch(() => {})
    fetch(`/api/recent-8k?ticker=${encodeURIComponent(ticker)}&limit=5`).then(r => r.json()).then(setRecent8k).catch(() => {})
    setTenkLoading(true)
    fetch(`/api/tenk-items?ticker=${encodeURIComponent(ticker)}`).then(r => r.json()).then(d => { setTenkData(d); setTenkLoading(false) }).catch(() => setTenkLoading(false))
  }, [selectedRow?.name])

  // Fetch EDGAR financials whenever the selected row changes
  useEffect(() => {
    if (!selectedRow) { setFinancialsData(null); return }
    const ticker = getTickerSymbol(selectedRow.exchangeTicker || selectedRow.securityTickers)
    if (!ticker) return
    setFinancialsData(null)
    setFinancialsLoading(true)
    fetch(`/api/edgar-financials?ticker=${encodeURIComponent(ticker)}`)
      .then(r => r.json())
      .then(d => { if (!d.error) setFinancialsData(d) })
      .catch(() => {})
      .finally(() => setFinancialsLoading(false))
  }, [selectedRow?.name])

  // On-demand full financial enrichment: when a company is selected but lacks deep Yahoo data,
  // immediately fetch via capi to populate P&L waterfall, margins, and the 1Y price chart.
  // quote-batch gives price/PE/sector; spark-batch gives monthly history; but both lack
  // totalRevenue/EBITDA/margins and daily price history needed for the detail panel.
  useEffect(() => {
    if (!selectedRow) return
    // Skip only when BOTH financials AND daily history are already loaded
    if (selectedRow.totalRevenue != null && selectedRow.history?.closes?.length > 30) return
    const ticker = getTickerSymbol(selectedRow.ticker || selectedRow.exchangeTicker || selectedRow.securityTickers)
    if (!ticker) return

    // Parallel: capi (Yahoo chart history + earnings) + edgar-financials (SEC 10-K, EDGAR mode only)
    // In CSV mode, CIQ already provides EBITDA/Revenue so we skip edgar-financials.
    Promise.all([
      fetch(`/api/capi?tickers=${encodeURIComponent(ticker)}`).then(r => r.json()).catch(() => ({ data: [] })),
      csvMode ? Promise.resolve(null) : fetch(`/api/edgar-financials?ticker=${encodeURIComponent(ticker)}`).then(r => r.json()).catch(() => null),
    ]).then(([capiJson, edgarFin]) => {
      const capiQuotes = Array.isArray(capiJson?.data) ? capiJson.data : []

      // Map edgar-financials snapshot into a quote-shaped object for mergeQuoteBatch
      const snap = edgarFin?.snapshot
      const edgarQuotes = snap && !edgarFin.error ? [{
        ticker,
        exchangeTicker:  ticker,
        primarySector:   edgarFin.primarySector  ?? null,
        fyLabel:         edgarFin.fyLabel         ?? null,
        totalRevenue:    snap.revenueMm           ?? null,
        grossProfit:     snap.grossProfitMm       ?? null,
        ebitda:          snap.ebitdaMm            ?? null,
        netIncome:       snap.netIncomeMm         ?? null,
        totalDebt:       snap.totalDebtMm         ?? null,
        grossMargin:     snap.grossMargin         ?? null,
        operatingMargin: snap.opMargin            ?? null,
        netMargin:       snap.netMargin           ?? null,
      }] : []

      // Apply capi first (history + earnings + Yahoo financials if available),
      // then edgar on top to fill any null financial fields from SEC 10-K data.
      const applyMerge = (rows) => {
        let r = mergeQuoteBatch(rows, capiQuotes)
        if (edgarQuotes.length) r = mergeQuoteBatch(r, edgarQuotes)
        return r
      }

      if (!capiQuotes.length && !edgarQuotes.length) return

      setData(prev => applyMerge(prev))
      setSelectedRow(prev => {
        if (!prev) return prev
        return applyMerge([prev])[0] || prev
      })
    })
  }, [selectedRow?.name])

  // Format numbers for display with locale separators or fallback placeholder.
  const fmt = (n) => (typeof n === 'number' ? n.toLocaleString() : n || '-')

  // Return a HTML title attribute only when the string is non-empty.
  const getTitle = (value) => (typeof value === 'string' && value.trim() ? value : undefined)

  // Build a title string for the selected company detail panel.
  const getCompanyTitle = (row) => {
    if (row.description) return row.description
    return getTitle(row.name)
  }

  // Select a row and open the detail panel.
  const handleSelectCompany = (row) => {
    setSelectedRow(row)
    setDetailPanelTab('overview')
  }

  // Close the detail panel and clear the selected row.
  const closeSelectedCompany = () => {
    setSelectedRow(null)
  }

  // Normalize a ticker string for matching both CSV and API results.
  const getTickerSymbol = (ticker) => {
    if (!ticker) return ''
    const raw = String(ticker).trim()
    if (raw.includes(':')) {
      return raw.split(':').pop().trim().toUpperCase()
    }
    return raw.toUpperCase()
  }

  // Build a sorted list of unique sectors from the loaded companies.
  const sectors = Array.from(new Set(data.map((row) => row.primarySector).filter(Boolean))).sort()
  const presentExchanges = new Set(data.map(r => (r.exchange || '').toLowerCase()))
  const exchanges = ['Nasdaq', 'NYSE'].filter(ex => presentExchanges.has(ex.toLowerCase()))
  // Market cap buckets (marketCap expected in $mm)
  // Static sector list for setup page (matches FMP/Yahoo sector names used in enrichment)
  const STATIC_SECTORS = [
    'Basic Materials', 'Communication Services', 'Consumer Cyclical', 'Consumer Defensive',
    'Energy', 'Financial Services', 'Healthcare', 'Industrials',
    'Real Estate', 'Technology', 'Utilities',
  ]
  const STATIC_EXCHANGES = ['Nasdaq', 'NYSE']

  const marketCapCategories = [
    { id: 'small', label: 'Small < $300M',   min: 0,      max: 300 },
    { id: 'smid',  label: 'SMID $300M–2B',   min: 300,    max: 2000 },
    { id: 'mid',   label: 'Mid $2B–50B',      min: 2000,   max: 50000 },
    { id: 'large', label: 'Large $50B–200B',  min: 50000,  max: 200000 },
    { id: 'mega',  label: 'Mega > $200B',     min: 200000, max: Infinity },
  ]

  const shortInterestCategories = [
    { id: 'si_low', label: '< 10%', min: 0, max: 10 },
    { id: 'si_mid', label: '10–20%', min: 10, max: 20 },
    { id: 'si_high', label: '20–40%', min: 20, max: 40 },
    { id: 'si_very_high', label: '> 40%', min: 40, max: Infinity },
  ]

  const betaCategories = [
    { id: 'beta_low',  label: '< 0.5  (very defensive)', min: -Infinity, max: 0.5 },
    { id: 'beta_mid',  label: '0.5 – 1.0  (defensive)',  min: 0.5, max: 1.0 },
    { id: 'beta_mkt',  label: '1.0 – 1.5  (market-like)', min: 1.0, max: 1.5 },
    { id: 'beta_high', label: '> 1.5  (aggressive)',      min: 1.5, max: Infinity },
  ]

  const distFromLowCategories = [
    { id: 'dfl_near',   label: '< 10% above 52W low', min: 0,   max: 10 },
    { id: 'dfl_close',  label: '10–25% above',         min: 10,  max: 25 },
    { id: 'dfl_mid',    label: '25–50% above',          min: 25,  max: 50 },
    { id: 'dfl_far',    label: '50–75% above',          min: 50,  max: 75 },
    { id: 'dfl_75plus', label: '> 75% above 52W low',  min: 75,  max: Infinity },
  ]

  const grossMarginCategories = [
    { id: 'gm_low', label: '< 20%', min: -Infinity, max: 20 },
    { id: 'gm_mid', label: '20–40%', min: 20, max: 40 },
    { id: 'gm_high', label: '40–60%', min: 40, max: 60 },
    { id: 'gm_very_high', label: '> 60%', min: 60, max: Infinity },
  ]

  const operatingMarginCategories = [
    { id: 'om_neg', label: 'Negative', min: -Infinity, max: 0 },
    { id: 'om_low', label: '0–10%', min: 0, max: 10 },
    { id: 'om_mid', label: '10–25%', min: 10, max: 25 },
    { id: 'om_high', label: '> 25%', min: 25, max: Infinity },
  ]

  const netMarginCategories = [
    { id: 'nm_neg', label: 'Negative', min: -Infinity, max: 0 },
    { id: 'nm_low', label: '0–5%', min: 0, max: 5 },
    { id: 'nm_mid', label: '5–15%', min: 5, max: 15 },
    { id: 'nm_high', label: '> 15%', min: 15, max: Infinity },
  ]
  const cfoCategories = [
    { id: 'cfo_neg',  label: 'Negative CFO',    min: -Infinity, max: 0 },
    { id: 'cfo_pos',  label: 'Positive CFO',    min: 0, max: Infinity },
  ]
  const sbcRevCategories = [
    { id: 'sbc_low',  label: '< 5%',    min: 0,  max: 5 },
    { id: 'sbc_mid',  label: '5–20%',   min: 5,  max: 20 },
    { id: 'sbc_high', label: '> 20%',   min: 20, max: Infinity },
  ]
  const hfOwnCategories = [
    { id: 'hf_none', label: 'No HF ownership', min: -Infinity, max: 0 },
    { id: 'hf_low',  label: '< 1%',            min: 0, max: 1 },
    { id: 'hf_mid',  label: '1–5%',            min: 1, max: 5 },
    { id: 'hf_high', label: '> 5%',            min: 5, max: Infinity },
  ]
  const analystsCategories = [
    { id: 'an_few',  label: '0–3 analysts',  min: 0,  max: 4 },
    { id: 'an_mid',  label: '4–10 analysts', min: 4,  max: 11 },
    { id: 'an_many', label: '> 10 analysts', min: 11, max: Infinity },
  ]
  const ppeRevCategories = [
    { id: 'ppe_low',  label: '< 10% (asset-light)', min: -Infinity, max: 10 },
    { id: 'ppe_mid',  label: '10–30%',              min: 10, max: 30 },
    { id: 'ppe_high', label: '> 30% (asset-heavy)', min: 30, max: Infinity },
  ]
  const rdRevCategories = [
    { id: 'rd_none', label: '< 5%',   min: -Infinity, max: 5 },
    { id: 'rd_low',  label: '5–15%',  min: 5,  max: 15 },
    { id: 'rd_mid',  label: '15–40%', min: 15, max: 40 },
    { id: 'rd_high', label: '> 40%',  min: 40, max: Infinity },
  ]
  const roicCategories = [
    { id: 'roic_neg',  label: '< 0% (value-destroying)', min: -Infinity, max: 0 },
    { id: 'roic_low',  label: '0–8% (below WACC)',       min: 0,  max: 8 },
    { id: 'roic_mid',  label: '8–20% (above WACC)',      min: 8,  max: 20 },
    { id: 'roic_high', label: '> 20% (compounder)',      min: 20, max: Infinity },
  ]
  const tamGrowthCategories = [
    { id: 'tam_fast', label: '> 10% CAGR', min: 10, max: Infinity },
    { id: 'tam_mid',  label: '6–10% CAGR', min: 6,  max: 10 },
    { id: 'tam_slow', label: '< 6% CAGR',  min: 0,  max: 6 },
  ]

  const inMarketCapCategory = (marketCap, cat) => {
    if (typeof marketCap !== 'number') return false
    return marketCap >= cat.min && marketCap <= cat.max
  }

  const rowTicker = (row) => getTickerSymbol(row.exchangeTicker || row.securityTickers)

  // Apply all active filters
  const filteredData = viewMode === 'watchlist'
    ? data.filter(row => watchlist.includes(rowTicker(row)))
    : data.filter((row) => {
    const sectorOk = selectedSectors.length === 0 || selectedSectors.includes(row.primarySector)
    const exchangeOk = selectedExchanges.length === 0 ||
      selectedExchanges.some(ex => (row.exchange || '').toLowerCase() === ex.toLowerCase())
    // Numeric filters pass when data is null (company not yet enriched) - they only EXCLUDE
    // when data IS loaded and confirmed outside the range. This keeps companies visible as
    // data loads progressively rather than hiding everything until full enrichment.
    const mcOk =
      selectedMarketCaps.length === 0 ||
      row.marketCap == null ||
      selectedMarketCaps.some((catId) => {
        const cat = marketCapCategories.find((c) => c.id === catId)
        return cat && inMarketCapCategory(row.marketCap, cat)
      })
    const siOk =
      selectedShortInterests.length === 0 ||
      row.shortInterest == null ||
      selectedShortInterests.some((catId) => {
        const cat = shortInterestCategories.find((c) => c.id === catId)
        if (!cat) return false
        return row.shortInterest >= cat.min && row.shortInterest < cat.max
      })
    const dflOk =
      selectedDistFromLow.length === 0 ||
      (row.price == null || row.week52Low == null || row.week52Low <= 0) ||
      selectedDistFromLow.some((catId) => {
        const cat = distFromLowCategories.find((c) => c.id === catId)
        if (!cat) return false
        const pct = ((row.price - row.week52Low) / row.week52Low) * 100
        return pct >= cat.min && pct < cat.max
      })
    const gmOk =
      selectedGrossMargins.length === 0 ||
      (() => {
        const gm = typeof row.grossMargin === 'number' ? row.grossMargin
          : (typeof row.grossProfit === 'number' && typeof row.totalRevenue === 'number' && row.totalRevenue > 0)
            ? (row.grossProfit / row.totalRevenue) * 100 : null
        if (gm === null) return true // not yet loaded - pass
        return selectedGrossMargins.some((catId) => {
          const cat = grossMarginCategories.find((c) => c.id === catId)
          return cat && gm >= cat.min && gm < cat.max
        })
      })()
    const omOk =
      selectedOperatingMargins.length === 0 ||
      row.operatingMargin == null ||
      selectedOperatingMargins.some((catId) => {
        const cat = operatingMarginCategories.find((c) => c.id === catId)
        return cat && row.operatingMargin >= cat.min && row.operatingMargin < cat.max
      })
    const nmOk =
      selectedNetMargins.length === 0 ||
      (() => {
        const nm = typeof row.netMargin === 'number' ? row.netMargin
          : (typeof row.netIncome === 'number' && typeof row.totalRevenue === 'number' && row.totalRevenue > 0)
            ? (row.netIncome / row.totalRevenue) * 100 : null
        if (nm === null) return true // not yet loaded - pass
        return selectedNetMargins.some((catId) => {
          const cat = netMarginCategories.find((c) => c.id === catId)
          return cat && nm >= cat.min && nm < cat.max
        })
      })()
    const ind = newsIndicators[rowTicker(row)]
    const velOk = selectedVelocity.length === 0 || (ind && selectedVelocity.includes(ind.velocityState))
    const sentOk = selectedSentiment.length === 0 || (ind && selectedSentiment.includes(ind.sentimentState))
    const insiderOk = !insiderFilter || (() => {
      const sent = insiderSentimentCache[rowTicker(row)]
      if (!sent) return true
      if (insiderFilter === 'selling') return sent === 'bearish'
      if (insiderFilter === 'buying') return sent === 'bullish'
      return true
    })()
    const sigOk = (selectedSignalSeverity.length === 0 && selectedSignalCategories.length === 0) || (() => {
      const summary = allSignalsCache[rowTicker(row)]
      if (!summary) return true
      // Both selected: must have a signal matching a chosen severity in a chosen category
      if (selectedSignalSeverity.length > 0 && selectedSignalCategories.length > 0) {
        return selectedSignalCategories.some(cat =>
          selectedSignalSeverity.some(sev => summary.categories?.[cat]?.[`has${sev.charAt(0).toUpperCase()}${sev.slice(1)}`])
        )
      }
      if (selectedSignalSeverity.length > 0) {
        return selectedSignalSeverity.some(sev =>
          sev === 'red' ? summary.hasRed : sev === 'yellow' ? summary.hasYellow : summary.hasGreen
        )
      }
      return selectedSignalCategories.some(cat => summary.categories?.[cat]?.hasAny)
    })()
    const presetOk = !activePresetId || (() => {
      const ticker = rowTicker(row)
      const sig = allSignalsCache[ticker]
      const insider = insiderSentimentCache[ticker]
      const has = (...titles) => sig?.titles && titles.some(t => sig.titles.includes(t))

      switch (activePresetId) {

        case 'chanos-roic': {
          // ROIC declining: op margin compression OR earnings not converting to cash
          if (!sig) {
            const opM = typeof row.operatingMargin === 'number' ? row.operatingMargin
              : (row.ebitda != null && row.totalRevenue > 0) ? row.ebitda / row.totalRevenue * 100 : null
            return opM != null && opM < 8
          }
          return has(
            'Gross margin under pressure',
            'Operating leverage deteriorating',
            'Earnings not converting to cash',
            'Below-the-line costs rising',
          )
        }

        case 'inventory-recv':
          // Must have loaded signals - specific inventory/receivables signals only
          if (!sig) return true
          return has(
            'Inventory outpacing revenue',
            'Receivables outpacing revenue',
            'Inventory buildup trend',
            'Inventory turning slower',
            'Revenue growth not dropping to gross profit',
          )

        case 'qoe':
          if (!sig) return true
          return has(
            'Earnings not converting to cash',
            'SBC masking profitability',
            'High SBC dilution',
            'Heavy capex without revenue follow-through',
            'Cash burn accelerating',
          )

        case 'val-deteri': {
          const highMult = (typeof row.pe === 'number' && row.pe > 40) ||
                           (typeof row.tevLtmRev === 'number' && row.tevLtmRev > 10)
          if (!highMult) return false
          if (!sig) return true
          return has(
            'Gross margin under pressure',
            'Operating leverage deteriorating',
            'Gross margin expanding',  // inverted - expanding margin at high mult is fine; only flag compression
            'Revenue growth not dropping to gross profit',
            'Rule of 40 deteriorating',
          ) && !has('Gross margin expanding')  // exclude if margins actually improving
        }

        case 'bs-weakness':
          if (!sig) return true
          return has(
            'High leverage',
            'Leverage elevated',
            'Goodwill heavy - acquisition risk',
            'Share count dilution',
            'Cash burn accelerating',
          )

        case 'mgmt-flags':
          if (!insider) return true
          return insider === 'bearish'

        case 'growth-quality':
          // Growing revenue but losing operating leverage - needs external capital eventually
          if (!sig) return true
          return has(
            'Revenue growth not dropping to gross profit',
            'Operating leverage deteriorating',
            'SBC masking profitability',
            'Backlog shrinking',
            'Rule of 40 deteriorating',
          )

        case 'ipo-flags':
          if (!sig) return true
          return has('Cash burn accelerating') &&
            has('Gross margin under pressure', 'Operating leverage deteriorating', 'Rule of 40 deteriorating')

        // ── Long screens ──────────────────────────────────────────────
        case 'quality-compounder':
          return (typeof row.grossMargin === 'number' && row.grossMargin > 50) &&
                 (typeof row.cfo === 'number' ? row.cfo > 0 : typeof row.fcf === 'number' ? row.fcf > 0 : true) &&
                 (typeof row.sbcRev === 'number' ? row.sbcRev < 20 : true)

        case 'cheap-quality':
          return (typeof row.tevEbitda === 'number' && row.tevEbitda > 0 && row.tevEbitda < 12) &&
                 (typeof row.operatingMargin === 'number' && row.operatingMargin > 15) &&
                 (typeof row.netIncome === 'number' && row.netIncome > 0)

        case 'insider-conviction':
          return (typeof row.ceoOwnedPct === 'number' && row.ceoOwnedPct > 0) &&
                 (typeof row.ceoChgPct === 'number' && row.ceoChgPct > 0)

        case 'hf-accumulation':
          return (typeof row.hfOwnedPct === 'number' && row.hfOwnedPct > 0) &&
                 (typeof row.marketCap === 'number' && row.marketCap < 10000)

        case 'underfollowed':
          return (typeof row.numAnalysts === 'number' && row.numAnalysts <= 3) &&
                 (typeof row.cfo === 'number' ? row.cfo > 0 : true) &&
                 (typeof row.grossMargin === 'number' && row.grossMargin > 20)

        case 'asset-light':
          return (typeof row.ppeRev === 'number' && row.ppeRev < 0.1) &&
                 (typeof row.grossMargin === 'number' && row.grossMargin > 40) &&
                 (typeof row.cfo === 'number' ? row.cfo > 0 : true)

        case 'net-cash-longs':
          return (typeof row.cash === 'number' && typeof row.marketCap === 'number' &&
                  row.cash > 0 && row.marketCap > 0 && row.cash >= row.marketCap) &&
                 (typeof row.ebit === 'number' && row.ebit > 0)

        case 'earnings-revision':
          return (typeof row.researchDocs30d === 'number' && row.researchDocs30d > 15) &&
                 (typeof row.hfOwnedPct === 'number' && row.hfOwnedPct > 0)

        case 'near-52w-low': {
          const p = row.price, lo = row.week52Low, hi = row.week52High
          if (typeof p !== 'number' || typeof lo !== 'number' || typeof hi !== 'number') return false
          const range = hi - lo
          if (range <= 0) return false
          return ((p - lo) / range < 0.20) &&
                 (typeof row.cfo === 'number' ? row.cfo > 0 : true)
        }

        case 'low-beta': {
          const b = row.beta
          if (typeof b !== 'number') return false
          return b < 0.8 && (typeof row.cfo === 'number' ? row.cfo > 0 : true)
        }

        case 'high-short-interest': {
          const si = row.shortInterest, dtc = row.daysToCover
          if (typeof si !== 'number') return false
          return si > 15 && (typeof dtc === 'number' ? dtc > 5 : true)
        }

        // ── New short screens ─────────────────────────────────────────
        case 'zombie-burner':
          return (typeof row.cfo === 'number' && row.cfo < 0) &&
                 (typeof row.netIncome === 'number' && row.netIncome < 0)

        case 'multiple-compression':
          return (typeof row.tevLtmRev === 'number' && row.tevLtmRev > 10) &&
                 (typeof row.operatingMargin === 'number' && row.operatingMargin < 15)

        case 'insider-distribution':
          return (typeof row.ceoChgPct === 'number' && row.ceoChgPct < 0)

        case 'hf-crowded-exit':
          return (typeof row.hfOwnedPct === 'number' && row.hfOwnedPct > 1) &&
                 (typeof row.ceoChgPct === 'number' && row.ceoChgPct < 0)

        case 'wc-deterioration':
          return (typeof row.nwc === 'number' && row.nwc < 0) &&
                 (typeof row.netIncome === 'number' && row.netIncome < 0)

        case 'rd-treadmill':
          return (typeof row.rdRev === 'number' && row.rdRev > 40) &&
                 (typeof row.cfo === 'number' && row.cfo < 0)

        case 'inventory-buildup':
          return (typeof row.inventoryRev === 'number' && row.inventoryRev > 0.25) &&
                 (typeof row.grossMargin === 'number' && row.grossMargin < 40)

        case 'covenant-risk':
          return (typeof row.interestCov === 'number' && row.interestCov < 2 && row.interestCov > 0) ||
                 (typeof row.totalEquity === 'number' && row.totalEquity < 0)

        case 'leveraged-slowing':
          return (typeof row.netDebtEbitda === 'number' && row.netDebtEbitda > 4) &&
                 (typeof row.operatingMargin === 'number' && row.operatingMargin < 10)

        case 'float-insider-exit':
          return (typeof row.ceoChgPct === 'number' && row.ceoChgPct < 0) &&
                 (typeof row.hfOwnedPct === 'number' && row.hfOwnedPct < 0.5)

        default: return true
      }
    })()
    const betaOk =
      selectedBeta.length === 0 ||
      row.beta == null ||
      selectedBeta.some((catId) => {
        const cat = betaCategories.find((c) => c.id === catId)
        return cat && row.beta >= cat.min && row.beta < cat.max
      })
    const cfoOk = selectedCfo.length === 0 || (() => {
      const v = typeof row.cfo === 'number' ? row.cfo : null
      if (v === null) return true
      return selectedCfo.some(id => {
        const cat = cfoCategories.find(c => c.id === id)
        return cat && v >= cat.min && v < cat.max
      })
    })()
    const sbcRevOk = selectedSbcRev.length === 0 || (() => {
      const v = typeof row.sbcRev === 'number' ? row.sbcRev : null
      if (v === null) return true
      return selectedSbcRev.some(id => {
        const cat = sbcRevCategories.find(c => c.id === id)
        return cat && v >= cat.min && v < cat.max
      })
    })()
    const hfOwnOk = selectedHfOwn.length === 0 || (() => {
      const v = typeof row.hfOwnedPct === 'number' ? row.hfOwnedPct : null
      if (v === null) return true
      return selectedHfOwn.some(id => {
        const cat = hfOwnCategories.find(c => c.id === id)
        return cat && v >= cat.min && v < cat.max
      })
    })()
    const analystsOk = selectedAnalysts.length === 0 || (() => {
      const v = typeof row.numAnalysts === 'number' ? row.numAnalysts : null
      if (v === null) return true
      return selectedAnalysts.some(id => {
        const cat = analystsCategories.find(c => c.id === id)
        return cat && v >= cat.min && v < cat.max
      })
    })()
    const ppeRevOk = selectedPpeRev.length === 0 || (() => {
      const v = typeof row.ppeRev === 'number' ? row.ppeRev * 100 : null
      if (v === null) return true
      return selectedPpeRev.some(id => {
        const cat = ppeRevCategories.find(c => c.id === id)
        return cat && v >= cat.min && v < cat.max
      })
    })()
    const rdRevOk = selectedRdRev.length === 0 || (() => {
      const v = typeof row.rdRev === 'number' ? row.rdRev : null
      if (v === null) return true
      return selectedRdRev.some(id => {
        const cat = rdRevCategories.find(c => c.id === id)
        return cat && v >= cat.min && v < cat.max
      })
    })()
    const roicOk = selectedRoic.length === 0 || (() => {
      const v = typeof row.roic === 'number' ? row.roic : null
      if (v === null) return true
      return selectedRoic.some(id => {
        const cat = roicCategories.find(c => c.id === id)
        return cat && v >= cat.min && v < cat.max
      })
    })()
    const tamGrowthOk = selectedTamGrowth.length === 0 || (() => {
      const tamInfo = INDUSTRY_TAM[row.primaryIndustry] || SECTOR_TAM[row.primarySector]
      if (!tamInfo) return true
      const cagr = parseFloat(tamInfo.cagr)
      if (isNaN(cagr)) return true
      return selectedTamGrowth.some(id => {
        const cat = tamGrowthCategories.find(c => c.id === id)
        return cat && cagr >= cat.min && cagr < cat.max
      })
    })()
    const mktShareGainOk = !mktShareGainFilter || (() => {
      const summary = allSignalsCache[rowTicker(row)]
      if (!summary || summary.revGrowth == null) return true
      const tamInfo = INDUSTRY_TAM[row.primaryIndustry] || SECTOR_TAM[row.primarySector]
      const tamCagr = tamInfo ? parseFloat(tamInfo.cagr) : 5
      return summary.revGrowth > (isNaN(tamCagr) ? 5 : tamCagr)
    })()
    return sectorOk && exchangeOk && mcOk && siOk && dflOk && gmOk && omOk && nmOk && betaOk && velOk && sentOk && insiderOk && sigOk && presetOk && cfoOk && sbcRevOk && hfOwnOk && analystsOk && ppeRevOk && rdRevOk && roicOk && tamGrowthOk && mktShareGainOk
  })
  const displayedCount = filteredData.length

  // Apply sorting if requested
  const displayedData = [...filteredData].sort((a, b) => {
    if (!sortBy) return 0
    const va = getSortValue(a, sortBy)
    const vb = getSortValue(b, sortBy)
    if (typeof va === 'string' || typeof vb === 'string') {
      return sortAsc ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va))
    }
    return sortAsc ? va - vb : vb - va
  })

  // Toggle a sector filter on/off.
  const toggleSector = (sector) => {
    setSelectedSectors((prev) =>
      prev.includes(sector) ? prev.filter((item) => item !== sector) : [...prev, sector]
    )
  }

  const toggleExchange = (ex) => {
    setSelectedExchanges((prev) =>
      prev.includes(ex) ? prev.filter((item) => item !== ex) : [...prev, ex]
    )
  }

  const toggleMarketCap = (catId) => {
    setSelectedMarketCaps((prev) => (prev.includes(catId) ? prev.filter((c) => c !== catId) : [...prev, catId]))
  }

  const toggleShortInterest = (catId) => {
    setSelectedShortInterests((prev) => prev.includes(catId) ? prev.filter((c) => c !== catId) : [...prev, catId])
  }

  const toggleBeta = (catId) => {
    setSelectedBeta((prev) => prev.includes(catId) ? prev.filter((c) => c !== catId) : [...prev, catId])
  }

  const toggleDistFromLow = (catId) => {
    setSelectedDistFromLow((prev) => prev.includes(catId) ? prev.filter((c) => c !== catId) : [...prev, catId])
  }

  const toggleGrossMargin = (catId) => {
    setSelectedGrossMargins((prev) => prev.includes(catId) ? prev.filter((c) => c !== catId) : [...prev, catId])
  }

  const toggleOperatingMargin = (catId) => {
    setSelectedOperatingMargins((prev) => prev.includes(catId) ? prev.filter((c) => c !== catId) : [...prev, catId])
  }

  const toggleNetMargin = (catId) => {
    setSelectedNetMargins((prev) => prev.includes(catId) ? prev.filter((c) => c !== catId) : [...prev, catId])
  }

  const toggleVelocity = (id) => setSelectedVelocity(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  const toggleSentiment = (id) => setSelectedSentiment(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])

  const loadAllNews = async () => {
    setNewsLoadingAll(true)
    const tickers = data.map(row => rowTicker(row)).filter(Boolean)
    for (const ticker of tickers) {
      if (newsIndicators[ticker]) continue
      const cacheKey = `fnews_${ticker}`
      try {
        const cached = sessionStorage.getItem(cacheKey)
        if (cached) {
          const articles = JSON.parse(cached)
          const ind = computeIndicators(articles)
          if (ind) handleIndicatorsReady(ticker, ind)
          continue
        }
      } catch {}
      try {
        const res = await fetch(`/api/finnhub-news?ticker=${encodeURIComponent(ticker)}`)
        const json = await res.json()
        if (Array.isArray(json)) {
          try { sessionStorage.setItem(cacheKey, JSON.stringify(json)) } catch {}
          const ind = computeIndicators(json)
          if (ind) handleIndicatorsReady(ticker, ind)
        }
      } catch {}
      await new Promise(r => setTimeout(r, 220))
    }
    setNewsLoadingAll(false)
  }

  const loadAllInsiderData = async () => {
    setInsiderLoadingAll(true)
    const tickers = data.map(row => rowTicker(row)).filter(Boolean)
    for (const ticker of tickers) {
      if (insiderSentimentCache[ticker]) continue
      try {
        const res = await fetch(`/api/insider-ownership?ticker=${encodeURIComponent(ticker)}`)
        const json = await res.json()
        if (!json.error && json.insider?.sentiment) {
          setInsiderSentimentCache(prev => ({ ...prev, [ticker]: json.insider.sentiment }))
        }
      } catch {}
      await new Promise(r => setTimeout(r, 300))
    }
    setInsiderLoadingAll(false)
  }

  const toggleSignalSeverity = (id) => setSelectedSignalSeverity(prev =>
    prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
  )
  const toggleSignalCategory = (id) => setSelectedSignalCategories(prev =>
    prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
  )

  const loadAllSignals = async () => {
    setSignalsLoadingAll(true)
    const rows = data.filter(row => rowTicker(row) && !allSignalsCache[rowTicker(row)])
    for (const row of rows) {
      const ticker = rowTicker(row)
      try {
        const res = await fetch(`/api/financial-signals?ticker=${encodeURIComponent(ticker)}`)
        const json = await res.json()
        const computed = analyzeSignals(json, row.primarySector || '')
        const triggered = computed.filter(s => s.status === 'triggered')
        const cats = {}
        for (const cat of ['growth', 'margins', 'cash', 'balance_sheet', 'sector']) {
          const inCat = triggered.filter(s => s.category === cat)
          cats[cat] = {
            hasAny:    inCat.length > 0,
            hasRed:    inCat.some(s => s.severity === 'red'),
            hasYellow: inCat.some(s => s.severity === 'yellow'),
            hasGreen:  inCat.some(s => s.severity === 'green'),
          }
        }
        const revArr = (json?.annual?.revenues || []).filter(v => v != null)
        const rCurr = revArr.at(-1), rPrev = revArr.at(-2)
        const revGrowth = rCurr != null && rPrev != null && rPrev !== 0 ? (rCurr - rPrev) / Math.abs(rPrev) * 100 : null
        setAllSignalsCache(prev => ({
          ...prev,
          [ticker]: {
            hasRed:    triggered.some(s => s.severity === 'red'),
            hasYellow: triggered.some(s => s.severity === 'yellow'),
            hasGreen:  triggered.some(s => s.severity === 'green'),
            categories: cats,
            titles: triggered.map(s => s.title),
            revGrowth,
          }
        }))
      } catch {}
      await new Promise(r => setTimeout(r, 400))
    }
    setSignalsLoadingAll(false)
  }

  // Clear all active filters.
  const clearSectors = () => {
    setSelectedSectors([])
    setSelectedExchanges([])
    setSelectedMarketCaps([])
    setSelectedShortInterests([])
    setSelectedDistFromLow([])
    setSelectedGrossMargins([])
    setSelectedOperatingMargins([])
    setSelectedNetMargins([])
    setSelectedBeta([])
    setSelectedCfo([])
    setSelectedSbcRev([])
    setSelectedHfOwn([])
    setSelectedAnalysts([])
    setSelectedPpeRev([])
    setSelectedRdRev([])
    setSelectedRoic([])
    setSelectedTamGrowth([])
    setMktShareGainFilter(false)
    setSelectedVelocity([])
    setSelectedSentiment([])
    setInsiderFilter(null)
    setSelectedSignalSeverity([])
    setSelectedSignalCategories([])
    setActivePresetId(null)
  }

  const toggleWatchlist = (row, side = 'long') => {
    const t = rowTicker(row)
    const updated = watchlist.includes(t) ? watchlist.filter(x => x !== t) : [...watchlist, t]
    setWatchlist(updated)
    localStorage.setItem('watchlist', JSON.stringify(updated))
    if (!watchlist.includes(t)) {
      const newSides = { ...watchlistSides, [t]: side }
      setWatchlistSides(newSides)
      localStorage.setItem('watchlistSides', JSON.stringify(newSides))
    }
  }

  const addAllToWatchlist = () => {
    const tickers = displayedData.map(row => rowTicker(row)).filter(Boolean)
    const updated = Array.from(new Set([...watchlist, ...tickers]))
    setWatchlist(updated)
    localStorage.setItem('watchlist', JSON.stringify(updated))
  }

  const clearWatchlist = () => {
    setWatchlist([])
    localStorage.setItem('watchlist', JSON.stringify([]))
  }

  const saveScreen = (name) => {
    const screen = {
      id: Date.now(),
      label: name,
      filters: { selectedSectors, selectedExchanges, selectedMarketCaps, selectedShortInterests, selectedDistFromLow, selectedGrossMargins, selectedOperatingMargins, selectedNetMargins, selectedBeta }
    }
    const updated = [...savedScreens, screen]
    setSavedScreens(updated)
    localStorage.setItem('savedScreens', JSON.stringify(updated))
  }

  const applyScreen = (screen) => {
    const f = screen.filters
    setSelectedSectors(f.selectedSectors || [])
    setSelectedExchanges(f.selectedExchanges || [])
    setSelectedMarketCaps(f.selectedMarketCaps || [])
    setSelectedShortInterests(f.selectedShortInterests || [])
    setSelectedDistFromLow(f.selectedDistFromLow || [])
    setSelectedGrossMargins(f.selectedGrossMargins || [])
    setSelectedOperatingMargins(f.selectedOperatingMargins || [])
    setSelectedNetMargins(f.selectedNetMargins || [])
    setSelectedBeta(f.selectedBeta || [])
    setViewMode('screener')
  }

  const deleteScreen = (id, e) => {
    e.stopPropagation()
    const updated = savedScreens.filter(s => s.id !== id)
    setSavedScreens(updated)
    localStorage.setItem('savedScreens', JSON.stringify(updated))
  }

  // Calculate where the current price sits in the 52-week range.
  const positionIn52 = (low, high, price) => {
    if (!low || !high || !price || high <= low) return null
    const pct = ((price - low) / (high - low)) * 100
    return Math.max(0, Math.min(100, pct))
  }

  // Choose a ticker label for table rows.
  const formatTicker = (row) => row.formattedTicker || row.exchangeTicker || row.id

  // Simple ratio calculator used for valuation multiples.
  const computeRatio = (numerator, denominator) => {
    if (typeof numerator !== 'number' || typeof denominator !== 'number' || denominator === 0) return null
    return numerator / denominator
  }

  // Split an array into fixed-size chunks.
  const chunkArray = (arr, size) => {
    const chunks = []
    for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size))
    return chunks
  }

  const handleSort = (key) => {
    if (sortBy === key) {
      setSortAsc(!sortAsc)
    } else {
      setSortBy(key)
      setSortAsc(true)
    }
  }

  const getSortValue = (row, key) => {
    switch (key) {
      case 'tev':
        return typeof row.tev === 'number' ? row.tev : -Infinity
      case 'marketCap':
        return typeof row.marketCap === 'number' ? row.marketCap : -Infinity
      case 'totalDebt':
        return typeof row.totalDebt === 'number' ? row.totalDebt : -Infinity
      case 'grossMargin':
        return typeof row.grossMargin === 'number' ? row.grossMargin : -Infinity
      case 'netMargin':
        return typeof row.netMargin === 'number' ? row.netMargin : -Infinity
      case 'beta':
        return typeof row.beta === 'number' ? row.beta : -Infinity
      case 'shortInterest':
        return typeof row.shortInterest === 'number' ? row.shortInterest : -Infinity
      case 'de':
        return computeRatio(row.totalDebt, row.marketCap) != null ? computeRatio(row.totalDebt, row.marketCap) : -Infinity
      case 'name':
        return row.name || ''
      case 'primarySector':
        return row.primarySector || ''
      case 'ticker':
        return getTickerSymbol(row.exchangeTicker || row.securityTickers) || ''
      default:
        return -Infinity
    }
  }

  // Convert a P&L line item into a percent width relative to revenue.
  const buildPLSegmentWidth = (value, total) => {
    if (typeof value !== 'number' || typeof total !== 'number' || total <= 0) return 0
    return Math.max(0, Math.min(100, (Math.abs(value) / Math.abs(total)) * 100))
  }

  // Format large values in billions for the P&L widget (values in $mm).
  const formatBillions = (value) => {
    if (typeof value !== 'number') return '-'
    return `$${(value / 1000).toFixed(1)}B`
  }

  // Format a market-cap / TEV value stored in $mm with B/M/T suffix.
  const fmtMktCap = (mm) => {
    if (mm == null || typeof mm !== 'number') return '-'
    if (mm >= 1e6)  return `$${(mm / 1e6).toFixed(2)}T`
    if (mm >= 1000) return `$${(mm / 1000).toFixed(1)}B`
    return `$${Math.round(mm)}M`
  }

  // Convert close price history into SVG polyline points.
  const buildSparklinePoints = (closes) => {
    if (!Array.isArray(closes) || closes.length < 2) return ''
    const valid = closes.filter((value) => typeof value === 'number')
    if (valid.length < 2) return ''
    const min = Math.min(...valid)
    const max = Math.max(...valid)
    const range = max - min || 1
    return valid
      .map((value, index) => {
        const x = (index / (valid.length - 1)) * 100
        const y = 38 - ((value - min) / range) * 36
        return `${x.toFixed(1)},${y.toFixed(1)}`
      })
      .join(' ')
  }

  // Build an SVG area polygon for the sparkline fill.
  const buildSparklineArea = (closes) => {
   const min = Math.min(...closes)
   const max = Math.max(...closes)
   const range = max - min || 1
   const pts = closes.map((p, i) => {
      const x = (i / (closes.length - 1)) * 100
      const y = 38 - ((p - min) / range) * 36
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    return `M 0,40 L ${pts.join(' L ')} L 100,40 Z`
  }

  // Build bar data for the detail panel waterfall P&L chart.
  const buildWaterfallBars = (row) => {
    const { totalRevenue: rev, grossProfit: gp, ebit, ebitda: eb, netIncome: net, operatingMargin: opM } = row
    if (typeof rev !== 'number' || rev <= 0) return null
    // Use direct EBIT field (from CSV), fall back to computing from operating margin (Yahoo enrichment)
    const ebitVal = typeof ebit === 'number' ? ebit
      : (typeof opM === 'number' && rev > 0) ? (opM / 100) * rev : null
    const bars = [{ label: 'Revenue', from: 0, to: rev, color: '#3b82f6' }]
    if (typeof gp === 'number') {
      bars.push({ label: '- COGS', from: gp, to: rev, color: '#e07345' })
      bars.push({ label: 'Gross Profit', from: 0, to: gp, color: '#2a9d8f' })
      if (typeof ebitVal === 'number') {
        bars.push({ label: '- OpEx', from: ebitVal, to: gp, color: '#e07345' })
        bars.push({ label: 'EBIT', from: Math.min(0, ebitVal), to: Math.max(0, ebitVal), color: ebitVal >= 0 ? '#2a9d8f' : '#e07345' })
        if (typeof eb === 'number') {
          const da = eb - ebitVal
          if (da > 0) bars.push({ label: '+ D&A', from: ebitVal, to: eb, color: '#6366f1' })
          bars.push({ label: 'EBITDA', from: Math.min(0, eb), to: Math.max(0, eb), color: eb >= 0 ? '#2a9d8f' : '#e07345' })
          if (typeof net === 'number') {
            bars.push({ label: '- Other', from: Math.max(0, net), to: Math.max(0, eb), color: '#e07345' })
            bars.push({ label: 'Net Income', from: Math.min(0, net), to: Math.max(0, net), color: net >= 0 ? '#3b82f6' : '#e07345' })
          }
        } else if (typeof net === 'number') {
          bars.push({ label: '- Other', from: Math.max(0, net), to: Math.max(0, ebitVal), color: '#e07345' })
          bars.push({ label: 'Net Income', from: Math.min(0, net), to: Math.max(0, net), color: net >= 0 ? '#3b82f6' : '#e07345' })
        }
      } else if (typeof eb === 'number') {
        bars.push({ label: '- OpEx', from: eb, to: gp, color: '#e07345' })
        bars.push({ label: 'EBITDA', from: Math.min(0, eb), to: Math.max(0, eb), color: eb >= 0 ? '#2a9d8f' : '#e07345' })
        if (typeof net === 'number') {
          bars.push({ label: '- Other', from: Math.max(0, net), to: Math.max(0, eb), color: '#e07345' })
          bars.push({ label: 'Net Income', from: Math.min(0, net), to: Math.max(0, net), color: net >= 0 ? '#3b82f6' : '#e07345' })
        }
      } else if (typeof net === 'number') {
        bars.push({ label: '- Other', from: Math.max(0, net), to: gp, color: '#e07345' })
        bars.push({ label: 'Net Income', from: Math.min(0, net), to: Math.max(0, net), color: net >= 0 ? '#3b82f6' : '#e07345' })
      }
    } else if (typeof eb === 'number') {
      // CSV mode: no gross profit - Revenue → EBITDA → Net Income
      bars.push({ label: '- Total Costs', from: eb, to: rev, color: '#e07345' })
      bars.push({ label: 'EBITDA', from: Math.min(0, eb), to: Math.max(0, eb), color: eb >= 0 ? '#2a9d8f' : '#e07345' })
      if (typeof net === 'number') {
        bars.push({ label: '- Other', from: Math.max(0, net), to: Math.max(0, eb), color: '#e07345' })
        bars.push({ label: 'Net Income', from: Math.min(0, net), to: Math.max(0, net), color: net >= 0 ? '#3b82f6' : '#e07345' })
      }
    } else if (typeof net === 'number') {
      bars.push({ label: '- Total Costs', from: Math.max(0, net), to: rev, color: '#e07345' })
      bars.push({ label: 'Net Income', from: Math.min(0, net), to: Math.max(0, net), color: net >= 0 ? '#3b82f6' : '#e07345' })
    }
    return bars
  }

  // Parse a string of multiples into numeric history for the detail chart.
  const parseMultiplesHistory = (text) => {
    if (!text || typeof text !== 'string') return []
    const matches = String(text).match(/-?\d+(?:\.\d+)?/g)
    if (!matches) return []
    return matches.map((value) => Number(value)).filter((num) => Number.isFinite(num))
  }

  const handleIndicatorsReady = (ticker, indicators) => {
    setNewsIndicators(prev => ({ ...prev, [ticker]: indicators }))
    try { sessionStorage.setItem(`fnews_ind_${ticker}`, JSON.stringify(indicators)) } catch {}
  }

  // Compute signals from raw EDGAR data whenever it changes
  const signals = useMemo(() => {
    if (!signalsData || !selectedRow) return []
    return analyzeSignals(signalsData, selectedRow.primarySector || '')
  }, [signalsData, selectedRow])

  // Auto-expand panel when there are red signals; collapse when all clear
  useEffect(() => {
    if (signals.length === 0) return
    const hasRed = signals.some(s => s.status === 'triggered' && s.severity === 'red')
    setSignalsPanelOpen(prev => prev === null ? hasRed : prev)
  }, [signals])

  // Quality of Earnings - computed from financial-signals data
  const qoe = useMemo(() => {
    if (!signalsData?.annual) return null
    const ann = signalsData.annual
    const last = a => a?.[a.length - 1] ?? null
    const prev = a => a?.[a.length - 2] ?? null
    const ni = last(ann.netIncome), ocf = last(ann.ocf), capex = last(ann.capex)
    const assets = last(ann.assets), prevAssets = prev(ann.assets)
    const sbc = last(ann.sbc), rev = last(ann.revenue), defRev = last(ann.deferredRevenue)
    const fcf = ocf != null && capex != null ? ocf - Math.abs(capex) : null
    const avgAssets = assets != null && prevAssets != null ? (assets + prevAssets) / 2 : (assets ?? null)
    return {
      fcfConversion: ni != null && fcf != null && Math.abs(ni) > 0 ? fcf / Math.abs(ni) : null,
      accrualsRatio: ni != null && fcf != null && avgAssets ? (ni - fcf) / avgAssets : null,
      sbcPct: sbc != null && ni != null && Math.abs(ni) > 0 ? (sbc / Math.abs(ni)) * 100 : null,
      deferredPct: defRev != null && rev != null && rev > 0 ? (defRev / rev) * 100 : null,
    }
  }, [signalsData])

  const CATALYST_ABBR = { Earnings: 'E', 'M&A': 'MA', Analyst: 'A', Macro: 'G', Legal: 'L' }


  // Display earnings surprise text or fallback placeholders.
  const formatEarningsSurprise = (row) => {
    if (typeof row.earningsSurprise === 'number') {
      const rounded = row.earningsSurprise.toFixed(2)
      return `${rounded}% ${row.earningsSurprise >= 0 ? 'beat' : 'miss'}`
    }
    if (row.earningsBeatMiss) return row.earningsBeatMiss
    return '-'
  }

  return (
    <ErrorBoundary key="root">
    <div className="container">

      {/* Page header */}
      <div className="header-row">
        <h1>Stock Screener v1</h1>
        <div className="count-label">{displayedCount} companies</div>
      </div>

      {/* View tabs + saved screens bar */}
      <div className="top-bar">
        <div className="view-tabs">
          <button
            type="button"
            className={`view-tab ${viewMode === 'screener' ? 'active' : ''}`}
            onClick={() => setViewMode('screener')}
          >
            Screener
          </button>
          <button
            type="button"
            className={`view-tab ${viewMode === 'watchlist' ? 'active' : ''}`}
            onClick={() => setViewMode('watchlist')}
          >
            Watchlist {watchlist.length > 0 && <span className="watchlist-badge">{watchlist.length}</span>}
          </button>
        </div>
        <div className="screens-area">
          {savedScreens.map(screen => (
            <div key={screen.id} className="screen-chip" onClick={() => applyScreen(screen)}>
              {screen.label}
              <button type="button" className="screen-chip-del" onClick={(e) => deleteScreen(screen.id, e)}>×</button>
            </div>
          ))}
          {viewMode === 'screener' && (
            <>
              <button type="button" className="save-screen-btn" onClick={() => setShowSaveModal(true)}>
                + Save screen
              </button>
              {displayedData.length > 0 && (
                <button type="button" className="save-screen-btn" onClick={addAllToWatchlist}>
                  ★ Add all {displayedData.length > 0 ? `(${displayedData.length})` : ''} to watchlist
                </button>
              )}
            </>
          )}
          {viewMode === 'watchlist' && watchlist.length > 0 && (
            <button type="button" className="save-screen-btn" style={{ color: '#be123c', borderColor: '#fca5a5' }} onClick={clearWatchlist}>
              × Clear watchlist
            </button>
          )}
        </div>
      </div>

      {/* Preset screens bar - Long + Short rows */}
      {viewMode === 'screener' && (() => {
        const LONG_PRESETS = [
          { id: 'quality-compounder',  label: 'Quality Compounder', desc: 'Gross margin >50%, positive CFO, low SBC/Rev - high-quality compounding business' },
          { id: 'cheap-quality',       label: 'Cheap Quality',      desc: 'TEV/EBITDA <12x, EBIT margin >15%, net income positive - quality at a reasonable price' },
          { id: 'insider-conviction',  label: 'Insider Conviction', desc: 'CEO owns shares and increased position QoQ - skin in the game signal' },
          { id: 'hf-accumulation',     label: 'HF Accumulation',    desc: 'HF ownership present, mid/small cap (<$10B) - institutional accumulation before move' },
          { id: 'underfollowed',       label: 'Underfollowed',      desc: '≤3 analysts covering, positive CFO, gross margin >20% - undiscovered quality' },
          { id: 'asset-light',         label: 'Asset-Light',        desc: 'Net PP&E/Revenue <10%, gross margin >40%, positive CFO - capital-light compounder' },
          { id: 'net-cash-longs',      label: 'Net Cash',           desc: 'Cash ≥ market cap, EBIT positive - trading below net cash with profitable operations' },
          { id: 'earnings-revision',   label: 'Earnings Revision',  desc: '>15 research docs in last 30 days + HF interest - analyst attention + institutional buying' },
          { id: 'near-52w-low',        label: '52W Low',            desc: 'Price in bottom 20% of 52-week range, positive CFO - quality at cyclical trough' },
          { id: 'low-beta',            label: 'Low Beta',           desc: 'Beta <0.8, positive CFO - defensive stocks with earnings quality' },
          { id: 'high-short-interest', label: 'High SI',            desc: 'Short interest >15% of float, DTC >5 - heavily shorted with squeeze potential' },
        ]
        const SHORT_PRESETS = [
          { id: 'chanos-roic',          label: 'Chanos ROIC',          desc: 'ROIC <8% or op margin <8% - declining return on invested capital' },
          { id: 'inventory-recv',       label: 'Inventory / Recv',     desc: 'Inventory or receivables growing faster than revenue (Staley/Snapple/Cott)' },
          { id: 'qoe',                  label: 'QoE',                  desc: 'FCF conversion <0.7 or accruals ratio >0.1 (Bildner)' },
          { id: 'val-deteri',           label: 'Val + Deteri.',        desc: 'High multiple (P/E >40x or EV/Rev >10x) with margin compression (Robertson/DiMenna)' },
          { id: 'bs-weakness',          label: 'Balance Sheet',        desc: 'Net debt/EBITDA >4x, goodwill >40% of assets, or share dilution >2% (Porter/Feshbach)' },
          { id: 'mgmt-flags',           label: 'Mgmt Red Flags',       desc: 'Insider net selling with no buys (Porter/Feshbach)' },
          { id: 'growth-quality',       label: 'Growth Quality',       desc: 'Revenue growth not dropping to gross profit, operating leverage deteriorating (Jiffy Lube)' },
          { id: 'ipo-flags',            label: 'IPO Red Flags',        desc: 'Cash burn accelerating, margins declining, growth decelerating post-IPO (Chanos)' },
          { id: 'zombie-burner',        label: 'Zombie Burner',        desc: 'Negative CFO + negative net income - cash-burning zombie with no earnings' },
          { id: 'multiple-compression', label: 'Multiple Compression', desc: 'TEV/Revenue >10x, EBIT margin <15% - multiple not justified by fundamentals' },
          { id: 'insider-distribution', label: 'Insider Exit',         desc: 'CEO reducing ownership QoQ - management distributing ahead of potential weakness' },
          { id: 'hf-crowded-exit',      label: 'HF Crowded Exit',      desc: 'HF ownership >1% + CEO selling - crowded trade with insider exit signal' },
          { id: 'wc-deterioration',     label: 'WC Deterioration',     desc: 'Negative NWC + negative net income - working capital stress with earnings weakness' },
          { id: 'rd-treadmill',         label: 'R&D Treadmill',        desc: 'R&D >40% of revenue, negative CFO - spending heavily on R&D with no cash generation' },
          { id: 'inventory-buildup',    label: 'Inventory Buildup',    desc: 'Inventory >25% of revenue, gross margin <40% - inventory accumulating vs revenue' },
          { id: 'covenant-risk',        label: 'Covenant Risk',        desc: 'Interest coverage <2x or negative equity - thin debt coverage or insolvent balance sheet' },
          { id: 'leveraged-slowing',    label: 'Levered + Slowing',    desc: 'Net debt/EBITDA >4x, EBIT margin <10% - high leverage with thin operating buffer' },
          { id: 'float-insider-exit',   label: 'Float + Insider Exit', desc: 'CEO selling + low HF ownership (<0.5%) - insider exit with low institutional support' },
        ]
        const allPresets = [...LONG_PRESETS, ...SHORT_PRESETS]
        const isLong = id => LONG_PRESETS.some(p => p.id === id)
        const activeIsLong = activePresetId ? isLong(activePresetId) : null

        const renderRow = (presets, side) => {
          const accentActive = side === 'long' ? '#15803d' : '#dc2626'
          const accentText   = side === 'long' ? '#6b7280' : '#9ca3af'
          return (
            <div style={{ marginBottom: 6 }}>
              <div style={{ fontSize: '0.68rem', color: accentText, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                {side === 'long' ? '▲ Long' : '▼ Short'}
              </div>
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                {presets.map(ps => {
                  const isActive = activePresetId === ps.id
                  return (
                    <button key={ps.id} type="button"
                      onClick={() => setActivePresetId(prev => prev === ps.id ? null : ps.id)}
                      style={{
                        display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2,
                        padding: '5px 9px', borderRadius: 6, cursor: 'pointer', textAlign: 'left',
                        border: `1px solid ${isActive ? accentActive : side === 'long' ? '#bbf7d0' : '#fca5a5'}`,
                        background: isActive ? accentActive : side === 'long' ? '#f0fdf4' : '#fff5f5',
                        color: isActive ? '#fff' : side === 'long' ? '#14532d' : '#7f1d1d',
                        transition: 'all 0.1s',
                        maxWidth: 180,
                      }}
                    >
                      <span style={{ fontSize: '0.66rem', fontWeight: 700, whiteSpace: 'nowrap' }}>{ps.label}</span>
                      <span style={{ fontSize: '0.68rem', fontWeight: 400, color: isActive ? 'rgba(255,255,255,0.82)' : side === 'long' ? '#166534' : '#991b1b', lineHeight: 1.35, whiteSpace: 'normal' }}>{ps.desc}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )
        }

        const active = allPresets.find(p => p.id === activePresetId)
        const activeAccent = activeIsLong ? '#15803d' : '#dc2626'
        const activeBg    = activeIsLong ? '#f0fdf4' : '#fff5f5'
        const activeBorder= activeIsLong ? '#bbf7d0' : '#fecaca'

        return (
          <div style={{ marginBottom: 6, borderBottom: '1px solid #f0f0f0', paddingBottom: 6 }}>
            {renderRow(LONG_PRESETS, 'long')}
            {renderRow(SHORT_PRESETS, 'short')}
            {activePresetId && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 2 }}>
                <button type="button" onClick={() => setActivePresetId(null)}
                  style={{ fontSize: '0.68rem', color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px' }}>
                  × clear filter
                </button>
              </div>
            )}
          </div>
        )
      })()}

      {/* Save screen modal */}
      {showSaveModal && (
        <div className="modal-overlay" onClick={() => setShowSaveModal(false)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-title">Save current screen</div>
            <input
              className="modal-input"
              placeholder="e.g. Long, SMID High-SI, Value Plays"
              value={newScreenName}
              onChange={e => setNewScreenName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && newScreenName.trim()) {
                  saveScreen(newScreenName.trim())
                  setNewScreenName('')
                  setShowSaveModal(false)
                }
                if (e.key === 'Escape') setShowSaveModal(false)
              }}
              autoFocus
            />
            <div className="modal-actions">
              <button type="button" className="modal-cancel" onClick={() => setShowSaveModal(false)}>Cancel</button>
              <button
                type="button"
                className="modal-save"
                onClick={() => {
                  if (newScreenName.trim()) {
                    saveScreen(newScreenName.trim())
                    setNewScreenName('')
                    setShowSaveModal(false)
                  }
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Loading and error status messages. */}
      {loading && <p className="info">Loading companies from EDGAR...</p>}
      {priceLoading && !loading && (
        <p className="info">
          Refreshing prices (top {priceProgress.total > 0 ? priceProgress.total.toLocaleString() : '…'} cos.)…{' '}
          {priceProgress.total > 0 && `${priceProgress.loaded.toLocaleString()} / ${priceProgress.total.toLocaleString()}`}
          {priceProgress.total > 0 && (
            <span style={{ marginLeft: 8, color: '#9ca3af', fontSize: '0.75em' }}>
              ({Math.round(priceProgress.loaded / priceProgress.total * 100)}% — prices from CSV available now; Finnhub refresh running in background)
            </span>
          )}
        </p>
      )}

      {/* Detail panel for the selected company. */}
      <ErrorBoundary key={selectedRow?.name}>
      {selectedRow && (
        <div className="detail-panel">
          <div className="detail-panel-header">
            <h2>{selectedRow.name}{(() => {
              const raw = String(selectedRow.exchangeTicker || selectedRow.securityTickers || '').trim()
              if (!raw) return null
              const parts = raw.includes(':') ? raw.split(':') : [null, raw]
              const exchange = parts[0]?.trim().toUpperCase()
              const sym = parts[parts.length - 1].trim().toUpperCase()
              if (!sym) return null
              return <span style={{ fontWeight: 400, fontSize: '0.75em', color: '#6b7280', marginLeft: 8 }}>({exchange ? `${exchange}: ` : ''}{sym})</span>
            })()}</h2>
            <button type="button" className="detail-close" onClick={closeSelectedCompany}>×</button>
          </div>

          {(<>
          {/* ── Snapshot metrics bar ── */}
          {mounted && (() => {
            const s = snapshotData
            const ticker = getTickerSymbol(selectedRow.exchangeTicker || selectedRow.securityTickers)
            const price = selectedRow.price
            const totalRecs = s ? (s.buy || 0) + (s.hold || 0) + (s.sell || 0) : 0
            const consensus = totalRecs > 0
              ? s.buy / totalRecs >= 0.6 ? 'Buy' : s.sell / totalRecs >= 0.4 ? 'Sell' : 'Hold'
              : null
            const consColor = consensus === 'Buy' ? '#2a9d8f' : consensus === 'Sell' ? '#e76f51' : '#f59e0b'
            const upside = s?.ptMean && price ? ((s.ptMean - price) / price * 100).toFixed(1) : null
            const fmtPct = v => v != null ? `${v >= 0 ? '+' : ''}${typeof v === 'number' ? v.toFixed(1) : v}%` : '-'
            const fmtNum = v => v != null ? v.toFixed(2) : '-'
            const fmtVol = v => v == null ? '-' : v >= 1000 ? `${(v/1000).toFixed(1)}M` : `${v.toFixed(0)}K`
            const pill = (label, val, color) => (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '4px 10px', background: '#f9f9f9', border: '1px solid #e8e8e8', borderRadius: 7, minWidth: 60 }}>
                <span style={{ fontSize: '0.6rem', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>{label}</span>
                <span style={{ fontSize: '0.8rem', fontWeight: 700, color: color || '#1a2b3c', marginTop: 1 }}>{val}</span>
              </div>
            )
            return (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12, alignItems: 'stretch' }}>
                {/* Consensus */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '4px 10px', background: '#f9f9f9', border: '1px solid #e8e8e8', borderRadius: 7, minWidth: 80 }}>
                  <span style={{ fontSize: '0.6rem', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Consensus</span>
                  <span style={{ fontSize: '0.78rem', fontWeight: 700, color: consensus ? consColor : '#9ca3af', marginTop: 1 }}>{consensus || '-'}</span>
                  {totalRecs > 0 && <span style={{ fontSize: '0.68rem', color: '#9ca3af' }}>{s.buy}B · {s.hold}H · {s.sell}S</span>}
                </div>
                {/* Rating bar */}
                {totalRecs > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '4px 10px', background: '#f9f9f9', border: '1px solid #e8e8e8', borderRadius: 7, minWidth: 80 }}>
                    <span style={{ fontSize: '0.6rem', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>Ratings</span>
                    <div style={{ display: 'flex', height: 10, width: 70, borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ flex: s.buy, background: '#2a9d8f' }}/>
                      <div style={{ flex: s.hold, background: '#f59e0b' }}/>
                      <div style={{ flex: s.sell, background: '#e76f51' }}/>
                    </div>
                  </div>
                )}
                {/* Price target */}
                {s?.ptMean && pill('Avg PT', `$${s.ptMean.toFixed(2)}`, '#1a2b3c')}
                {upside != null && pill('PT Upside', fmtPct(parseFloat(upside)), parseFloat(upside) >= 0 ? '#2a9d8f' : '#e76f51')}
                {pill('YTD', fmtPct(s?.ytdReturn), s?.ytdReturn >= 0 ? '#2a9d8f' : s?.ytdReturn < 0 ? '#e76f51' : null)}
                {pill('Beta', fmtNum(s?.beta ?? selectedRow.beta))}
                {pill('ADV', fmtVol(s?.adv3m))}
                {pill('SI %', s?.shortPct != null ? `${s.shortPct.toFixed(1)}%` : selectedRow.shortInterest != null ? `${Number(selectedRow.shortInterest).toFixed(1)}%` : '-', s?.shortPct > 10 ? '#e76f51' : null)}
                {pill('DTC', s?.daysToCover != null ? fmtNum(s.daysToCover) : selectedRow.daysToCover != null ? fmtNum(selectedRow.daysToCover) : '-', (s?.daysToCover ?? selectedRow.daysToCover) > 10 ? '#e76f51' : null)}
                {selectedRow.totalDebt != null && !financialsData?.snapshot && pill('Debt', selectedRow.totalDebt >= 1000 ? `$${(selectedRow.totalDebt/1000).toFixed(1)}B` : `$${Math.round(selectedRow.totalDebt)}M`)}
                {/* 30-day realized vol from price history */}
                {(() => {
                  const closes = selectedRow.history?.closes?.filter(v => typeof v === 'number') || []
                  if (closes.length < 22) return null
                  const last30 = closes.slice(-31)
                  const logRets = last30.slice(1).map((p, i) => Math.log(p / last30[i]))
                  const mean = logRets.reduce((a, b) => a + b, 0) / logRets.length
                  const variance = logRets.reduce((a, b) => a + (b - mean) ** 2, 0) / (logRets.length - 1)
                  const vol = Math.sqrt(variance * 252) * 100
                  return pill('30D Vol', `${vol.toFixed(1)}%`, vol > 40 ? '#e76f51' : vol > 25 ? '#f59e0b' : '#2a9d8f')
                })()}
                {/* EDGAR balance-sheet + FCF metrics */}
                {financialsData?.snapshot && (() => {
                  const fs = financialsData.snapshot
                  const num = v => v != null ? v : '-'
                  const ann = signalsData?.annual
                  const lastA = a => a?.[a.length - 1] ?? null
                  const annRev = lastA(ann?.revenue), annOcf = lastA(ann?.ocf), annCapex = lastA(ann?.capex)
                  const annFcf = (annOcf != null && annCapex != null) ? annOcf - Math.abs(annCapex) : null
                  const fcfPct = (annFcf != null && annRev) ? annFcf / annRev * 100 : null
                  const fcfColor = fcfPct == null ? '#9ca3af' : fcfPct >= 10 ? '#2a9d8f' : fcfPct >= 0 ? '#f59e0b' : '#e76f51'
                  const debtMm = fs.debtToEquity != null && fs.equity != null ? fs.debtToEquity * fs.equity : fs.ltDebt
                  const fmtDebt = v => v == null ? '-' : v >= 1000 ? `$${(v/1000).toFixed(1)}B` : `$${Math.round(v)}M`
                  return (<>
                    {pill('Cash', num(fs.cash))}
                    {pill('Net Debt', num(fs.netDebt))}
                    {pill('Debt', fmtDebt(debtMm))}
                    {pill('Equity', num(fs.equity))}
                    {pill('ROE', fs.roe != null ? `${fs.roe}%` : '-')}
                    {pill('ROA', fs.roa != null ? `${fs.roa}%` : '-')}
                    {pill('Curr Ratio', num(fs.currentRatio))}
                    {pill('FCF Margin', fcfPct != null ? `${fcfPct.toFixed(1)}%` : '-', fcfColor)}
                  </>)
                })()}
                {sectorMetrics?.metrics?.length > 0 && sectorMetrics.metrics.map((m, i) => (
                  <div key={`sm-${i}`} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '4px 10px', background: '#e8edf2', border: '1px solid #c8d4df', borderRadius: 7, minWidth: 60 }}>
                    <span style={{ fontSize: '0.6rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>{m.label}</span>
                    <span style={{ fontSize: '0.8rem', fontWeight: 700, color: m.highlight || '#1a2b3c', marginTop: 1 }}>{m.value || '-'}</span>
                    {m.sub && <span style={{ fontSize: '0.6rem', color: '#6b7280' }}>{m.sub}</span>}
                  </div>
                ))}
                {/* ── Derived metrics ── */}
                {(() => {
                  const ann = signalsData?.annual
                  const fs = financialsData?.snapshot
                  const lastA = a => a?.[a.length - 1] ?? null
                  const prevA = a => a?.length >= 2 ? a[a.length - 2] ?? null : null
                  const annRev = lastA(ann?.revenue), prevRev = prevA(ann?.revenue)
                  const annOcf = lastA(ann?.ocf), annCapex = lastA(ann?.capex)
                  const annGP  = lastA(ann?.grossProfit)
                  const annFcf = (annOcf != null && annCapex != null) ? annOcf - Math.abs(annCapex) : null
                  const fcfPct = (annFcf != null && annRev && annRev > 0) ? annFcf / annRev * 100 : null
                  const revGr  = (annRev != null && prevRev != null && prevRev !== 0) ? (annRev - prevRev) / Math.abs(prevRev) * 100 : null
                  const dpill  = (label, val, color, sub) => (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '4px 10px', background: '#f0f4ff', border: '1px solid #c7d5f5', borderRadius: 7, minWidth: 60 }}>
                      <span style={{ fontSize: '0.6rem', color: '#4b5ea8', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>{label}</span>
                      <span style={{ fontSize: '0.8rem', fontWeight: 700, color: color || '#1a2b3c', marginTop: 1 }}>{val}</span>
                      {sub && <span style={{ fontSize: '0.68rem', color: '#6b7280' }}>{sub}</span>}
                    </div>
                  )
                  const out = []

                  // 1. Rule of 40 (software/SaaS only)
                  const isSoftware = (() => { const s = (selectedRow.primarySector || '').toLowerCase(); const i = (selectedRow.primaryIndustry || '').toLowerCase(); return s.includes('tech') || i.includes('software') || i.includes('saas') || i.includes('internet') })()
                  if (isSoftware && revGr != null && fcfPct != null) {
                    const r40 = revGr + fcfPct
                    out.push(dpill('Rule of 40', r40.toFixed(1), r40 >= 40 ? '#15803d' : r40 >= 20 ? '#d97706' : '#dc2626', `${revGr.toFixed(0)}%g + ${fcfPct.toFixed(0)}%fcf`))
                  }

                  // 2. Earnings Power Value vs market cap (10% discount rate)
                  if (annFcf != null && selectedRow.marketCap != null && selectedRow.marketCap > 0) {
                    const epvM = annFcf / 0.10
                    const ms = (epvM / selectedRow.marketCap - 1) * 100
                    out.push(dpill('EPV MoS', `${ms > 0 ? '+' : ''}${ms.toFixed(0)}%`, ms > 20 ? '#15803d' : ms > -10 ? '#d97706' : '#dc2626', `EPV $${epvM >= 1000 ? (epvM/1000).toFixed(1)+'B' : Math.round(epvM)+'M'}`))
                  }

                  // 3. Revenue beat rate (last 8Q)
                  if (detailEarnings?.history?.length > 0) {
                    const hist = detailEarnings.history.slice(0, 8).filter(q => q.surprisePct != null)
                    if (hist.length > 0) {
                      const beats = hist.filter(q => q.surprisePct > 0).length
                      const rate = Math.round(beats / hist.length * 100)
                      out.push(dpill('Rev Beat Rate', `${rate}%`, rate >= 75 ? '#15803d' : rate >= 50 ? '#d97706' : '#dc2626', `${beats}/${hist.length}Q`))
                    }
                  }

                  // 4. Gross margin vs sector peer median
                  const selfGM = typeof selectedRow.grossMargin === 'number' ? selectedRow.grossMargin : null
                  if (selfGM != null) {
                    const peerGMs = data
                      .filter(r => r.primarySector === selectedRow.primarySector &&
                        (r.exchangeTicker||r.securityTickers) !== (selectedRow.exchangeTicker||selectedRow.securityTickers) &&
                        typeof r.grossMargin === 'number' && r.grossMargin > 0)
                      .map(r => r.grossMargin)
                      .sort((a, b) => a - b)
                    if (peerGMs.length >= 2) {
                      const medGM = peerGMs[Math.floor(peerGMs.length / 2)]
                      const delta = selfGM - medGM
                      out.push(dpill('GM vs Peers', `${delta > 0 ? '+' : ''}${delta.toFixed(1)}pp`, delta > 0 ? '#15803d' : delta > -5 ? '#d97706' : '#dc2626', `self ${selfGM.toFixed(1)}%`))
                    }
                  }

                  // 5. Net debt / gross profit
                  const annCash      = lastA(ann?.cash)   // $M from signalsData
                  const rawTotalDebt = typeof selectedRow.totalDebt === 'number' ? selectedRow.totalDebt : null
                  const gpRaw        = annGP ?? (typeof selectedRow.grossProfit === 'number' ? selectedRow.grossProfit : null)
                  if (rawTotalDebt != null && annCash != null && gpRaw != null && gpRaw > 0) {
                    const ndGP = (rawTotalDebt - annCash) / gpRaw
                    out.push(dpill('ND/GrProfit', `${ndGP.toFixed(2)}x`, ndGP <= 1 ? '#15803d' : ndGP <= 3 ? '#d97706' : '#dc2626'))
                  }

                  return out.length ? out : null
                })()}
                {pill('Inst %', s?.institutionalPct != null ? `${s.institutionalPct.toFixed(1)}%` : '-')}
                {pill('Insider %', s?.insiderPct != null ? `${s.insiderPct.toFixed(1)}%` : '-')}
              </div>
            )
          })()}

          {/* Business overview + earnings date cards side by side */}
          {/* Row 1: biz overview + calendar cards + velocity chart + sentiment donut */}
          <div style={{ display: 'flex', gap: 12, alignItems: 'stretch', marginBottom: 14 }}>
            {/* Description */}
            <div style={{ flex: 2, minWidth: 0 }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#1a2b3c', marginBottom: 5 }}>Business Overview</div>
              <p className="detail-description" style={{ margin: 0, marginBottom: selectedRow.website ? 4 : 0 }}>
                {selectedRow.description || 'No description available.'}
              </p>
              {selectedRow.website && (
                <a href={selectedRow.website.startsWith('http') ? selectedRow.website : `https://${selectedRow.website}`}
                   target="_blank" rel="noopener noreferrer"
                   style={{ fontSize: '0.68rem', color: '#2563eb', textDecoration: 'none' }}>
                  {selectedRow.website.replace(/^https?:\/\//, '').replace(/\/$/, '')} ↗
                </a>
              )}
            </div>
            {/* Velocity + Sentiment side by side */}
            {(() => {
              const ticker = getTickerSymbol(selectedRow.exchangeTicker || selectedRow.securityTickers)
              const ind = newsIndicators[ticker]
              const isSpike = ind?.velocityState === 'spike'
              const trendColor = ind?.sentTrend === 'improving' ? '#2a9d8f' : ind?.sentTrend === 'deteriorating' ? '#e76f51' : '#6b7280'
              return (
                <div style={{ flex: '0 0 420px', display: 'flex', gap: 8 }}>
                  {/* Velocity */}
                  <div style={{ flex: 1, background: '#f9f9f9', border: '1px solid #e8e8e8', borderRadius: 8, padding: '8px 10px' }}>
                    <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#1a2b3c', marginBottom: 5 }}>
                      News Velocity {isSpike && <span style={{ color: '#f59e0b', fontSize: '0.65rem' }}>⚡ Spike</span>}
                    </div>
                    {ind?.byDay
                      ? <VelocityChart byDay={ind.byDay} />
                      : <div style={{ height: 38, display: 'flex', alignItems: 'center' }}><span style={{ fontSize: '0.68rem', color: '#d1d5db' }}>load news to populate</span></div>
                    }
                    <div style={{ fontSize: '0.68rem', color: '#6b7280', marginTop: 3 }}>
                      {ind
                        ? <><strong style={{ color: '#374151' }}>{ind.week0}</strong> this wk · <strong style={{ color: '#374151' }}>{ind.week1}</strong> prior · avg <strong style={{ color: '#374151' }}>{ind.avg30daily?.toFixed(1) ?? '-'}/day</strong></>
                        : <span style={{ color: '#e5e7eb' }}>-</span>
                      }
                    </div>
                  </div>
                  {/* Sentiment */}
                  <div style={{ flex: 1, background: '#f9f9f9', border: '1px solid #e8e8e8', borderRadius: 8, padding: '8px 10px' }}>
                    <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#1a2b3c', marginBottom: 5 }}>Sentiment</div>
                    {ind?.sentCounts
                      ? (
                        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                          <DonutChart pos={ind.sentCounts.pos} neg={ind.sentCounts.neg} neu={ind.sentCounts.neu} />
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: '0.7rem', paddingTop: 2 }}>
                            <span><span style={{ color: '#2a9d8f', fontWeight: 700 }}>●</span> {ind.sentCounts.pos} positive</span>
                            <span><span style={{ color: '#e76f51', fontWeight: 700 }}>●</span> {ind.sentCounts.neg} negative</span>
                            <span><span style={{ color: '#9ca3af', fontWeight: 700 }}>●</span> {ind.sentCounts.neu} neutral</span>
                            {ind.sentTrend && <div style={{ marginTop: 3, fontSize: '0.68rem' }}>Trend: <span style={{ fontWeight: 700, color: trendColor }}>{ind.sentTrend}</span></div>}
                          </div>
                        </div>
                      )
                      : <div style={{ height: 52, display: 'flex', alignItems: 'center' }}><span style={{ fontSize: '0.68rem', color: '#d1d5db' }}>-</span></div>
                    }
                  </div>
                </div>
              )
            })()}
            {/* Earnings date calendar cards */}
            <div style={{ display: 'flex', flexDirection: 'column', flexShrink: 0, background: '#f9f9f9', border: '1px solid #e8e8e8', borderRadius: 8, padding: '8px 10px' }}>
              <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#1a2b3c', marginBottom: 8 }}>Earnings Dates</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flex: 1 }}>
                {[
                  { label: 'Last', date: detailEarnings?.lastEarningsDate || selectedRow.lastEarningsDate, next: false },
                  { label: 'Next', date: detailEarnings?.nextEarningsDate || selectedRow.nextEarningsDate, next: true },
                ].map(({ label, date, next }) => {
                  const color = next ? '#2563eb' : '#6b7280'
                  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
                  let mo = '', dy = ''
                  if (date && /^\d{4}-\d{2}-\d{2}/.test(date)) {
                    const [, m, d] = date.split('-').map(Number)
                    mo = MONTHS[(m - 1)] || ''
                    dy = String(d)
                  }
                  return (
                    <div key={label} style={{
                      background: next ? '#f0f6ff' : '#fff',
                      border: `1px solid ${next ? '#c7dcf7' : '#e5e5e5'}`,
                      borderRadius: 10, padding: '8px 10px', minWidth: 90, textAlign: 'center',
                      display: 'flex', flexDirection: 'column', alignItems: 'center',
                    }}>
                      <svg width="44" height="48" viewBox="0 0 44 48" fill="none" style={{ display: 'block', marginBottom: 5 }}>
                        <rect x="3" y="7" width="38" height="38" rx="5" fill="rgba(0,0,0,0.06)"/>
                        <rect x="2" y="6" width="38" height="38" rx="5" fill="white" stroke={color} strokeWidth="1.5"/>
                        <rect x="2" y="6" width="38" height="13" rx="5" fill={color}/>
                        <rect x="2" y="15" width="38" height="4" fill={color}/>
                        <rect x="12" y="2" width="4" height="9" rx="2" fill={color}/>
                        <rect x="28" y="2" width="4" height="9" rx="2" fill={color}/>
                        <text x="21" y="16.5" textAnchor="middle" fontSize="8.5" fill="white" fontWeight="700" fontFamily="system-ui,sans-serif" letterSpacing="0.08em">{mo || '···'}</text>
                        <text x="21" y="37" textAnchor="middle" fontSize="18" fill={color} fontWeight="800" fontFamily="system-ui,sans-serif">{dy || '-'}</text>
                      </svg>
                      <div style={{ fontSize: '0.63rem', color: next ? '#2563eb' : '#9ca3af', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Revenue breakdown + Financial Signals side by side */}
          {mounted && (
            <div style={{ display: 'flex', gap: 16, marginBottom: 16, alignItems: 'flex-start' }}>
            <div style={{ background: '#f9f9f9', border: '1px solid #e8e8e8', borderRadius: 8, padding: '10px 12px', flexShrink: 0, width: '27%' }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#1a2b3c', marginBottom: 8 }}>
                Revenue Breakdown
                {revenueSegments?.year && <span style={{ fontSize: '0.66rem', fontWeight: 400, color: '#9ca3af', marginLeft: 6 }}>{revenueSegments.year} · {revenueSegments.totalFmt}</span>}
              </div>
              {/* Tabs */}
              {(() => {
                const TABS = [
                  { id: 'product',   label: 'By Product' },
                  { id: 'segment',   label: 'By Segment' },
                  { id: 'geographic', label: 'Geographic' },
                ]
                const dataType = revenueSegments?.type || null
                const hasData = (revenueSegments?.segments?.length > 0)
                return (
                  <>
                    <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
                      {TABS.map(tab => {
                        const available = hasData && dataType === tab.id
                        const isActive = segTab === tab.id
                        return (
                          <button key={tab.id} type="button"
                            onClick={() => available && setSegTab(tab.id)}
                            style={{
                              fontSize: '0.68rem', fontWeight: isActive && available ? 700 : 500,
                              padding: '3px 10px', borderRadius: 5,
                              border: isActive && available ? '1.5px solid #2563eb' : '1.5px solid #e5e7eb',
                              background: isActive && available ? '#eff6ff' : '#f9fafb',
                              color: available ? (isActive ? '#1d4ed8' : '#374151') : '#d1d5db',
                              cursor: available ? 'pointer' : 'default',
                              opacity: available ? 1 : 0.55,
                            }}
                          >{tab.label}</button>
                        )
                      })}
                    </div>
                    {revenueSegmentsLoading && <div className="detail-multiples-empty">Loading…</div>}
                    {!revenueSegmentsLoading && (!hasData || dataType !== segTab) && (
                      <div className="detail-multiples-empty" style={{ color: '#d1d5db' }}>
                        {revenueSegments && !hasData
                          ? 'No segment data reported in EDGAR filings.'
                          : hasData
                            ? 'No data available for this breakdown.'
                            : 'Loading segment data…'}
                      </div>
                    )}
                    {!revenueSegmentsLoading && hasData && dataType === segTab && (() => {
                      const segs = revenueSegments.segments
                      const COLORS = ['#3b82f6','#2a9d8f','#e76f51','#f4a261','#8b5cf6','#ec4899','#10b981','#f59e0b']
                      const R = 52, cx = 60, cy = 60
                      let cumPct = 0
                      const slices = segs.map((s, i) => {
                        const pct = s.pct / 100
                        const start = cumPct * 2 * Math.PI - Math.PI / 2
                        cumPct += pct
                        const end = cumPct * 2 * Math.PI - Math.PI / 2
                        const largeArc = pct > 0.5 ? 1 : 0
                        const x1 = cx + R * Math.cos(start), y1 = cy + R * Math.sin(start)
                        const x2 = cx + R * Math.cos(end), y2 = cy + R * Math.sin(end)
                        return { ...s, color: COLORS[i % COLORS.length], d: pct < 0.999 ? `M ${cx} ${cy} L ${x1} ${y1} A ${R} ${R} 0 ${largeArc} 1 ${x2} ${y2} Z` : `M ${cx} ${cy} m -${R} 0 a ${R} ${R} 0 1 0 ${R*2} 0 a ${R} ${R} 0 1 0 -${R*2} 0` }
                      })
                      return (
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                          <svg width="120" height="120" viewBox="0 0 120 120" style={{ flexShrink: 0 }}>
                            {slices.map((s, i) => <path key={i} d={s.d} fill={s.color} stroke="white" strokeWidth="1.5"/>)}
                            <circle cx={cx} cy={cy} r={R * 0.45} fill="white"/>
                          </svg>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 0 }}>
                            {segs.map((s, i) => (
                              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.72rem' }}>
                                <div style={{ width: 8, height: 8, borderRadius: 2, background: COLORS[i % COLORS.length], flexShrink: 0 }}/>
                                <span style={{ flex: 1, color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.label}</span>
                                <span style={{ fontWeight: 700, color: '#1a2b3c' }}>{s.pct}%</span>
                                {s.fmtValue && <span style={{ color: '#9ca3af', fontSize: '0.67rem' }}>{s.fmtValue}</span>}
                              </div>
                            ))}
                          </div>
                        </div>
                      )
                    })()}
                  </>
                )
              })()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              {(signalsLoading || signals.length > 0) && (() => {
                const triggered   = signals.filter(s => s.status === 'triggered')
                const comingSoon  = signals.filter(s => s.status === 'coming_soon')
                const reds        = triggered.filter(s => s.severity === 'red')
                const yellows     = triggered.filter(s => s.severity === 'yellow')
                const greens      = triggered.filter(s => s.severity === 'green')
                const isOpen      = signalsPanelOpen === null ? reds.length > 0 : signalsPanelOpen
                const SEV_ORDER   = ['red', 'yellow', 'green']
                const sortedTriggered = SEV_ORDER.flatMap(sev => triggered.filter(s => s.severity === sev))
                const SEV_STYLE = {
                  red:    { border: '#e76f51', bg: 'rgba(231,111,81,0.06)', icon: '↓', iconColor: '#e76f51' },
                  yellow: { border: '#f59e0b', bg: 'rgba(245,158,11,0.06)', icon: '!', iconColor: '#d97706' },
                  green:  { border: '#2a9d8f', bg: 'rgba(42,157,143,0.06)', icon: '↑', iconColor: '#2a9d8f' },
                }
                return (
                  <div style={{ border: '1px solid #eee', borderRadius: 8, overflow: 'hidden' }}>
                    <div role="button" style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '7px 10px', background: '#fafafa', cursor: 'pointer', userSelect: 'none', borderBottom: isOpen ? '1px solid #eee' : 'none' }}
                      onClick={() => setSignalsPanelOpen(o => !(o === null ? reds.length > 0 : o))}>
                      <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#1a2b3c' }}>Financial Signals</span>
                      <span style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 2 }}>
                        {reds.length > 0 && <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: '#e76f51', display: 'inline-block' }}/><span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#e76f51' }}>{reds.length}</span></span>}
                        {yellows.length > 0 && <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: '#f59e0b', display: 'inline-block' }}/><span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#b45309' }}>{yellows.length}</span></span>}
                        {greens.length > 0 && <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: '#2a9d8f', display: 'inline-block' }}/><span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#1f6f4c' }}>{greens.length}</span></span>}
                        {comingSoon.length > 0 && <span style={{ fontSize: '0.68rem', color: '#9ca3af', fontWeight: 500 }}>⏱ {comingSoon.length}</span>}
                        {signalsLoading && <span style={{ fontSize: '0.68rem', color: '#9ca3af' }}>Loading…</span>}
                      </span>
                      <span style={{ marginLeft: 'auto', fontSize: '0.68rem', color: '#9ca3af' }}>{isOpen ? '▲' : '▼'}</span>
                    </div>
                    {isOpen && (
                      <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 5 }}>
                        {!signalsLoading && triggered.length === 0 && comingSoon.length === 0 && (
                          <div style={{ fontSize: '0.75rem', color: '#9ca3af', fontStyle: 'italic', padding: '4px 0' }}>No significant signals detected.</div>
                        )}
                        {sortedTriggered.map((s, i) => {
                          const st = SEV_STYLE[s.severity] || SEV_STYLE.yellow
                          return (
                            <div key={i} style={{ borderLeft: `3px solid ${st.border}`, background: st.bg, borderRadius: '0 6px 6px 0', padding: '5px 8px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
                                <span style={{ fontSize: '0.7rem', fontWeight: 800, color: st.iconColor, minWidth: 12, textAlign: 'center', lineHeight: 1 }}>{st.icon}</span>
                                <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#1a2b3c' }}>{s.title}</span>
                                <span style={{ fontSize: '0.6rem', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.04em', marginLeft: 2 }}>{s.category}</span>
                              </div>
                              <div style={{ fontSize: '0.69rem', color: '#374151', lineHeight: 1.4, paddingLeft: 17 }}>{s.detail}</div>
                            </div>
                          )
                        })}
                        {comingSoon.map((s, i) => (
                          <div key={`cs-${i}`} style={{ borderLeft: '3px solid #d1d5db', background: '#f9fafb', borderRadius: '0 6px 6px 0', padding: '5px 8px', opacity: 0.8 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                              <span style={{ fontSize: '0.7rem', color: '#9ca3af', minWidth: 12, textAlign: 'center', lineHeight: 1 }}>⏱</span>
                              <span style={{ fontSize: '0.72rem', fontWeight: 600, color: '#9ca3af' }}>{s.title}</span>
                              <span style={{ fontSize: '0.6rem', color: '#d1d5db', textTransform: 'uppercase', letterSpacing: '0.04em', marginLeft: 2 }}>{s.category}</span>
                            </div>
                            <div style={{ fontSize: '0.69rem', color: '#9ca3af', fontStyle: 'italic', paddingLeft: 17, marginTop: 2 }}>Coming soon</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })()}
            </div>
            </div>
          )}

          {/* ── Products & Services + Supply Chain ── */}
          {mounted && (
            <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
              {/* Products & Services */}
              <div style={{ flex: 2, background: '#f9f9f9', border: '1px solid #e8e8e8', borderRadius: 8, padding: '10px 12px' }}>
                <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#1a2b3c', marginBottom: 6 }}>Products &amp; Services</div>
                {selectedRow.productDescription ? (() => {
                  return (
                    <div style={{ fontSize: '0.76rem', color: '#374151', lineHeight: 1.55 }}>
                      {selectedRow.productDescription}
                    </div>
                  )
                })() : <div className="detail-multiples-empty">No product data in Capital IQ</div>}
              </div>
              {/* Supply Chain */}
              <div style={{ flex: 1, background: '#f9f9f9', border: '1px solid #e8e8e8', borderRadius: 8, padding: '10px 12px' }}>
                <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#1a2b3c', marginBottom: 6 }}>Supply Chain</div>
                {tenkLoading && <div className="detail-multiples-empty">Loading 10-K…</div>}
                {!tenkLoading && tenkData?.supplyChain && (() => {
                  return (
                    <div style={{ fontSize: '0.76rem', color: '#374151', lineHeight: 1.55 }}>
                      {tenkData.supplyChain}
                    </div>
                  )
                })()}
                {!tenkLoading && tenkData && !tenkData.supplyChain && <div className="detail-multiples-empty">Not reported in 10-K filings</div>}
              </div>
            </div>
          )}

          {/* Full-width block: Recent Dev + Value Prop + Accounting Policies — three separate boxes */}
          {mounted && (
            <div style={{ display: 'flex', gap: 12, marginBottom: 14, alignItems: 'flex-start' }}>
              {/* Recent Developments */}
              <div style={{ flex: '1 1 0', minWidth: 0, background: '#f9f9f9', border: '1px solid #e8e8e8', borderRadius: 8, padding: '10px 12px' }}>
                <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#1a2b3c', marginBottom: 8 }}>Recent Developments</div>
                {!recent8k && <div className="detail-multiples-empty">Loading…</div>}
                {recent8k?.filings?.length === 0 && <div className="detail-multiples-empty">No recent 8-K filings found</div>}
                {recent8k?.filings?.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {recent8k.filings.map((f, i) => {
                      const url = `https://www.sec.gov/Archives/edgar/data/${f.cikInt}/${f.accession.replace(/-/g, '')}/${f.primaryDoc}`
                      const typeLabel = f.items.map(it => it.label).join(' · ')
                      return (
                        <a key={i} href={url} target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '6px 8px', background: '#fff', border: '1px solid #ebebeb', borderRadius: 6, textDecoration: 'none' }}>
                          <span style={{ fontSize: '0.65rem', color: '#9ca3af', whiteSpace: 'nowrap', marginTop: 2 }}>{f.date}</span>
                          <div>
                            <span style={{ fontSize: '0.72rem', color: '#1a2b3c', fontWeight: 600 }}>{typeLabel || '8-K'}</span>
                            <span style={{ fontSize: '0.65rem', color: '#9ca3af', marginLeft: 6 }}>{f.items.map(it => it.code).join(', ')}</span>
                          </div>
                        </a>
                      )
                    })}
                  </div>
                )}
              </div>
              {/* Value Proposition */}
              <div style={{ flex: '1 1 0', minWidth: 0, background: '#f9f9f9', border: '1px solid #e8e8e8', borderRadius: 8, padding: '10px 12px' }}>
                <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#1a2b3c', marginBottom: 6 }}>Value Proposition</div>
                {selectedRow.description
                  ? <div style={{ fontSize: '0.73rem', color: '#374151', lineHeight: 1.55 }}>{selectedRow.description}</div>
                  : <div style={{ fontSize: '0.8rem', color: '#9ca3af', fontStyle: 'italic' }}>Coming soon</div>
                }
              </div>
              {/* Accounting Policies */}
              {(tenkLoading || tenkData?.accounting) && (() => {
                const a = tenkData?.accounting || {}
                const LABELS = { revenueRecognition: 'Revenue Recognition', inventory: 'Inventory', depreciation: 'Depreciation', goodwill: 'Goodwill' }
                const hasAny = Object.values(a).some(Boolean)
                if (!hasAny && !tenkLoading) return null
                return (
                  <div style={{ flex: '1 1 0', minWidth: 0, background: '#f9f9f9', border: '1px solid #e8e8e8', borderRadius: 8, padding: '10px 12px' }}>
                    <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#1a2b3c', marginBottom: 6 }}>Accounting Policies</div>
                    {tenkLoading && <div className="detail-multiples-empty">Loading 10-K…</div>}
                    {!tenkLoading && Object.entries(LABELS).map(([k, label]) => a[k] ? (
                      <div key={k} style={{ marginBottom: 5 }}>
                        <span style={{ fontSize: '0.63rem', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
                        <p style={{ margin: '2px 0 0', fontSize: '0.7rem', color: '#374151', lineHeight: 1.45 }}>{a[k]}</p>
                      </div>
                    ) : null)}
                  </div>
                )
              })()}
            </div>
          )}

          {/* Red Flags - full width */}
          {mounted && signals.some(s => s.status === 'triggered' && s.severity === 'red') && (() => {
            const red = signals.filter(s => s.status === 'triggered' && s.severity === 'red')
            return (
              <div style={{ background: 'rgba(231,111,81,0.04)', border: '1px solid rgba(231,111,81,0.25)', borderRadius: 8, padding: '10px 12px', marginBottom: 14 }}>
                <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#e76f51', marginBottom: 8 }}>🚩 Red Flags</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {red.map((sig, i) => (
                    <div key={i} style={{ fontSize: '0.72rem', color: '#1a2b3c' }}>
                      <span style={{ fontWeight: 600 }}>{sig.title}</span>
                      {sig.detail && <span style={{ color: '#6b7280', marginLeft: 6 }}>- {sig.detail}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}

          {/* Management & Governance - full width */}
          {mounted && (
            <div style={{ display: 'flex', gap: 12, marginBottom: 14, alignItems: 'flex-start' }}>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>

                {/* Management & Governance */}
                {managementData?.executives?.length > 0 && (() => {
                  const fmtComp = v => {
                    if (!v) return null
                    if (v >= 1e9) return `$${(v/1e9).toFixed(1)}B`
                    if (v >= 1e6) return `$${(v/1e6).toFixed(1)}M`
                    if (v >= 1e3) return `$${(v/1e3).toFixed(0)}K`
                    return `$${Math.round(v).toLocaleString()}`
                  }
                  const execs = managementData.executives
                  return (
                    <div style={{ background: '#f9f9f9', border: '1px solid #e8e8e8', borderRadius: 8, padding: '10px 12px' }}>
                      <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#1a2b3c', marginBottom: 8 }}>Management &amp; Governance</div>
                      <div style={{ display: 'flex', gap: 6, padding: '3px 0', borderBottom: '1px solid #ebebeb', fontSize: '0.63rem', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        <span style={{ flex: 3 }}>Name</span>
                        <span style={{ flex: 3 }}>Title</span>
                        <span style={{ flex: 1, textAlign: 'center' }}>Age</span>
                        <span style={{ flex: 2, textAlign: 'right' }}>Total Comp</span>
                      </div>
                      {execs.map((e, i) => (
                        <div key={i} style={{ display: 'flex', gap: 6, padding: '4px 0', borderBottom: i < execs.length - 1 ? '1px solid #f3f4f6' : 'none', alignItems: 'center' }}>
                          <span style={{ flex: 3, fontSize: '0.74rem', fontWeight: 600, color: '#1a2b3c', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name}</span>
                          <span style={{ flex: 3, fontSize: '0.71rem', color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.title}</span>
                          <span style={{ flex: 1, fontSize: '0.71rem', color: '#9ca3af', textAlign: 'center' }}>{e.age ?? '-'}</span>
                          <span style={{ flex: 2, fontSize: '0.71rem', fontWeight: 600, color: '#374151', textAlign: 'right' }}>{fmtComp(e.totalComp) ?? '-'}</span>
                        </div>
                      ))}
                    </div>
                  )
                })()}

              </div>
            </div>
          )}

          {/* Things to Clarify - full width */}
          {mounted && signals.some(s => s.status === 'triggered' && s.severity === 'yellow') && (
            <div style={{ background: 'rgba(245,158,11,0.04)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 8, padding: '10px 12px', marginBottom: 14 }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#b45309', marginBottom: 8 }}>⚠ Things to Clarify</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {signals.filter(s => s.status === 'triggered' && s.severity === 'yellow').map((sig, i) => (
                  <div key={i} style={{ fontSize: '0.72rem', color: '#1a2b3c' }}>
                    <span style={{ fontWeight: 600 }}>{sig.title}</span>
                    {sig.detail && <span style={{ color: '#6b7280', marginLeft: 6 }}>- {sig.detail}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 10K Footnotes - full width */}
          {mounted && (tenkLoading || tenkData?.riskFactors?.length > 0) && (
            <div style={{ background: '#f9f9f9', border: '1px solid #e8e8e8', borderRadius: 8, padding: '10px 12px', marginBottom: 14 }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#1a2b3c', marginBottom: 8 }}>10-K Footnotes <span style={{ fontWeight: 400, color: '#9ca3af', fontSize: '0.65rem' }}>Risk Factors</span></div>
              {tenkLoading && <div className="detail-multiples-empty">Loading 10-K…</div>}
              {tenkData?.riskFactors?.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {tenkData.riskFactors.slice(0, 6).map((r, i) => (
                    <div key={i} style={{ padding: '5px 0', borderBottom: '1px solid #f3f4f6' }}>
                      <div style={{ fontSize: '0.72rem', fontWeight: 600, color: '#374151', marginBottom: 2 }}>{r.heading}</div>
                      {r.summary && <div style={{ fontSize: '0.68rem', color: '#6b7280', lineHeight: 1.45 }}>{r.summary}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Full-width stock price chart with 1Y / 5Y toggle */}
          {mounted && (() => {
            const ticker = getTickerSymbol(selectedRow.exchangeTicker || selectedRow.securityTickers)
            const activeData = chartRange === '5y' ? chart5yData : chart1yData
            const isLoading = chartRange === '5y' ? chart5yLoading : chart1yLoading
            const apiCloses = activeData?.closes?.filter(v => typeof v === 'number') || []
            const apiTs = activeData?.timestamps || []
            const fallbackCloses = chartRange === '1y' && apiCloses.length === 0
              ? (selectedRow.history?.closes?.filter(v => typeof v === 'number') || [])
              : []
            const closes = apiCloses.length > 0 ? apiCloses : fallbackCloses
            const ts = apiCloses.length > 0 ? apiTs : []
            const fP = v => `$${v >= 1000 ? v.toFixed(0) : v.toFixed(2)}`
            return (
              <div style={{ marginTop: 14, marginBottom: 10, background: '#f9f9f9', border: '1px solid #e8e8e8', borderRadius: 9, padding: '10px 14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                    <span style={{ fontSize: '1.05rem', fontWeight: 700, color: '#1a2b3c' }}>{ticker}</span>
                    {closes.length > 0 && <span style={{ fontSize: '1.05rem', fontWeight: 700, color: '#1a2b3c' }}>{selectedRow.price != null ? fP(selectedRow.price) : fP(closes[closes.length - 1])}</span>}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      {['1y', '5y'].map(r => (
                        <button key={r} type="button" onClick={() => setChartRange(r)} style={{
                          fontSize: '0.85rem', fontWeight: chartRange === r ? 700 : 500,
                          padding: '2px 9px', borderRadius: 5,
                          border: chartRange === r ? '1.5px solid #2563eb' : '1.5px solid #e5e7eb',
                          background: chartRange === r ? '#eff6ff' : '#fff',
                          color: chartRange === r ? '#1d4ed8' : '#6b7280',
                          cursor: 'pointer',
                        }}>{r.toUpperCase()}</button>
                      ))}
                      {selectedRow.beta != null && (
                        <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#1a2b3c', marginLeft: 6 }}>β {selectedRow.beta.toFixed(2)}</span>
                      )}
                    </div>
                  </div>
                </div>
                {isLoading && closes.length === 0 && <div className="detail-multiples-empty">Loading chart…</div>}
                {!isLoading && closes.length === 0 && <div className="detail-multiples-empty">No chart data</div>}
                {closes.length > 0 && (() => {
                  const rawMin = Math.min(...closes), rawMax = Math.max(...closes)
                  const minV = rawMin
                  const maxV = rawMax
                  const rng = maxV - minV || 1
                  const isUp = closes[closes.length - 1] >= closes[0]
                  const stroke = isUp ? '#2a9d8f' : '#e76f51'
                  const W = 1400, H = 170, mL = 42, mR = 8, mT = 12, mB = 22
                  const cW = W - mL - mR, cH = H - mT - mB
                  const px = i => mL + (i / (closes.length - 1)) * cW
                  const py = v => mT + cH - ((v - minV) / rng) * cH
                  const pts = closes.map((v, i) => `${px(i)},${py(v)}`).join(' ')
                  const yTicks = [minV, minV + rng * 0.25, minV + rng * 0.5, minV + rng * 0.75, maxV]
                  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
                  const fmtMo = sec => { const d = new Date(sec * 1000); return MONTHS[d.getUTCMonth()] + ' \'' + String(d.getUTCFullYear()).slice(2) }
                  const fmtYr = sec => String(new Date(sec * 1000).getUTCFullYear())

                  // Big move annotations: find top 5 single-session moves >= threshold
                  const bigMoveAnnotations = (() => {
                    if (closes.length < 2) return []
                    const threshold = chartRange === '5y' ? 8 : 5  // % threshold
                    const moves = []
                    for (let i = 1; i < closes.length; i++) {
                      if (!closes[i-1]) continue
                      const pct = (closes[i] - closes[i-1]) / closes[i-1] * 100
                      if (Math.abs(pct) >= threshold) moves.push({ idx: i, pct })
                    }
                    // Sort by magnitude, pick top 5 with min spacing of 10 points
                    moves.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))
                    const picked = [], minGap = 10
                    for (const m of moves) {
                      if (!picked.some(p => Math.abs(p.idx - m.idx) < minGap)) picked.push(m)
                      if (picked.length >= 5) break
                    }
                    return picked
                  })()

                  // Earnings markers from actual detailEarnings history
                  const earningsMarkers = (() => {
                    if (chartRange === '5y' || !ts.length || !detailEarnings?.history?.length) return []
                    const out = []
                    const qLabel = period => {
                      const d = new Date(period + 'T12:00:00Z')
                      const mo = d.getUTCMonth() + 1
                      const q = mo <= 3 ? 'Q1' : mo <= 6 ? 'Q2' : mo <= 9 ? 'Q3' : 'Q4'
                      return `${q} '${String(d.getUTCFullYear()).slice(2)}`
                    }
                    for (const q of detailEarnings.history) {
                      if (!q.period) continue
                      const earnSec = new Date(q.period + 'T12:00:00Z').getTime() / 1000
                      if (earnSec < ts[0] - 86400 * 10 || earnSec > ts[ts.length - 1] + 86400 * 10) continue
                      let best = 0, minDiff = Infinity
                      for (let ii = 0; ii < ts.length; ii++) { const diff = Math.abs(ts[ii] - earnSec); if (diff < minDiff) { minDiff = diff; best = ii } }
                      if (!out.find(m => m.idx === best)) out.push({ idx: best, label: qLabel(q.period) })
                    }
                    return out
                  })()

                  // X-axis: monthly labels at month boundaries
                  const xLabels = (() => {
                    const boundaries = []
                    let prevMo = null
                    ts.forEach((sec, i) => {
                      const mo = new Date(sec * 1000).getUTCMonth()
                      if (mo !== prevMo) { boundaries.push({ idx: i, sec }); prevMo = mo }
                    })
                    if (chartRange === '5y') {
                      // Year labels at first occurrence of each year
                      const seen = new Set(), out = []
                      boundaries.forEach(({ idx, sec }) => {
                        const yr = new Date(sec * 1000).getUTCFullYear()
                        if (!seen.has(yr)) { seen.add(yr); out.push({ idx, label: fmtYr(sec) }) }
                      })
                      return out
                    } else {
                      // 1Y daily: show every ~3rd month boundary (quarterly)
                      const step = Math.max(1, Math.floor(boundaries.length / 4))
                      return boundaries
                        .filter((_, i) => i % step === 0)
                        .map(({ idx, sec }) => ({ idx, label: fmtMo(sec) }))
                    }
                  })()

                  return (
                    <svg
                      viewBox={`0 0 ${W} ${H}`}
                      style={{ width: '100%', maxWidth: 1400, display: 'block', cursor: 'crosshair' }}
                      xmlns="http://www.w3.org/2000/svg"
                      onMouseMove={e => {
                        const rect = e.currentTarget.getBoundingClientRect()
                        const svgX = ((e.clientX - rect.left) / rect.width) * W
                        const frac = Math.max(0, Math.min(1, (svgX - mL) / cW))
                        const idx = Math.round(frac * (closes.length - 1))
                        setChartHover({ idx, price: closes[idx], sec: ts[idx] })
                      }}
                      onMouseLeave={() => setChartHover(null)}
                    >
                      <defs>
                        <filter id="earningShadow" x="-60%" y="-60%" width="220%" height="220%">
                          <feDropShadow dx="0" dy="1" stdDeviation="1.2" floodColor="#1f2937" floodOpacity="0.28"/>
                        </filter>
                      </defs>
                      {yTicks.map((tv, ti) => (
                        <g key={ti}>
                          <line x1={mL} x2={W - mR} y1={py(tv)} y2={py(tv)} stroke="#f0f0f0" strokeWidth="0.6"/>
                          <text x={mL - 4} y={py(tv) + 3.5} textAnchor="end" fontSize="9" fill="#9ca3af">{fP(tv)}</text>
                        </g>
                      ))}
                      <line x1={mL} x2={W - mR} y1={mT + cH} y2={mT + cH} stroke="#e5e7eb" strokeWidth="0.7"/>
                      {xLabels.map(({ idx, label }, li) => (
                        <text key={li} x={px(idx)} y={H - 4} textAnchor={li === 0 ? 'start' : li === xLabels.length - 1 ? 'end' : 'middle'} fontSize="9" fill="#9ca3af">{label}</text>
                      ))}
                      <path d={`M ${px(0)},${mT + cH} L ${pts.split(' ').join(' L ')} L ${px(closes.length - 1)},${mT + cH} Z`} fill={isUp ? 'rgba(42,157,143,0.08)' : 'rgba(231,111,81,0.08)'}/>
                      <polyline points={pts} fill="none" stroke={stroke} strokeWidth="1.4" strokeLinecap="butt" strokeLinejoin="miter"/>
                      {earningsMarkers.map(({ idx, label }, mi) => {
                        const cx = px(idx), cy = py(closes[idx])
                        const markerColor = '#b45309'
                        const triPoints = `${cx - 4},${cy} ${cx + 4},${cy} ${cx},${cy - 8}`
                        const textY = Math.max(mT + 8, cy - 11)
                        return (
                          <g key={mi} filter="url(#earningShadow)">
                            <polygon points={triPoints} fill={markerColor}/>
                            <text x={cx} y={textY} textAnchor="middle" fontSize="8" fill={markerColor} fontWeight="700" fontFamily="system-ui,sans-serif">{label}</text>
                          </g>
                        )
                      })}
                      {bigMoveAnnotations.map(({ idx, pct }, ai) => {
                        const cx = px(idx), cy = py(closes[idx])
                        const isUp = pct > 0
                        const annotColor = isUp ? '#15803d' : '#be123c'
                        const stemLen = 10
                        const labelY = isUp ? cy - stemLen - 5 : cy + stemLen + 5
                        const stemY1 = isUp ? cy - 2 : cy + 2
                        const stemY2 = isUp ? cy - stemLen : cy + stemLen
                        const sign = isUp ? '+' : ''
                        const lbl = `${sign}${pct.toFixed(1)}%`
                        const lW = lbl.length * 5 + 6
                        const anchor = cx + lW/2 > W - mR ? 'end' : cx - lW/2 < mL ? 'start' : 'middle'
                        const lx = anchor === 'end' ? cx - lW : anchor === 'start' ? cx : cx - lW/2
                        return (
                          <g key={ai}>
                            <circle cx={cx} cy={cy} r="2.5" fill={annotColor} opacity="0.7"/>
                            <line x1={cx} y1={stemY1} x2={cx} y2={stemY2} stroke={annotColor} strokeWidth="0.7" strokeDasharray="2,1.5" opacity="0.7"/>
                            <rect x={lx} y={isUp ? labelY - 8 : labelY - 1} width={lW} height={9} rx="1.5" fill={annotColor} opacity="0.85"/>
                            <text x={lx + lW/2} y={isUp ? labelY : labelY + 7} textAnchor="middle" fontSize="7" fill="#fff" fontWeight="700">{lbl}</text>
                          </g>
                        )
                      })}
                      {chartHover && chartHover.idx >= 0 && chartHover.idx < closes.length && (() => {
                        const hx = px(chartHover.idx), hy = py(chartHover.price)
                        const labelW = 50, labelH = 13
                        const lx = Math.max(mL, Math.min(W - mR - labelW, hx - labelW / 2))
                        const fmtDate = sec => { const d = new Date(sec * 1000); return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()] + ' ' + d.getUTCDate() }
                        return (
                          <g pointerEvents="none">
                            <line x1={hx} x2={hx} y1={mT} y2={mT + cH} stroke="#9ca3af" strokeWidth="0.8" strokeDasharray="3,2"/>
                            <circle cx={hx} cy={hy} r="2.5" fill={stroke} stroke="#fff" strokeWidth="1.2"/>
                            <rect x={lx} y={mT} width={labelW} height={labelH} rx="2" fill="rgba(26,43,60,0.88)"/>
                            <text x={lx + labelW / 2} y={mT + 9} textAnchor="middle" fontSize="8" fill="#fff" fontWeight="700">{fP(chartHover.price)}</text>
                            {chartHover.sec && <text x={hx} y={mT + cH + 14} textAnchor={chartHover.idx < closes.length * 0.15 ? 'start' : chartHover.idx > closes.length * 0.85 ? 'end' : 'middle'} fontSize="8" fill="#6b7280">{fmtDate(chartHover.sec)}</text>}
                          </g>
                        )
                      })()}
                    </svg>
                  )
                })()}
              </div>
            )
          })()}

          {/* ── Advanced Metrics ── */}
          {mounted && (() => {
            const ann = signalsData?.annual
            const qtr = signalsData?.quarterly
            const lastA = a => a?.[a.length - 1] ?? null
            const lastQ = a => a?.[a.length - 1] ?? null
            const prevA = a => a?.length >= 2 ? a[a.length - 2] ?? null : null
            const annRev     = lastA(ann?.revenue)
            const prevRev    = prevA(ann?.revenue)
            const annOcf     = lastA(ann?.ocf)
            const annCapex   = lastA(ann?.capex)
            const annGP      = lastA(ann?.grossProfit)
            const annRec     = lastA(ann?.receivables)
            const prevRec    = prevA(ann?.receivables)
            const annInv     = lastA(ann?.inventory)
            const annPay     = lastA(ann?.payables)
            const annSbc     = lastA(ann?.sbc)
            const annRd      = lastA(ann?.rd)
            const annSga     = lastA(ann?.sga)
            const annDa      = lastA(ann?.da)
            const annOpInc   = lastA(ann?.operatingIncome)
            const annGoodwill = lastA(ann?.goodwill)
            const annAssets  = lastA(ann?.assets)
            const annNetPPE  = lastA(ann?.netPPE)
            const annEquity  = lastA(ann?.equity)
            const annIntExp  = lastA(ann?.interestExpense)
            const annDefRev  = lastA(ann?.deferredRevenue)
            const annCash    = lastA(ann?.cash)
            const annFcf     = (annOcf != null && annCapex != null) ? annOcf - Math.abs(annCapex) : null
            const revGr      = (annRev != null && prevRev != null && prevRev !== 0) ? (annRev - prevRev) / Math.abs(prevRev) * 100 : null
            const annCOGS    = (annRev != null && annGP != null) ? annRev - annGP : null
            const tev        = selectedRow.tev    // $M
            const mktCap     = selectedRow.marketCap  // $M
            const pe         = selectedRow.pe

            const SOON = <span style={{ fontSize: '0.67rem', color: '#c4c9d8', fontStyle: 'italic' }}>Soon</span>
            const row = (label, val) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '3px 0', borderBottom: '1px solid #f0f1f5', fontSize: '0.7rem' }}>
                <span style={{ color: '#6b7280' }}>{label}</span>
                <span style={{ fontWeight: 600, color: '#1a2b3c', textAlign: 'right' }}>{val ?? SOON}</span>
              </div>
            )

            // Derived values
            const ndEbitda = (() => {
              const ebitdaVals = financialsData?.trends?.ebitda?.values
              const lastEbitda = ebitdaVals?.length ? ebitdaVals[ebitdaVals.length-1] : null
              const td = typeof selectedRow.totalDebt === 'number' ? selectedRow.totalDebt : null
              if (td == null || annCash == null || lastEbitda == null || lastEbitda <= 0) return null
              return `${((td - annCash) / lastEbitda).toFixed(1)}x`
            })()
            const intCoverage = annOpInc != null && annIntExp != null && annIntExp > 0 ? `${(annOpInc / annIntExp).toFixed(1)}x` : null
            const debtYield   = (() => {
              const td = typeof selectedRow.totalDebt === 'number' ? selectedRow.totalDebt : null
              if (annIntExp == null || td == null || td <= 0) return null
              return `${(annIntExp / td * 100).toFixed(1)}%`
            })()
            const tbv = annEquity != null && annGoodwill != null ? (() => {
              const v = annEquity - annGoodwill
              return Math.abs(v) >= 1e9 ? `$${(v/1e9).toFixed(1)}B` : Math.abs(v) >= 1e6 ? `$${(v/1e6).toFixed(0)}M` : `$${v.toLocaleString()}`
            })() : null
            const assetLight  = annAssets != null && annNetPPE != null && annAssets > 0 ? `${((annAssets - annNetPPE) / annAssets * 100).toFixed(0)}%` : null
            const ppeIntensity = annCapex != null && annNetPPE != null && annNetPPE > 0 ? `${(Math.abs(annCapex) / annNetPPE * 100).toFixed(0)}%` : null
            const sbcPct      = annSbc != null && annRev && annRev > 0 ? `${(annSbc / annRev * 100).toFixed(1)}%` : null
            const rdIntensity = annRd != null && annRev && annRev > 0 ? `${(annRd / annRev * 100).toFixed(1)}%` : null
            const cashEbitda  = annOpInc != null && annDa != null && annSbc != null ? (() => {
              const v = annOpInc + annDa - annSbc
              return Math.abs(v) >= 1e9 ? `$${(v/1e9).toFixed(1)}B` : Math.abs(v) >= 1e6 ? `$${(v/1e6).toFixed(0)}M` : null
            })() : null
            const growthCapex = annCapex != null && annDa != null ? (() => {
              const v = Math.abs(annCapex) - annDa
              if (v < 0) return null
              return Math.abs(v) >= 1e9 ? `$${(v/1e9).toFixed(1)}B` : Math.abs(v) >= 1e6 ? `$${(v/1e6).toFixed(0)}M` : null
            })() : null
            const unearned    = annDefRev != null && annRev && annRev > 0 ? `${(annDefRev / annRev * 100).toFixed(1)}%` : null
            const recQuality  = annRec != null && prevRec != null && prevRev != null && annRev && prevRev && annRev > 0 && prevRev > 0 ? (() => {
              const recGr = (annRec - prevRec) / Math.abs(prevRec) * 100
              const revGrV = revGr ?? 0
              const delta = recGr - revGrV
              return delta > 10 ? `⚠ +${delta.toFixed(0)}pp` : delta < -10 ? `✓ ${delta.toFixed(0)}pp` : `≈ ${delta > 0 ? '+' : ''}${delta.toFixed(0)}pp`
            })() : null
            const capInt       = annCapex != null && annRev && annRev > 0 ? `${(Math.abs(annCapex) / annRev * 100).toFixed(1)}%` : null
            const annBuybacks  = lastA(ann?.buybacks)
            const buybackYield = annBuybacks != null && mktCap && mktCap > 0 ? `${(annBuybacks / (mktCap * 1e6) * 100).toFixed(1)}%` : null
            const annTax       = lastA(ann?.taxExpense)
            const annNetInt    = lastA(ann?.netInterestInc)
            const annLoans     = lastA(ann?.loans)
            const annDeposits  = lastA(ann?.deposits)
            const annNonIntExp = lastA(ann?.nonInterestExp)
            const annRPO       = lastA(ann?.rpo)
            const annCurrAssets = lastA(ann?.currentAssets)
            const annCurrLiab   = lastA(ann?.currentLiab)
            const annRetEarnings = lastA(ann?.retainedEarnings)

            // ROIC / WACC / current ratio / retained earnings
            const annLTDebt    = lastA(ann?.longTermDebt)
            const annSTDebt    = lastA(ann?.shortTermDebt)
            const taxRateEst   = annTax != null && annOpInc && annOpInc > 0 ? Math.min(0.4, Math.max(0, annTax / annOpInc)) : 0.21
            const nopatVal     = annOpInc != null ? annOpInc * (1 - taxRateEst) : null
            const investedCap  = annEquity != null ? annEquity + (annLTDebt ?? 0) + (annSTDebt ?? 0) - (annCash ?? 0) : null
            const roicVal      = nopatVal != null && investedCap && investedCap > 0 ? nopatVal / investedCap * 100 : null
            const roicFmt      = roicVal != null ? `${roicVal.toFixed(1)}%` : null
            const beta         = selectedRow.beta ?? snapshotData?.beta ?? null
            const costEquity   = beta != null ? 0.045 + beta * 0.055 : null  // CAPM: Rf=4.5%, MRP=5.5%
            const totalDebtWacc = (annLTDebt ?? 0) + (annSTDebt ?? 0)
            const costDebt     = annIntExp != null && totalDebtWacc > 0 ? (annIntExp / totalDebtWacc) * (1 - taxRateEst) : null
            const equityMV     = mktCap != null ? mktCap * 1e6 : null
            const totalCapital = equityMV != null ? equityMV + totalDebtWacc : null
            const waccVal      = costEquity != null && totalCapital && totalCapital > 0
              ? (costDebt != null
                  ? (equityMV / totalCapital) * costEquity + (totalDebtWacc / totalCapital) * costDebt
                  : costEquity)
              : null
            const waccFmt      = waccVal != null ? `${(waccVal * 100).toFixed(1)}%` : null
            const roicVsWacc   = roicVal != null && waccVal != null ? (() => {
              const spread = roicVal - waccVal * 100
              return `${spread >= 0 ? '+' : ''}${spread.toFixed(1)}pp`
            })() : null
            const currentRatio = annCurrAssets != null && annCurrLiab != null && annCurrLiab > 0
              ? `${(annCurrAssets / annCurrLiab).toFixed(2)}x` : null
            const retEarningsFmt = annRetEarnings != null ? (() => {
              const v = annRetEarnings
              return Math.abs(v) >= 1e9 ? `$${(v/1e9).toFixed(1)}B` : Math.abs(v) >= 1e6 ? `$${(v/1e6).toFixed(0)}M` : null
            })() : null
            const repurchaseFmt = annBuybacks != null ? (() => {
              const v = annBuybacks
              return Math.abs(v) >= 1e9 ? `$${(v/1e9).toFixed(1)}B` : Math.abs(v) >= 1e6 ? `$${(v/1e6).toFixed(0)}M` : null
            })() : null

            // Sector-specific card
            const sector = selectedRow.primarySector || ''
            const sectorCard = (() => {
              const fmtM = v => v == null ? null : Math.abs(v) >= 1e9 ? `$${(v/1e9).toFixed(1)}B` : Math.abs(v) >= 1e6 ? `$${(v/1e6).toFixed(0)}M` : null
              const fmtX = (n, d) => n != null && d != null && d > 0 ? `${(n/d).toFixed(2)}x` : null
              const fmtPct = (n, d) => n != null && d != null && d > 0 ? `${(n/d*100).toFixed(1)}%` : null

              if (sector === 'Healthcare') {
                const annCashRaw = lastA(ann?.cash)
                const ltD = lastA(ann?.longTermDebt), stD = lastA(ann?.shortTermDebt)
                const totalDebtRaw = (ltD ?? 0) + (stD ?? 0)
                const netCash = annCashRaw != null ? annCashRaw - totalDebtRaw : null
                const qtrOcf = lastQ(qtr?.ocf)
                const burnPerQ = qtrOcf != null && qtrOcf < 0 ? Math.abs(qtrOcf) : null
                const runway = netCash != null && burnPerQ != null && burnPerQ > 0 ? `${(netCash / burnPerQ).toFixed(1)} qtrs` : netCash != null && netCash > 0 && burnPerQ == null ? '∞ (no burn)' : null
                const burnPctMktCap = burnPerQ != null && mktCap && mktCap > 0 ? `${(burnPerQ * 4 / (mktCap * 1e6) * 100).toFixed(1)}%/yr` : null
                const rdRev = fmtPct(annRd, annRev)
                const rdCash = annRd != null && annCashRaw && annCashRaw > 0 ? `${(annRd / annCashRaw * 100).toFixed(0)}%` : null
                return { title: 'Biotech / Health', color: '#f0fdf4', border: '#86efac', rows: [
                  ['Net Cash',       fmtM(netCash)],
                  ['Qtr Burn',       burnPerQ != null ? fmtM(-burnPerQ) : netCash != null ? 'Cash gen.' : null],
                  ['Runway',         runway],
                  ['Burn % Mkt Cap', burnPctMktCap],
                  ['R&D / Rev',      rdRev],
                  ['R&D / Cash',     rdCash],
                  ['Patent Cliff',   tenkData?.riskFactors ? (JSON.stringify(tenkData.riskFactors).toLowerCase().includes('patent') ? '⚠ See Risk §' : '—') : null],
                ]}
              }

              if (sector === 'Financial Services') {
                const rotce = annNetInc != null && annEquity != null && annGoodwill != null && (annEquity - annGoodwill) > 0
                  ? `${(annNetInc / (annEquity - annGoodwill) * 100).toFixed(1)}%` : null
                const effRatio = annNonIntExp != null && annNetInt != null && annRev != null
                  ? fmtPct(annNonIntExp, (annNetInt ?? 0) + annRev) : null
                const ldr = annLoans != null && annDeposits && annDeposits > 0 ? `${(annLoans / annDeposits * 100).toFixed(0)}%` : null
                const nim = annNetInt != null && annAssets && annAssets > 0 ? `${(annNetInt / annAssets * 100).toFixed(2)}%` : null
                return { title: 'Banking', color: '#fef9c3', border: '#fde047', rows: [
                  ['ROTCE',         rotce],
                  ['NIM (approx)',  nim],
                  ['Efficiency Ratio', effRatio],
                  ['Loan/Deposit',  ldr],
                  ['CET1 (approx)', annEquity != null && annGoodwill != null && annAssets && annAssets > 0 ? `${((annEquity - annGoodwill) / annAssets * 100).toFixed(1)}%` : null],
                  ['NPL Ratio',     null],
                ]}
              }

              if (sector === 'Real Estate') {
                const ffo = annNetInc != null && annDa != null ? annNetInc + annDa : null
                const ffoYield = ffo != null && mktCap && mktCap > 0 ? `${(ffo / (mktCap * 1e6) * 100).toFixed(1)}%` : null
                const affo = ffo != null && annCapex != null ? ffo - Math.abs(annCapex) : null
                return { title: 'REIT', color: '#fdf4ff', border: '#e879f9', rows: [
                  ['FFO (approx)',   fmtM(ffo)],
                  ['FFO Yield',      ffoYield],
                  ['AFFO (approx)', fmtM(affo)],
                  ['Debt/EBITDA',    ndEbitda],
                  ['Occ. Rate',      null],
                  ['Same-Store NOI', null],
                ]}
              }

              if (sector === 'Consumer Cyclical' || sector === 'Consumer Defensive') {
                const invTurnover = annInv != null && annCOGS && annCOGS > 0 ? `${(annCOGS / annInv).toFixed(1)}x` : null
                const invDays = annInv != null && annCOGS && annCOGS > 0 ? `${(annInv / annCOGS * 365).toFixed(0)}d` : null
                const sgaPct = annSga != null && annRev && annRev > 0 ? `${(annSga / annRev * 100).toFixed(1)}%` : null
                return { title: 'Retail / Consumer', color: '#fff7ed', border: '#fdba74', rows: [
                  ['Inv. Turnover',  invTurnover],
                  ['Inv. Days',      invDays],
                  ['SG&A / Rev',     sgaPct],
                  ['Gross Margin',   annGP != null && annRev ? `${(annGP/annRev*100).toFixed(1)}%` : null],
                  ['SSS Growth',     null],
                  ['Rev / Sq Ft',    null],
                ]}
              }

              if (sector === 'Technology' || sector === 'Communication Services') {
                const sgaPct = annSga != null && annRev && annRev > 0 ? `${(annSga / annRev * 100).toFixed(1)}%` : null
                const rpo = annRPO != null ? fmtM(annRPO) : null
                const rpoRev = annRPO != null && annRev && annRev > 0 ? `${(annRPO / annRev).toFixed(1)}x rev` : null
                const fcfM = annFcf != null && annRev && annRev > 0 ? `${(annFcf / annRev * 100).toFixed(1)}%` : null
                const r40 = revGr != null && fcfM != null ? `${(revGr + parseFloat(fcfM)).toFixed(0)}` : null
                return { title: 'Software / SaaS', color: '#eff6ff', border: '#93c5fd', rows: [
                  ['Rule of 40',    r40],
                  ['FCF Margin',    fcfM],
                  ['RPO',           rpo ?? null],
                  ['RPO / Rev',     rpoRev],
                  ['R&D Intensity', rdIntensity],
                  ['SG&A / Rev',    sgaPct],
                  ['NRR',           null],
                ]}
              }

              if (sector === 'Industrials') {
                const invTurnover = annInv != null && annCOGS && annCOGS > 0 ? `${(annCOGS / annInv).toFixed(1)}x` : null
                const assetTurn = annRev != null && annAssets && annAssets > 0 ? `${(annRev / annAssets).toFixed(2)}x` : null
                const capexDa = annCapex != null && annDa && annDa > 0 ? `${(Math.abs(annCapex) / annDa).toFixed(1)}x` : null
                return { title: 'Industrials', color: '#f8fafc', border: '#94a3b8', rows: [
                  ['ROIC',          roicFmt],
                  ['Asset Turnover',assetTurn],
                  ['Inv. Turnover', invTurnover],
                  ['Capex / D&A',   capexDa],
                  ['Book-to-Bill',  null],
                  ['Cap. Util.',    null],
                ]}
              }

              if (sector === 'Energy') {
                const capexOcf = annCapex != null && annOcf && annOcf > 0 ? `${(Math.abs(annCapex) / annOcf * 100).toFixed(0)}%` : null
                const daDda = annDa != null && annRev && annRev > 0 ? `${(annDa / annRev * 100).toFixed(1)}%` : null
                return { title: 'Energy', color: '#fefce8', border: '#fbbf24', rows: [
                  ['Debt/EBITDA',   ndEbitda],
                  ['Capex / OCF',   capexOcf],
                  ['DD&A / Rev',    daDda],
                  ['FCF Yield',     annFcf != null && mktCap && mktCap > 0 ? `${(annFcf/mktCap*100).toFixed(1)}%` : null],
                  ['BOE/Day Growth',null],
                  ['Breakeven Price',null],
                ]}
              }

              return null
            })()

            const cards = [
              {
                title: 'Valuation & Returns',
                color: '#e8f0fe', border: '#c7d5f5',
                rows: [
                  ['EV/Sales',       tev != null && annRev && annRev > 0 ? `${(tev/annRev).toFixed(2)}x` : null],
                  ['EV/Gross Profit', tev != null && annGP && annGP > 0 ? `${(tev/annGP).toFixed(2)}x` : null],
                  ['PEG (approx)',   pe != null && revGr != null && revGr > 0 ? `${(pe/revGr).toFixed(2)}x` : null],
                  ['FCF Yield',      annFcf != null && mktCap && mktCap > 0 ? `${(annFcf/mktCap*100).toFixed(1)}%` : null],
                  ['ROIC',           roicFmt],
                  ['WACC',           waccFmt],
                  ['ROIC vs WACC',   roicVsWacc],
                  ['Capital Intensity', capInt],
                ],
              },
              {
                title: 'Balance Sheet',
                color: '#f0fdf4', border: '#bbf7d0',
                rows: [
                  ['ND/EBITDA',      ndEbitda],
                  ['Int. Coverage',  intCoverage],
                  ['Debt Yield',     debtYield],
                  ['Current Ratio',  currentRatio],
                  ['Asset-Light',    assetLight],
                  ['PP&E Intensity', ppeIntensity],
                  ['Tang. Book Val', tbv],
                  ['Retained Earn.', retEarningsFmt],
                ],
              },
              {
                title: 'Capital Alloc.',
                color: '#fffbeb', border: '#fde68a',
                rows: [
                  ['FCF Yield',      annFcf != null && mktCap && mktCap > 0 ? `${(annFcf/mktCap*100).toFixed(1)}%` : null],
                  ['Capex % Rev',    annCapex != null && annRev && annRev > 0 ? `${(Math.abs(annCapex)/annRev*100).toFixed(1)}%` : null],
                  ['SBC % Rev',      sbcPct],
                  ['R&D Intensity',  rdIntensity],
                  ['Cash EBITDA',    cashEbitda],
                  ['Growth Capex',   growthCapex],
                  ['Div Yield',      snapshotData?.divYield != null ? `${snapshotData.divYield.toFixed(2)}%` : null],
                  ['Buyback Yield',  buybackYield],
                  ['Repurchases',    repurchaseFmt],
                ],
              },
              {
                title: 'Earnings Quality',
                color: '#fef2f2', border: '#fecaca',
                rows: [
                  ['DSO',            annRec != null && annRev && annRev > 0 ? `${(annRec/annRev*365).toFixed(0)}d` : null],
                  ['DIO',            annInv != null && annCOGS && annCOGS > 0 ? `${(annInv/annCOGS*365).toFixed(0)}d` : null],
                  ['DPO',            annPay != null && annCOGS && annCOGS > 0 ? `${(annPay/annCOGS*365).toFixed(0)}d` : null],
                  ['CCC', (() => {
                    const dso = annRec != null && annRev > 0 ? annRec/annRev*365 : null
                    const dio = annInv != null && annCOGS > 0 ? annInv/annCOGS*365 : null
                    const dpo = annPay != null && annCOGS > 0 ? annPay/annCOGS*365 : null
                    return dso != null && dio != null && dpo != null ? `${(dso+dio-dpo).toFixed(0)}d` : null
                  })()],
                  ['Unearned Rev %', unearned],
                  ['Rec. Quality',   recQuality],
                  ['Rev/Employee',   null],
                ],
              },
              {
                title: 'Estimates',
                color: '#f5f3ff', border: '#ddd6fe',
                rows: [
                  ['NTM Rev Est.',   null],
                  ['NTM EPS Est.',   null],
                  ['Est. Revision',  null],
                  ['# Revs Up/Dn',  null],
                  ['Cost to Borrow', null],
                ],
              },
              ...(sectorCard ? [sectorCard] : []),
            ]

            return (
              <div style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4 }}>
                  {cards.map(card => (
                    <div key={card.title} style={{ flex: '0 0 170px', background: card.color, border: `1px solid ${card.border}`, borderRadius: 8, padding: '8px 10px' }}>
                      <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#1a2b3c', marginBottom: 6 }}>{card.title}</div>
                      {card.rows.map(([label, val]) => row(label, val))}
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}

          {/* Charts Row: Waterfall | Rev | Net Inc | EBITDA | P/E | P/S | P/OCF | P/FCF */}
          {mounted && (
          <div style={{ marginTop: 4, marginBottom: 4 }}>
            <div className="detail-multiples-chart-title" style={{ marginBottom: 8 }}>Charts</div>
            <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 8, alignItems: 'stretch' }}>

              {/* 1. Compact P&L Waterfall card */}
              {(() => {
                const bars = buildWaterfallBars(selectedRow)
                const cardBase = { flex: '0 0 268px', minHeight: 168, background: '#f9f9f9', border: '1px solid #e8e8e8', borderRadius: 9, padding: '8px 10px', display: 'flex', flexDirection: 'column' }
                if (!bars) return <div style={cardBase}><div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#374151', marginBottom: 4 }}>P&L Flow</div><div className="detail-multiples-empty">No P&L data</div></div>
                const W=268, H=120, mL=28, mB=36, mT=10, mR=4
                const cW=W-mL-mR, cH=H-mT-mB, n=bars.length
                const bW=Math.min(24, Math.floor(cW/n*0.63))
                const sp=(cW-bW*n)/(n+1)
                const allY=bars.flatMap(b=>[b.from,b.to])
                const maxVal=Math.max(...allY), minVal=Math.min(0,...allY)
                const range=maxVal-minVal||1
                const yPx=v=>mT+cH-((v-minVal)/range)*cH
                const revenue=bars[0]?.to||1
                const ABBR={'Revenue':'Rev','- COGS':'COGS','Gross Profit':'GP','- OpEx':'OpEx','EBIT':'EBIT','+ D&A':'D&A','- Total Costs':'Costs','EBITDA':'EBDA','- Other':'Oth','Net Income':'Net'}
                const fV=v=>{const a=Math.abs(v);return a>=1000?`$${(v/1000).toFixed(0)}B`:`$${Math.round(v)}M`}
                const fAxis=v=>{const a=Math.abs(v);return a>=1000?`${(v/1000).toFixed(0)}B`:`${Math.round(v)}M`}
                const wTicks=[0, maxVal/2, maxVal].filter(t=>t!==0||minVal<0)
                if(minVal<0) wTicks.unshift(minVal)
                return (
                  <div style={{ ...cardBase, flex: '0 0 268px' }}>
                    <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#374151', marginBottom: 4 }}>P&L Flow {selectedRow.fyLabel ? `(${selectedRow.fyLabel})` : csvMode ? '(LTM)' : '(10-K)'}</div>
                    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block' }}>
                      {/* Y-axis */}
                      <line x1={mL} x2={mL} y1={mT} y2={mT+cH} stroke="#e5e7eb" strokeWidth="0.8"/>
                      {[0, maxVal/2, maxVal].map((tv,ti)=>(
                        <g key={ti}>
                          <line x1={mL-3} x2={mL} y1={yPx(tv)} y2={yPx(tv)} stroke="#d1d5db" strokeWidth="0.8"/>
                          <line x1={mL} x2={W-mR} y1={yPx(tv)} y2={yPx(tv)} stroke={tv===0?'#d1d5db':'#f3f4f6'} strokeWidth="0.6" strokeDasharray={tv===0?'':'2,2'}/>
                          <text x={mL-4} y={yPx(tv)+3} textAnchor="end" fontSize="6.5" fill="#9ca3af">{fAxis(tv)}</text>
                        </g>
                      ))}
                      {bars.map((bar,i)=>{
                        const x=mL+sp+i*(bW+sp)
                        const y1=yPx(bar.from), y2=yPx(bar.to)
                        const rectY=Math.min(y1,y2), rectH=Math.max(2,Math.abs(y1-y2))
                        const isSub=bar.label.startsWith('-')
                        const barVal=Math.abs(bar.to-bar.from)
                        const marginPct=Math.round(barVal/revenue*100)
                        const labelInside=rectH>=13
                        const valY=labelInside?rectY+rectH/2+3:Math.max(mT+9,rectY-3)
                        return (
                          <g key={i}>
                            <rect x={x} y={rectY} width={bW} height={rectH} fill={bar.color} rx="2" opacity={isSub?0.85:1}/>
                            <text x={x+bW/2} y={valY} textAnchor="middle" fontSize="6" fill={labelInside?'rgba(255,255,255,0.92)':bar.color} fontWeight="700">{fV(barVal)}</text>
                            <text x={x+bW/2} y={H-mB+11} textAnchor="middle" fontSize="7.5" fill={isSub?'#9ca3af':'#374151'} fontWeight={isSub?'normal':'600'}>{ABBR[bar.label]||bar.label}</text>
                            <text x={x+bW/2} y={H-mB+22} textAnchor="middle" fontSize="7" fill={isSub?'#c0c8d0':'#6b7280'}>{isSub?`(${marginPct}%)`:`${marginPct}%`}</text>
                          </g>
                        )
                      })}
                    </svg>
                  </div>
                )
              })()}

              {/* 2-4. Revenue / Net Income / EBITDA growth bar charts */}
              {[
                { key: 'revenue',   label: 'Revenue',   color: '#3b82f6' },
                { key: 'netIncome', label: 'Net Income', color: '#2a9d8f' },
                { key: 'ebitda',    label: 'EBITDA',     color: '#e76f51' },
              ].map(({ key, label, color }) => {
                const cardBase = { flex: '0 0 165px', minHeight: 168, background: '#f9f9f9', border: '1px solid #e8e8e8', borderRadius: 9, padding: '8px 10px', display: 'flex', flexDirection: 'column' }
                if (financialsLoading) return (
                  <div key={key} style={cardBase}>
                    <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#9ca3af', marginBottom: 4 }}>{label}</div>
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><div style={{ height: 2, width: '70%', background: '#eee', borderRadius: 2 }} /></div>
                  </div>
                )
                const series = financialsData?.trends?.[key]
                if (!series?.values?.length) return null
                const vals=series.values, labs=series.labels, n=vals.length
                const W=149, H=96, mL=30, mR=4, mT=12, mB=12
                const cW=W-mL-mR, cH=H-mT-mB
                const lo=Math.min(0,...vals), hi=Math.max(...vals), range=hi-lo||1
                const bW=Math.floor(cW/n*0.66), sp=(cW-bW*n)/(n+1)
                const yPx=v=>mT+cH-((v-lo)/range)*cH, zeroY=yPx(0)
                const latest=vals[n-1]
                const latestGrowth=n>=2&&vals[n-2]!==0?Math.round((latest-vals[n-2])/Math.abs(vals[n-2])*100):null
                const fV=v=>{const a=Math.abs(v);return a>=1e12?`$${(v/1e12).toFixed(1)}T`:a>=1e9?`$${(v/1e9).toFixed(1)}B`:a>=1e6?`$${(v/1e6).toFixed(0)}M`:'-'}
                const fAxis=v=>{const a=Math.abs(v);if(a>=1e12)return`${(v/1e12).toFixed(1)}T`;if(a>=1e9)return`${(v/1e9).toFixed(1)}B`;if(a>=1e6)return`${(v/1e6).toFixed(0)}M`;return String(Math.round(v))}
                const gCol=c=>c>0?'#15803d':c<0?'#be123c':'#9ca3af'
                // Y-axis ticks: 0, hi, and if lo<0 then lo too
                const yTicks = lo < 0 ? [lo, 0, hi] : [0, hi/2, hi]
                return (
                  <div key={key} style={cardBase}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 2 }}>
                      <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#374151' }}>{label}</span>
                      <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#1a2b3c' }}>{fV(latest)}</span>
                    </div>
                    {latestGrowth != null && <div style={{ fontSize: '0.68rem', fontWeight: 600, marginBottom: 2, color: gCol(latestGrowth) }}>{latestGrowth>0?'+':''}{latestGrowth}% YoY</div>}
                    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block' }}>
                      {/* Y-axis */}
                      <line x1={mL} x2={mL} y1={mT} y2={mT+cH} stroke="#e5e7eb" strokeWidth="0.8"/>
                      {yTicks.map((tv,ti)=>(
                        <g key={ti}>
                          <line x1={mL-3} x2={mL} y1={yPx(tv)} y2={yPx(tv)} stroke="#d1d5db" strokeWidth="0.8"/>
                          <line x1={mL} x2={W-mR} y1={yPx(tv)} y2={yPx(tv)} stroke={tv===0?'#d1d5db':'#f3f4f6'} strokeWidth={tv===0?'0.8':'0.5'} strokeDasharray={tv===0?'':'2,2'}/>
                          <text x={mL-4} y={yPx(tv)+3.5} textAnchor="end" fontSize="6.5" fill="#9ca3af">{fAxis(tv)}</text>
                        </g>
                      ))}
                      {vals.map((v,i)=>{
                        const x=mL+sp+i*(bW+sp)
                        const barY=Math.min(yPx(v),zeroY), barH=Math.max(1,Math.abs(yPx(v)-zeroY))
                        const growth=i>0&&vals[i-1]!==0?Math.round((v-vals[i-1])/Math.abs(vals[i-1])*100):null
                        return (
                          <g key={i}>
                            <rect x={x} y={barY} width={bW} height={barH} fill={i===n-1?color:color+'88'} rx="2"/>
                            {growth!=null&&barY>mT+8&&<text x={x+bW/2} y={Math.max(mT+7,barY-2)} textAnchor="middle" fontSize="6" fill={gCol(growth)} fontWeight="700">{growth>0?'+':''}{growth}%</text>}
                            <text x={x+bW/2} y={H-1} textAnchor="middle" fontSize="7" fill="#9ca3af">{labs[i].slice(2)}</text>
                          </g>
                        )
                      })}
                    </svg>
                  </div>
                )
              })}

              {/* 5-8. Historical multiples sparkline cards */}
              {(() => {
                const sectorPeers = data.filter(r =>
                  r.primarySector && r.primarySector === selectedRow.primarySector &&
                  (r.exchangeTicker||r.securityTickers) !== (selectedRow.exchangeTicker||selectedRow.securityTickers)
                )
                const median = arr => { const s=[...arr].sort((a,b)=>a-b); const m=Math.floor(s.length/2); return s.length%2?s[m]:(s[m-1]+s[m])/2 }
                const peerMedians = {}
                for (const [mk, field] of Object.entries({ pe:'pe', ps:'tevLtmRev' })) {
                  const pv = sectorPeers.map(r=>Number(r[field])).filter(v=>v>0&&v<500)
                  if (pv.length>=3) peerMedians[mk] = Math.round(median(pv)*100)/100
                }
                const cardSm = { flex:'0 0 158px', minHeight:168, background:'#f9f9f9', border:'1px solid #e8e8e8', borderRadius:9, padding:'8px 10px', display:'flex', flexDirection:'column' }
                const placeholder = (label, note) => (
                  <div key={label} style={cardSm}>
                    <div style={{ fontSize:'0.72rem', fontWeight:700, color:'#bbb', marginBottom:4 }}>{label}</div>
                    <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center' }}><div style={{ height:2, width:'70%', background:'#eee', borderRadius:2 }}/></div>
                    {note&&<div style={{ fontSize:'0.7rem', color:'#bbb', textAlign:'center', fontStyle:'italic', marginTop:2 }}>{note}</div>}
                  </div>
                )
                if (multiplesLoading) return ['P/E','P/S','P/OCF','P/FCF'].map(l=>placeholder(l,''))
                if (!multiplesData) return ['P/E','P/S','P/OCF','P/FCF'].map(l=>placeholder(l, multiplesError?'No SEC data':'Coming soon'))
                return Object.entries(multiplesData).map(([key, m]) => {
                  const vsColor=m.vsHistory==='expensive'?'#e76f51':m.vsHistory==='cheap'?'#2a9d8f':'#6b7280'
                  const vsBadge=m.vsHistory==='expensive'?'▲':m.vsHistory==='cheap'?'▼':'◆'
                  const peerMed=peerMedians[key]??null
                  const W=150, H=56, mL=22, mR=4, pad=4
                  const vals=m.values
                  const allV=peerMed!=null?[...vals,peerMed,m.avg]:vals
                  const lo=Math.min(...allV)*0.95, hi=Math.max(...allV)*1.05, rangeV=hi-lo||1
                  const x=i=>mL+(i/(vals.length-1))*(W-mL-mR)
                  const y=v=>pad+((hi-v)/rangeV)*(H-pad*2)
                  const pts=vals.map((v,i)=>`${x(i)},${y(v)}`).join(' ')
                  // Y-axis ticks: lo, avg, hi
                  const yTicks=[Math.round(lo*10)/10, Math.round(hi*10)/10]
                  return (
                    <div key={key} style={cardSm}>
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:2 }}>
                        <span style={{ fontSize:'0.72rem', fontWeight:700, color:'#555' }}>{m.label}</span>
                        <span style={{ fontSize:'0.8rem', fontWeight:700, color:'#1a2b3c' }}>{m.current.toFixed(1)}x</span>
                      </div>
                      <svg viewBox={`0 0 ${W} ${H}`} style={{ width:'100%', height:56, display:'block' }}>
                        {/* Y-axis */}
                        <line x1={mL} x2={mL} y1={pad} y2={H-pad} stroke="#e5e7eb" strokeWidth="0.7"/>
                        {yTicks.map((tv,ti)=>(
                          <g key={ti}>
                            <line x1={mL-2} x2={mL} y1={y(tv)} y2={y(tv)} stroke="#d1d5db" strokeWidth="0.7"/>
                            <text x={mL-3} y={y(tv)+3} textAnchor="end" fontSize="6" fill="#9ca3af">{tv}x</text>
                          </g>
                        ))}
                        {/* Grid lines */}
                        <line x1={mL} x2={W-mR} y1={y(m.avg)} y2={y(m.avg)} stroke="rgba(42,157,143,0.35)" strokeDasharray="3,2" strokeWidth="1"/>
                        {peerMed!=null&&<line x1={mL} x2={W-mR} y1={y(peerMed)} y2={y(peerMed)} stroke="rgba(234,88,12,0.4)" strokeDasharray="4,3" strokeWidth="1"/>}
                        {/* X-axis */}
                        <line x1={mL} x2={W-mR} y1={H-pad} y2={H-pad} stroke="#e5e7eb" strokeWidth="0.7"/>
                        <text x={x(0)} y={H} textAnchor="middle" fontSize="6" fill="#9ca3af">{m.labels[0]}</text>
                        <text x={x(vals.length-1)} y={H} textAnchor="middle" fontSize="6" fill="#9ca3af">{m.labels[m.labels.length-1]}</text>
                        <polyline points={pts} fill="none" stroke="#0066cc" strokeWidth="1.5" strokeLinejoin="round"/>
                        {vals.length>1&&<circle cx={x(vals.length-1)} cy={y(vals[vals.length-1])} r="2.5" fill="#0066cc"/>}
                      </svg>
                      <div style={{ fontSize:'0.68rem', color:'#888', marginTop:2, display:'flex', justifyContent:'space-between' }}>
                        <span><span style={{ color:'rgba(42,157,143,0.8)', fontWeight:600 }}>-</span> {m.avg.toFixed(1)}x avg</span>
                        <span style={{ color:vsColor, fontWeight:600 }}>{vsBadge} {m.vsHistory}</span>
                      </div>
                      {peerMed!=null&&<div style={{ fontSize:'0.68rem', color:'#bbb', marginTop:1 }}><span style={{ color:'rgba(234,88,12,0.7)', fontWeight:600 }}>-</span> {peerMed.toFixed(1)}x peer avg</div>}
                    </div>
                  )
                })
              })()}

              {/* Short Interest chart */}
              {snapshotData && (() => {
                const s = snapshotData
                const cardSm = { flex:'0 0 158px', minHeight:168, background:'#f9f9f9', border:'1px solid #e8e8e8', borderRadius:9, padding:'8px 10px', display:'flex', flexDirection:'column' }
                const pts = []
                if (s.shortPriorK != null && s.dateShortPrior) pts.push({ label: s.dateShortPrior.slice(0, 7), val: s.shortPriorK })
                if (s.shortSharesK != null && s.dateShortCurrent) pts.push({ label: s.dateShortCurrent.slice(0, 7), val: s.shortSharesK })
                if (pts.length === 0 && s.shortSharesK != null) pts.push({ label: 'Current', val: s.shortSharesK })
                if (pts.length === 0) return (
                  <div style={cardSm}>
                    <div style={{ fontSize:'0.72rem', fontWeight:700, color:'#555', marginBottom:4 }}>Short Interest</div>
                    <div className="detail-multiples-empty">No data</div>
                  </div>
                )
                const W=150, H=80, mL=28, mR=6, mT=10, mB=18
                const cW=W-mL-mR, cH=H-mT-mB
                const vals=pts.map(p=>p.val)
                const lo=Math.min(0,...vals)*0.95, hi=Math.max(...vals)*1.05, range=hi-lo||1
                const n=pts.length
                const bW=Math.max(16, Math.floor(cW/n*0.55)), sp=(cW-bW*n)/(n+1)
                const yPx=v=>mT+cH-((v-lo)/range)*cH
                const delta = pts.length>=2 ? ((pts[pts.length-1].val - pts[0].val) / (pts[0].val||1) * 100) : null
                const deltaColor = delta == null ? '#6b7280' : delta > 0 ? '#dc2626' : '#15803d'
                const fK = v => v >= 1e6 ? `${(v/1e6).toFixed(1)}B` : v >= 1e3 ? `${(v/1e3).toFixed(1)}M` : `${Math.round(v)}K`
                return (
                  <div style={cardSm}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:2 }}>
                      <span style={{ fontSize:'0.72rem', fontWeight:700, color:'#555' }}>Short Interest</span>
                      {s.shortPct != null && <span style={{ fontSize:'0.75rem', fontWeight:700, color: s.shortPct > 10 ? '#dc2626' : '#1a2b3c' }}>{s.shortPct.toFixed(1)}%</span>}
                    </div>
                    {delta != null && <div style={{ fontSize:'0.68rem', fontWeight:600, marginBottom:2, color:deltaColor }}>{delta>0?'+':''}{delta.toFixed(1)}% MoM</div>}
                    <svg viewBox={`0 0 ${W} ${H}`} style={{ width:'100%', display:'block', flex:1 }}>
                      <line x1={mL} x2={mL} y1={mT} y2={mT+cH} stroke="#e5e7eb" strokeWidth="0.8"/>
                      {[lo, hi].map((tv,ti)=>(
                        <g key={ti}>
                          <line x1={mL-3} x2={mL} y1={yPx(tv)} y2={yPx(tv)} stroke="#d1d5db" strokeWidth="0.7"/>
                          <text x={mL-4} y={yPx(tv)+3} textAnchor="end" fontSize="6" fill="#9ca3af">{fK(tv)}</text>
                        </g>
                      ))}
                      {pts.map((p,i)=>{
                        const x=mL+sp+i*(bW+sp)
                        const barTop=yPx(p.val), barH=Math.max(2,yPx(lo)-barTop)
                        const isLast=i===pts.length-1
                        const barColor=isLast?(delta>0?'#ef4444':delta<0?'#22c55e':'#6b7280'):'#d1d5db'
                        return (
                          <g key={i}>
                            <rect x={x} y={barTop} width={bW} height={barH} fill={barColor} rx="2"/>
                            <text x={x+bW/2} y={H-2} textAnchor="middle" fontSize="6" fill="#9ca3af">{p.label.slice(2)}</text>
                          </g>
                        )
                      })}
                    </svg>
                    {s.daysToCover != null && <div style={{ fontSize:'0.67rem', color:'#9ca3af', marginTop:2 }}>DTC: {s.daysToCover.toFixed(1)}d</div>}
                  </div>
                )
              })()}

            </div>
          </div>
          )}

          {/* Quality of Earnings table + mini charts */}
          {(() => {
            const QOE_METRICS = [
              { key: 'cashConversion', label: 'Cash Conv.', color: '#2563eb', unit: 'x', desc: 'OCF / Net Income' },
              { key: 'fcfMargin',      label: 'FCF Margin',  color: '#15803d', unit: '%', desc: 'FCF / Revenue' },
              { key: 'netMargin',      label: 'Net Margin',  color: '#7c3aed', unit: '%', desc: 'NI / Revenue' },
              { key: 'ocfMargin',      label: 'OCF Margin',  color: '#d97706', unit: '%', desc: 'OCF / Revenue' },
              { key: 'accrualsRatio',  label: 'Accruals',    color: '#dc2626', unit: '%', desc: '(NI−OCF) / Assets' },
            ]
            const pts = qualityOfEarnings?.points ? [...qualityOfEarnings.points].reverse() : []
            const qual = qualityOfEarnings?.conclusion?.quality
            const qualColor = qual === 'high' ? '#15803d' : qual === 'low' ? '#dc2626' : '#d97706'

            const MiniChart = ({ metric }) => {
              const W = 165, H = 96, mL = 28, mR = 4, pad = 6
              const vals = pts.map(p => {
                const v = p[metric.key]
                return v != null ? (metric.unit === '%' ? v * 100 : v) : null
              })
              const valid = vals.filter(v => v != null)
              if (!valid.length) return null
              const rawLo = Math.min(...valid)
              const rawHi = Math.max(...valid, metric.key === 'cashConversion' ? 1.2 : 0.05)
              const rangePad = (rawHi - rawLo) * 0.12 || 0.1
              const lo = rawLo - rangePad, hi = rawHi + rangePad
              const rng = hi - lo || 1
              const x = i => mL + (pts.length <= 1 ? (W - mL - mR) / 2 : (i / (pts.length - 1)) * (W - mL - mR))
              const y = v => pad + ((hi - v) / rng) * (H - pad * 2)
              const pStr = vals.map((v, i) => v != null ? `${x(i).toFixed(1)},${y(v).toFixed(1)}` : null).filter(Boolean).join(' ')
              const last = valid[valid.length - 1]
              const prev = valid.length > 1 ? valid[valid.length - 2] : null
              const lastIdx = vals.reduce((acc, v, i) => v != null ? i : acc, 0)
              const trendDir = prev != null ? (last > prev ? 1 : last < prev ? -1 : 0) : null
              const isGood = metric.key === 'accrualsRatio' ? trendDir === -1 : trendDir === 1
              const trendColor = trendDir === null ? '#9ca3af' : isGood ? '#15803d' : '#dc2626'
              const fmt = v => metric.unit === 'x' ? v.toFixed(2) + 'x' : v.toFixed(1) + '%'
              return (
                <div style={{ flex: '0 0 165px', minHeight: 168, background: '#fff', border: '1px solid #e8e8e8', borderRadius: 9, padding: '8px 10px', display: 'flex', flexDirection: 'column' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 2 }}>
                    <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#374151' }}>{metric.label}</span>
                    <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#1a2b3c' }}>{fmt(last)}</span>
                  </div>
                  <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 96, display: 'block' }}>
                    <line x1={mL} x2={mL} y1={pad} y2={H - pad} stroke="#e5e7eb" strokeWidth="0.7"/>
                    <line x1={mL - 2} x2={mL} y1={y(rawLo)} y2={y(rawLo)} stroke="#d1d5db" strokeWidth="0.7"/>
                    <text x={mL - 3} y={y(rawLo) + 3} textAnchor="end" fontSize="6" fill="#9ca3af">{fmt(rawLo)}</text>
                    <line x1={mL - 2} x2={mL} y1={y(rawHi)} y2={y(rawHi)} stroke="#d1d5db" strokeWidth="0.7"/>
                    <text x={mL - 3} y={y(rawHi) + 3} textAnchor="end" fontSize="6" fill="#9ca3af">{fmt(rawHi)}</text>
                    {lo < 0 && hi > 0 && <line x1={mL} x2={W - mR} y1={y(0)} y2={y(0)} stroke="#e5e7eb" strokeWidth="0.8" strokeDasharray="2,2"/>}
                    <line x1={mL} x2={W - mR} y1={H - pad} y2={H - pad} stroke="#e5e7eb" strokeWidth="0.7"/>
                    {pts.length > 0 && <text x={x(0)} y={H} textAnchor="middle" fontSize="6" fill="#9ca3af">{pts[0]?.label?.replace('FY', '')}</text>}
                    {pts.length > 1 && <text x={x(pts.length - 1)} y={H} textAnchor="middle" fontSize="6" fill="#9ca3af">{pts[pts.length - 1]?.label?.replace('FY', '')}</text>}
                    {pStr && <polygon points={`${x(0)},${H - pad} ${pStr} ${x(pts.length - 1)},${H - pad}`} fill={metric.color} fillOpacity="0.08"/>}
                    {pStr && <polyline points={pStr} fill="none" stroke={metric.color} strokeWidth="1.5" strokeLinejoin="round"/>}
                    {valid.length > 0 && <circle cx={x(lastIdx)} cy={y(last)} r="2.5" fill={metric.color}/>}
                  </svg>
                  <div style={{ fontSize: '0.68rem', color: '#6b7280', marginTop: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: '#9ca3af', fontSize: '0.6rem', fontStyle: 'italic' }}>{metric.desc}</span>
                    {trendDir !== null && <span style={{ color: trendColor, fontWeight: 700 }}>{trendDir > 0 ? '▲' : trendDir < 0 ? '▼' : '◆'}</span>}
                  </div>
                </div>
              )
            }

            const qoeRow = (label, val, good, bad, fmt) => {
              if (val == null) return (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: '1px solid #f3f4f6' }}>
                  <span style={{ fontSize: '0.73rem', color: '#6b7280' }}>{label}</span>
                  <span style={{ fontSize: '0.7rem', color: '#d1d5db' }}>⏱ coming soon</span>
                </div>
              )
              const color = good(val) ? '#2a9d8f' : bad(val) ? '#e76f51' : '#f59e0b'
              return (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: '1px solid #f3f4f6' }}>
                  <span style={{ fontSize: '0.73rem', color: '#374151' }}>{label}</span>
                  <span style={{ fontSize: '0.73rem', fontWeight: 600, color }}>● {fmt(val)}</span>
                </div>
              )
            }

            return (
              <div style={{ marginTop: 4, marginBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <div className="detail-multiples-chart-title" style={{ marginBottom: 0 }}>Quality of Earnings</div>
                  {qualityOfEarnings?.conclusion && (
                    <span style={{ fontSize: '0.67rem', fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: qual === 'high' ? '#d1fae5' : qual === 'low' ? '#fee2e2' : '#fef3c7', color: qualColor }}>
                      {qualityOfEarnings.conclusion.verdict}
                    </span>
                  )}
                </div>
                {qualityOfEarningsLoading && <div className="detail-multiples-empty">Loading…</div>}
                {/* Mini trend charts + snapshot */}
                {!qualityOfEarningsLoading && (pts.length > 0 || qoe) && (
                  <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 8, alignItems: 'stretch' }}>
                    {pts.length > 0 && QOE_METRICS.map(m => <MiniChart key={m.key} metric={m} />)}
                    {/* Snapshot metrics card */}
                    {qoe && (
                      <div style={{ flex: '0 0 180px', flexShrink: 0, background: '#f9f9f9', border: '1px solid #e8e8e8', borderRadius: 9, padding: '8px 10px', display: 'flex', flexDirection: 'column', justifyContent: 'flex-start' }}>
                        <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#374151', marginBottom: 6 }}>QoE Snapshot</div>
                        {qoeRow('FCF Conversion', qoe.fcfConversion, v => v >= 0.9, v => v < 0.6, v => v.toFixed(2))}
                        {qoeRow('Accruals Ratio', qoe.accrualsRatio, v => Math.abs(v) < 0.05, v => v > 0.1, v => v.toFixed(3))}
                        {qoeRow('SBC % of NI', qoe.sbcPct, v => v < 15, v => v > 30, v => `${v.toFixed(1)}%`)}
                        {qoeRow('Deferred Rev %', qoe.deferredPct, v => v > 5, v => false, v => `${v.toFixed(1)}%`)}
                        {qoeRow('Audit Opinion', null, () => false, () => false, v => v)}
                      </div>
                    )}
                  </div>
                )}

                {/* Analysis text */}
                {!qualityOfEarningsLoading && qualityOfEarnings?.conclusion?.text && (
                  <div style={{ marginTop: 10, background: qual === 'high' ? '#f0fdf4' : qual === 'low' ? '#fef2f2' : '#fffbeb', border: `1px solid ${qual === 'high' ? '#bbf7d0' : qual === 'low' ? '#fecaca' : '#fde68a'}`, borderRadius: 8, padding: '10px 12px' }}>
                    <div style={{ fontSize: '0.67rem', fontWeight: 700, color: qualColor, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 5 }}>
                      Analysis - {qualityOfEarnings.conclusion.verdict} Quality Earnings
                    </div>
                    <div style={{ fontSize: '0.76rem', color: '#374151', lineHeight: 1.55 }}>
                      {qualityOfEarnings.conclusion.text}
                    </div>
                  </div>
                )}

                {!qualityOfEarningsLoading && !qualityOfEarnings && !qoe && (
                  <div className="detail-multiples-empty">No EDGAR data available</div>
                )}
              </div>
            )
          })()}

          {/* Earnings History + Last 8-K Highlights side by side */}
          <div style={{ marginBottom: 16, display: 'flex', gap: 14, alignItems: 'flex-start' }}>
            {/* Left: 8-quarter earnings cards */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <div className="detail-multiples-chart-title" style={{ marginBottom: 0 }}>Earnings History</div>
                {detailEarnings?.streak && (
                  <span style={{
                    fontSize: '0.67rem', fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                    background: detailEarnings.streak.dir === 'beat' ? '#d1fae5' : '#fee2e2',
                    color: detailEarnings.streak.dir === 'beat' ? '#065f46' : '#991b1b',
                  }}>
                    {detailEarnings.streak.count}Q {detailEarnings.streak.dir === 'beat' ? 'beat streak' : 'miss streak'}
                  </span>
                )}
              </div>
              {!detailEarnings && <div className="detail-multiples-empty">…</div>}
              {detailEarnings?.history?.length === 0 && <div className="detail-multiples-empty">No history available</div>}
              {detailEarnings?.history?.length > 0 && (
                <div style={{ display: 'flex', gap: 7, overflowX: 'auto', paddingBottom: 4 }}>
                  {detailEarnings.history.slice(0, 8).reverse().map((q, i) => {
                    const isBeat = q.beatMiss === 'beat'
                    const isMiss = q.beatMiss === 'miss'
                    const cardBorder = isBeat ? '#bbf7d0' : isMiss ? '#fecaca' : '#e5e5e5'
                    const cardBg = isBeat ? '#f0fdf4' : isMiss ? '#fff5f5' : '#f9f9f9'
                    return (
                      <div key={i} style={{
                        border: `1px solid ${cardBorder}`, background: cardBg,
                        borderRadius: 9, padding: '8px 10px', minWidth: 120, flexShrink: 0,
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                          <span style={{ fontWeight: 700, color: '#1a2b3c', fontSize: '0.77rem' }}>{q.quarter}</span>
                          <span style={{
                            fontSize: '0.68rem', fontWeight: 700, padding: '1px 5px', borderRadius: 4,
                            background: isBeat ? '#d1fae5' : isMiss ? '#fee2e2' : '#f3f4f6',
                            color: isBeat ? '#065f46' : isMiss ? '#991b1b' : '#9ca3af',
                            textTransform: 'uppercase',
                          }}>
                            {q.beatMiss || '-'}
                          </span>
                        </div>
                        <div style={{ borderTop: '1px solid #e8e8e8', paddingTop: 4, marginBottom: 4 }}>
                          <div style={{ fontSize: '0.6rem', fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 1 }}>Revenue</div>
                          <strong style={{ color: '#1a2b3c', fontSize: '0.73rem' }}>{q.revenue || '-'}</strong>
                        </div>
                        <div style={{ borderTop: '1px solid #e8e8e8', paddingTop: 4, marginBottom: 4 }}>
                          <div style={{ fontSize: '0.6rem', fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 1 }}>Net Inc</div>
                          <strong style={{ color: '#1a2b3c', fontSize: '0.73rem' }}>{q.netIncome || '-'}</strong>
                        </div>
                        <div style={{ borderTop: '1px solid #e8e8e8', paddingTop: 4, marginBottom: 4 }}>
                          <div style={{ fontSize: '0.6rem', fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 1 }}>EPS</div>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                            <strong style={{ color: '#1a2b3c', fontSize: '0.73rem' }}>{q.eps != null ? `$${q.eps.toFixed(2)}` : '-'}</strong>
                            {q.epsEstimate != null && (
                              <span style={{ color: '#9ca3af', fontSize: '0.6rem' }}>est ${q.epsEstimate.toFixed(2)}</span>
                            )}
                          </div>
                        </div>
                        <div style={{ borderTop: '1px solid #e8e8e8', paddingTop: 4 }}>
                          <div style={{ fontSize: '0.6rem', fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 1 }}>Surprise</div>
                          <strong style={{ color: isBeat ? '#15803d' : isMiss ? '#dc2626' : '#9ca3af', fontSize: '0.73rem' }}>
                            {q.surprise != null
                              ? `${q.surprise >= 0 ? '+' : ''}${q.surprise.toFixed(2)} (${q.surprisePct >= 0 ? '+' : ''}${q.surprisePct?.toFixed(1)}%)`
                              : '-'}
                          </strong>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Right: last 8-K highlights + guidance */}
            <div style={{ flex: '0 0 250px', minWidth: 210 }}>
              <div className="detail-multiples-chart-title" style={{ marginBottom: 8 }}>
                Last Earnings Release
                {earningsCall?.filingDate && (
                  <span style={{ fontSize: '0.66rem', fontWeight: 400, color: '#9ca3af', marginLeft: 6 }}>{earningsCall.filingDate}</span>
                )}
              </div>
              {earningsCallLoading && <div className="detail-multiples-empty">Loading…</div>}
              {!earningsCallLoading && earningsCall && (
                <div>
                  {earningsCall.guidance?.length > 0 && (
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: '0.63rem', fontWeight: 700, color: '#2563eb', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>Guidance</div>
                      {earningsCall.guidance.map((s, i) => (
                        <div key={i} style={{ fontSize: '0.72rem', color: '#374151', lineHeight: 1.4, marginBottom: 4, paddingLeft: 8, borderLeft: '2px solid #c7dcf7' }}>
                          {s.length > 200 ? s.slice(0, 197) + '…' : s}
                        </div>
                      ))}
                    </div>
                  )}
                  {earningsCall.highlights?.length > 0 && (
                    <div>
                      <div style={{ fontSize: '0.63rem', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>Key Topics</div>
                      {earningsCall.highlights.slice(0, 4).map((s, i) => (
                        <div key={i} style={{ fontSize: '0.71rem', color: '#6b7280', lineHeight: 1.4, marginBottom: 4, display: 'flex', gap: 5, alignItems: 'flex-start' }}>
                          <span style={{ color: '#9ca3af', flexShrink: 0 }}>•</span>
                          <span>{s.length > 180 ? s.slice(0, 177) + '…' : s}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {(!earningsCall.guidance?.length && !earningsCall.highlights?.length) && (
                    <div className="detail-multiples-empty">No 8-K press release text found</div>
                  )}
                </div>
              )}
              {!earningsCallLoading && !earningsCall && (
                <div className="detail-multiples-empty">…</div>
              )}
            </div>
          </div>

          {/* Earnings Call Analysis - 8 Signal Categories */}
          <div style={{ marginBottom: 16 }}>
            <div className="detail-multiples-chart-title" style={{ marginBottom: 10 }}>Earnings Call Analysis</div>
            {earningsSignalsLoading && <div className="detail-multiples-empty">Analyzing 8-K filings…</div>}
            {!earningsSignalsLoading && earningsSignals && (() => {
              const latest = earningsSignals.quarters?.[0]
              const SIGNAL_LABEL = { fontSize: '0.65rem', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }
              const COMING_SOON = <span style={{ fontSize: '0.75rem', color: '#9ca3af', fontStyle: 'italic' }}>Coming soon</span>
              const CARD = { border: '1px solid #e5e7eb', borderRadius: 9, padding: '10px 12px', background: '#fafafa', marginBottom: 10 }

              return (
                <div>
                  {/* Signal 1 + 2: Guidance Numbers + Qualitative Tone - side by side */}
                  <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>

                    {/* Signal 1: Guidance - Numbers */}
                    <div style={{ ...CARD, flex: 2, marginBottom: 0 }}>
                      <div style={SIGNAL_LABEL}>1. Guidance - Numbers (most recent quarter)</div>
                      {!latest?.guidance?.length
                        ? <div style={{ fontSize: '0.74rem', color: '#9ca3af', fontStyle: 'italic' }}>No numeric guidance found in 8-K</div>
                        : latest.guidance.map((g, i) => (
                          <div key={i} style={{ fontSize: '0.71rem', color: '#374151', lineHeight: 1.45, marginBottom: 6, paddingLeft: 8, borderLeft: '2px solid #93c5fd' }}>
                            {g.sentence}
                            {g.numbers.length > 0 && (
                              <div style={{ marginTop: 2, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                {g.numbers.map((n, j) => (
                                  <span key={j} style={{ fontSize: '0.65rem', fontWeight: 700, background: '#dbeafe', color: '#1d4ed8', padding: '1px 5px', borderRadius: 4 }}>{n}</span>
                                ))}
                              </div>
                            )}
                          </div>
                        ))
                      }
                    </div>

                    {/* Signal 2: Qualitative Tone */}
                    <div style={{ ...CARD, flex: 1, marginBottom: 0 }}>
                      <div style={SIGNAL_LABEL}>2. Qualitative Tone</div>
                      {!latest?.tone
                        ? COMING_SOON
                        : (() => {
                          const t = latest.tone
                          const total = t.bull + t.bear || 1
                          return (
                            <div>
                              <div style={{ display: 'flex', height: 12, borderRadius: 6, overflow: 'hidden', marginBottom: 6 }}>
                                <div style={{ width: `${t.bullPct}%`, background: '#2a9d8f' }} />
                                <div style={{ width: `${t.bearPct}%`, background: '#e76f51' }} />
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ fontSize: '0.68rem', color: '#15803d', fontWeight: 700 }}>Bullish {t.bullPct}% ({t.bull})</span>
                                <span style={{ fontSize: '0.68rem', color: '#dc2626', fontWeight: 700 }}>Bearish {t.bearPct}% ({t.bear})</span>
                              </div>
                              <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                {earningsSignals.quarters?.slice(0, 4).map((q, i) => {
                                  const qT = q.tone
                                  if (!qT) return null
                                  const net = qT.bull - qT.bear
                                  const isPos = net >= 0
                                  return (
                                    <div key={i} style={{ textAlign: 'center' }}>
                                      <div style={{ fontSize: '0.68rem', color: '#9ca3af' }}>{q.date?.slice(0, 7)}</div>
                                      <div style={{ fontSize: '0.68rem', fontWeight: 700, color: isPos ? '#16a34a' : '#dc2626' }}>{isPos ? '+' : ''}{net}</div>
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          )
                        })()
                      }
                    </div>
                  </div>

                  {/* Signal 3 + 4 + 5: Topic Frequency | Analyst Qs | Management Deflection */}
                  <div style={{ display: 'flex', gap: 10, marginBottom: 10, alignItems: 'flex-start' }}>
                    <div style={{ ...CARD, flex: 1, minWidth: 0, marginBottom: 0 }}>
                      <div style={SIGNAL_LABEL}>3. Topic Frequency (keyword mentions across recent quarters)</div>
                      {!earningsSignals.quarters?.length
                        ? COMING_SOON
                        : (() => {
                          const topics = Object.keys(earningsSignals.quarters[0]?.topics || {})
                          if (!topics.length) return COMING_SOON
                          return (
                            <div style={{ overflowX: 'auto' }}>
                              <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.65rem' }}>
                                <thead>
                                  <tr>
                                    <th style={{ textAlign: 'left', color: '#9ca3af', fontWeight: 600, padding: '3px 6px', borderBottom: '1px solid #e5e7eb', width: 70 }}>Topic</th>
                                    {earningsSignals.quarters.slice(0, 2).map((q, i) => (
                                      <th key={i} style={{ textAlign: 'center', color: '#9ca3af', fontWeight: 600, padding: '3px 4px', borderBottom: '1px solid #e5e7eb', minWidth: 36 }}>
                                        {q.date?.slice(0, 7)}
                                      </th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {topics.map(topic => (
                                    <tr key={topic}>
                                      <td style={{ padding: '3px 6px', fontWeight: 600, color: '#374151', borderBottom: '1px solid #f3f4f6' }}>{topic}</td>
                                      {earningsSignals.quarters.slice(0, 2).map((q, i) => {
                                        const count = q.topics?.[topic] || 0
                                        const heat = count === 0 ? '#f9fafb' : count <= 2 ? '#fef3c7' : count <= 5 ? '#fde68a' : '#fbbf24'
                                        return (
                                          <td key={i} style={{ textAlign: 'center', padding: '3px 4px', background: heat, color: count === 0 ? '#d1d5db' : '#92400e', fontWeight: count > 0 ? 700 : 400, borderBottom: '1px solid #f3f4f6', borderRadius: 4 }}>
                                            {count || '-'}
                                          </td>
                                        )
                                      })}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )
                        })()
                      }
                    </div>
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <div style={{ ...CARD, marginBottom: 0 }}>
                        <div style={SIGNAL_LABEL}>4. Analyst Questions</div>
                        {COMING_SOON}
                        <div style={{ fontSize: '0.65rem', color: '#d1d5db', marginTop: 4 }}>Requires full call transcript</div>
                      </div>
                      <div style={{ ...CARD, marginBottom: 0 }}>
                        <div style={SIGNAL_LABEL}>5. Management Deflection Signals</div>
                        {COMING_SOON}
                        <div style={{ fontSize: '0.65rem', color: '#d1d5db', marginTop: 4 }}>Requires full call transcript</div>
                      </div>
                    </div>
                  </div>

                  {/* Signal 6: New / Disappeared Language */}
                  <div style={CARD}>
                    <div style={SIGNAL_LABEL}>6. New / Disappeared Language (vs prior 4 quarters)</div>
                    {!latest?.language
                      ? COMING_SOON
                      : (() => {
                        const lang = latest.language
                        return (
                          <div style={{ display: 'flex', gap: 16 }}>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: '0.69rem', fontWeight: 700, color: '#15803d', textTransform: 'uppercase', marginBottom: 4 }}>New this quarter</div>
                              {lang.newPhrases.length === 0
                                ? <div style={{ fontSize: '0.7rem', color: '#9ca3af' }}>No standout new phrases</div>
                                : lang.newPhrases.slice(0, 5).map((p, i) => (
                                  <div key={i} style={{ fontSize: '0.7rem', color: '#374151', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 4, padding: '2px 6px', marginBottom: 3 }}>"{p}"</div>
                                ))
                              }
                            </div>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: '0.69rem', fontWeight: 700, color: '#dc2626', textTransform: 'uppercase', marginBottom: 4 }}>Dropped from language</div>
                              {lang.droppedPhrases.length === 0
                                ? <div style={{ fontSize: '0.7rem', color: '#9ca3af' }}>No phrases notably dropped</div>
                                : lang.droppedPhrases.slice(0, 5).map((p, i) => (
                                  <div key={i} style={{ fontSize: '0.7rem', color: '#374151', background: '#fff5f5', border: '1px solid #fecaca', borderRadius: 4, padding: '2px 6px', marginBottom: 3 }}>"{p}"</div>
                                ))
                              }
                            </div>
                          </div>
                        )
                      })()
                    }
                  </div>

                </div>
              )
            })()}
            {!earningsSignalsLoading && !earningsSignals && (
              <div className="detail-multiples-empty">No 8-K filings found for analysis</div>
            )}
          </div>

          <div className="detail-multiples-chart-title" style={{ marginBottom: 8 }}>Industry</div>

          {/* Industry panel — multi-row expanded */}
          <div style={{ marginBottom: 14, background: '#f5f8ff', border: '1px solid #dde8f7', borderRadius: 10, padding: '14px 16px' }}>

            {/* ── Row 1: Identity · TAM · Market Char · Multiples ── */}
            <div style={{ display: 'flex', gap: 0, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 14 }}>
              {/* Industry name */}
              <div style={{ paddingRight: 20, flexShrink: 0 }}>
                <div style={{ fontSize: '0.6rem', color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>Industry</div>
                <div style={{ fontSize: '0.88rem', fontWeight: 700, color: '#1a2b3c', whiteSpace: 'nowrap' }}>
                  {selectedRow.primaryIndustry || selectedRow.primarySector || '-'}
                </div>
                {selectedRow.primaryIndustry && selectedRow.primarySector && selectedRow.primaryIndustry !== selectedRow.primarySector && (
                  <div style={{ fontSize: '0.7rem', color: '#6b7280', marginTop: 1 }}>{selectedRow.primarySector}</div>
                )}
              </div>

              {/* TAM + Market Share inline */}
              {(() => {
                const tamInfo = INDUSTRY_TAM[selectedRow.primaryIndustry] || SECTOR_TAM[selectedRow.primarySector]
                const share = competitorsData?.revenueShare
                if (!tamInfo && share == null) return null
                return (
                  <div style={{ borderLeft: '1px solid #c7d9f0', paddingLeft: 16, paddingRight: 20, flexShrink: 0, display: 'flex', alignItems: 'flex-start', gap: 16 }}>
                    {tamInfo && (
                      <div>
                        <div style={{ fontSize: '0.6rem', color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>TAM</div>
                        <div style={{ fontSize: '0.88rem', fontWeight: 700, color: '#1a2b3c', whiteSpace: 'nowrap' }}>
                          {tamInfo.tam}
                        </div>
                        {tamInfo.cagr && <div style={{ fontSize: '0.75rem', color: '#2a9d8f', fontWeight: 700, marginTop: 1 }}>{tamInfo.cagr} CAGR</div>}
                        <div style={{ fontSize: '0.67rem', color: '#9ca3af', marginTop: 1 }}>{tamInfo.note}</div>
                      </div>
                    )}
                    {share != null && mounted && (() => {
                      const compRevGrowth = financialsData?.snapshot?.revGrowth
                      const peerGrowths = competitorsData.peers?.filter(p => p.revGrowth != null).map(p => p.revGrowth).sort((a,b)=>a-b) ?? []
                      const medPeerGrowth = peerGrowths.length ? peerGrowths[Math.floor(peerGrowths.length / 2)] : null
                      const shareDelta = compRevGrowth != null && medPeerGrowth != null ? compRevGrowth - medPeerGrowth : null
                      const R = 22, circ = 2 * Math.PI * R
                      return (
                        <div style={{ flexShrink: 0, textAlign: 'center', borderLeft: tamInfo ? '1px solid #e5e7eb' : 'none', paddingLeft: tamInfo ? 16 : 0 }}>
                          <div style={{ fontSize: '0.6rem', color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Mkt Share</div>
                          <svg width="56" height="56" viewBox="0 0 56 56" style={{ display: 'block', margin: '0 auto' }}>
                            <circle cx="28" cy="28" r={R} fill="none" stroke="#e5e7eb" strokeWidth="9"/>
                            <circle cx="28" cy="28" r={R} fill="none" stroke="#3b82f6" strokeWidth="9"
                              strokeDasharray={`${(share / 100) * circ} ${circ}`}
                              transform="rotate(-90 28 28)"
                              strokeLinecap="round"
                            />
                            <text x="28" y="33" textAnchor="middle" fontSize="11" fontWeight="700" fill="#1a2b3c">{share}%</text>
                          </svg>
                          {shareDelta != null && (
                            <div style={{ fontSize: '0.69rem', fontWeight: 600, color: shareDelta > 0 ? '#15803d' : '#be123c', marginTop: 2 }}>
                              {shareDelta > 0 ? '▲' : '▼'} {Math.abs(shareDelta).toFixed(1)}pp
                            </div>
                          )}
                        </div>
                      )
                    })()}
                  </div>
                )
              })()}

              {/* Market Characteristics */}
              {(tenkLoading || tenkData?.marketChar) && (() => {
                const mc = tenkData?.marketChar
                if (!mc && !tenkLoading) return null
                const cycColor = c => c === 'High' ? '#e76f51' : c === 'Moderate' ? '#f59e0b' : '#2a9d8f'
                if (tenkLoading) return <div style={{ borderLeft: '1px solid #c7d9f0', paddingLeft: 16, fontSize: '0.68rem', color: '#9ca3af' }}>Loading…</div>
                return (
                  <div style={{ borderLeft: '1px solid #c7d9f0', paddingLeft: 16, paddingRight: 20, flexShrink: 0, maxWidth: 300 }}>
                    <div style={{ fontSize: '0.6rem', color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Market Characteristics</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <div style={{ fontSize: '0.7rem' }}>
                        <span style={{ color: '#9ca3af' }}>Cyclicality: </span>
                        <span style={{ color: cycColor(mc.cyclicality), fontWeight: 700 }}>{mc.cyclicality || '?'}</span>
                      </div>
                      {mc.cyclicalEvidence && (
                        <div style={{ fontSize: '0.69rem', color: '#9ca3af', fontStyle: 'italic', lineHeight: 1.4, marginTop: 1 }}>
                          {mc.cyclicalEvidence.length > 120 ? mc.cyclicalEvidence.slice(0, 120) + '…' : mc.cyclicalEvidence}
                        </div>
                      )}
                      {mc.customerType?.length > 0 && (
                        <div style={{ fontSize: '0.7rem', marginTop: 2 }}>
                          <span style={{ color: '#9ca3af' }}>Customers: </span>
                          <span style={{ color: '#374151', fontWeight: 600 }}>{mc.customerType.join(' · ')}</span>
                        </div>
                      )}
                      <div style={{ fontSize: '0.7rem' }}>
                        <span style={{ color: '#9ca3af' }}>International: </span>
                        <span style={{ color: mc.international ? '#2a9d8f' : '#9ca3af', fontWeight: 600 }}>{mc.international ? 'Yes ✓' : 'Domestic'}</span>
                      </div>
                    </div>
                  </div>
                )
              })()}

              {/* Key multiples */}
              <div style={{ borderLeft: '1px solid #c7d9f0', paddingLeft: 16, flexShrink: 0 }}>
                <div style={{ fontSize: '0.6rem', color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Key Multiples</div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {(SECTOR_MULTIPLES[selectedRow.primarySector] || ['P/E', 'EV/EBITDA']).map(m => (
                    <span key={m} style={{ fontSize: '0.72rem', fontWeight: 600, background: '#e8f0fe', color: '#2563eb', padding: '3px 8px', borderRadius: 5, whiteSpace: 'nowrap' }}>{m}</span>
                  ))}
                </div>
              </div>
            </div>


          </div>

          {/* Competitive Landscape */}
          <div style={{ marginBottom: 16 }}>
            <div className="detail-multiples-chart-title" style={{ marginBottom: 10 }}>Competitive Landscape</div>

            <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>

              {/* Competitors table */}
              <div style={{ flex: 1, minWidth: 0 }}>
                {competitorsLoading && <div className="detail-multiples-empty">Loading…</div>}
                {!competitorsLoading && !competitorsData && <div className="detail-multiples-empty">No data</div>}
                {competitorsData && mounted && (() => {
                  const all = [competitorsData.company, ...(competitorsData.peers || [])].filter(Boolean)
                  const fB = v => v == null ? '-' : v >= 1e6 ? `$${(v/1e6).toFixed(1)}T` : v >= 1000 ? `$${(v/1000).toFixed(1)}B` : `$${Math.round(v)}M`
                  const fPct = v => v == null ? '-' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`
                  const fX = v => v == null ? '-' : `${v.toFixed(1)}x`
                  const selectedTicker = getTickerSymbol(selectedRow.exchangeTicker || selectedRow.securityTickers)
                  const metricTh = { padding: '3px 3px', textAlign: 'right', fontSize: '0.63rem', color: '#1a2b3c', fontWeight: 700, whiteSpace: 'nowrap', width: 54 }
                  const metricTd = { padding: '3px 3px', textAlign: 'right', width: 54, whiteSpace: 'nowrap' }
                  return (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.7rem' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid #e8e8e8' }}>
                          <th style={{ padding: '3px 5px', textAlign: 'left', fontSize: '0.63rem', color: '#1a2b3c', fontWeight: 700 }}>Comparable Competitors</th>
                          {['Mkt Cap', 'Revenue', 'Rev Gr.', 'P/E', 'Net Mgn'].map(h => (
                            <th key={h} style={metricTh}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {all.map((c, i) => {
                          const isSelf = c.ticker === selectedTicker
                          const revGrowthColor = c.revGrowth > 5 ? '#15803d' : c.revGrowth < 0 ? '#be123c' : '#374151'
                          return (
                            <tr key={c.ticker} style={{
                              background: isSelf ? '#eff6ff' : i % 2 === 0 ? '#fff' : '#fafafa',
                              borderBottom: '1px solid #f0f0f0',
                            }}>
                              <td style={{ padding: '3px 5px', whiteSpace: 'nowrap' }}>
                                <span style={{ fontWeight: isSelf ? 700 : 500, color: isSelf ? '#1d4ed8' : '#1a2b3c' }}>{c.ticker}</span>
                                <span style={{ color: '#9ca3af', marginLeft: 4, fontSize: '0.65rem' }}>{c.name?.split(' ').slice(0, 2).join(' ')}</span>
                              </td>
                              <td style={{ ...metricTd, fontWeight: 500 }}>{fB(c.marketCap)}</td>
                              <td style={metricTd}>{fB(c.revenue)}</td>
                              <td style={{ ...metricTd, color: revGrowthColor, fontWeight: 600 }}>{fPct(c.revGrowth)}</td>
                              <td style={metricTd}>{fX(c.pe)}</td>
                              <td style={metricTd}>{c.netMargin != null ? `${c.netMargin.toFixed(1)}%` : '-'}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  )
                })()}
              </div>

              {/* Porter's Five Forces — side by side with competitors */}
              {(tenkLoading || tenkData?.porter) && (() => {
                const p = tenkData?.porter
                const FORCES = [
                  { key: 'competition',   label: 'Competitive Rivalry' },
                  { key: 'newEntrants',   label: 'New Entrants' },
                  { key: 'supplierPower', label: 'Supplier Power' },
                  { key: 'buyerPower',    label: 'Buyer Power' },
                  { key: 'substitutes',   label: 'Substitutes' },
                ]
                const ratingColor = r => r === 'High' ? '#e76f51' : r === 'Medium' ? '#f59e0b' : '#2a9d8f'
                return (
                  <div style={{ flex: 1, minWidth: 0, background: '#f9f9f9', border: '1px solid #e8e8e8', borderRadius: 8, padding: '10px 12px', alignSelf: 'flex-start' }}>
                    <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#1a2b3c', marginBottom: 8 }}>
                      Porter's Five Forces <span style={{ fontWeight: 400, color: '#9ca3af', fontSize: '0.65rem' }}>from 10-K</span>
                    </div>
                    {tenkLoading && <div className="detail-multiples-empty">Loading 10-K…</div>}
                    {!tenkLoading && p && FORCES.map(({ key, label }) => {
                      const f = p[key]
                      if (!f) return null
                      return (
                        <div key={key} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '4px 0', borderBottom: '1px solid #f3f4f6' }}>
                          <span style={{ flex: '0 0 120px', fontSize: '0.72rem', color: '#374151', fontWeight: 500 }}>{label}</span>
                          <span style={{ flex: '0 0 44px', fontSize: '0.72rem', fontWeight: 700, color: ratingColor(f.rating) }}>{f.rating}</span>
                          {f.evidence && <span style={{ fontSize: '0.67rem', color: '#9ca3af', lineHeight: 1.4, flex: 1, overflow: 'hidden' }}>&ldquo;{f.evidence.slice(0, 100)}&rdquo;</span>}
                        </div>
                      )
                    })}
                  </div>
                )
              })()}

            </div>

            {/* Trading Activity */}
            {snapshotData && (() => {
              const s = snapshotData
              const stats = [
                s.adv3m != null ? { label: 'ADV (3M)', val: `${Math.round(s.adv3m * 1000).toLocaleString()} sh/day`, color: null } : null,
                s.shortPct != null ? { label: 'Short Interest', val: `${s.shortPct.toFixed(1)}%`, color: s.shortPct > 10 ? '#dc2626' : null } : null,
                s.daysToCover != null ? { label: 'Days to Cover', val: s.daysToCover.toFixed(1) + 'd', color: s.daysToCover > 10 ? '#dc2626' : null } : null,
                s.adv10d != null ? { label: 'ADV (10D)', val: `${Math.round(s.adv10d * 1000).toLocaleString()} sh/day`, color: null } : null,
                selectedRow?.ceoOwnedPct != null ? { label: 'CEO Ownership', val: `${selectedRow.ceoOwnedPct.toFixed(2)}%`, color: selectedRow.ceoOwnedPct > 1 ? '#15803d' : null } : null,
                selectedRow?.hfOwnedPct != null ? { label: 'HF Ownership', val: `${selectedRow.hfOwnedPct.toFixed(2)}%`, color: selectedRow.hfOwnedPct > 1 ? '#2563eb' : null } : null,
              ].filter(Boolean)
              if (!stats.length) return null
              return (
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#1a2b3c', marginBottom: 8 }}>Trading Activity</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {stats.map(({ label, val, color }, i) => (
                      <div key={i} style={{ background: '#f9f9f9', border: '1px solid #e8e8e8', borderRadius: 7, padding: '6px 10px' }}>
                        <div style={{ fontSize: '0.68rem', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>{label}</div>
                        <div style={{ fontSize: '0.82rem', fontWeight: 700, color: color || '#1a2b3c' }}>{val}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })()}

          </div>



          {/* ── Ownership & Insider Activity ── */}
          {(insiderLoading || insiderData) && mounted && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#1a2b3c', marginBottom: 8 }}>Ownership &amp; Insider Activity</div>
              {insiderLoading && <div className="detail-multiples-empty">Loading…</div>}
              {insiderData && (() => {
                  const { insider, institutional } = insiderData
                  const total = insider.buyCount + insider.sellCount
                  const buyPct = total > 0 ? Math.round(insider.buyCount / total * 100) : 0
                  return (
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      {/* Insider panel */}
                      <div style={{ flex: '1 1 280px', minWidth: 240, background: '#f9f9f9', border: '1px solid #eee', borderRadius: 9, padding: '10px 12px' }}>
                        <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#374151', marginBottom: 6 }}>Insider Transactions (6 mo)</div>
                        {/* Buy/sell bar */}
                        {total > 0 && (
                          <div style={{ marginBottom: 8 }}>
                            <div style={{ display: 'flex', gap: 10, marginBottom: 4, fontSize: '0.72rem' }}>
                              <span style={{ color: '#15803d', fontWeight: 700 }}>▲ {insider.buyCount} Buys</span>
                              <span style={{ color: '#be123c', fontWeight: 700 }}>▼ {insider.sellCount} Sells</span>
                              {insider.sentiment !== 'neutral' && (
                                <span style={{ color: insider.sentiment === 'bullish' ? '#15803d' : '#be123c', fontWeight: 600, marginLeft: 'auto' }}>
                                  {insider.sentiment === 'bullish' ? '● Bullish' : '● Bearish'}
                                </span>
                              )}
                            </div>
                            <div style={{ height: 6, borderRadius: 3, background: '#fee2e2', overflow: 'hidden' }}>
                              <div style={{ width: `${buyPct}%`, height: '100%', background: '#15803d', borderRadius: 3, transition: 'width 0.3s' }}/>
                            </div>
                          </div>
                        )}
                        {insider.transactions.length === 0 && <div style={{ fontSize: '0.75rem', color: '#9ca3af', fontStyle: 'italic' }}>No open-market transactions</div>}
                        {insider.transactions.slice(0, 6).map((t, i) => (
                          <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'baseline', fontSize: '0.72rem', padding: '3px 0', borderBottom: i < 5 ? '1px solid #f0f0f0' : 'none' }}>
                            <span style={{ color: t.type === 'Buy' ? '#15803d' : '#be123c', fontWeight: 700, minWidth: 28 }}>{t.type === 'Buy' ? '▲' : '▼'} {t.type}</span>
                            <span style={{ flex: 1, color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name.split(' ').slice(0, 2).join(' ')}</span>
                            <span style={{ color: '#6b7280', minWidth: 48, textAlign: 'right' }}>{t.valueFmt || `${t.shares?.toLocaleString()} sh`}</span>
                            <span style={{ color: '#9ca3af', minWidth: 55, textAlign: 'right' }}>{t.date?.slice(5)}</span>
                          </div>
                        ))}
                      </div>
                      {/* Institutional panel */}
                      {institutional.holders.length > 0 && (
                        <div style={{ flex: '1 1 220px', minWidth: 200, background: '#f9f9f9', border: '1px solid #eee', borderRadius: 9, padding: '10px 12px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                            <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#374151' }}>Institutional Holders</span>
                            <span style={{ fontSize: '0.7rem', color: '#6b7280' }}>{institutional.totalPct.toFixed(1)}% total</span>
                          </div>
                          {institutional.holders.slice(0, 6).map((h, i) => (
                            <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 5 }}>
                              <div style={{ flex: 1 }}>
                                <div style={{ fontSize: '0.68rem', color: '#374151', fontWeight: 500, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 140 }}>{h.name}</div>
                                <div style={{ height: 3, borderRadius: 2, background: '#e5e7eb', marginTop: 2, overflow: 'hidden' }}>
                                  <div style={{ width: `${Math.min(100, (h.pct || 0) / (institutional.holders[0]?.pct || 1) * 100)}%`, height: '100%', background: '#3b82f6', borderRadius: 2 }}/>
                                </div>
                              </div>
                              <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#1a2b3c', minWidth: 36, textAlign: 'right' }}>{h.pct != null ? `${h.pct}%` : '-'}</span>
                              {h.changePct != null && (
                                <span style={{ fontSize: '0.65rem', minWidth: 38, textAlign: 'right', color: h.changePct > 0 ? '#15803d' : h.changePct < 0 ? '#be123c' : '#9ca3af', fontWeight: 600 }}>
                                  {h.changePct > 0 ? '+' : ''}{h.changePct.toFixed(1)}%
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      {/* Ownership Signals panel */}
                      {(() => {
                        const holders = institutional.holders
                        const totalPct = institutional.totalPct
                        // HF concentration: top holder's pct as % of total inst pct
                        const topHolderPct = holders[0]?.pct ?? null
                        const concentration = topHolderPct != null && totalPct > 0 ? topHolderPct / totalPct * 100 : null
                        // HF flow: how many of top 5 holders are increasing vs decreasing
                        const top5 = holders.slice(0, 5).filter(h => h.changePct != null)
                        const hfAccum = top5.filter(h => h.changePct > 0).length
                        const hfReduc = top5.filter(h => h.changePct < 0).length
                        // Divergence: insider bullish/bearish vs HF flow
                        const insiderBull = insider.sentiment === 'bullish'
                        const insiderBear = insider.sentiment === 'bearish'
                        const hfBull = top5.length > 0 && hfAccum > hfReduc
                        const hfBear = top5.length > 0 && hfReduc > hfAccum
                        let divergence = null, divergenceColor = '#6b7280'
                        if (insiderBull && hfBear) { divergence = 'Insider↑ / HF↓'; divergenceColor = '#92400e' }
                        else if (insiderBear && hfBull) { divergence = 'Insider↓ / HF↑'; divergenceColor = '#1e40af' }
                        else if (insiderBull && hfBull) { divergence = 'Both accumulating'; divergenceColor = '#15803d' }
                        else if (insiderBear && hfBear) { divergence = 'Both distributing'; divergenceColor = '#be123c' }
                        else { divergence = 'Mixed / neutral' }
                        // Ownership quality score: +1 insider buy, +1 hf accum, -1 insider sell, -1 hf dist
                        let score = 0
                        if (insiderBull) score += 2
                        if (insiderBear) score -= 2
                        if (hfBull) score += 1
                        if (hfBear) score -= 1
                        const scoreLabel = score >= 2 ? 'Strong Buy Signal' : score === 1 ? 'Mild Accumulation' : score === 0 ? 'Neutral' : score === -1 ? 'Mild Distribution' : 'Strong Sell Signal'
                        const scoreColor = score >= 2 ? '#15803d' : score >= 1 ? '#3b82f6' : score === 0 ? '#6b7280' : score >= -1 ? '#d97706' : '#be123c'
                        const insiderPct = snapshotData?.insiderPct != null ? `${snapshotData.insiderPct.toFixed(1)}%` : '-'
                        return (
                          <div style={{ flex: '1 1 200px', minWidth: 180, background: '#f8f9ff', border: '1px solid #e0e7ff', borderRadius: 9, padding: '10px 12px' }}>
                            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#374151', marginBottom: 8 }}>Ownership Signals</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem' }}>
                                <span style={{ color: '#6b7280' }}>Insider owned</span>
                                <span style={{ fontWeight: 700, color: '#1a2b3c' }}>{insiderPct}</span>
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem' }}>
                                <span style={{ color: '#6b7280' }}>Inst. owned</span>
                                <span style={{ fontWeight: 700, color: '#1a2b3c' }}>{totalPct.toFixed(1)}%</span>
                              </div>
                              {concentration != null && (
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem' }}>
                                  <span style={{ color: '#6b7280' }}>HF concentration</span>
                                  <span style={{ fontWeight: 700, color: concentration > 30 ? '#d97706' : '#1a2b3c' }}>{concentration.toFixed(0)}%</span>
                                </div>
                              )}
                              {top5.length > 0 && (
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem' }}>
                                  <span style={{ color: '#6b7280' }}>HF flow (top 5)</span>
                                  <span style={{ fontWeight: 700, color: hfBull ? '#15803d' : hfBear ? '#be123c' : '#6b7280' }}>
                                    {hfAccum}↑ {hfReduc}↓
                                  </span>
                                </div>
                              )}
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem' }}>
                                <span style={{ color: '#6b7280' }}>Divergence</span>
                                <span style={{ fontWeight: 600, color: divergenceColor, textAlign: 'right', maxWidth: 110 }}>{divergence}</span>
                              </div>
                              <div style={{ marginTop: 4, padding: '4px 8px', borderRadius: 6, background: scoreColor + '18', border: `1px solid ${scoreColor}40` }}>
                                <div style={{ fontSize: '0.69rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Ownership Quality</div>
                                <div style={{ fontSize: '0.75rem', fontWeight: 700, color: scoreColor }}>{scoreLabel}</div>
                              </div>
                            </div>
                          </div>
                        )
                      })()}
                    </div>
                  )
                })()}
              </div>
            )}

          {/* ── HF Holdings + Congressional Trades side by side ── */}
          {mounted && (hfLoading || hfHoldings || congressLoading || congressTrades) && (
            <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'flex-start' }}>

              {/* HF Holdings (13F) */}
              {(hfLoading || hfHoldings) && (
                <div style={{ flex: '1 1 0', minWidth: 0 }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#1a2b3c', marginBottom: 8 }}>Hedge Fund Holdings (13F)</div>
                  {hfLoading && !hfHoldings && <div className="detail-multiples-empty">Loading 13F filings…</div>}
                  {hfHoldings && (() => {
                    const holdings = hfHoldings.holdings || []
                    if (holdings.length === 0) return <div className="detail-multiples-empty">No positions found in recent 13F filings</div>
                    const fmtShares = n => n >= 1e6 ? `${(n/1e6).toFixed(2)}M` : n >= 1e3 ? `${(n/1e3).toFixed(0)}K` : `${n}`
                    const fmtVal = n => n >= 1e9 ? `$${(n/1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n/1e6).toFixed(0)}M` : `$${(n/1e3).toFixed(0)}K`
                    const actionStyle = a => a === 'added' ? { color: '#15803d', label: '▲ Added' } : a === 'reduced' ? { color: '#dc2626', label: '▼ Reduced' } : a === 'new' ? { color: '#2563eb', label: '★ New' } : { color: '#6b7280', label: '= Flat' }
                    return (
                      <div style={{ background: '#f9f9f9', border: '1px solid #e8e8e8', borderRadius: 8, overflow: 'hidden' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.73rem' }}>
                          <thead>
                            <tr style={{ background: '#f3f4f6', borderBottom: '1px solid #e5e7eb' }}>
                              <th style={{ textAlign: 'left', padding: '6px 10px', fontWeight: 600, color: '#6b7280', fontSize: '0.63rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Fund</th>
                              <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 600, color: '#6b7280', fontSize: '0.63rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Value</th>
                              <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 600, color: '#6b7280', fontSize: '0.63rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>QoQ Δ</th>
                              <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600, color: '#6b7280', fontSize: '0.63rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Action</th>
                            </tr>
                          </thead>
                          <tbody>
                            {holdings.map((h, i) => {
                              const as = actionStyle(h.action)
                              return (
                                <tr key={i} style={{ borderBottom: '1px solid #f3f4f6' }}>
                                  <td style={{ padding: '6px 10px', fontWeight: 600, color: '#1a2b3c' }}>{h.fund}</td>
                                  <td style={{ padding: '6px 8px', textAlign: 'right', color: '#374151' }}>{fmtVal(h.value)}</td>
                                  <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600, color: h.deltaPct > 0 ? '#15803d' : h.deltaPct < 0 ? '#dc2626' : '#6b7280' }}>
                                    {h.deltaPct != null ? `${h.deltaPct > 0 ? '+' : ''}${h.deltaPct.toFixed(1)}%` : '—'}
                                  </td>
                                  <td style={{ padding: '6px 8px', fontWeight: 700, color: as.color }}>{as.label}</td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                        <div style={{ padding: '4px 10px', fontSize: '0.6rem', color: '#d1d5db' }}>SEC EDGAR 13F-HR · 45-day lag</div>
                      </div>
                    )
                  })()}
                </div>
              )}

              {/* Congressional Trades */}
              {(congressLoading || congressTrades) && (
                <div style={{ flex: '1 1 0', minWidth: 0 }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#1a2b3c', marginBottom: 8 }}>Congressional Trades</div>
                  {congressLoading && !congressTrades && <div className="detail-multiples-empty">Loading…</div>}
                  {congressTrades && (() => {
                    const trades = congressTrades.trades || []
                    if (trades.length === 0) return <div className="detail-multiples-empty">No congressional trades on record</div>
                    const txColor = t => /purchase/i.test(t) ? '#15803d' : /sale/i.test(t) ? '#dc2626' : '#6b7280'
                    const chamberColor = c => c === 'Senate' ? '#7c3aed' : '#0369a1'
                    return (
                      <div style={{ background: '#f9f9f9', border: '1px solid #e8e8e8', borderRadius: 8, overflow: 'hidden' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.73rem' }}>
                          <thead>
                            <tr style={{ background: '#f3f4f6', borderBottom: '1px solid #e5e7eb' }}>
                              <th style={{ textAlign: 'left', padding: '6px 10px', fontWeight: 600, color: '#6b7280', fontSize: '0.63rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Member</th>
                              <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600, color: '#6b7280', fontSize: '0.63rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Transaction</th>
                              <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 600, color: '#6b7280', fontSize: '0.63rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Amount</th>
                              <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 600, color: '#6b7280', fontSize: '0.63rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Date</th>
                            </tr>
                          </thead>
                          <tbody>
                            {trades.map((t, i) => (
                              <tr key={i} style={{ borderBottom: '1px solid #f3f4f6' }}>
                                <td style={{ padding: '6px 10px' }}>
                                  <div style={{ fontWeight: 600, color: '#1a2b3c' }}>{t.name}</div>
                                  <span style={{ fontSize: '0.63rem', fontWeight: 700, color: chamberColor(t.chamber), background: t.chamber === 'Senate' ? '#ede9fe' : '#e0f2fe', borderRadius: 3, padding: '1px 4px' }}>{t.chamber}</span>
                                </td>
                                <td style={{ padding: '6px 8px', fontWeight: 700, color: txColor(t.transaction) }}>{t.transaction}</td>
                                <td style={{ padding: '6px 8px', textAlign: 'right', color: '#374151' }}>{t.amount}</td>
                                <td style={{ padding: '6px 8px', textAlign: 'right', color: '#9ca3af', fontSize: '0.65rem' }}>{t.date}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <div style={{ padding: '4px 10px', fontSize: '0.6rem', color: '#d1d5db' }}>Senate/House Stock Watcher · STOCK Act · 45-day lag</div>
                      </div>
                    )
                  })()}
                </div>
              )}

            </div>
          )}

          {/* News section */}
          <div style={{ marginTop: 18 }}>
            <div className="detail-multiples-chart-title" style={{ marginBottom: 8 }}>News</div>
            {/* Filter tabs */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
              {[{ id: 'all', label: 'All' }, { id: 'earnings', label: 'Earnings' }, { id: 'mna', label: 'M&A' }, { id: 'analyst', label: 'Analyst' }, { id: 'macro', label: 'Macro' }, { id: 'legal', label: 'Legal' }].map(tab => (
                <button key={tab.id} type="button" onClick={() => setNewsFilter(tab.id)} style={{
                  fontSize: '0.68rem', fontWeight: newsFilter === tab.id ? 700 : 500,
                  padding: '3px 10px', borderRadius: 5,
                  border: newsFilter === tab.id ? '1.5px solid #2563eb' : '1.5px solid #e5e7eb',
                  background: newsFilter === tab.id ? '#eff6ff' : '#f9fafb',
                  color: newsFilter === tab.id ? '#1d4ed8' : '#374151',
                  cursor: 'pointer',
                }}>{tab.label}</button>
              ))}
            </div>
            {/* Company news + Sector news side by side */}
            <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
              {/* Company news */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="detail-multiples-chart-title" style={{ marginBottom: 8 }}>Company News</div>
                <NewsPanel inline hideIndicators ticker={getTickerSymbol(selectedRow.exchangeTicker || selectedRow.securityTickers)} onIndicatorsReady={handleIndicatorsReady} externalFilter={newsFilter === 'all' ? 'All' : newsFilter === 'mna' ? 'M&A' : newsFilter.charAt(0).toUpperCase() + newsFilter.slice(1)} />
              </div>
              {/* Sector news */}
              {selectedRow.primarySector && (
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="detail-multiples-chart-title" style={{ marginBottom: 8 }}>{selectedRow.primarySector} Sector News</div>
                {industryNewsLoading && <div className="detail-multiples-empty">Loading…</div>}
                {!industryNewsLoading && industryNews && industryNews.length === 0 && (
                  <div className="detail-multiples-empty">No recent sector news</div>
                )}
                {!industryNewsLoading && industryNews && industryNews.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {industryNews.map((n, i) => (
                      <a key={i} href={n.url} target="_blank" rel="noopener noreferrer"
                        style={{ display: 'block', padding: '7px 10px', borderRadius: 7, background: '#f9f9f9', border: '1px solid #e8e8e8', textDecoration: 'none' }}>
                        <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#1a2b3c', lineHeight: 1.3 }}>{n.headline}</div>
                        <div style={{ display: 'flex', gap: 8, marginTop: 3 }}>
                          <span style={{ fontSize: '0.7rem', color: '#6b7280' }}>{n.source}</span>
                          <span style={{ fontSize: '0.7rem', color: '#9ca3af' }}>
                            {n.datetime ? new Date(n.datetime * 1000).toLocaleDateString() : ''}
                          </span>
                        </div>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          </div>
          </>)}
        </div>
      )}
      </ErrorBoundary>
      {error && <div className="error">{error}</div>}

      {/* Main page layout: filter sidebar plus table content. */}
      <div className="main-layout">
        <aside className={`sidebar ${viewMode === 'watchlist' ? 'sidebar-hidden' : ''}`}>
          <h2>Filter by sector</h2>
          <div className="filter-list">
            {sectors.length === 0 && <p className="info">No sectors available</p>}
            {sectors.map((sector) => {
              const active = selectedSectors.includes(sector)
              return (
                <button
                  key={sector}
                  type="button"
                  className={`sector-button ${active ? 'active' : ''}`}
                  onClick={() => toggleSector(sector)}
                >
                  {sector}
                </button>
              )
            })}
          </div>
          <h2 style={{marginTop:12}}>Filter by exchange</h2>
          <div className="filter-list">
            {exchanges.length === 0 && <p className="info">Loading…</p>}
            {exchanges.map((ex) => {
              const active = selectedExchanges.includes(ex)
              return (
                <button
                  key={ex}
                  type="button"
                  className={`sector-button ${active ? 'active' : ''}`}
                  onClick={() => toggleExchange(ex)}
                >
                  {ex}
                </button>
              )
            })}
          </div>
          <h2 style={{marginTop:12}}>Filter by market cap</h2>
          <div className="filter-list">
            {marketCapCategories.map((cat) => {
              const active = selectedMarketCaps.includes(cat.id)
              return (
                <button
                  key={cat.id}
                  type="button"
                  className={`sector-button ${active ? 'active' : ''}`}
                  onClick={() => toggleMarketCap(cat.id)}
                >
                  {cat.label}
                </button>
              )
            })}
          </div>
          <h2 style={{marginTop:12}}>Short Interest</h2>
          <div className="filter-list">
            {shortInterestCategories.map((cat) => {
              const active = selectedShortInterests.includes(cat.id)
              return (
                <button
                  key={cat.id}
                  type="button"
                  className={`sector-button ${active ? 'active' : ''}`}
                  onClick={() => toggleShortInterest(cat.id)}
                >
                  {cat.label}
                </button>
              )
            })}
          </div>
          <h2 style={{marginTop:12}}>Beta</h2>
          <div className="filter-list">
            {betaCategories.map((cat) => {
              const active = selectedBeta.includes(cat.id)
              return (
                <button key={cat.id} type="button" className={`sector-button ${active ? 'active' : ''}`} onClick={() => toggleBeta(cat.id)}>
                  {cat.label}
                </button>
              )
            })}
          </div>
          <h2 style={{marginTop:12}}>Distance from 52W Low</h2>
          <div className="filter-list">
            {distFromLowCategories.map((cat) => {
              const active = selectedDistFromLow.includes(cat.id)
              return (
                <button
                  key={cat.id}
                  type="button"
                  className={`sector-button ${active ? 'active' : ''}`}
                  onClick={() => toggleDistFromLow(cat.id)}
                >
                  {cat.label}
                </button>
              )
            })}
          </div>
          <h2 style={{marginTop:12}}>Gross Margin</h2>
          <div className="filter-list">
            {grossMarginCategories.map((cat) => {
              const active = selectedGrossMargins.includes(cat.id)
              return (
                <button key={cat.id} type="button" className={`sector-button ${active ? 'active' : ''}`} onClick={() => toggleGrossMargin(cat.id)}>
                  {cat.label}
                </button>
              )
            })}
          </div>
          <h2 style={{marginTop:12}}>Operating Margin</h2>
          <div className="filter-list">
            {operatingMarginCategories.map((cat) => {
              const active = selectedOperatingMargins.includes(cat.id)
              return (
                <button key={cat.id} type="button" className={`sector-button ${active ? 'active' : ''}`} onClick={() => toggleOperatingMargin(cat.id)}>
                  {cat.label}
                </button>
              )
            })}
          </div>
          <h2 style={{marginTop:12}}>Net Margin</h2>
          <div className="filter-list">
            {netMarginCategories.map((cat) => {
              const active = selectedNetMargins.includes(cat.id)
              return (
                <button key={cat.id} type="button" className={`sector-button ${active ? 'active' : ''}`} onClick={() => toggleNetMargin(cat.id)}>
                  {cat.label}
                </button>
              )
            })}
          </div>
          <h2 style={{marginTop:12}}>Insider Activity</h2>
          <div className="filter-list">
            {[{id:'selling', label:'▼ Net Selling'},{id:'buying', label:'▲ Net Buying'}].map(cat => (
              <button key={cat.id} type="button"
                className={`sector-button ${insiderFilter === cat.id ? 'active' : ''}`}
                onClick={() => setInsiderFilter(prev => prev === cat.id ? null : cat.id)}>
                {cat.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="clear-button"
            style={{marginTop:6, opacity: insiderLoadingAll ? 0.6 : 1}}
            disabled={insiderLoadingAll}
            onClick={loadAllInsiderData}
          >
            {insiderLoadingAll ? 'Loading insider data…' : '↻ Load insider data'}
          </button>
          {insiderFilter && (
            <p style={{fontSize:'0.74rem',color:'#999',margin:'4px 2px 0',lineHeight:1.4}}>
              Showing tickers with loaded data only.
            </p>
          )}
          <h2 style={{marginTop:12}}>News Velocity</h2>
          <div className="filter-list">
            {[{id:'spike',label:'⚡ Spiking'},{id:'normal',label:'Normal'}].map(cat => (
              <button key={cat.id} type="button"
                className={`sector-button ${selectedVelocity.includes(cat.id) ? 'active' : ''}`}
                onClick={() => toggleVelocity(cat.id)}>
                {cat.label}
              </button>
            ))}
          </div>
          <h2 style={{marginTop:12}}>News Sentiment</h2>
          <div className="filter-list">
            {[{id:'positive',label:'Positive'},{id:'negative',label:'Negative'},{id:'neutral',label:'Neutral'}].map(cat => (
              <button key={cat.id} type="button"
                className={`sector-button ${selectedSentiment.includes(cat.id) ? 'active' : ''}`}
                onClick={() => toggleSentiment(cat.id)}>
                {cat.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="clear-button"
            style={{marginTop:10,opacity: newsLoadingAll ? 0.6 : 1}}
            disabled={newsLoadingAll}
            onClick={loadAllNews}
          >
            {newsLoadingAll ? 'Loading news…' : '↻ Load all news data'}
          </button>
          {(selectedVelocity.length > 0 || selectedSentiment.length > 0) && (
            <p style={{fontSize:'0.74rem',color:'#999',margin:'6px 2px 0',lineHeight:1.4}}>
              Only filters tickers with loaded news. Click ◎ on rows or use Load above.
            </p>
          )}
          <h2 style={{marginTop:12}}>Financial Signals</h2>
          <div style={{fontSize:'0.68rem',color:'#aaa',marginBottom:4,marginTop:2}}>Severity</div>
          <div className="filter-list">
            {[
              { id: 'red',    label: '🔴 Red flag' },
              { id: 'yellow', label: '🟡 Caution' },
              { id: 'green',  label: '🟢 Positive' },
            ].map(cat => (
              <button key={cat.id} type="button"
                className={`sector-button ${selectedSignalSeverity.includes(cat.id) ? 'active' : ''}`}
                onClick={() => toggleSignalSeverity(cat.id)}>
                {cat.label}
              </button>
            ))}
          </div>
          <div style={{fontSize:'0.68rem',color:'#aaa',marginBottom:4,marginTop:8}}>Category</div>
          <div className="filter-list">
            {[
              { id: 'growth',        label: 'Growth' },
              { id: 'margins',       label: 'Margins' },
              { id: 'cash',          label: 'Cash Flow' },
              { id: 'balance_sheet', label: 'Balance Sheet' },
              { id: 'sector',        label: 'Sector-specific' },
            ].map(cat => (
              <button key={cat.id} type="button"
                className={`sector-button ${selectedSignalCategories.includes(cat.id) ? 'active' : ''}`}
                onClick={() => toggleSignalCategory(cat.id)}>
                {cat.label}
              </button>
            ))}
          </div>
          {(selectedSignalSeverity.length > 0 && selectedSignalCategories.length > 0) && (
            <p style={{fontSize:'0.72rem',color:'#6b7280',margin:'5px 2px 0',lineHeight:1.4}}>
              Showing: <strong>{selectedSignalSeverity.join(' or ')}</strong> signals in <strong>{selectedSignalCategories.map(c => c.replace('_',' ')).join(' or ')}</strong>
            </p>
          )}
          <button
            type="button"
            className="clear-button"
            style={{marginTop:6, opacity: signalsLoadingAll ? 0.6 : 1}}
            disabled={signalsLoadingAll}
            onClick={loadAllSignals}
          >
            {signalsLoadingAll ? 'Loading signals…' : '↻ Load signal data'}
          </button>
          {(selectedSignalSeverity.length > 0 || selectedSignalCategories.length > 0) && (
            <p style={{fontSize:'0.74rem',color:'#999',margin:'4px 2px 0',lineHeight:1.4}}>
              Only filters tickers with loaded signal data.
            </p>
          )}
          {(sectors.length > 0 || data.length > 0) && (
            <button type="button" className="clear-button" onClick={clearSectors}>
              Clear all filters
            </button>
          )}
          <h2 style={{marginTop:12}}>CFO</h2>
          <div className="filter-list">
            {cfoCategories.map(cat => (
              <button key={cat.id} type="button" className={`sector-button ${selectedCfo.includes(cat.id) ? 'active' : ''}`}
                onClick={() => setSelectedCfo(prev => prev.includes(cat.id) ? prev.filter(x => x !== cat.id) : [...prev, cat.id])}>
                {cat.label}
              </button>
            ))}
          </div>
          <h2 style={{marginTop:12}}>SBC / Revenue</h2>
          <div className="filter-list">
            {sbcRevCategories.map(cat => (
              <button key={cat.id} type="button" className={`sector-button ${selectedSbcRev.includes(cat.id) ? 'active' : ''}`}
                onClick={() => setSelectedSbcRev(prev => prev.includes(cat.id) ? prev.filter(x => x !== cat.id) : [...prev, cat.id])}>
                {cat.label}
              </button>
            ))}
          </div>
          <h2 style={{marginTop:12}}>HF Ownership</h2>
          <div className="filter-list">
            {hfOwnCategories.map(cat => (
              <button key={cat.id} type="button" className={`sector-button ${selectedHfOwn.includes(cat.id) ? 'active' : ''}`}
                onClick={() => setSelectedHfOwn(prev => prev.includes(cat.id) ? prev.filter(x => x !== cat.id) : [...prev, cat.id])}>
                {cat.label}
              </button>
            ))}
          </div>
          <h2 style={{marginTop:12}}>Analysts Covering</h2>
          <div className="filter-list">
            {analystsCategories.map(cat => (
              <button key={cat.id} type="button" className={`sector-button ${selectedAnalysts.includes(cat.id) ? 'active' : ''}`}
                onClick={() => setSelectedAnalysts(prev => prev.includes(cat.id) ? prev.filter(x => x !== cat.id) : [...prev, cat.id])}>
                {cat.label}
              </button>
            ))}
          </div>
          <h2 style={{marginTop:12}}>PPE / Revenue</h2>
          <div className="filter-list">
            {ppeRevCategories.map(cat => (
              <button key={cat.id} type="button" className={`sector-button ${selectedPpeRev.includes(cat.id) ? 'active' : ''}`}
                onClick={() => setSelectedPpeRev(prev => prev.includes(cat.id) ? prev.filter(x => x !== cat.id) : [...prev, cat.id])}>
                {cat.label}
              </button>
            ))}
          </div>
          <h2 style={{marginTop:12}}>R&amp;D / Revenue</h2>
          <div className="filter-list">
            {rdRevCategories.map(cat => (
              <button key={cat.id} type="button" className={`sector-button ${selectedRdRev.includes(cat.id) ? 'active' : ''}`}
                onClick={() => setSelectedRdRev(prev => prev.includes(cat.id) ? prev.filter(x => x !== cat.id) : [...prev, cat.id])}>
                {cat.label}
              </button>
            ))}
          </div>
          <h2 style={{marginTop:12}}>ROIC</h2>
          <div className="filter-list">
            {roicCategories.map(cat => (
              <button key={cat.id} type="button" className={`sector-button ${selectedRoic.includes(cat.id) ? 'active' : ''}`}
                onClick={() => setSelectedRoic(prev => prev.includes(cat.id) ? prev.filter(x => x !== cat.id) : [...prev, cat.id])}>
                {cat.label}
              </button>
            ))}
          </div>
          <h2 style={{marginTop:12}}>TAM Growth</h2>
          <div className="filter-list">
            {tamGrowthCategories.map(cat => (
              <button key={cat.id} type="button" className={`sector-button ${selectedTamGrowth.includes(cat.id) ? 'active' : ''}`}
                onClick={() => setSelectedTamGrowth(prev => prev.includes(cat.id) ? prev.filter(x => x !== cat.id) : [...prev, cat.id])}>
                {cat.label}
              </button>
            ))}
          </div>
          <h2 style={{marginTop:12}}>Market Share</h2>
          <div className="filter-list">
            <button type="button" className={`sector-button ${mktShareGainFilter ? 'active' : ''}`}
              onClick={() => setMktShareGainFilter(v => !v)}>
              Gaining share
            </button>
          </div>
        </aside>

        <div className="content">
          {viewMode === 'watchlist' && watchlist.length === 0 && (
            <p className="info" style={{marginTop:32}}>No stocks on your watchlist yet. Double-click any row in the Screener to add it.</p>
          )}

          {/* ── Watchlist Analytics ── */}
          {viewMode === 'watchlist' && mounted && (() => {
            const wlDataRows = data.filter(row => watchlist.includes(rowTicker(row)))
            const wlExtraList = watchlist.filter(t => !wlDataRows.some(r => rowTicker(r) === t) && wlExtras[t]).map(t => wlExtras[t])
            const wlRows = [...wlDataRows, ...wlExtraList]
            if (!wlRows.length) return null

            // ── palette ──────────────────────────────────────────────
            const COLORS = ['#3b82f6','#e76f51','#2a9d8f','#f59e0b','#8b5cf6','#ec4899','#10b981','#0ea5e9','#f97316','#14b8a6']
            const color = i => COLORS[i % COLORS.length]
            const getTicker = row => getTickerSymbol(row.exchangeTicker || row.securityTickers) || row.name?.slice(0, 6)

            const longRows = wlRows.filter(r => (watchlistSides[getTicker(r)] || 'long') === 'long')
            const shortRows = wlRows.filter(r => watchlistSides[getTicker(r)] === 'short')

            // ── Combined normalised price chart ───────────────────────
            const seriesList = wlRows.map((row, i) => {
              const closes = row.history?.closes?.filter(v => typeof v === 'number') || []
              const ts = row.history?.timestamps || []
              if (closes.length < 3) return null
              const base = closes[0]
              // Always use index-based x; optionally carry timestamps for labels
              return { ticker: getTicker(row), color: color(i), idx: closes.map(v => (v / base) * 100), ts, len: closes.length }
            }).filter(Boolean)

            const chartW = 600, chartH = 140, mL = 34, mR = 60, mT = 10, mB = 22
            const cW = chartW - mL - mR, cH = chartH - mT - mB
            const maxLen = seriesList.length ? Math.max(...seriesList.map(s => s.len)) : 1

            const allIdx = seriesList.flatMap(s => s.idx)
            const minIdx = Math.min(...(allIdx.length ? allIdx : [100]), 85)
            const maxIdx = Math.max(...(allIdx.length ? allIdx : [100]), 115)
            const idxRange = maxIdx - minIdx || 1

            // x by index position (normalised to longest series so all fit)
            const pxi = (i, len) => mL + (i / (len - 1 || 1)) * cW
            const py = v => mT + cH - ((v - minIdx) / idxRange) * cH

            // x-axis: try timestamps on first series, else "N months ago" labels
            const xLabels = (() => {
              if (!seriesList.length) return []
              const s0 = seriesList[0]
              const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
              const step = Math.max(1, Math.floor(s0.len / 5))
              if (s0.ts.length === s0.len) {
                // real timestamps
                const out = []
                for (let i = 0; i < s0.len; i += step) {
                  const d = new Date(s0.ts[i] * 1000)
                  out.push({ x: pxi(i, s0.len), label: MONTHS[d.getUTCMonth()] + " '" + String(d.getUTCFullYear()).slice(2) })
                }
                return out
              }
              // synthetic: N months back from today
              const now = new Date()
              const out = []
              for (let i = 0; i < s0.len; i += step) {
                const d = new Date(now)
                d.setMonth(d.getMonth() - (s0.len - 1 - i))
                out.push({ x: pxi(i, s0.len), label: MONTHS[d.getMonth()] + " '" + String(d.getFullYear()).slice(2) })
              }
              return out
            })()

            // ── Multiples comparison ──────────────────────────────────
            const multCols = [
              { key: 'pe',        label: 'P/E',         fmt: v => v != null ? `${v.toFixed(1)}x` : '-', higherWorse: true },
              { key: 'tevLtmRev', label: 'EV/Rev',      fmt: v => v != null ? `${v.toFixed(1)}x` : '-', higherWorse: true },
              { key: '_evEbitda', label: 'EV/EBITDA',   fmt: v => v != null ? `${v.toFixed(1)}x` : '-', higherWorse: true },
              { key: '_gm',       label: 'Gross Margin',fmt: v => v != null ? `${v.toFixed(1)}%` : '-', higherWorse: false },
              { key: '_om',       label: 'Op Margin',   fmt: v => v != null ? `${v.toFixed(1)}%` : '-', higherWorse: false },
              { key: '_nm',       label: 'Net Margin',  fmt: v => v != null ? `${v.toFixed(1)}%` : '-', higherWorse: false },
              { key: 'beta',      label: 'Beta',        fmt: v => v != null ? v.toFixed(2) : '-', higherWorse: null },
            ]
            const multRows = wlRows.map(row => ({
              ticker: getTicker(row),
              name: row.name,
              pe: typeof row.pe === 'number' ? row.pe : null,
              tevLtmRev: typeof row.tevLtmRev === 'number' ? row.tevLtmRev : null,
              _evEbitda: (row.tev != null && row.ebitda != null && row.ebitda > 0) ? row.tev / row.ebitda : null,
              _gm: (row.grossProfit != null && row.totalRevenue > 0) ? row.grossProfit / row.totalRevenue * 100 : null,
              _om: typeof row.operatingMargin === 'number' ? row.operatingMargin : null,
              _nm: (row.netIncome != null && row.totalRevenue > 0) ? row.netIncome / row.totalRevenue * 100 : null,
              beta: typeof row.beta === 'number' ? row.beta : null,
            }))

            // compute min/max per col for relative coloring
            const colStats = {}
            multCols.forEach(col => {
              const vals = multRows.map(r => r[col.key]).filter(v => v != null)
              colStats[col.key] = { min: Math.min(...vals), max: Math.max(...vals) }
            })
            const relColor = (col, val) => {
              if (val == null || col.higherWorse === null) return '#374151'
              const { min, max } = colStats[col.key] || {}
              if (min == null || max === min) return '#374151'
              const norm = (val - min) / (max - min)  // 0=min, 1=max
              // higherWorse: high value = bad (red), low = good (green)
              const bad = col.higherWorse ? norm > 0.66 : norm < 0.33
              const good = col.higherWorse ? norm < 0.33 : norm > 0.66
              return bad ? '#dc2626' : good ? '#15803d' : '#92400e'
            }

            // ── Earnings timeline ────────────────────────────────────
            const TODAY_SEC = Date.now() / 1000
            const SIX_MO = 182 * 86400
            const tlStart = TODAY_SEC - SIX_MO, tlEnd = TODAY_SEC + SIX_MO
            const events = []
            wlRows.forEach((row, i) => {
              const tick = getTicker(row)
              const col = color(i)
              const addEvent = (dateStr, past) => {
                if (!dateStr || !/^\d{4}-\d{2}-\d{2}/.test(dateStr)) return
                const sec = new Date(dateStr + 'T12:00:00Z').getTime() / 1000
                if (sec < tlStart - 30 * 86400 || sec > tlEnd + 30 * 86400) return
                events.push({ sec, tick, col, past, dateStr })
              }
              addEvent(row.lastEarningsDate, true)
              addEvent(row.nextEarningsDate, false)
            })
            events.sort((a, b) => a.sec - b.sec)

            // Sector ETF mapping
            const SECTOR_ETF = { 'Technology': 'XLK', 'Consumer Cyclical': 'XLY', 'Healthcare': 'XLV', 'Financial Services': 'XLF', 'Communication Services': 'XLC', 'Consumer Defensive': 'XLP', 'Energy': 'XLE', 'Industrials': 'XLI', 'Real Estate': 'XLRE', 'Basic Materials': 'XLB', 'Utilities': 'XLU' }

            // Group multRows by sector for a given subset of wlRows
            const buildSectorGroups = (subRows) => {
              const groups = {}
              subRows.forEach(row => {
                const t = getTicker(row)
                const mrIdx = wlRows.indexOf(row)
                if (mrIdx === -1) return
                const mr = multRows[mrIdx]
                if (!mr) return
                const sec = row.primarySector || 'Other'
                if (!groups[sec]) groups[sec] = []
                groups[sec].push({ mr, wlIdx: mrIdx })
              })
              return groups
            }

            const longSectorGroups = buildSectorGroups(longRows)
            const shortSectorGroups = buildSectorGroups(shortRows)

            const thStyle = { textAlign: 'right', padding: '4px 8px', fontSize: '0.63rem', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '1px solid #e5e7eb', fontWeight: 600, whiteSpace: 'nowrap' }
            const colRelColor = (col, val, groupRows) => {
              if (val == null || col.higherWorse === null) return '#374151'
              const vals = groupRows.map(r => r.mr[col.key]).filter(v => v != null)
              if (vals.length < 2) return '#374151'
              const mn = Math.min(...vals), mx = Math.max(...vals)
              if (mx === mn) return '#374151'
              const norm = (val - mn) / (mx - mn)
              const bad = col.higherWorse ? norm > 0.66 : norm < 0.33
              const good = col.higherWorse ? norm < 0.33 : norm > 0.66
              return bad ? '#dc2626' : good ? '#15803d' : '#92400e'
            }

            const renderSideTable = (sectorGroups, panelSide) => {
              const sectorEntries = Object.entries(sectorGroups)
              if (sectorEntries.length === 0) {
                return (
                  <div style={{ fontSize: '0.72rem', color: '#9ca3af', padding: '16px 8px', textAlign: 'center' }}>
                    {panelSide === 'short' ? 'No short ideas — click "S" on any row to mark it short.' : 'No long ideas.'}
                  </div>
                )
              }
              return sectorEntries.map(([sector, groupRows]) => {
                const etf = SECTOR_ETF[sector]
                return (
                  <div key={sector} style={{ background: '#f9f9f9', border: `1px solid ${panelSide === 'long' ? '#bbf7d0' : '#fca5a5'}`, borderRadius: 9, padding: '10px 12px', marginBottom: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                      <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#1a2b3c' }}>{sector}</span>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <span style={{ fontSize: '0.65rem', background: '#e0f2fe', color: '#0369a1', padding: '1px 7px', borderRadius: 4, fontWeight: 600 }}>SPY</span>
                        {etf && <span style={{ fontSize: '0.65rem', background: '#f0fdf4', color: '#15803d', padding: '1px 7px', borderRadius: 4, fontWeight: 600 }}>{etf}</span>}
                      </div>
                      <span style={{ fontSize: '0.69rem', color: '#d1d5db', marginLeft: 'auto' }}>vs S&amp;P 500{etf ? ` · ${etf}` : ''}</span>
                    </div>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.73rem' }}>
                        <thead>
                          <tr>
                            <th style={{ textAlign: 'left', padding: '4px 8px', fontSize: '0.63rem', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '1px solid #e5e7eb', fontWeight: 600, minWidth: 300, width: 300 }}>Company</th>
                            {multCols.map(col => <th key={col.key} style={{ ...thStyle, padding: '4px 3px', width: 52, maxWidth: 52 }}>{col.label}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {groupRows.map(({ mr, wlIdx }) => (
                            <tr key={mr.ticker} style={{ borderBottom: '1px solid #f3f4f6' }}>
                              <td style={{ padding: '5px 8px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const t = mr.ticker
                                      const side = watchlistSides[t] === 'short' ? 'long' : 'short'
                                      const ns = { ...watchlistSides, [t]: side }
                                      setWatchlistSides(ns)
                                      localStorage.setItem('watchlistSides', JSON.stringify(ns))
                                    }}
                                    style={{
                                      fontSize: '0.55rem', fontWeight: 700, padding: '1px 4px', borderRadius: 3, cursor: 'pointer',
                                      border: `1px solid ${panelSide === 'long' ? '#bbf7d0' : '#fca5a5'}`,
                                      background: panelSide === 'long' ? '#f0fdf4' : '#fff5f5',
                                      color: panelSide === 'long' ? '#15803d' : '#dc2626',
                                      flexShrink: 0,
                                    }}
                                    title={panelSide === 'long' ? 'Move to Short' : 'Move to Long'}
                                  >
                                    {panelSide === 'long' ? 'L' : 'S'}
                                  </button>
                                  <div style={{ width: 8, height: 8, borderRadius: 2, background: color(wlIdx), flexShrink: 0 }}/>
                                  <div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                      <span style={{ fontWeight: 600, color: '#1a2b3c' }}>{mr.ticker}</span>
                                      {(() => {
                                        const price = wlRows[wlIdx]?.price
                                        const closes = wlRows[wlIdx]?.history?.closes
                                        const prev = closes?.length >= 2 ? closes[closes.length - 2] : null
                                        const chg = price != null && prev && prev > 0 ? (price - prev) / prev * 100 : null
                                        if (price == null) return null
                                        return (
                                          <>
                                            <span style={{ fontWeight: 700, color: '#374151', fontSize: '0.73rem' }}>${price.toFixed(2)}</span>
                                            {chg != null && <span style={{ fontSize: '0.63rem', color: chg >= 0 ? '#15803d' : '#dc2626', fontWeight: 600 }}>{chg >= 0 ? '+' : ''}{chg.toFixed(1)}%</span>}
                                          </>
                                        )
                                      })()}
                                    </div>
                                    <span style={{ color: '#9ca3af', fontSize: '0.65rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 260, display: 'block' }}>{mr.name}</span>
                                  </div>
                                </div>
                              </td>
                              {multCols.map(col => (
                                <td key={col.key} style={{ textAlign: 'right', padding: '5px 3px', fontWeight: 600, color: colRelColor(col, mr[col.key], groupRows), whiteSpace: 'nowrap', fontSize: '0.68rem', width: 52, maxWidth: 52 }}>
                                  {col.fmt(mr[col.key])}
                                </td>
                              ))}
                            </tr>
                          ))}
                          {/* SPY benchmark row */}
                          <tr style={{ borderTop: '1px solid #e5e7eb', background: '#f8faff' }}>
                            <td style={{ padding: '4px 8px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <div style={{ width: 8, height: 8, borderRadius: 2, background: '#94a3b8', flexShrink: 0 }}/>
                                <span style={{ fontWeight: 600, color: '#64748b', fontSize: '0.7rem' }}>SPY</span>
                                <span style={{ color: '#cbd5e1', fontSize: '0.63rem' }}>S&amp;P 500 ETF</span>
                              </div>
                            </td>
                            {multCols.map(col => <td key={col.key} style={{ textAlign: 'right', padding: '4px 8px', fontSize: '0.68rem', color: '#cbd5e1', fontStyle: 'italic' }}>—</td>)}
                          </tr>
                          {etf && (
                            <tr style={{ background: '#f0fdf4' }}>
                              <td style={{ padding: '4px 8px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <div style={{ width: 8, height: 8, borderRadius: 2, background: '#86efac', flexShrink: 0 }}/>
                                  <span style={{ fontWeight: 600, color: '#15803d', fontSize: '0.7rem' }}>{etf}</span>
                                  <span style={{ color: '#86efac', fontSize: '0.63rem' }}>{sector} ETF</span>
                                </div>
                              </td>
                              {multCols.map(col => <td key={col.key} style={{ textAlign: 'right', padding: '4px 8px', fontSize: '0.68rem', color: '#86efac', fontStyle: 'italic' }}>—</td>)}
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                    <div style={{ fontSize: '0.69rem', color: '#d1d5db', marginTop: 4 }}>Color: <span style={{ color: '#15803d' }}>green = best in sector group</span>  <span style={{ color: '#dc2626' }}>red = worst</span></div>
                  </div>
                )
              })
            }

            return (
              <div style={{ marginBottom: 20 }}>

                {/* ── 1. Earnings Calendar — horizontal cards, chronological ── */}
                <div style={{ background: '#f9f9f9', border: '1px solid #e8e8e8', borderRadius: 9, padding: '10px 14px', marginBottom: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    <span style={{ fontSize: '1rem' }}>📅</span>
                    <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#1a2b3c' }}>Earnings Calendar</span>
                    <span style={{ fontSize: '0.65rem', color: '#9ca3af' }}>chronological · ± 6 months</span>
                  </div>
                  {events.length === 0
                    ? <div className="detail-multiples-empty">No earnings dates loaded</div>
                    : (
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {events.map((ev, i) => {
                          const [yr, mo, dy] = ev.dateStr.split('-')
                          const MONTHS = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
                          const isToday = ev.dateStr === new Date(TODAY_SEC * 1000).toISOString().slice(0, 10)
                          return (
                            <div key={i} style={{
                              display: 'flex', flexDirection: 'column', alignItems: 'center',
                              padding: '6px 12px', borderRadius: 8,
                              background: ev.past ? '#f3f4f6' : '#eff6ff',
                              border: `1.5px solid ${ev.past ? '#e5e7eb' : ev.col}`,
                              opacity: ev.past ? 0.75 : 1,
                              minWidth: 64,
                            }}>
                              <span style={{ fontSize: '0.95rem', fontWeight: 700, color: '#374151' }}>{MONTHS[+mo]} {+dy}, {yr}</span>
                              <span style={{ fontSize: '0.82rem', fontWeight: 700, color: ev.col, marginTop: 1 }}>{ev.tick}</span>
                              <span style={{ fontSize: '0.69rem', color: ev.past ? '#9ca3af' : '#2563eb', marginTop: 1 }}>
                                {ev.past ? 'Reported' : (() => { const mn = +mo; return `${mn <= 3 ? 'Q1' : mn <= 6 ? 'Q2' : mn <= 9 ? 'Q3' : 'Q4'} '${yr.slice(2)}` })()}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    )
                  }
                </div>

                {/* ── 2. Long / Short multiples side-by-side ── */}
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#15803d', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>▲ Long Ideas</div>
                    {renderSideTable(longSectorGroups, 'long')}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#dc2626', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>▼ Short Ideas</div>
                    {renderSideTable(shortSectorGroups, 'short')}
                  </div>
                </div>

              </div>
            )
          })()}

          {data.length > 0 && (
            <div className="table-wrapper">
              {/* Primary companies table with price and metrics. */}
              <table>
            <thead>
              <tr>
                {[
                  { key: 'name',          label: 'Company',             cls: 'combined-col' },
                  { key: null,            label: 'P&L Flow',            cls: 'flow-column' },
                  { key: 'primarySector', label: 'Sector',              cls: 'sector-col'  },
                  { key: 'tev',           label: 'TEV ($mm)',           cls: 'narrow-col' },
                  { key: 'marketCap',     label: 'Mkt Cap',             cls: 'narrow-col' },
                  { key: 'grossMargin',   label: 'GM %',                cls: 'narrow-col' },
                  { key: 'netMargin',     label: 'Net Mgn',             cls: 'narrow-col' },
                  { key: 'beta',          label: 'Beta',                cls: 'narrow-col' },
                  { key: 'shortInterest', label: 'SI %',                cls: 'narrow-col' },
                  { key: 'de',            label: 'D/E',                 cls: 'narrow-col' },
                ].map(({ key, label, cls }) => (
                  <th
                    key={label}
                    className={cls}
                    style={key ? { cursor: 'pointer', userSelect: 'none' } : {}}
                    onClick={key ? () => handleSort(key) : undefined}
                  >
                    {label}{key && sortBy === key ? (sortAsc ? ' ▲' : ' ▼') : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayedData.map((row) => {
                const ticker = formatTicker(row)
                const priceForRange = row.price != null ? row.price : null
                const rangePct = positionIn52(row.week52Low, row.week52High, priceForRange)
                const deRatio = computeRatio(row.totalDebt, row.marketCap)
                const isNegativeNet = typeof row.netIncome === 'number' && row.netIncome < 0
                const history = row.history && Array.isArray(row.history.closes) && row.history.closes.length ? row.history.closes : null
                const currentPrice = row.price != null ? row.price : history ? history[history.length - 1] : null
                const isUpYear = history ? (history[history.length - 1] >= history[0]) : true
                const sparkStroke = isUpYear ? '#2a9d8f' : '#e76f51'
                const yearChangePct = history && history.length >= 2 ? ((history[history.length - 1] - history[0]) / history[0]) * 100 : null
                const isWatchlisted = watchlist.includes(rowTicker(row))
                return (
                  <tr
                    className={`${isNegativeNet ? 'negative-net' : ''} ${isWatchlisted ? 'watchlist-row' : ''}`}
                    key={`${row.id}-${row.name}`}
                    onDoubleClick={() => toggleWatchlist(row)}
                    title="Double-click to add/remove from watchlist"
                  >
                    {/* Combined col: name + ticker + price + chart + 52W bar */}
                    <td className="combined-cell">
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                          {isWatchlisted && <span className="watchlist-star">★</span>}
                          <button type="button" className="company-link" onClick={() => handleSelectCompany(row)} style={{ fontWeight: 700, fontSize: '0.82rem' }}>
                            {row.name}
                          </button>
                          <span style={{ color: '#9ca3af', fontSize: '0.72rem' }}>({rowTicker(row)})</span>
                          <button type="button" className="ni-news-btn" title="News" onClick={e => { e.stopPropagation(); handleSelectCompany(row); setDetailPanelTab('news') }}>◎</button>
                        </div>
                        <div className="stock-price-row">
                          <span className="stock-price">{currentPrice != null ? `$${currentPrice.toFixed(2)}` : '-'}</span>
                          {yearChangePct != null && (
                            <span className={`stock-year-chg ${yearChangePct >= 0 ? 'chg-up' : 'chg-down'}`}>
                              {yearChangePct >= 0 ? '+' : ''}{yearChangePct.toFixed(1)}%
                            </span>
                          )}
                          {newsIndicators[rowTicker(row)] && (() => {
                            const ind = newsIndicators[rowTicker(row)]
                            return (
                              <span className="ni-row" style={{ marginLeft: 2 }}>
                                <span className={`ni-dot ni-v-${ind.velocityState}`} title={`Velocity: ${ind.velocityState}`} />
                                <span className={`ni-dot ni-s-${ind.sentimentState}`} title={`Sentiment: ${ind.sentimentState}`} />
                              </span>
                            )
                          })()}
                        </div>
                        {row.history && Array.isArray(row.history.closes) && row.history.closes.length > 0 ? (
                          <svg className="range-sparkline" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
                            {(() => {
                              const closes = row.history.closes.filter(v => typeof v === 'number')
                              const px = i => (i / (closes.length - 1)) * 100
                              return (
                                <>
                                  <path d={buildSparklineArea(row.history.closes)} fill={isUpYear ? 'rgba(42,157,143,0.14)' : 'rgba(231,111,81,0.12)'}/>
                                  <polyline fill="none" stroke={sparkStroke} strokeWidth="0.8" strokeLinecap="butt" strokeLinejoin="miter" points={buildSparklinePoints(row.history.closes)}/>
                                  {(() => {
                                    const ts = row.history?.timestamps
                                    if (!ts?.length || !row.lastEarningsDate) return null
                                    const lastEarnSec = new Date(row.lastEarningsDate + 'T12:00:00Z').getTime() / 1000
                                    const quarter = 91 * 86400
                                    const firstTs = ts[0], lastTs = ts[ts.length - 1]
                                    const markers = []
                                    let d = lastEarnSec
                                    while (d >= firstTs - quarter) {
                                      if (d <= lastTs && d >= firstTs) {
                                        let closest = 0, minDiff = Infinity
                                        for (let ii = 0; ii < ts.length; ii++) {
                                          const diff = Math.abs(ts[ii] - d)
                                          if (diff < minDiff) { minDiff = diff; closest = ii }
                                        }
                                        markers.push(closest)
                                      }
                                      d -= quarter
                                    }
                                    return markers.map((idx, mi) => <polygon key={mi} points={`${px(idx)},3 ${px(idx)-3},0 ${px(idx)+3},0`} fill="#f59e0b" opacity="0.9"/>)
                                  })()}
                                </>
                              )
                            })()}
                          </svg>
                        ) : null}
                        {row.week52Low != null && row.week52High != null && (
                          <>
                            <div className="range-bar">
                              <div className="range-track" />
                              {rangePct != null && <div className="range-filled" style={{ width: `${rangePct}%` }} />}
                              {rangePct != null && <div className="range-marker" style={{ left: `${Math.min(100, Math.max(0, rangePct))}%` }} />}
                            </div>
                            <div className="range-labels">
                              <span>L ${fmt(row.week52Low)}</span>
                              <span>H ${fmt(row.week52High)}</span>
                            </div>
                          </>
                        )}
                      </div>
                    </td>
                    <td className="flow-cell-column">
                      {(() => {
                        const bars = buildWaterfallBars(row)
                        if (!bars) return <div style={{ color: '#9ca3af', fontSize: '0.78rem', padding: '4px 2px' }}>No P&L data</div>
                        const SHORT = { 'Revenue': 'Rev', '- COGS': 'COGS', 'Gross Profit': 'GP', '- OpEx': 'OpEx', 'EBIT': 'EBIT', '+ D&A': 'D&A', '- Total Costs': 'Costs', 'EBITDA': 'EBITDA', '- Other': 'Other', 'Net Income': 'Net' }
                        const allY = bars.flatMap(b => [b.from, b.to])
                        const maxVal = Math.max(...allY)
                        const minVal = Math.min(0, ...allY)
                        const W = 260, H = 82
                        const mL = 2, mB = 18, mT = 4, mR = 2
                        const cW = W - mL - mR
                        const cH = H - mT - mB
                        const n = bars.length
                        const bW = Math.floor((cW / n) * 0.6)
                        const sp = (cW - bW * n) / (n + 1)
                        const range = maxVal - minVal || 1
                        const yPx = v => mT + cH - ((v - minVal) / range) * cH
                        const zeroY = yPx(0)
                        return (
                          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 90 }}>
                            <line x1={mL} x2={W - mR} y1={zeroY} y2={zeroY} stroke="#e5e7eb" strokeWidth="0.8" />
                            {bars.map((bar, i) => {
                              const x = mL + sp + i * (bW + sp)
                              const y1 = yPx(bar.from), y2 = yPx(bar.to)
                              const rectY = Math.min(y1, y2)
                              const rectH = Math.max(2, Math.abs(y1 - y2))
                              const isSub = bar.label.startsWith('-')
                              const lbl = SHORT[bar.label] || bar.label
                              return (
                                <g key={i}>
                                  <title>{bar.label}: {formatBillions(bar.to - bar.from)}</title>
                                  <rect x={x} y={rectY} width={bW} height={rectH}
                                    fill={bar.color} rx="2" opacity={isSub ? 0.72 : 1} />
                                  <text x={x + bW / 2} y={H - 3} textAnchor="middle"
                                    fontSize="7.5" fill={isSub ? '#b0b8c4' : '#4b5563'}
                                    fontWeight={isSub ? 'normal' : '600'}>
                                    {lbl}
                                  </text>
                                </g>
                              )
                            })}
                          </svg>
                        )
                      })()}
                    </td>
                    <td className="sector-cell">{row.primarySector || '-'}</td>
                    <td className="narrow-cell">{row.tev != null ? `$${fmt(row.tev)}` : '-'}</td>
                    <td className="narrow-cell">{fmtMktCap(row.marketCap)}</td>
                    <td className="narrow-cell" style={{ color: row.grossMargin != null ? (row.grossMargin >= 50 ? '#15803d' : row.grossMargin >= 25 ? '#374151' : '#dc2626') : undefined }}>{row.grossMargin != null ? `${row.grossMargin.toFixed(1)}%` : '-'}</td>
                    <td className="narrow-cell" style={{ color: row.netMargin != null ? (row.netMargin >= 10 ? '#15803d' : row.netMargin >= 0 ? '#374151' : '#dc2626') : undefined }}>{row.netMargin != null ? `${row.netMargin.toFixed(1)}%` : '-'}</td>
                    <td className="narrow-cell">{row.beta ?? '-'}</td>
                    <td className="narrow-cell">{row.shortInterest != null ? `${row.shortInterest}%` : '-'}</td>
                    <td className="narrow-cell">{row.debtEquity != null ? `${row.debtEquity.toFixed(0)}%` : deRatio != null ? deRatio.toFixed(2) : '-'}</td>
                  </tr>
                )
              })}
            </tbody>
              </table>
            </div>
          )}

          {data.length > 0 && filteredData.length === 0 && (
            <p className="info">No companies match the selected sector filters.</p>
          )}

          {!loading && data.length === 0 && !error && (
            <p className="info">No data available. Please refresh the page to try again.</p>
          )}
        </div>
      </div>

      {/* News Intelligence slide-in panel */}
      {newsPanel && (
        <NewsPanel
          ticker={newsPanel}
          onClose={() => setNewsPanel(null)}
          onIndicatorsReady={handleIndicatorsReady}
        />
      )}
    </div>
    </ErrorBoundary>
  )
}
