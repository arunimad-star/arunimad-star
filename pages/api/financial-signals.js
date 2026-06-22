import axios from 'axios'

const SEC = 'https://data.sec.gov'
const HDR = { 'User-Agent': 'arunimad@berkeley.edu', Accept: 'application/json' }
const CACHE_TTL = 2 * 60 * 60 * 1000

const cikCache = { data: null, ts: 0 }
const conceptCache = new Map()
const signalsCache = new Map()

async function getCik(ticker) {
  if (!cikCache.data || Date.now() - cikCache.ts > CACHE_TTL) {
    const r = await axios.get('https://www.sec.gov/files/company_tickers.json', { headers: HDR, timeout: 10000 })
    cikCache.data = r.data
    cikCache.ts = Date.now()
  }
  const entry = Object.values(cikCache.data).find(e => e.ticker === ticker.toUpperCase())
  return entry ? String(entry.cik_str).padStart(10, '0') : null
}

async function getConcept(cik, concept) {
  const key = `${cik}_${concept}`
  const hit = conceptCache.get(key)
  if (hit && Date.now() - hit.ts < CACHE_TTL) return hit.data
  try {
    const r = await axios.get(`${SEC}/api/xbrl/companyconcept/CIK${cik}/us-gaap/${concept}.json`, {
      headers: HDR, timeout: 12000
    })
    conceptCache.set(key, { data: r.data, ts: Date.now() })
    return r.data
  } catch { return null }
}

// Annual: most recent N fiscal years from 10-K
function annualVals(concept, nYears = 5) {
  if (!concept) return []
  const arr = concept.units?.USD || concept.units?.['USD/shares'] || concept.units?.shares || []
  const cutoff = new Date()
  cutoff.setFullYear(cutoff.getFullYear() - nYears - 1)
  const byYearMo = {}
  for (const item of arr) {
    if (item.form !== '10-K' || !item.end || item.val == null) continue
    if (new Date(item.filed) < cutoff) continue
    const k = item.end.slice(0, 7)
    if (!byYearMo[k] || item.filed > byYearMo[k].filed) byYearMo[k] = item
  }
  return Object.values(byYearMo)
    .sort((a, b) => a.end.localeCompare(b.end))
    .slice(-nYears)
    .map(i => i.val)
}

// Quarterly income/cash-flow items: single-period 10-Q filings (~60-100 day windows)
function quarterlyFlowVals(concept, nQuarters = 5) {
  if (!concept) return []
  const arr = concept.units?.USD || concept.units?.shares || []
  const quarterly = arr.filter(item => {
    if (item.form !== '10-Q' || !item.start || !item.end || item.val == null) return false
    const days = (new Date(item.end) - new Date(item.start)) / 86400000
    return days >= 55 && days <= 110
  })
  const byEnd = {}
  for (const item of quarterly) {
    if (!byEnd[item.end] || item.filed > byEnd[item.end].filed) byEnd[item.end] = item
  }
  return Object.values(byEnd)
    .sort((a, b) => a.end.localeCompare(b.end))
    .slice(-nQuarters)
    .map(i => i.val)
}

// Quarterly balance-sheet items: point-in-time, any 10-Q
function quarterlyBSVals(concept, nQuarters = 5) {
  if (!concept) return []
  const arr = concept.units?.USD || concept.units?.shares || []
  const quarterly = arr.filter(item => item.form === '10-Q' && item.end && item.val != null)
  const byEnd = {}
  for (const item of quarterly) {
    if (!byEnd[item.end] || item.filed > byEnd[item.end].filed) byEnd[item.end] = item
  }
  return Object.values(byEnd)
    .sort((a, b) => a.end.localeCompare(b.end))
    .slice(-nQuarters)
    .map(i => i.val)
}

const REVENUE_CONCEPTS = [
  'RevenueFromContractWithCustomerExcludingAssessedTax',
  'Revenues',
  'SalesRevenueNet',
  'SalesRevenueGoodsNet',
  'RevenueFromContractWithCustomerIncludingAssessedTax',
]

