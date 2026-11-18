// 证据回路 · 面板数据面（/evidence-loop 前缀路由）。
//   GET  /evidence-loop/api/state   面板状态（含节点 review_state）
//   GET  /evidence-loop/api/audit   审计台四块数据
//   POST /evidence-loop/api/start   未开始 → 练习中
//   POST /evidence-loop/api/submit  练习中/需重做 → 已提交，并触发异步 AI 复盘
//   POST /evidence-loop/api/review  对当前版本重新触发复盘（失败/中断后使用）
import { buildAudit } from './audit.js'
import { readChat, resetChat, sendChat } from './chat.js'
import { Blocked, startNode, submitVersion } from './machine.js'
import { listReviews, loadPaths, readAudit } from './store.js'
import { buildShareModel, generateShare, readShareFile, readShareNote, saveShareNote } from './share.js'
import { queueReview, retryReview } from './review.js'
import { buildState } from './state.js'

const BASE = '/evidence-loop'
let shareBuildInFlight = false

function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}

function rejection(ctx, req) {
  const connection = ctx.get('connection')
  if (typeof connection?.requestRejection !== 'function') return false
  return connection.requestRejection({ headers: req.headers })
}

function readJson(req, max = 512 * 1024) {
  return new Promise((resolve, reject) => {
    if (req.method !== 'POST') return reject(Object.assign(new Error('method'), { status: 405 }))
    if (!/^application\/json\b/.test(req.headers['content-type'] || '')) return reject(Object.assign(new Error('content-type'), { status: 415 }))
    const origin = req.headers.origin
    if (origin && origin.replace(/^https?:\/\//, '') !== req.headers.host) {
      return reject(Object.assign(new Error('origin'), { status: 403 }))
    }
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > max) req.destroy()
      else chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch (err) {
        reject(Object.assign(err, { status: 400 }))
      }
    })
    req.on('error', reject)
  })
}

async function run(ctx, action, body) {
  if (action === 'start') {
    startNode(String(body.nodeId || ''))
    return { ok: true, state: buildState() }
  }
  if (action === 'submit') {
    const result = submitVersion(String(body.nodeId || ''), body.content, body.reworkReason)
    // 提交即触发异步 AI 复盘；状态机只认复盘 JSON 的判定，LLM 不能直接改状态。
    queueReview(ctx, result.node.node_id, result.submission.submission_id)
    return {
      ok: true,
      state: buildState(),
      submission: {
        submission_id: result.submission.submission_id,
        version: result.submission.version,
        summary: result.submission.summary,
        rework: result.rework,
      },
    }
  }
  if (action === 'review') {
    const nodeId = String(body.nodeId || '')
    retryReview(ctx, nodeId, { force: Boolean(body.force) })
    return { ok: true, state: buildState() }
  }
  throw Object.assign(new Error('未知操作'), { status: 404 })
}

