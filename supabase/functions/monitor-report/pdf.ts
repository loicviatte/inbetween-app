// Markdown -> HTML -> PDF rendering.
//
// HTML is rendered edge-side (marked). PDF conversion uses PDFShift
// (https://pdfshift.io — free tier: 50 credits/month). If PDFSHIFT_API_KEY
// is unset, we return null bytes and callers fall back to attaching HTML.

import { marked } from 'https://esm.sh/marked@12'

const CSS = `
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1a1a1a; max-width: 780px; margin: 32px auto; padding: 0 24px; line-height: 1.55; }
  h1 { font-size: 24px; border-bottom: 2px solid #111; padding-bottom: 8px; }
  h2 { font-size: 18px; margin-top: 32px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
  h3 { font-size: 15px; margin-top: 20px; }
  table { border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 13px; }
  th, td { border: 1px solid #ddd; padding: 6px 10px; text-align: left; }
  th { background: #f5f5f5; }
  code { background: #f2f2f2; padding: 1px 5px; border-radius: 3px; font-size: 12px; }
  em { color: #555; }
  .logo { max-height: 56px; margin-bottom: 24px; }
`

export function renderHtml(markdown: string, logoUrl?: string): string {
  const body = marked.parse(markdown, { async: false }) as string
  const logo = logoUrl
    ? `<img class="logo" src="${logoUrl}" alt="InBetween" />`
    : ''
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>InBetween Monitoring Report</title>
<style>${CSS}</style></head>
<body>${logo}${body}</body></html>`
}

export async function renderPdf(html: string): Promise<Uint8Array | null> {
  const key = Deno.env.get('PDFSHIFT_API_KEY')
  if (!key) return null
  const res = await fetch('https://api.pdfshift.io/v3/convert/pdf', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`api:${key}`)}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ source: html, landscape: false, format: 'A4' }),
  })
  if (!res.ok) {
    console.error('[pdf] PDFShift error', res.status, await res.text().catch(() => ''))
    return null
  }
  return new Uint8Array(await res.arrayBuffer())
}