export default async function handler(req, res) {
  const { ticker } = req.query
  if (!ticker) return res.status(400).json({ error: 'Missing ticker' })

  const sym = ticker.toUpperCase()
  const hit = signalsCache.get(sym)
  if (hit && Date.now() - hit.ts < CACHE_TTL) return res.status(200).json(hit.data)

  try {
    const cik = await getCik(sym)
    if (!cik) return res.status(200).json({ error: `No SEC filing for ${sym}`, annual: {}, quarterly: {} })

    const CONCEPTS = [
      'NetIncomeLoss',
      'OperatingIncomeLoss',
      'GrossProfit',
      'DepreciationDepletionAndAmortization',
      'SellingGeneralAndAdministrativeExpense',
      'ResearchAndDevelopmentExpense',
      'NetCashProvidedByUsedInOperatingActivities',
      'PaymentsToAcquirePropertyPlantAndEquipment',
      'ShareBasedCompensation',
      'InventoryNet',
      'AccountsReceivableNetCurrent',
      'AccountsPayableCurrent',
      'DeferredRevenueCurrent',
      'ContractWithCustomerLiabilityCurrent',
      'CashAndCashEquivalentsAtCarryingValue',
      'CashCashEquivalentsAndShortTermInvestments',
      'LongTermDebt',
      'LongTermDebtNoncurrent',
      'ShortTermBorrowings',
      'DebtCurrent',
      'CommonStockSharesOutstanding',
      'WeightedAverageNumberOfSharesOutstandingBasic',
      'Goodwill',
      'Assets',
      'StockholdersEquity',
      'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest',
      'PropertyPlantAndEquipmentNet',
      'InterestExpense',
      'InterestAndDebtExpense',
      'AssetsCurrent',
      'LiabilitiesCurrent',
      'IncomeTaxExpenseBenefit',
      'RetainedEarningsAccumulatedDeficit',
      'PaymentsForRepurchaseOfCommonStock',
      // Banks
      'NoninterestExpense',
      'LoansAndLeasesReceivableNetReported',
      'LoansAndLeasesReceivableGross',
      'Deposits',
      'InterestIncomeExpenseNet',
      // SaaS / Industrials
      'RevenueRemainingPerformanceObligation',
      'OrdersReceivedNet',
      ...REVENUE_CONCEPTS,
    ]

    const results = await Promise.all(CONCEPTS.map(c => getConcept(cik, c)))
    const cm = {}
    CONCEPTS.forEach((c, i) => { cm[c] = results[i] })

    // Revenue: first concept with ≥2 annual data points
    let revData = null
    for (const c of REVENUE_CONCEPTS) {
      const items = cm[c]?.units?.USD || []
      if (items.filter(i => i.form === '10-K').length >= 2) { revData = cm[c]; break }
    }

    const cashData = cm['CashAndCashEquivalentsAtCarryingValue'] || cm['CashCashEquivalentsAndShortTermInvestments']
    const ltDebtData = cm['LongTermDebt'] || cm['LongTermDebtNoncurrent']
    const stDebtData = cm['ShortTermBorrowings'] || cm['DebtCurrent']
    const defRevData = cm['ContractWithCustomerLiabilityCurrent'] || cm['DeferredRevenueCurrent']
    const sharesData = cm['CommonStockSharesOutstanding'] || cm['WeightedAverageNumberOfSharesOutstandingBasic']
    const equityData = cm['StockholdersEquity'] || cm['StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest']
    const intExpData = cm['InterestExpense'] || cm['InterestAndDebtExpense']
    const loansData  = cm['LoansAndLeasesReceivableNetReported'] || cm['LoansAndLeasesReceivableGross']

    const annual = {
      revenue:         annualVals(revData),
      grossProfit:     annualVals(cm['GrossProfit']),
      netIncome:       annualVals(cm['NetIncomeLoss']),
      operatingIncome: annualVals(cm['OperatingIncomeLoss']),
      da:              annualVals(cm['DepreciationDepletionAndAmortization']),
      ocf:             annualVals(cm['NetCashProvidedByUsedInOperatingActivities']),
      capex:           annualVals(cm['PaymentsToAcquirePropertyPlantAndEquipment']),
      sga:             annualVals(cm['SellingGeneralAndAdministrativeExpense']),
      rd:              annualVals(cm['ResearchAndDevelopmentExpense']),
      inventory:       annualVals(cm['InventoryNet']),
      receivables:     annualVals(cm['AccountsReceivableNetCurrent']),
      payables:        annualVals(cm['AccountsPayableCurrent']),
      deferredRevenue: annualVals(defRevData),
      cash:            annualVals(cashData),
      longTermDebt:    annualVals(ltDebtData),
      shortTermDebt:   annualVals(stDebtData),
      sbc:             annualVals(cm['ShareBasedCompensation']),
      shares:          annualVals(sharesData),
      goodwill:        annualVals(cm['Goodwill']),
      assets:          annualVals(cm['Assets']),
      equity:          annualVals(equityData),
      netPPE:          annualVals(cm['PropertyPlantAndEquipmentNet']),
      interestExpense: annualVals(intExpData),
      currentAssets:   annualVals(cm['AssetsCurrent']),
      currentLiab:     annualVals(cm['LiabilitiesCurrent']),
      taxExpense:      annualVals(cm['IncomeTaxExpenseBenefit']),
      retainedEarnings:annualVals(cm['RetainedEarningsAccumulatedDeficit']),
      buybacks:        annualVals(cm['PaymentsForRepurchaseOfCommonStock']),
      // Banks
      nonInterestExp:  annualVals(cm['NoninterestExpense']),
      loans:           annualVals(loansData),
      deposits:        annualVals(cm['Deposits']),
      netInterestInc:  annualVals(cm['InterestIncomeExpenseNet']),
      // SaaS / Industrials
      rpo:             annualVals(cm['RevenueRemainingPerformanceObligation']),
      backlog:         annualVals(cm['OrdersReceivedNet']),
    }

    const quarterly = {
      revenue:         quarterlyFlowVals(revData),
      grossProfit:     quarterlyFlowVals(cm['GrossProfit']),
      netIncome:       quarterlyFlowVals(cm['NetIncomeLoss']),
      ocf:             quarterlyFlowVals(cm['NetCashProvidedByUsedInOperatingActivities']),
      capex:           quarterlyFlowVals(cm['PaymentsToAcquirePropertyPlantAndEquipment']),
      inventory:       quarterlyBSVals(cm['InventoryNet']),
      cash:            quarterlyBSVals(cashData),
      deferredRevenue: quarterlyBSVals(defRevData),
      receivables:     quarterlyBSVals(cm['AccountsReceivableNetCurrent']),
      payables:        quarterlyBSVals(cm['AccountsPayableCurrent']),
      loans:           quarterlyBSVals(loansData),
      deposits:        quarterlyBSVals(cm['Deposits']),
    }

    const data = { ticker: sym, annual, quarterly }
    signalsCache.set(sym, { data, ts: Date.now() })
    return res.status(200).json(data)
  } catch (err) {
    console.error('financial-signals error:', err.message)
    return res.status(200).json({ error: err.message, annual: {}, quarterly: {} })
  }
}
