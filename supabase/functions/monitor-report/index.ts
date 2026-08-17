// InBetween Data Monitor — generates a structured report every Mon/Wed/Sat.
//
// Flow:
//   1. Resolve reporting period from the previous monitoring_reports row.
//   2. Pull deterministic anomalies via code-level checks.
//   3. Build an aggregated data snapshot for the LLM.
//   4. Call Claude with the system prompt → structured JSON output.
//   5. Merge new anomalies with unresolved past ones (assign ESCALATED, bump
//      reports_count).
//   6. Render HTML + PDF, persist to monitoring_reports, fire Telegram alerts.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { callAnthropic } from '../_shared/aiLogger.ts'
import { SYSTEM_PROMPT } from './prompt.ts'
import { runAllChecks, type DetectedAnomaly } from './checks.ts'
import { buildSnapshot } from './snapshot.ts'
import { renderHtml, renderPdf } from './pdf.ts'
import { sendMessage, sendDocument, formatCriticalAlert, resolveButton } from './telegram.ts'

const CLAUDE_MODEL = 'claude-sonnet-4-6'

interface ReportAnomaly {
  id: string
  severity: 'critical' | 'warning' | 'info'
  description: string
  affected: string
  supabase_url: string
  first_detected: string
  reports_count: number
  suggested_direction: string
  status: 'NEW' | 'RECURRING' | 'ESCALATED' | 'RESOLVED'
  kind?: string              // internal dedupe key (not required from LLM)
}

interface ClaudeOutput {
  status: 'ok' | 'attention' | 'critical'
  summary: string
  report_md: string
  anomalies: ReportAnomaly[]
}

function supabaseClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
}

function supabaseProjectUrl() {
  return Deno.env.get('SUPABASE_URL') ?? ''
}

function supabaseRowLink(table: string, id: string) {
  // Dashboard deep links use project ref, but server-side edge fns have the
  // full project URL. Good-enough affordance for now.
  const url = supabaseProjectUrl().replace('.supabase.co', '')
  const ref = url.replace('https://', '')
  return `https://supabase.com/dashboard/project/${ref}/editor?table=${table}&filter=id%3Aeq%3A${id}`
}

function paris(d: Date) {
  return new Date(d.toLocaleString('en-US', { timeZone: 'Europe/Paris' }))
}