export function registerApi(ctx) {
  return ctx.webServer.register({
    kind: 'prefix',
    path: BASE,
    async handler(req, res) {
      try {
        const denied = rejection(ctx, req)
        if (typeof denied === 'number') return json(res, denied, { ok: false, error: '未授权' })

        const url = new URL(req.url, 'http://x')
        if (url.pathname !== BASE && !url.pathname.startsWith(`${BASE}/`)) {
          return json(res, 404, { ok: false, error: 'not found' })
        }
        const path = url.pathname.slice(BASE.length) || '/'

        // 本机预览：同源只读 HTML，浏览器里直接打开（分享隧道不可用时的兜底）。
        if (path.startsWith('/share/') && (req.method === 'GET' || req.method === 'HEAD')) {
          const html = readShareFile(path.slice('/share/'.length))
          if (html === null) return json(res, 404, { ok: false, error: 'not found' })
          res.writeHead(200, {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'no-store',
            'x-content-type-options': 'nosniff',
          })
          return res.end(req.method === 'HEAD' ? undefined : html)
        }

        if (path === '/api/state' && (req.method === 'GET' || req.method === 'HEAD')) {
          return json(res, 200, buildState())
        }
        if (path === '/api/audit' && (req.method === 'GET' || req.method === 'HEAD')) {
          return json(res, 200, buildAudit())
        }
        if (path === '/api/share/note' && (req.method === 'GET' || req.method === 'HEAD')) {
          const record = readShareNote()
          return json(res, 200, { ok: true, ...record })
        }
        if (path === '/api/share/preview' && (req.method === 'GET' || req.method === 'HEAD')) {
          const model = buildShareModel({ data: loadPaths(), reviews: listReviews(), note: readShareNote().note })
          const last = [...readAudit(300).events].reverse()
            .find((event) => event.action === 'share_built')
          const lastUrlBad = typeof last?.url === 'string' && /^https?:\/\/api\./i.test(last.url)
          return json(res, 200, {
            ok: true,
            summary: model.summary,
            key_events: model.key_events.length,
            badcases: model.badcases.length,
            note: model.note,
            last_publish: last
              ? {
                  url: lastUrlBad ? null : last.url || null,
                  id: last.id || null,
                  path: last.path || null,
                  local_path: last.local_path || null,
                  at: last.at,
                  error: last.error || (lastUrlBad ? '上次返回的是无效的 API 地址' : null),
                }
              : null,
          })
        }

        if (path === '/api/share/note' && req.method === 'POST') {
          try {
            const body = await readJson(req)
            const record = saveShareNote(String(body.note || ''))
            return json(res, 200, { ok: true, ...record })
          } catch (err) {
            return json(res, err.status || 400, { ok: false, error: err?.message || '保存失败' })
          }
        }

        // 呼叫教练：读取历史 / 发送一条 / 清空
        if (path === '/api/chat' && (req.method === 'GET' || req.method === 'HEAD')) {
          try {
            return json(res, 200, { ok: true, ...readChat(url.searchParams.get('nodeId') || '') })
          } catch (err) {
            return json(res, err.status || 500, { ok: false, error: err?.message || '读取对话失败' })
          }
        }
        if (path === '/api/chat' && req.method === 'POST') {
          try {
            const body = await readJson(req)
            const payload = await sendChat(ctx, String(body.nodeId || ''), body.message)
            return json(res, 200, { ok: true, ...payload })
          } catch (err) {
            return json(res, err.status || 500, { ok: false, error: err?.message || '教练暂时不可用' })
          }
        }
        if (path === '/api/chat/reset' && req.method === 'POST') {
          try {
            const body = await readJson(req)
            return json(res, 200, { ok: true, ...resetChat(String(body.nodeId || '')) })
          } catch (err) {
            return json(res, err.status || 500, { ok: false, error: err?.message || '清空对话失败' })
          }
        }
        if (path === '/api/share/build' && req.method === 'POST') {
          if (shareBuildInFlight) return json(res, 409, { ok: false, error: '正在生成分享页，请稍候' })
          shareBuildInFlight = true
          try {
            const body = await readJson(req)
            const payload = await generateShare(ctx, { ttlHours: body.ttlHours, title: body.title })
            return json(res, 200, payload)
          } catch (err) {
            return json(res, err.status || 500, { ok: false, error: err?.message || '生成分享页失败' })
          } finally {
            shareBuildInFlight = false
          }
        }

        const actions = { '/api/start': 'start', '/api/submit': 'submit', '/api/review': 'review' }
        if (actions[path]) {
          if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method' })
          try {
            const body = await readJson(req)
            const payload = await run(ctx, actions[path], body)
            return json(res, 200, payload)
          } catch (err) {
            if (err instanceof Blocked) {
              // 拦截也回一份最新投影：界面被拒后立刻回到真实状态，而不是停在旧状态反复点。
              return json(res, 409, { ok: false, blocked: true, error: err.message, details: err.details || {}, state: buildState() })
            }
            return json(res, err.status || 500, { ok: false, error: err?.message || '操作失败' })
          }
        }

        return json(res, 404, { ok: false, error: 'not found' })
      } catch (err) {
        return json(res, 500, { ok: false, error: err?.message || '内部错误' })
      }
    },
  })
}
