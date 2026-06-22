import axios from 'axios'

const SEC = 'https://data.sec.gov'
const HDR = { 'User-Agent': 'arunimad@berkeley.edu', Accept: 'application/json' }
const CACHE_TTL = 4 * 60 * 60 * 1000

const cikCache = { data: null, ts: 0 }
const conceptCache = new Map()

const REVENUE_CONCEPTS = [
  'RevenueFromContractWithCustomerExcludingAssessedTax',
  'Revenues', 'SalesRevenueNet', 'SalesRevenueGoodsNet',
]

function getSectorCat(sector = '') {
  const s = sector.toLowerCase()
  if (s.includes('bank') || s.includes('insurance') || s.includes('diversified financial') || (s.includes('financial') && !s.includes('tech'))) return 'banks'
  if (s.includes('healthcare') || s.includes('biotech') || s.includes('pharma') || s.includes('medical') || s.includes('life science')) return 'healthcare'
  if (s.includes('consumer') || s.includes('retail') || s.includes('food') || s.includes('beverage') || s.includes('personal')) return 'retail'
  if (s.includes('industrial') || s.includes('manufactur') || s.includes('aerospace') || s.includes('defense') || s.includes('transport') || s.includes('basic material')) return 'industrials'
  if (s.includes('energy') || s.includes('oil') || s.includes('gas') || s.includes('mining')) return 'energy'
  if (s.includes('real estate') || s.includes('reit')) return 'reit'
  if (s.includes('util')) return 'utilities'
  return 'tech'
}

const SECTOR_CONCEPTS = {
  tech: [
    ...REVENUE_CONCEPTS,
    'NetIncomeLoss', 'GrossProfit',
    'ResearchAndDevelopmentExpense',
    'AllocatedShareBasedCompensationExpense', 'ShareBasedCompensation',
    'DeferredRevenueCurrent', 'DeferredRevenueNoncurrent',
    'NetCashProvidedByUsedInOperatingActivities',
    'CashAndCashEquivalentsAtCarryingValue',
  ],
  banks: [
    ...REVENUE_CONCEPTS,
    'NetIncomeLoss', 'Assets', 'StockholdersEquity',
    'NetInterestIncome',
    'InterestAndDividendIncomeOperating',
    'InterestExpense',
    'NoninterestIncome',
    'ProvisionForLoanAndLeaseLosses', 'ProvisionForDoubtfulAccounts',
    'LoansAndLeasesReceivableNetReportedAmount',
  ],
  healthcare: [
    ...REVENUE_CONCEPTS,
    'NetIncomeLoss', 'GrossProfit',
    'ResearchAndDevelopmentExpense',
    'NetCashProvidedByUsedInOperatingActivities',
    'CashAndCashEquivalentsAtCarryingValue',
    'CashCashEquivalentsAndShortTermInvestments',
  ],
  retail: [
    ...REVENUE_CONCEPTS,
    'NetIncomeLoss', 'GrossProfit',
    'SellingGeneralAndAdministrativeExpense',
    'InventoryNet',
    'CostOfGoodsAndServicesSold', 'CostOfRevenue',
  ],
  industrials: [
    ...REVENUE_CONCEPTS,
    'NetIncomeLoss',
    'PaymentsToAcquirePropertyPlantAndEquipment',
    'InventoryNet',
    'PropertyPlantAndEquipmentNet',
    'RevenueRemainingPerformanceObligation',
    'NetCashProvidedByUsedInOperatingActivities',
  ],
  energy: [
    ...REVENUE_CONCEPTS,
    'NetIncomeLoss',
    'OperatingIncomeLoss',
    'DepreciationDepletionAndAmortization',
    'PaymentsToAcquirePropertyPlantAndEquipment',
    'NetCashProvidedByUsedInOperatingActivities',
    'LongTermDebt',
  ],
  reit: [
    ...REVENUE_CONCEPTS,
    'NetIncomeLoss',
    'DepreciationAndAmortization', 'DepreciationDepletionAndAmortization',
    'RealEstateInvestmentPropertyNet',
    'PaymentsOfDividendsCommonStock',
    'Assets',
    'LongTermDebt',
  ],
  utilities: [
    ...REVENUE_CONCEPTS,
    'NetIncomeLoss', 'StockholdersEquity', 'LongTermDebt',
    'RegulatedOperatingRevenue',
    'PaymentsOfDividendsCommonStock',
  ],
}

