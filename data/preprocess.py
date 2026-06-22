import csv
import json
import re
from datetime import datetime

def parse_float(v):
    if not v: return None
    v = v.strip()
    if v in ('-', 'NA', 'N/A', '', '—'): return None
    negative = v.startswith('(') and v.endswith(')')
    v = v.strip('()').lstrip('$').replace(',', '')
    try:
        n = float(v)
        return -n if negative else n
    except:
        return None

def parse_int(v):
    if not v: return None
    v = v.strip().replace(',', '')
    if v in ('-', 'NA', 'N/A', '', '—'): return None
    try:
        return int(float(v))
    except:
        return None

def parse_date(v):
    if not v or v.strip() in ('-', 'NA', 'N/A', '', '—'): return None
    for fmt in ['%m/%d/%Y', '%Y-%m-%d', '%d/%m/%Y']:
        try:
            return datetime.strptime(v.strip(), fmt).strftime('%Y-%m-%d')
        except:
            pass
    return None

SECTOR_MAP = {
    'consumer discretionary': 'Consumer Cyclical',
    'consumer staples':       'Consumer Defensive',
    'health care':            'Healthcare',
    'healthcare':             'Healthcare',
    'information technology': 'Technology',
    'communication services': 'Communication Services',
    'financials':             'Financial Services',
    'energy':                 'Energy',
    'materials':              'Basic Materials',
    'industrials':            'Industrials',
    'utilities':              'Utilities',
    'real estate':            'Real Estate',
}

def map_sector(raw):
    s = (raw or '').strip().lower()
    for k, v in SECTOR_MAP.items():
        if k in s:
            return v
    return raw.strip() if raw else ''

def map_exchange(raw):
    r = (raw or '').lower()
    if 'nasdaq' in r: return 'Nasdaq'
    if 'nyse' in r:   return 'NYSE'
    return raw.split('[')[0].strip()

def safe_div(a, b, scale=1, digits=2):
    if a is not None and b and b != 0:
        return round(a / b * scale, digits)
    return None

companies = []

