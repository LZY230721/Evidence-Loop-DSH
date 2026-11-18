// 证据回路 · HR 视角只读分享页。
//
// 生成一个自包含 HTML（无外部资源、无脚本），再通过 Host 的 shareLink 服务发布成只读链接。
// 发布时只传 path / title / ttlHours，不传 channel（与 share_artifact 工具的实现一致）。
import { existsSync, readFileSync, readdirSync, realpathSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, join, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  SHARE_DIR, SHARE_NOTE_FILE, appendAudit, listReviews, loadPaths, nowIso, readJson, writeJson,
} from './store.js'

const MAX_NOTE = 5000
const DEFAULT_TTL_HOURS = 168
const MAX_EVENTS = 3
const SUMMARY_CHARS = 80
const MAX_SHARE_FILES = 20

const DIMENSION_ORDER = ['完成度', '证据充分性', '结构清晰度', '迭代痕迹']
const VERDICT_RANK = { 不通过: 0, 部分通过: 1, 通过: 2 }

// 分享页只展示摘要片段：短交付物的 summary 等于全文，不能原样公开。
function clipSummary(text, max = SUMMARY_CHARS) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max)}…` : clean
}

export function readShareNote() {
  const record = readJson(SHARE_NOTE_FILE, { note: '', updated_at: null })
  return { note: String(record?.note || ''), updated_at: record?.updated_at || null }
}

export function saveShareNote(note) {
  const value = String(note || '').slice(0, MAX_NOTE)
  const record = { note: value, updated_at: nowIso() }
  writeJson(SHARE_NOTE_FILE, record)
  return record
}

function worstDimension(review) {
  const dims = Array.isArray(review?.dimensions) ? review.dimensions : []
  let worst = null
  for (const dim of dims) {
    if (!(dim?.verdict in VERDICT_RANK)) continue
    if (dim.verdict === '通过') continue
    const order = DIMENSION_ORDER.indexOf(dim.name)
    if (!worst || VERDICT_RANK[dim.verdict] < VERDICT_RANK[worst.verdict]
      || (VERDICT_RANK[dim.verdict] === VERDICT_RANK[worst.verdict] && order < DIMENSION_ORDER.indexOf(worst.name))) {
      worst = dim
    }
  }
  return worst ? { name: worst.name, verdict: worst.verdict, quote: worst.quote || '', reason: worst.reason || '' } : null
}

export function buildShareModel({ data, reviews, note }) {
  const flat = []
  for (const path of data.paths) for (const node of path.nodes || []) flat.push({ path, node })
  const byReviewId = new Map(reviews.map((review) => [review.review_id, review]))

  const reworks = []
  for (const { path, node } of flat) {
    const versions = node.versions || []
    for (let i = 1; i < versions.length; i += 1) {
      const after = versions[i]
      if (!after.rework_reason) continue
      const before = versions[i - 1]
      reworks.push({
        node_id: node.node_id,
        node_title: node.title,
        path_id: path.path_id,
        path_title: path.title,
        before: { version: before.version, summary: before.summary || '', at: before.submitted_at },
        beforeReview: before.review_id ? byReviewId.get(before.review_id) || null : null,
        reason: after.rework_reason,
        after: {
          version: after.version,
          summary: after.summary || '',
          at: after.submitted_at,
          decision: after.review_decision || null,
        },
      })
    }
  }
  reworks.sort((a, b) => String(b.after.at).localeCompare(String(a.after.at)))

  const groups = new Map()
  for (const record of reworks) {
    const attribution = worstDimension(record.beforeReview)
    const key = attribution ? attribution.name : '未归因'
    if (!groups.has(key)) groups.set(key, { dimension: key, count: 0, typical: null })
    const group = groups.get(key)
    group.count += 1
    if (!group.typical) {
      group.typical = {
        node_id: record.node_id,
        node_title: record.node_title,
        verdict: attribution?.verdict || '',
        quote: attribution?.quote || '',
        reason: attribution?.reason || '',
        rework_reason: record.reason,
        at: record.after.at,
      }
    }
  }
  const badcases = [...groups.values()].sort((a, b) => b.count - a.count || a.dimension.localeCompare(b.dimension))

  // 每个节点只取最近一次重做进「关键重做」，避免同一节点连续重做占满名额。
  const latestByNode = new Map()
  for (const record of reworks) {
    if (!latestByNode.has(record.node_id)) latestByNode.set(record.node_id, record)
  }
  const keyEvents = [...latestByNode.values()]
    .sort((a, b) => String(b.after.at).localeCompare(String(a.after.at)))
    .slice(0, MAX_EVENTS)

  const passed = flat.filter(({ node }) => node.status === '已通过复盘').length
  return {
    generated_at: nowIso(),
    note: String(note || ''),
    key_events: keyEvents,
    badcases,
    summary: {
      passed,
      total_nodes: flat.length,
      rework_total: reworks.length,
      rework_nodes: new Set(reworks.map((record) => record.node_id)).size,
      reviews: reviews.length,
    },
  }
}

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;')

const fmtTime = (iso) => {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return escapeHtml(iso)
  return escapeHtml(date.toLocaleString('zh-CN', { hour12: false }))
}

const verdictClass = (verdict) => verdict === '通过' ? 'good' : verdict === '不通过' ? 'bad' : 'mid'

function renderDimensions(review) {
  const dims = Array.isArray(review?.dimensions) ? review.dimensions : []
  if (!dims.length) return '<p class="empty">这一版没有复盘记录。</p>'
  return `<ul class="dims">${dims.map((dim) => {
    const reason = String(dim.reason || '')
    return `
    <li><span class="v ${verdictClass(dim.verdict)}">${escapeHtml(dim.verdict)}</span>
    <div>
      <div>${escapeHtml(dim.name)}${dim.quote ? `：<span class="q">「${escapeHtml(dim.quote)}」</span>` : ''}</div>
      ${dim.verdict !== '通过' && reason ? `<div class="q">${escapeHtml(reason.length > 120 ? `${reason.slice(0, 120)}…` : reason)}</div>` : ''}
    </div></li>`
  }).join('')}</ul>`
}

export function renderShareHtml(model) {
  const events = model.key_events || []
  const badcases = model.badcases || []
  const summary = model.summary

  const eventCards = events.map((event) => `
    <article class="card">
      <div class="node">${escapeHtml(event.node_id)} ${escapeHtml(event.node_title)}</div>
      <div class="sub">路径 ${escapeHtml(event.path_id)} · ${escapeHtml(event.path_title)} · 该节点第 ${event.after.version - 1} 次重做</div>
      <div class="compare">
        <div class="col">
          <h4>重做前 · v${event.before.version}</h4>
          <div class="summary">${escapeHtml(clipSummary(event.before.summary) || '（无摘要）')}</div>
          ${renderDimensions(event.beforeReview)}
        </div>
        <div class="col">
          <h4>重做后 · v${event.after.version}</h4>
          <div class="summary">${escapeHtml(clipSummary(event.after.summary) || '（无摘要）')}</div>
          <p class="q">新版本判定：${escapeHtml(event.after.decision || '待复盘')} · ${fmtTime(event.after.at)}</p>
        </div>
      </div>
      <div class="reason"><b>修改理由：</b>${escapeHtml(event.reason)}</div>
    </article>`).join('')

  const badcaseRows = badcases.map((group) => `
    <tr>
      <td><span class="tag${group.dimension === '未归因' ? ' tag-neutral' : ''}">${escapeHtml(group.dimension)}</span></td>
      <td class="num">${group.count}</td>
      <td>
        <div><b>${escapeHtml(group.typical?.node_id || '')}</b> ${escapeHtml(group.typical?.node_title || '')}</div>
        ${group.typical?.verdict ? `<div class="q">${escapeHtml(group.typical.verdict)}${group.typical.quote ? `：「${escapeHtml(group.typical.quote)}」` : ''}</div>` : ''}
        ${group.typical?.rework_reason ? `<div class="q">修改理由：${escapeHtml(group.typical.rework_reason)}</div>` : ''}
      </td>
    </tr>`).join('')

  const note = model.note.trim()
    ? `<div class="note">${escapeHtml(model.note)}</div>`
    : '<p class="empty">学习者尚未填写。</p>'

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>证据回路 · 我的学习证据台账</title>
<style>
:root{--ink:#15171a;--muted:#5f6673;--line:#e3e6ea;--bg:#f7f8fa;--card:#fff;--accent:#2451b3;--bad:#b42318;--mid:#b54708;--good:#067647}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.75 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
.wrap{max-width:880px;margin:0 auto;padding:48px 24px 72px}
.badge{display:inline-block;font-size:12px;letter-spacing:.06em;color:var(--accent);background:#eaf0fc;border-radius:999px;padding:4px 12px}
h1{font-size:28px;line-height:1.35;margin:14px 0 8px}
.meta{color:var(--muted);font-size:13px}
.stats{display:flex;flex-wrap:wrap;gap:10px;margin:24px 0 8px}
.stat{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 16px;font-size:13px;color:var(--muted);min-width:118px}
.stat b{display:block;font-size:22px;line-height:1.3;color:var(--ink)}
.section{margin-top:40px}
.section h2{font-size:18px;margin:0 0 6px}
.lead{color:var(--muted);font-size:13px;margin:0 0 16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px 22px;margin-bottom:16px}
.node{font-weight:600}
.sub{color:var(--muted);font-size:12px;margin:2px 0 0}
.compare{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:16px}
.col{border:1px solid var(--line);border-radius:10px;padding:12px 14px;background:#fbfcfd}
.col h4{margin:0 0 8px;font-size:12px;color:var(--muted);font-weight:600;letter-spacing:.04em}
.summary{font-size:14px}
.dims{margin:10px 0 0;padding:0;list-style:none;font-size:12px}
.dims li{display:flex;gap:8px;padding:4px 0;border-top:1px dashed var(--line)}
.dims li:first-child{border-top:0}
.v{font-weight:600;flex:none}
.v.bad{color:var(--bad)}.v.mid{color:var(--mid)}.v.good{color:var(--good)}
.q{color:var(--muted);font-size:12px;margin-top:6px}
.reason{margin-top:14px;border-left:3px solid var(--accent);padding:8px 12px;background:#f3f6fd;border-radius:0 8px 8px 0;font-size:14px}
.table-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:12px}
.table{width:100%;min-width:520px;border-collapse:collapse;font-size:13px;background:var(--card)}
.table th,.table td{text-align:left;padding:10px 12px;border-top:1px solid var(--line);vertical-align:top}
.table th{background:#f1f3f6;color:var(--muted);font-weight:600;font-size:12px}
.table tr:first-child th{border-top:0}
.table .num{font-variant-numeric:tabular-nums}
.tag{display:inline-block;font-size:12px;background:#fdecea;color:var(--bad);border-radius:6px;padding:1px 8px}
.tag-neutral{background:#eef0f3;color:#4a515b}
.note{white-space:pre-wrap;font-size:15px;line-height:1.9;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px 20px}
.empty{color:var(--muted);font-size:13px}
footer{margin-top:44px;color:var(--muted);font-size:12px;border-top:1px solid var(--line);padding-top:16px;line-height:1.8}
@media(max-width:680px){.compare{grid-template-columns:1fr}.wrap{padding:28px 16px 56px}h1{font-size:23px}}
@media print{body{background:#fff}.card,.stat,.table-wrap{break-inside:avoid}h2{break-after:avoid}@page{margin:16mm}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style>
</head>
<body>
<div class="wrap">
  <span class="badge">证据回路 · 只读分享</span>
  <h1>我的学习证据台账</h1>
  <div class="meta">生成于 ${fmtTime(model.generated_at)} · 只读快照</div>

  <div class="stats">
    <div class="stat"><b>${summary.passed}</b>已通过复盘节点</div>
    <div class="stat"><b>${summary.rework_total}</b>重做提交</div>
    <div class="stat"><b>${summary.rework_nodes}</b>发生过重做的节点</div>
    <div class="stat"><b>${summary.reviews}</b>次复盘记录</div>
  </div>

  <section class="section">
    <h2>关键重做：改了什么，为什么改</h2>
    <p class="lead">每个节点最值得看的重做前后对比：旧版摘要 + 复盘判定 + 修改理由 + 新版摘要。</p>
    ${eventCards || '<p class="empty">还没有重做记录。等出现第一次「需重做 → 重新提交」后，这里会自动收录。</p>'}
  </section>

  <section class="section">
    <h2>我的 Bad Case 台账</h2>
    <p class="lead">按复盘中最弱的那一维归因；只展示分组计数与典型一条，便于看清重复犯的错。</p>
    ${badcaseRows
      ? `<div class="table-wrap"><table class="table"><thead><tr><th>归因维度</th><th>次数</th><th>典型一条</th></tr></thead><tbody>${badcaseRows}</tbody></table></div>`
      : '<p class="empty">还没有可归因的重做记录。</p>'}
  </section>

  <section class="section">
    <h2>我从这次重做中学到了什么</h2>
    ${note}
  </section>

  <footer>
    只读快照：仅收录摘要片段（每条不超过 80 字）、复盘判定与修改理由，可能包含交付物开头片段。生成后不会再更新。
  </footer>
</div>
</body>
</html>`
}