// deno-lint-ignore no-explicit-any
async function callClaude(sb: any, payload: unknown): Promise<ClaudeOutput> {
  const json = await callAnthropic(
    {
      model: CLAUDE_MODEL,
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: JSON.stringify(payload) }],
    },
    {
      function_name: 'monitor-report',
      context: 'report',
      class_input_id: null,
      user_id: null,
      supabase: sb,
    },
  )
  const text = json?.content?.[0]?.text ?? ''
  const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/```$/, '').trim()
  try {
    return JSON.parse(cleaned) as ClaudeOutput
  } catch (e) {
    // Surface a clear parse error (with a snippet) instead of a bare
    // SyntaxError, so a truncated / non-JSON Claude response is diagnosable.
    throw new Error(`monitor-report: Claude did not return valid JSON (${e instanceof Error ? e.message : String(e)}): ${cleaned.slice(0, 200)}`)
  }
}

// Authoritative dedupe is on `kind`. IDs are derived from kind (reused if the
// kind appeared before, freshly generated otherwise). The LLM's `id` field is
// ignored to prevent drift across runs.
function mergeAnomalies(
  deterministic: DetectedAnomaly[],
  llmOut: ReportAnomaly[],
  previousAll: ReportAnomaly[],
  today: string,
): ReportAnomaly[] {
  // Index every anomaly we've ever seen by kind.
  const prevByKind = new Map<string, ReportAnomaly>()
  for (const a of previousAll) {
    const k = a.kind ?? a.id
    if (!prevByKind.has(k)) prevByKind.set(k, a)
  }

  const llmByKind = new Map<string, ReportAnomaly>()
  for (const a of llmOut) if (a.kind) llmByKind.set(a.kind, a)

  const datePrefix = `ANOMALY-${today.replace(/-/g, '')}-`
  let idCounter = 0
  const nextId = () => `${datePrefix}${(++idCounter).toString().padStart(3, '0')}`

  function resolveId(kind: string): { id: string; fromHistory: ReportAnomaly | undefined } {
    const fromHistory = prevByKind.get(kind)
    if (fromHistory?.id) return { id: fromHistory.id, fromHistory }
    return { id: nextId(), fromHistory: undefined }
  }

  function statusFor(fromHistory: ReportAnomaly | undefined): ReportAnomaly['status'] {
    if (!fromHistory) return 'NEW'
    return (fromHistory.reports_count ?? 1) >= 2 ? 'ESCALATED' : 'RECURRING'
  }

  const out: ReportAnomaly[] = []
  const emittedKinds = new Set<string>()

  // 1) Deterministic anomalies — authoritative source for severity / affected
  //    / url. LLM entry with the same kind may enrich description & direction.
  for (const d of deterministic) {
    const enrich = llmByKind.get(d.kind)
    const { id, fromHistory } = resolveId(d.kind)
    out.push({
      kind: d.kind,
      id,
      severity: d.severity,
      description: enrich?.description ?? d.description,
      affected: d.affected,
      supabase_url: d.row_table && d.row_id ? supabaseRowLink(d.row_table, d.row_id) : '',
      first_detected: fromHistory?.first_detected ?? d.first_detected,
      reports_count: (fromHistory?.reports_count ?? 0) + 1,
      suggested_direction: enrich?.suggested_direction ?? '',
      status: statusFor(fromHistory),
    })
    emittedKinds.add(d.kind)
  }

  // 2) LLM-only anomalies — patterns the model spotted on its own.
  for (const a of llmOut) {
    const kind = a.kind ?? a.id
    if (!kind || emittedKinds.has(kind)) continue
    const { id, fromHistory } = resolveId(kind)
    out.push({
      ...a,
      kind,
      id,
      first_detected: fromHistory?.first_detected ?? a.first_detected ?? today,
      reports_count: (fromHistory?.reports_count ?? 0) + 1,
      status: a.status ?? statusFor(fromHistory),
    })
    emittedKinds.add(kind)
  }

  // 3) Carry forward previous anomalies whose kind did NOT reappear in this
  //    run. Mark them RESOLVED — absence means the condition cleared.
  //    (We keep them in the report history via anomalies jsonb but remove
  //    them from unresolved_ids upstream.)
  for (const prev of previousAll) {
    const k = prev.kind ?? prev.id
    if (emittedKinds.has(k)) continue
    if (prev.status === 'RESOLVED') continue
    out.push({ ...prev, status: 'RESOLVED' })
    emittedKinds.add(k)
  }

  const sevRank = { critical: 0, warning: 1, info: 2 } as const
  const statusRank = { ESCALATED: 0, RECURRING: 1, NEW: 2, RESOLVED: 3 } as const
  out.sort(
    (a, b) =>
      sevRank[a.severity] - sevRank[b.severity] ||
      statusRank[a.status] - statusRank[b.status],
  )
  return out
}

async function handleRun() {
  const started = Date.now()
  const sb = supabaseClient()

  // ── 1. Period resolution ────────────────────────────────────────────────
  const { data: lastReports } = await sb
    .from('monitoring_reports')
    .select('id, created_at, anomalies, unresolved_ids, summary')
    .order('created_at', { ascending: false })
    .limit(3)

  const previousCreatedAt = lastReports?.[0]?.created_at
  const periodEnd = new Date().toISOString()
  const periodStart =
    previousCreatedAt ?? new Date(Date.now() - 7 * 86400000).toISOString()
  const today = paris(new Date()).toISOString().slice(0, 10)

  // ── 2. Deterministic checks ─────────────────────────────────────────────
  const deterministic = await runAllChecks({
    sb,
    periodStart,
    periodEnd,
    today,
  })

  // ── 3. Data snapshot ────────────────────────────────────────────────────
  const data = await buildSnapshot(sb, periodStart, periodEnd)

  // ── 4. Claude call ──────────────────────────────────────────────────────
  // Use only the most recent report's anomalies — the full active set whose
  // kind we need to either carry forward or mark resolved.
  const previousAll: ReportAnomaly[] = (lastReports?.[0]?.anomalies ?? []) as ReportAnomaly[]

  const payload = {
    period: { start: periodStart, end: periodEnd },
    today,
    supabase_project_url: supabaseProjectUrl(),
    previous_reports: (lastReports ?? []).map((r) => ({
      created_at: r.created_at,
      summary: r.summary,
      anomalies: r.anomalies,
      unresolved_ids: r.unresolved_ids,
    })),
    deterministic_anomalies: deterministic,
    data,
  }

  let llmOut: ClaudeOutput
  try {
    llmOut = await callClaude(sb, payload)
  } catch (e) {
    console.error('[monitor] Claude call failed:', e)
    await sb.from('monitoring_reports').insert({
      period_start: periodStart,
      period_end: periodEnd,
      status: 'critical',
      summary: 'Monitor run failed before report generation',
      error: String(e),
      run_duration_ms: Date.now() - started,
    })
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }

  // ── 5. Merge anomalies with history ─────────────────────────────────────
  const merged = mergeAnomalies(deterministic, llmOut.anomalies ?? [], previousAll, today)

  // ── 6. Render + persist + notify ────────────────────────────────────────
  const html = renderHtml(llmOut.report_md, Deno.env.get('INBETWEEN_LOGO_URL'))
  const pdfBytes = await renderPdf(html)

  const unresolvedIds = merged
    .filter((a) => a.status !== 'RESOLVED')
    .map((a) => a.id)

  const critical = merged.filter((a) => a.severity === 'critical' && a.status !== 'RESOLVED')

  // Fire Telegram alerts before DB write — if DB write fails we've still
  // flagged to the humans. Collect message ids to persist.
  const telegramMessageIds: Record<string, number> = {}
  for (const a of critical) {
    const { message_id } = await sendMessage(
      formatCriticalAlert(a.id, a.description, a.supabase_url || supabaseProjectUrl()),
      resolveButton(a.id),
    )
    if (message_id) telegramMessageIds[a.id] = message_id
  }

  const { data: inserted, error: insertErr } = await sb
    .from('monitoring_reports')
    .insert({
      period_start: periodStart,
      period_end: periodEnd,
      status: llmOut.status,
      summary: llmOut.summary,
      report_md: llmOut.report_md,
      report_pdf: pdfBytes,
      anomalies: merged,
      unresolved_ids: unresolvedIds,
      telegram_message_ids: telegramMessageIds,
      run_duration_ms: Date.now() - started,
    })
    .select('id, report_date')
    .single()

  if (insertErr) {
    console.error('[monitor] insert error:', insertErr)
  }

  // Attach the report itself to Telegram as a document.
  if (pdfBytes) {
    await sendDocument(
      `inbetween-monitor-${inserted?.report_date ?? today}.pdf`,
      pdfBytes,
      `📊 InBetween Monitoring Report — ${inserted?.report_date ?? today}`,
    )
  } else {
    const htmlBytes = new TextEncoder().encode(html)
    await sendDocument(
      `inbetween-monitor-${inserted?.report_date ?? today}.html`,
      htmlBytes,
      `📊 InBetween Monitoring Report — ${inserted?.report_date ?? today} (PDF rendering unavailable — HTML attached)`,
    )
  }

  return new Response(
    JSON.stringify({
      ok: true,
      report_id: inserted?.id,
      status: llmOut.status,
      anomalies: merged.length,
      critical: critical.length,
      duration_ms: Date.now() - started,
    }),
    { headers: { 'content-type': 'application/json' } },
  )
}

function jwtRoleIs(authHeader: string, expectedRole: string): boolean {
  const m = authHeader.match(/^\s*Bearer\s+(.+)$/i)
  if (!m) return false
  const token = m[1].trim()
  const parts = token.split('.')
  if (parts.length !== 3) return false
  try {
    let payload = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const pad = payload.length % 4
    if (pad) payload += '='.repeat(4 - pad)
    const decoded = JSON.parse(atob(payload))
    return decoded?.role === expectedRole
  } catch {
    return false
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }
  // Auth: monitor-report incurs Claude Sonnet 8K + DB queries + Telegram +
  // PDF rendering. Without auth, any anonymous POST burns budget. Only
  // accept service-role JWT (used by the pg_cron sweep configured in the
  // monitoring_reports migration).
  const authHeader = req.headers.get('Authorization') || ''
  if (!jwtRoleIs(authHeader, 'service_role')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    })
  }
  try {
    return await handleRun()
  } catch (e) {
    console.error('[monitor] fatal', e)
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }
})