with open('data/vsv3.csv', encoding='utf-8-sig', errors='replace') as f:
    reader = csv.reader(f)
    next(reader)  # header at row 0
    for row in reader:
        if len(row) < 15: continue
        def g(c): return row[c].strip() if c < len(row) else ''

        # col[0] = "Apple Inc. (NasdaqGS:AAPL)" — extract name and Exchange:Ticker from it
        raw0 = g(0)
        m = re.search(r'\(([^)]+):([^)]+)\)\s*$', raw0)
        name = re.sub(r'\s*\([^)]*:[^)]*\)\s*$', '', raw0).strip()
        if not name: continue
        ticker_raw = m.group(0)[1:-1] if m else g(1)  # "NasdaqGS:AAPL"
        ticker = m.group(2).strip() if m else (g(1).split(':')[-1].strip().rstrip(')') if ':' in g(1) else g(1).strip())

        total_revenue = parse_float(g(14))
        gross_profit  = parse_float(g(76))
        ebitda        = parse_float(g(12))
        ebit          = parse_float(g(67))
        net_income    = parse_float(g(68))
        market_cap    = parse_float(g(15))
        tev           = parse_float(g(13))

        # Balance sheet & cash flow
        cash             = parse_float(g(70))
        total_assets     = parse_float(g(71))
        net_ppe          = parse_float(g(72))
        total_equity     = parse_float(g(73))
        capex            = parse_float(g(74))
        cfo              = parse_float(g(75))
        sbc              = parse_float(g(77))
        rd_exp           = parse_float(g(78))
        interest_exp     = parse_float(g(81))
        inventory        = parse_float(g(83))
        total_receivables= parse_float(g(85))
        nwc              = parse_float(g(88))

        # Ownership / analyst fields
        num_analysts     = parse_int(g(23))
        research_docs_30d= parse_int(g(24))
        ceo_owned_pct    = parse_float(g(64))
        ceo_chg_pct      = parse_float(g(65))
        hf_owned_pct     = parse_float(g(66))

        # Short interest, D/E, 52-week price range, price, beta
        short_interest   = parse_float(g(97))   # % of float
        days_to_cover    = parse_float(g(98))
        debt_equity      = parse_float(g(99))   # LT Debt/Equity %
        week52_low       = parse_float(g(100))
        week52_high      = parse_float(g(101))
        price            = parse_float(g(102))
        beta             = parse_float(g(103))

        rev = total_revenue
        tev_ltm_rev      = safe_div(tev, rev)
        gross_margin     = safe_div(gross_profit, rev, 100)
        operating_margin = safe_div(ebit, rev, 100)
        ebitda_margin    = safe_div(ebitda, rev, 100)
        net_margin       = safe_div(net_income, rev, 100)

        # Derived screening ratios
        fcf              = round(cfo - capex, 1) if cfo is not None and capex is not None else None
        tev_ebitda       = safe_div(tev, ebitda)
        invested_capital = (total_assets - cash) if total_assets is not None and cash is not None else None
        roic             = safe_div(ebit, invested_capital, 100, 2) if invested_capital else None
        sbc_rev          = safe_div(sbc, rev, 100)
        rd_rev           = safe_div(rd_exp, rev, 100)
        ppe_rev          = safe_div(net_ppe, rev, 1, 3)
        inventory_rev    = safe_div(inventory, rev, 1, 3)
        interest_cov     = safe_div(ebit, interest_exp, 1, 2) if interest_exp and interest_exp > 0 else None
        cash_to_mcap     = safe_div(cash, market_cap, 1, 3)
        net_debt         = round(tev - market_cap, 1) if tev and market_cap else None
        net_debt_ebitda  = safe_div(net_debt, ebitda) if net_debt is not None and ebitda and ebitda > 0 else None

        desc = g(34) or g(17) or g(29)
        product_name = g(28)
        product_description = g(27)
        website = g(45)

        companies.append({
            'id':              ticker or name[:20],
            'name':            name,
            'ticker':          ticker,
            'exchangeTicker':  ticker_raw,
            'securityTickers': ticker_raw,
            'exchange':        map_exchange(g(95)),
            'price':           price,
            'week52Low':       week52_low,
            'week52High':      week52_high,
            'marketCap':       market_cap,
            'tev':             tev,
            'totalRevenue':    total_revenue,
            'grossProfit':     gross_profit,
            'ebitda':          ebitda,
            'ebit':            ebit,
            'netIncome':       net_income,
            'totalDebt':       None,
            'beta':            beta,
            'shortInterest':   short_interest,
            'daysToCover':     days_to_cover,
            'debtEquity':      debt_equity,
            'pe':              None,
            'tevLtmRev':       tev_ltm_rev,
            'tevEbitda':       tev_ebitda,
            'grossMargin':     gross_margin,
            'operatingMargin': operating_margin,
            'ebitdaMargin':    ebitda_margin,
            'netMargin':       net_margin,
            'cash':            cash,
            'totalAssets':     total_assets,
            'netPPE':          net_ppe,
            'totalEquity':     total_equity,
            'capex':           capex,
            'cfo':             cfo,
            'sbc':             sbc,
            'rdExp':           rd_exp,
            'interestExp':     interest_exp,
            'inventory':       inventory,
            'totalReceivables':total_receivables,
            'nwc':             nwc,
            'fcf':             fcf,
            'sbcRev':          sbc_rev,
            'rdRev':           rd_rev,
            'ppeRev':          ppe_rev,
            'inventoryRev':    inventory_rev,
            'interestCov':     interest_cov,
            'roic':            roic,
            'cashToMcap':      cash_to_mcap,
            'netDebt':         net_debt,
            'netDebtEbitda':   net_debt_ebitda,
            'numAnalysts':     num_analysts,
            'researchDocs30d': research_docs_30d,
            'ceoOwnedPct':     ceo_owned_pct,
            'ceoChgPct':       ceo_chg_pct,
            'hfOwnedPct':      hf_owned_pct,
            'primarySector':   map_sector(g(44)),
            'primaryIndustry': g(43),
            'description':     desc,
            'productName':     product_name,
            'productDescription': product_description,
            'website':         website,
            'earningsCadence': '',
            'lastEarningsDate':  None,
            'nextEarningsDate':  parse_date(g(22)),
            'guidance':          '',
            'earningsSurprise':  None,
            'earningsBeatMiss':  '',
            'fyLabel':           None,
            'history':           None,
        })

with open('data/companies.json', 'w') as f:
    json.dump(companies, f, separators=(',', ':'))

print(f'Done: {len(companies)} companies written to data/companies.json')
