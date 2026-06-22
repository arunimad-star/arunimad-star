import axios from 'axios'

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const CRUMB_TTL = 25 * 60 * 1000 // 25 min (Yahoo crumbs last ~30 min)

let _cookie = null
let _crumb = null
let _ts = 0
let _inflightPromise = null

async function _refresh() {
  try {
    // Step 1: Get session cookie
    const initRes = await axios.get('https://finance.yahoo.com/', {
      headers: { 'User-Agent': UA, Accept: 'text/html' },
      timeout: 10000,
      maxRedirects: 5,
    })
    const cookies = (initRes.headers['set-cookie'] || [])
      .map(c => c.split(';')[0])
      .filter(Boolean)
    _cookie = cookies.join('; ')

    // Step 2: Get crumb using cookie
    const crumbRes = await axios.get('https://query1.finance.yahoo.com/v1/test/getcrumb', {
      headers: { 'User-Agent': UA, Cookie: _cookie, Accept: 'text/plain' },
      timeout: 6000,
    })
    _crumb = String(crumbRes.data).trim()
    _ts = Date.now()
  } catch {
    _crumb = null
    _cookie = null
  }
}

async function ensureAuth() {
  if (_crumb && Date.now() - _ts < CRUMB_TTL) return
  if (_inflightPromise) return _inflightPromise
  _inflightPromise = _refresh().finally(() => { _inflightPromise = null })
  return _inflightPromise
}

export async function yahooSummary(ticker, modules) {
  await ensureAuth()
  const crumbParam = _crumb ? `&crumb=${encodeURIComponent(_crumb)}` : ''
  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=${modules}${crumbParam}`
  return axios.get(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'application/json',
      ...(_cookie ? { Cookie: _cookie } : {}),
    },
    timeout: 8000,
  })
}