async function getCik(ticker) {
  if (!cikCache.data || Date.now() - cikCache.ts > CACHE_TTL) {
    const r = await axios.get('https://www.sec.gov/files/company_tickers.json', { headers: HDR, timeout: 10000 })
    cikCache.data = r.data; cikCache.ts = Date.now()
  }
  const entry = Object.values(cikCache.data).find(e => e.ticker === ticker.toUpperCase())
  return entry ? String(entry.cik_str).padStart(10, '0') : null
}

async function getConcept(cik, concept) {
  const k = `${cik}_${concept}`
  const hit = conceptCache.get(k)
  if (hit && Date.now() - hit.ts < CACHE_TTL) return hit.data
  try {
    const r = await axios.get(`${SEC}/api/xbrl/companyconcept/CIK${cik}/us-gaap/${concept}.json`, { headers: HDR, timeout: 10000 })
    conceptCache.set(k, { data: r.data, ts: Date.now() })
    return r.data
  } catch { return null }
}

function latestAnnual(conceptData) {
  if (!conceptData) return null
  const arr = conceptData.units?.USD || conceptData.units?.['USD/shares'] || []
  const byYear = {}
  for (const item of arr) {
    if (item.form !== '10-K' || item.val == null) continue
    const yr = item.end?.slice(0, 4)
    if (!yr) continue
    if (!byYear[yr] || item.filed > byYear[yr].filed) byYear[yr] = item
  }
  const dates = Object.keys(byYear).sort()
  return dates.length ? byYear[dates[dates.length - 1]].val : null
}

function fmtM(v) {
  if (v == null) return null
  const a = Math.abs(v)
  if (a >= 1e12) return `$${(v / 1e12).toFixed(2)}T`
  if (a >= 1e9) return `$${(v / 1e9).toFixed(1)}B`
  if (a >= 1e6) return `$${(v / 1e6).toFixed(0)}M`
  return `$${v.toLocaleString()}`
}

function pctOf(v, base) {
  if (v == null || !base || base === 0) return null
  return `${Math.round(v / base * 1000) / 10}% of rev`
}

function pctFmt(v) {
  return v != null ? `${Math.round(v * 10) / 10}%` : null
}