const pad = (value) => String(value).padStart(2, '0')
function stamp(date = new Date()) {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

// 本机预览：只允许读取 share/ 下的 .html 快照（挡目录穿越与非 HTML）。
export function readShareFile(name) {
  const safeName = basename(String(name || ''))
  if (!/^[A-Za-z0-9._-]+\.html$/.test(safeName)) return null
  let base
  try { base = realpathSync(SHARE_DIR) } catch { return null }
  const file = join(base, safeName)
  if (!file.startsWith(base + sep)) return null
  if (!existsSync(file) || !statSync(file).isFile()) return null
  return readFileSync(file, 'utf8')
}

// share-link 在隧道失败时会把错误日志里的 api.trycloudflare.com 当成隧道地址，必须识别并拒绝。
function isBadShareUrl(url) {
  if (typeof url !== 'string' || url.length === 0) return true
  try {
    const parsed = new URL(url)
    if (/^api\./i.test(parsed.hostname)) return true
    if (!/\/s\/[a-z0-9]+\/?$/i.test(parsed.pathname)) return true
    return false
  } catch {
    return true
  }
}

export function clampTtl(hours) {
  const value = Number(hours)
  if (!Number.isFinite(value)) return DEFAULT_TTL_HOURS
  return Math.min(24 * 30, Math.max(1, Math.round(value)))
}

function pruneShareFiles() {
  try {
    const files = readdirSync(SHARE_DIR)
      .filter((name) => name.endsWith('.html'))
      .map((name) => ({ name, mtime: statSync(join(SHARE_DIR, name)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
    for (const old of files.slice(MAX_SHARE_FILES)) unlinkSync(join(SHARE_DIR, old.name))
  } catch {
    // 清理失败不影响本次生成。
  }
}

// 生成 HTML → 落盘 → 通过 shareLink 发布（不传 channel）。发布失败也保留本地文件。
export async function generateShare(ctx, options = {}) {
  const note = readShareNote().note
  const model = buildShareModel({ data: loadPaths(), reviews: listReviews(), note })
  const html = renderShareHtml(model)
  const file = join(SHARE_DIR, `evidence-loop-${stamp()}-${randomUUID().slice(0, 6)}.html`)
  writeFileSync(file, html, 'utf8')
  pruneShareFiles()

  const title = String(options.title || '证据回路 · 我的学习证据台账').slice(0, 80)
  const ttlHours = clampTtl(options.ttlHours)
  let publish = null
  let publishError = null
  const share = ctx.get('shareLink')
  if (share && typeof share.createPathShare === 'function') {
    try {
      // 与 share_artifact 工具一致：只传 path/title/ttlHours，不传 channel。
      const entry = await share.createPathShare(file, { title, ttlHours })
      if (isBadShareUrl(entry?.url)) {
        // 上游把 api.trycloudflare.com 当成了隧道地址：撤销记录，绝不把坏链接给用户。
        if (entry?.id && typeof share.revoke === 'function') {
          try { await share.revoke(entry.id) } catch {}
        }
        publishError = `分享服务没有建立隧道，返回了无效地址（${entry?.url || '空'}）。Cloudflare Quick Tunnel 被当前网络阻断时会出现这种情况；可用下方「本机预览」验证页面，或开启全局代理后重试。`
      } else {
        publish = {
          url: entry.url,
          id: entry.id || null,
          expires_at: entry.expiresAt || null,
          provider: entry.provider || null,
          degraded: entry.degraded === true,
          degraded_reason: entry.degradedReason || null,
        }
      }
    } catch (err) {
      publishError = String(err?.message || err)
    }
  } else {
    publishError = '分享服务不可用（shareLink 服务缺席）'
  }

  appendAudit({
    action: 'share_built',
    path: file,
    local_path: `/evidence-loop/share/${basename(file)}`,
    url: publish?.url || null,
    id: publish?.id || null,
    error: publishError,
    events: model.key_events.length,
    badcases: model.badcases.length,
  })

  return {
    ok: true,
    path: file,
    local_path: `/evidence-loop/share/${basename(file)}`,
    title,
    ttl_hours: ttlHours,
    model: {
      summary: model.summary,
      key_events: model.key_events.length,
      badcases: model.badcases.length,
    },
    publish,
    publish_error: publishError,
  }
}
