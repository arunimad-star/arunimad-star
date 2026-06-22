# VSProjectA Website

Minimal Next.js scaffold with a placeholder API to fetch Capital IQ data.

Quick start:

```bash
# from workspace root
npm install
npm run dev
```

Notes:
- The API route `pages/api/capi.js` is now a server-side proxy that forwards requests to Capital IQ.
- Do not commit API credentials; copy `.env.local.example` to `.env.local` and fill in `CIQ_API_URL` and `CIQ_API_KEY`.

Testing the API locally:

1. Create `.env.local` at the project root with your credentials. Example contents are in `.env.local.example`.
2. Start the dev server:

```bash
npm install
npm run dev
```

3. Request data (optionally pass `tickers` as a comma-separated list):

```bash
curl "http://localhost:3000/api/capi?tickers=AAPL,MSFT"
```