export default async function handler(req, res) {
  const { ticker, sector } = req.query
  if (!ticker) return res.status(400).json({ error: 'Missing ticker' })

  const cat = getSectorCat(sector || '')
  const rawConcepts = SECTOR_CONCEPTS[cat] || SECTOR_CONCEPTS.tech
  const concepts = [...new Set(rawConcepts)]

  try {
    const cik = await getCik(ticker.toUpperCase())
    if (!cik) return res.status(200).json({ error: `No SEC filing for ${ticker}` })

    const results = await Promise.all(concepts.map(c => getConcept(cik, c)))
    const cm = {}
    concepts.forEach((c, i) => { cm[c] = results[i] })

    // Revenue — first concept with data wins
    let rev = null
    for (const rc of REVENUE_CONCEPTS) {
      rev = latestAnnual(cm[rc])
      if (rev != null) break
    }

    const netInc = latestAnnual(cm['NetIncomeLoss'])
    const isProfitable = netInc != null ? netInc > 0 : null
    const metrics = []

    if (cat === 'tech') {
      const rd = latestAnnual(cm['ResearchAndDevelopmentExpense'])
      const sbc = latestAnnual(cm['AllocatedShareBasedCompensationExpense']) ?? latestAnnual(cm['ShareBasedCompensation'])
      const defCur = latestAnnual(cm['DeferredRevenueCurrent']) ?? 0
      const defNc = latestAnnual(cm['DeferredRevenueNoncurrent']) ?? 0
      const defRev = (defCur + defNc) || null
      const ocf = latestAnnual(cm['NetCashProvidedByUsedInOperatingActivities'])
      const cash = latestAnnual(cm['CashAndCashEquivalentsAtCarryingValue'])
      const gp = latestAnnual(cm['GrossProfit'])

      if (rd != null) metrics.push({ label: 'R&D Spend', value: fmtM(rd), sub: pctOf(rd, rev) })
      if (sbc != null) metrics.push({ label: 'Stock-Based Comp', value: fmtM(sbc), sub: pctOf(sbc, rev) })
      if (defRev) metrics.push({ label: 'Deferred Revenue', value: fmtM(defRev) })

      if (isProfitable === false && ocf != null && ocf < 0 && cash != null) {
        const burnQtr = Math.abs(ocf) / 4
        const runwayMo = cash > 0 ? Math.round(cash / Math.abs(ocf) * 12) : null
        metrics.push({ label: 'Burn Rate (qtrly)', value: fmtM(burnQtr), highlight: '#e76f51' })
        if (runwayMo != null) metrics.push({ label: 'Cash Runway', value: `~${runwayMo} months`, highlight: runwayMo < 18 ? '#e76f51' : '#15803d' })
      }
    }

    if (cat === 'banks') {
      const assets = latestAnnual(cm['Assets'])
      const equity = latestAnnual(cm['StockholdersEquity'])
      const nim = latestAnnual(cm['NetInterestIncome'])
      const intInc = latestAnnual(cm['InterestAndDividendIncomeOperating'])
      const intExp = latestAnnual(cm['InterestExpense'])
      const nonInt = latestAnnual(cm['NoninterestIncome'])
      const provisions = latestAnnual(cm['ProvisionForLoanAndLeaseLosses']) ?? latestAnnual(cm['ProvisionForDoubtfulAccounts'])
      const loans = latestAnnual(cm['LoansAndLeasesReceivableNetReportedAmount'])

      const netIntInc = nim ?? (intInc != null && intExp != null ? intInc - intExp : null)
      if (netIntInc != null && assets) metrics.push({ label: 'Net Interest Margin', value: pctFmt(netIntInc / assets * 100) })
      if (netIntInc != null) metrics.push({ label: 'Net Interest Income', value: fmtM(netIntInc) })
      if (provisions != null) metrics.push({ label: 'Loan Loss Provisions', value: fmtM(provisions) })
      if (loans != null && provisions != null) metrics.push({ label: 'Provision / Loans', value: pctFmt(provisions / loans * 100) })
      if (netInc != null && equity != null && equity > 0) metrics.push({ label: 'Return on Equity', value: pctFmt(netInc / equity * 100) })
      if (netInc != null && assets != null && assets > 0) metrics.push({ label: 'Return on Assets', value: pctFmt(netInc / assets * 100) })
      if (equity != null) metrics.push({ label: 'Book Value (Equity)', value: fmtM(equity) })
      if (nonInt != null) metrics.push({ label: 'Non-Interest Income', value: fmtM(nonInt) })
    }

    if (cat === 'healthcare') {
      const rd = latestAnnual(cm['ResearchAndDevelopmentExpense'])
      const ocf = latestAnnual(cm['NetCashProvidedByUsedInOperatingActivities'])
      const cash = latestAnnual(cm['CashAndCashEquivalentsAtCarryingValue'])
        ?? latestAnnual(cm['CashCashEquivalentsAndShortTermInvestments'])
      if (rd != null) metrics.push({ label: 'R&D Spend', value: fmtM(rd), sub: pctOf(rd, rev) })

      if (isProfitable === false && ocf != null && ocf < 0) {
        const burnQtr = Math.abs(ocf) / 4
        metrics.push({ label: 'Burn Rate (qtrly)', value: fmtM(burnQtr), highlight: '#e76f51' })
        if (cash != null && cash > 0) {
          const runway = Math.round(cash / Math.abs(ocf) * 12)
          metrics.push({ label: 'Cash Runway', value: `~${runway} months`, highlight: runway < 18 ? '#e76f51' : '#15803d' })
        }
      }
      if (cash != null) metrics.push({ label: 'Cash & Equivalents', value: fmtM(cash) })
      metrics.push({ label: 'Pipeline Stage', value: 'See 10-K', sub: 'Qualitative disclosure' })
    }

    if (cat === 'retail') {
      const sga = latestAnnual(cm['SellingGeneralAndAdministrativeExpense'])
      const inv = latestAnnual(cm['InventoryNet'])
      const cogs = latestAnnual(cm['CostOfGoodsAndServicesSold']) ?? latestAnnual(cm['CostOfRevenue'])

      if (sga != null) metrics.push({ label: 'SG&A', value: fmtM(sga), sub: pctOf(sga, rev) })
      if (inv != null && cogs != null && cogs > 0) metrics.push({ label: 'Inventory Turnover', value: `${(Math.round(cogs / inv * 10) / 10).toFixed(1)}x/yr` })
      if (inv != null) metrics.push({ label: 'Inventory', value: fmtM(inv) })
      metrics.push({ label: 'Same-Store Sales', value: 'See 10-K', sub: 'Reported in narrative' })
    }

    if (cat === 'industrials') {
      const capex = latestAnnual(cm['PaymentsToAcquirePropertyPlantAndEquipment'])
      const inv = latestAnnual(cm['InventoryNet'])
      const ppe = latestAnnual(cm['PropertyPlantAndEquipmentNet'])
      const backlog = latestAnnual(cm['RevenueRemainingPerformanceObligation'])
      const ocf = latestAnnual(cm['NetCashProvidedByUsedInOperatingActivities'])

      if (backlog != null) metrics.push({ label: 'Backlog (Remaining Perf. Oblig.)', value: fmtM(backlog) })
      if (capex != null) metrics.push({ label: 'Capex', value: fmtM(capex), sub: pctOf(capex, rev) })
      if (capex != null && ocf != null && ocf > 0) metrics.push({ label: 'FCF Conversion', value: pctFmt((ocf - capex) / ocf * 100) })
      if (inv != null) metrics.push({ label: 'Inventory', value: fmtM(inv) })
      if (ppe != null) metrics.push({ label: 'PP&E Net', value: fmtM(ppe) })
    }

    if (cat === 'energy') {
      const capex = latestAnnual(cm['PaymentsToAcquirePropertyPlantAndEquipment'])
      const ocf = latestAnnual(cm['NetCashProvidedByUsedInOperatingActivities'])
      const opInc = latestAnnual(cm['OperatingIncomeLoss'])
      const da = latestAnnual(cm['DepreciationDepletionAndAmortization'])
      const debt = latestAnnual(cm['LongTermDebt'])
      const ebitda = opInc != null && da != null ? opInc + da : null

      if (capex != null) metrics.push({ label: 'Capex', value: fmtM(capex) })
      if (ocf != null) metrics.push({ label: 'Operating Cash Flow', value: fmtM(ocf) })
      if (capex != null && ocf != null) metrics.push({ label: 'Capex / OCF', value: pctFmt(capex / Math.abs(ocf) * 100) })
      if (ebitda != null && debt != null && ebitda > 0) metrics.push({ label: 'Debt / EBITDA', value: `${(Math.round(debt / ebitda * 10) / 10).toFixed(1)}x` })
      if (ebitda != null) metrics.push({ label: 'EBITDA', value: fmtM(ebitda) })
      metrics.push({ label: 'Production / Reserves', value: 'See 10-K', sub: 'Company-specific units' })
    }

    if (cat === 'reit') {
      const da = latestAnnual(cm['DepreciationAndAmortization']) ?? latestAnnual(cm['DepreciationDepletionAndAmortization'])
      const divs = latestAnnual(cm['PaymentsOfDividendsCommonStock'])
      const ppe = latestAnnual(cm['RealEstateInvestmentPropertyNet'])
      const assets = latestAnnual(cm['Assets'])
      const debt = latestAnnual(cm['LongTermDebt'])

      const ffo = netInc != null && da != null ? netInc + da : null
      if (ffo != null) metrics.push({ label: 'FFO (Net Inc + D&A)', value: fmtM(ffo) })
      if (divs != null) metrics.push({ label: 'Dividends Paid', value: fmtM(divs) })
      if (ffo != null && divs != null && ffo > 0) metrics.push({ label: 'Payout / FFO', value: pctFmt(divs / ffo * 100) })
      if (debt != null && assets != null && assets > 0) metrics.push({ label: 'Debt / Assets', value: pctFmt(debt / assets * 100) })
      if (ppe != null) metrics.push({ label: 'Real Estate Net', value: fmtM(ppe) })
      metrics.push({ label: 'Occupancy Rate', value: 'See 10-K', sub: 'Supplemental disclosure' })
    }

    if (cat === 'utilities') {
      const regRev = latestAnnual(cm['RegulatedOperatingRevenue'])
      const divs = latestAnnual(cm['PaymentsOfDividendsCommonStock'])
      const debt = latestAnnual(cm['LongTermDebt'])
      const equity = latestAnnual(cm['StockholdersEquity'])

      if (regRev != null && rev != null) metrics.push({ label: 'Regulated Revenue', value: fmtM(regRev), sub: pctOf(regRev, rev) })
      if (divs != null) metrics.push({ label: 'Dividends Paid', value: fmtM(divs) })
      if (divs != null && netInc != null && netInc > 0) metrics.push({ label: 'Payout Ratio', value: pctFmt(divs / netInc * 100) })
      if (debt != null && equity != null && equity > 0) metrics.push({ label: 'Debt / Equity', value: `${(Math.round(debt / equity * 100) / 100).toFixed(2)}x` })
      metrics.push({ label: 'Rate Base Growth', value: 'See 10-K', sub: 'Regulatory filings' })
    }

    return res.status(200).json({
      ticker: ticker.toUpperCase(),
      category: cat,
      isProfitable,
      metrics,
    })
  } catch (err) {
    console.error('sector-metrics error:', err.message)
    return res.status(200).json({ error: err.message })
  }
}
