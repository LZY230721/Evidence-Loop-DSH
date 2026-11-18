// 证据回路 · 浏览器半边（面板渲染）。
// 通过 dsh.client 声明加载；在侧栏注册「证据回路」入口，并在 main 槽渲染面板。
window.__ModuleLoader__.load({
  id: 'dsh-evidence-loop',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback, useRef } = React

    const PANEL_ID = 'evidence-loop'
    const API = '/evidence-loop/api/'
    // 与宿主 lib/version.js 的 API_VERSION 保持一致；不一致时面板会显式提示重启。
    const EXPECTED_API_VERSION = 4

    const STATUS_HINT = {
      未开始: '尚未开始练习',
      练习中: '已开始，等待提交作业',
      已提交: '已提交，等待复盘',
      已通过复盘: '证据已通过复盘，计入完成度',
      需重做: '复盘判定证据不足，需重做',
    }

    const EVENT_LABEL = {
      seed: '初始化路径',
      status_change: '状态流转',
      blocked: '拦截',
      review_started: '复盘开始',
      review_applied: '复盘写入',
      review_rejected: '复盘被拒',
      review_failed: '复盘失败',
      review_attempt_failed: '复盘重试',
      plugin_boot: '插件启动',
      external_check: '外部校验',
      share_built: '分享页生成',
    }

    const TRIGGER_LABEL = {
      start: '开始',
      submit: '提交',
      resubmit: '重做提交',
    }

    const DIMENSIONS = ['完成度', '证据充分性', '结构清晰度', '迭代痕迹']
    const DIM_COLOR = {
      完成度: 'var(--dsw-alias-brand-primary)',
      证据充分性: 'var(--dsw-alias-state-success-primary)',
      结构清晰度: 'var(--dsw-alias-state-warn-primary)',
      迭代痕迹: 'var(--dsw-alias-state-error-primary)',
    }
    const VERDICT_TEXT = { 3: '通过', 2: '部分通过', 1: '不通过' }

    const TONE = {
      未开始: 'idle',
      练习中: 'active',
      已提交: 'wait',
      已通过复盘: 'pass',
      需重做: 'fail',
    }

    function fmtTime(iso) {
      if (!iso) return '—'
      const date = new Date(iso)
      if (Number.isNaN(date.getTime())) return String(iso)
      return date.toLocaleString('zh-CN', { hour12: false })
    }

    function percent(part, total) {
      if (!total) return 0
      return Math.round((part / total) * 100)
    }

    async function request(path, body) {
      const timeoutMs = path.startsWith('chat') ? 75_000 : path === 'share/build' ? 120_000 : 60_000
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      const init = {
        ...(body
          ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
          : { method: 'GET' }),
        signal: controller.signal,
      }
      let res
      try {
        res = await fetch(API + path, init)
      } catch (err) {
        if (controller.signal.aborted) throw new Error('请求超时，请重试。')
        throw new Error(`连接不到插件后台（${err && err.message ? err.message : '网络错误'}）`)
      } finally {
        clearTimeout(timer)
      }
      const payload = await res.json().catch(() => null)
      if (!res.ok || !payload || payload.ok === false) {
        const raw = (payload && payload.error) || `请求失败（HTTP ${res.status}）`
        const error = new Error(
          res.status === 404 && raw === 'not found'
            ? '接口不存在：证据回路的宿主代码可能还是旧版本。请完全退出 DeepSeek Harness（含托盘图标 → 退出）后重新打开；仅刷新页面不会重新加载宿主。'
            : raw
        )
        if (payload && payload.state) error.state = payload.state
        throw error
      }
      return payload
    }

    function Chip({ tone, children }) {
      return h('span', { className: 'el-chip', 'data-tone': tone || 'idle' }, children)
    }

    function StatusChip({ status }) {
      return h(Chip, { tone: TONE[status] || 'idle' }, status)
    }

    function VerdictChip({ verdict }) {
      const tone = verdict === '通过' ? 'pass' : verdict === '不通过' ? 'fail' : 'wait'
      return h(Chip, { tone }, verdict)
    }

    function PanelIcon(props) {
      const size = (props && props.size) || 18
      return h(
        'svg',
        {
          width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
          stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        h('path', { d: 'M4.5 9.5A8 8 0 0 1 19 8' }),
        h('path', { d: 'M19 3.5V8h-4.5' }),
        h('path', { d: 'M19.5 14.5A8 8 0 0 1 5 16' }),
        h('path', { d: 'M5 20.5V16h4.5' }),
        h('path', { d: 'M9.2 12.4l2 2 3.6-4' })
      )
    }

    function EvidencePanel() {
      const [data, setData] = useState(null)
      const [error, setError] = useState('')
      const [loading, setLoading] = useState(true)
      const [tab, setTab] = useState('paths')
      const [expanded, setExpanded] = useState(null)
      const [refreshToken, setRefreshToken] = useState(0)

      const load = useCallback(async () => {
        try {
          const payload = await request('state')
          setData(payload)
          setError('')
        } catch (err) {
          setError(err.message)
        } finally {
          setLoading(false)
        }
      }, [])

      useEffect(() => {
        load()
      }, [load])

      // 有节点正在复盘时轮询：提交后界面不必手动刷新，复盘完成自动更新状态。
      useEffect(() => {
        const running = !!(data && data.paths.some((path) => path.nodes.some((node) => node.review_state === 'running')))
        if (!running) return undefined
        const timer = setInterval(() => { load() }, 1500)
        return () => clearInterval(timer)
      }, [data, load])

      const applyState = useCallback((next) => {
        if (next) setData(next)
      }, [])

      const focusNode = useCallback((nodeId) => {
        setTab('paths')
        setExpanded(nodeId)
        setTimeout(() => {
          const el = document.getElementById(`el-node-${nodeId}`)
          if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center', behavior: 'smooth' })
        }, 60)
      }, [])

      const stats = data ? data.stats : null
      const outdated = !!(data && data.api_version !== EXPECTED_API_VERSION)

      return h(
        'div',
        { className: 'el-root' },
        h('style', { key: 'el-css' }, CSS),
        h(
          'div',
          { className: 'el-inner' },
          h(
            'div',
            { className: 'el-head' },
            h(
              'div',
              null,
              h('div', { className: 'el-title' }, '证据回路'),
              h('div', { className: 'el-sub' }, '打卡不等于掌握：只有提交可审计的证据并通过复盘，知识点才计入完成度。')
            ),
            h(
              'div',
              { style: { display: 'flex', gap: 8, alignItems: 'center' } },
              h(
                'button',
                {
                  className: 'el-btn el-btn-ghost',
                  onClick: () => { load(); setRefreshToken((value) => value + 1) },
                  disabled: loading,
                  title: '重新读取本地数据',
                },
                loading ? '读取中…' : '刷新'
              )
            )
          ),
          outdated
            ? h(
                'div',
                { className: 'el-banner' },
                h('b', null, '面板与宿主版本不一致：'),
                '浏览器半边是新版，但宿主仍在运行旧版证据回路（没有 AI 复盘与审计接口）。请 ',
                h('b', null, '完全退出 DeepSeek Harness（含托盘图标 → 退出）'),
                ' 后重新打开；仅刷新页面不会重新加载宿主代码。已提交但未复盘的版本，重启后在节点内点「开始复盘」即可补跑。'
              )
            : null,

          h(
            'div',
            { className: 'el-tabs', role: 'tablist' },
            h('button', {
              className: 'el-tab', role: 'tab', 'aria-selected': String(tab === 'paths'), 'data-active': String(tab === 'paths'),
              onClick: () => setTab('paths'),
            }, '我的路径'),
            h('button', {
              className: 'el-tab', role: 'tab', 'aria-selected': String(tab === 'audit'), 'data-active': String(tab === 'audit'),
              onClick: () => setTab('audit'),
            }, '审计台')
          ),

          error
            ? h(
                'div',
                { className: 'el-path', style: { padding: '12px 16px' } },
                h('div', { className: 'el-error' }, error),
                h('div', { className: 'el-row' }, h('button', { className: 'el-btn', onClick: load }, '重试'))
              )
            : null,

          !data && !error ? h('div', { className: 'el-empty' }, '正在读取证据回路数据…') : null,

          data && tab === 'paths'
            ? h(PathsView, {
                data, stats, expanded, setExpanded, applyState, focusNode,
              })
            : null,

          data && tab === 'audit' ? h(AuditView, { data, onJump: focusNode, refreshToken }) : null,

          h('div', { className: 'el-foot' }, data
            ? `数据目录：${data.data_dir}${data.api_version ? ` · 宿主协议 v${data.api_version}` : ' · 宿主协议未知（旧版宿主）'}`
            : '')
        )
      )
    }

    function PathsView({ data, stats, expanded, setExpanded, applyState, focusNode }) {
      const streak = (data.meta && data.meta.streak) || {}
      const outdated = !!(data && data.api_version !== EXPECTED_API_VERSION)
      const stuck = data.paths
        .flatMap((path) => path.nodes)
        .filter((node) => node.status === '已提交' && node.review_state === 'idle')
      return h(
        'div',
        null,
        h(
          'div',
          { className: 'el-stats' },
          h('span', null,
            '连续学习 ',
            h('b', null, String(streak.current || 0)),
            ' 天',
            streak.stale && streak.last_submit_date
              ? h('span', { className: 'el-hint' }, `（上次提交 ${String(streak.last_submit_date).slice(5)}）`)
              : null
          ),
          h('span', null, '段位 ', h('b', null, stats.rank), stats.rank_next ? `（再通过 ${stats.rank_next.need} 个节点升为「${stats.rank_next.name}」）` : ''),
          h('span', null, '已通过 ', h('b', null, `${stats.passed}/${stats.total}`)),
          h('span', null, '需重做 ', h('b', null, String(stats.rework))),
          h('span', null, '等待复盘 ', h('b', null, String(stats.submitted)))
        ),
        !outdated && stuck.length
          ? h(
              'div',
              { className: 'el-banner el-banner-info' },
              `有 ${stuck.length} 个已提交版本尚未复盘（${stuck.map((node) => node.node_id).join('、')}）：展开节点点「开始复盘」即可补跑。`
            )
          : null,
        data.focus
          ? h(
              'button',
              { className: 'el-focus', onClick: () => focusNode(data.focus.node_id) },
              h('span', { className: 'el-focus-tag' }, '当前建议聚焦：'),
              h('b', null, `${data.focus.path_id} ${data.focus.path_title}`),
              h('span', { className: 'el-focus-tag' }, '·'),
              h('span', null, `${data.focus.node_id} ${data.focus.title}`),
              h('span', { className: 'el-focus-tag', style: { marginLeft: 'auto' } }, `状态：${data.focus.status}`)
            )
          : h('div', { className: 'el-empty' }, '全部节点都已通过复盘，路径完成。'),

        data.paths.map((path) =>
          h(
            'section',
            { key: path.path_id, className: 'el-path' },
            h(
              'div',
              { className: 'el-path-head' },
              h('span', { className: 'el-path-name' }, path.title),
              h('span', { className: 'el-path-id' }, `路径 ${path.path_id}`),
              h('span', { className: 'el-path-summary' }, `已通过 ${path.completion.passed}/${path.completion.total}`)
            ),
            h('div', { className: 'el-bar' }, h('i', { style: { width: `${percent(path.completion.passed, path.completion.total)}%` } })),
            h(
              'div',
              { className: 'el-nodes' },
              path.nodes.map((node) =>
                h(NodeCard, {
                  key: node.node_id,
                  node,
                  pathTitle: path.title,
                  expanded: expanded === node.node_id,
                  onToggle: () => setExpanded(expanded === node.node_id ? null : node.node_id),
                  applyState,
                })
              )
            )
          )
        )
      )
    }

    function NodeCard({ node, pathTitle, expanded, onToggle, applyState }) {
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')
      const [flash, setFlash] = useState('')
      const [coachOpen, setCoachOpen] = useState(false)
      const [chat, setChat] = useState(null)
      const [chatInput, setChatInput] = useState('')
      const [chatBusy, setChatBusy] = useState(false)
      const [chatError, setChatError] = useState('')
      const [chatLoading, setChatLoading] = useState(false)
      const [clearArmed, setClearArmed] = useState(false)
      const chatLogRef = useRef(null)
      const latest = node.versions.length ? node.versions[node.versions.length - 1] : null
      const reworkCount = node.versions.filter((version) => version.rework_reason).length
      const tutorialSteps = String(node.tutorial || '')
        .split(/[；;]\s*(?=第[一二三四五六七八九十]+步)/)
        .map((step) => step.trim())
        .filter(Boolean)

      useEffect(() => {
        setError('')
      }, [node.status])

      async function start() {
        setBusy(true)
        setError('')
        try {
          const payload = await request('start', { nodeId: node.node_id })
          applyState(payload.state)
          setFlash('已进入练习中：写好交付物后点「提交作业」提交 v1。')
        } catch (err) {
          setError(err.message)
          if (err.state) applyState(err.state)
        } finally {
          setBusy(false)
        }
      }

      async function retry(force) {
        setBusy(true)
        setError('')
        try {
          const payload = await request('review', { nodeId: node.node_id, force: Boolean(force) })
          applyState(payload.state)
          setFlash(force ? '已取消上一次复盘并重新发起。' : '已重新发起 AI 复盘，完成后状态会自动更新。')
        } catch (err) {
          setError(err.message)
          if (err.state) applyState(err.state)
        } finally {
          setBusy(false)
        }
      }

      const toggleFromKeyboard = (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onToggle()
        }
      }

      const loadChat = useCallback(async () => {
        setChatLoading(true)
        try {
          const payload = await request(`chat?nodeId=${encodeURIComponent(node.node_id)}`)
          setChat({ messages: payload.messages || [] })
          setChatError('')
        } catch (err) {
          setChatError(err.message)
        } finally {
          setChatLoading(false)
        }
      }, [node.node_id])

      useEffect(() => {
        if (coachOpen) loadChat()
      }, [coachOpen, loadChat])

      useEffect(() => {
        if (!coachOpen) return
        const log = chatLogRef.current
        if (log) log.scrollTop = log.scrollHeight
      }, [chat, coachOpen])

      async function sendCoachMessage() {
        const text = chatInput.trim()
        if (!text || chatBusy || chatLoading || !chat) return
        setChatBusy(true)
        setChatError('')
        const previous = chat ? chat.messages : []
        setChat({ messages: [...previous, { role: 'user', content: text, at: new Date().toISOString() }] })
        setChatInput('')
        try {
          const payload = await request('chat', { nodeId: node.node_id, message: text })
          setChat({ messages: payload.messages || [] })
        } catch (err) {
          setChatError(err.message)
          setChatInput((current) => current || text)
          try {
            const payload = await request(`chat?nodeId=${encodeURIComponent(node.node_id)}`)
            setChat({ messages: payload.messages || [] })
          } catch {}
        } finally {
          setChatBusy(false)
        }
      }

      async function clearCoachChat() {
        setChatBusy(true)
        setChatError('')
        try {
          const payload = await request('chat/reset', { nodeId: node.node_id })
          setChat({ messages: payload.messages || [] })
        } catch (err) {
          setChatError(err.message)
        } finally {
          setChatBusy(false)
        }
      }

      return h(
        'div',
        { className: 'el-node', id: `el-node-${node.node_id}` },
        h(
          'div',
          {
            className: 'el-node-row', onClick: onToggle, role: 'button', tabIndex: 0,
            'aria-expanded': String(expanded), onKeyDown: toggleFromKeyboard,
          },
          h('span', { className: 'el-dot', 'data-tone': TONE[node.status] || 'idle' }),
          h(
            'div',
            { style: { minWidth: 0 } },
            h('div', { className: 'el-node-title' }, `${node.node_id} ${node.title}`),
            h('div', { className: 'el-week' }, `建议节奏 ${node.suggested_week}`)
          ),
          h(
            'div',
            { className: 'el-node-meta' },
            node.versions.length
              ? h('span', { className: 'el-count' }, `v${node.versions.length}${reworkCount ? ` · 重做 ${reworkCount}` : ''}`)
              : null,
            node.review_state === 'running' ? h('span', { className: 'el-count' }, '复盘中…') : null,
            node.review_state === 'failed' ? h('span', { className: 'el-count el-more' }, '复盘失败') : null,
            node.status === '需重做' ? h('span', { className: 'el-count el-more' }, '查看复盘 →') : null,
            h(StatusChip, { status: node.status }),
            h('span', { className: 'el-caret', 'data-open': String(expanded), 'aria-hidden': true }, '›')
          )
        ),
        expanded
          ? h(
              'div',
              { className: 'el-detail' },
              h(
                'section',
                { className: 'el-tutorial' },
                h('div', { className: 'el-tutorial-title' }, '📋 实战操作指南'),
                node.tutorial
                  ? tutorialSteps.length > 1
                    ? h(
                        'ol',
                        { className: 'el-tutorial-steps' },
                        tutorialSteps.map((step, index) => h('li', { key: index }, step))
                      )
                    : h('div', { className: 'el-tutorial-text' }, node.tutorial)
                  : h('div', { className: 'el-tutorial-text' }, '该节点暂无实操指南。'),
                node.tutorial_url && /^https?:\/\//i.test(node.tutorial_url)
                  ? h('a', {
                      className: 'el-btn el-tutorial-link',
                      href: node.tutorial_url,
                      target: '_blank',
                      rel: 'noopener noreferrer',
                    }, `🔗 ${node.tutorial_label || '前往实操环境'}`)
                  : null
              ),
              h('div', { className: 'el-evidence' }, `通过本节点需要：${node.evidence_required}`),
              h('div', { className: 'el-hint', style: { marginBottom: 12 } }, `${pathTitle} · ${STATUS_HINT[node.status] || ''}`),

              node.status === '未开始'
                ? h(
                    'div',
                    { className: 'el-row' },
                    h('button', { className: 'el-btn el-btn-primary', disabled: busy, onClick: start }, busy ? '处理中…' : '开始练习'),
                    h('span', { className: 'el-hint' }, '开始后才能提交作业。')
                  )
                : null,

              node.status === '练习中'
                ? h(SubmitForm, { node, mode: 'practice', applyState, onFlash: setFlash })
                : null,

              node.status === '已提交'
                ? h(
                    'div',
                    null,
                    node.review_state === 'running'
                      ? h(
                          'div',
                          null,
                          h(
                            'div',
                            { className: 'el-row' },
                            h('span', { className: 'el-spinner', 'aria-hidden': true }),
                            h('span', { className: 'el-hint' }, 'AI 复盘中…（提交后自动触发，通常 10–30 秒；完成后状态自动更新）')
                          ),
                          h(
                            'div',
                            { className: 'el-row' },
                            h('button', { className: 'el-btn el-btn-ghost', disabled: busy, onClick: () => retry(true) },
                              busy ? '处理中…' : '取消并重新复盘'),
                            h('span', { className: 'el-hint' }, '超过 2 分钟仍无结果时可用；会中止当前这次复盘。')
                          )
                        )
                      : node.review_state === 'failed'
                        ? h(
                            'div',
                            null,
                            h('div', { className: 'el-error', style: { marginTop: 0 } },
                              `复盘失败：${(latest && latest.review_error) || '未知原因'}`),
                            h(
                              'div',
                              { className: 'el-row' },
                              h('button', { className: 'el-btn', disabled: busy, onClick: () => retry(false) }, busy ? '处理中…' : '重新复盘'),
                              h('span', { className: 'el-hint' }, '状态仍停在「已提交」；只有复盘通过校验才会流转。')
                            )
                          )
                        : h(
                            'div',
                            null,
                            h('div', { className: 'el-hint' }, '这个版本还没有复盘记录（可能被重启中断）。'),
                            h(
                              'div',
                              { className: 'el-row' },
                              h('button', { className: 'el-btn', disabled: busy, onClick: () => retry(false) }, busy ? '处理中…' : '开始复盘')
                            )
                          ),
                    latest && latest.submission_id
                      ? h('div', { className: 'el-hint', style: { marginTop: 8 } },
                          `当前版本 v${latest.version} · 提交于 ${fmtTime(latest.submitted_at)}`)
                      : null
                  )
                : null,

              node.status === '需重做'
                ? h(SubmitForm, {
                    node,
                    mode: 'rework',
                    applyState,
                    onFlash: setFlash,
                    previous: latest,
                    previousReview: latest && latest.review ? latest.review : null,
                  })
                : null,

              node.status === '已通过复盘'
                ? h('div', { className: 'el-hint' }, '已通过复盘：这次交付物与复盘记录已归档，计入完成度与段位。')
                : null,

              flash ? h('div', { className: 'el-ok', style: { marginTop: 10 } }, flash) : null,
              error ? h('div', { className: 'el-error' }, error) : null,

              h(
                'section',
                { className: 'el-coach' },
                h(
                  'div',
                  { className: 'el-coach-head' },
                  h('button', {
                    className: 'el-btn',
                    'aria-expanded': String(coachOpen),
                    onClick: () => setCoachOpen((open) => !open),
                  }, coachOpen ? '💬 收起教练' : '💬 呼叫教练'),
                  h('span', { className: 'el-hint' }, '只给提示与排查方向，不替你写作业')
                ),
                coachOpen
                  ? h(
                      'div',
                      { className: 'el-coach-body' },
                      h(
                        'div',
                        { className: 'el-chat-log', ref: chatLogRef, role: 'log', 'aria-live': 'polite' },
                        chat === null
                          ? h('div', { className: 'el-empty' },
                              chatLoading ? '正在读取对话…' : chatError ? '对话读取失败' : '还没有对话。可以先问：「这个节点我第一步该做什么？」')
                          : chat.messages.length
                            ? chat.messages.map((item, index) =>
                                h(
                                  'div',
                                  { key: index, className: `el-chat-msg el-chat-${item.role}` },
                                  h('div', { className: 'el-chat-bubble' }, item.content),
                                  h('div', { className: 'el-chat-at' }, fmtTime(item.at))
                                )
                              )
                            : h('div', { className: 'el-empty' }, '还没有对话。可以先问：「这个节点我第一步该做什么？」')
                      ),
                      h(
                        'div',
                        { className: 'el-chat-input' },
                        h('textarea', {
                          className: 'el-textarea',
                          style: { minHeight: 70 },
                          value: chatInput,
                          maxLength: 2000,
                          placeholder: '描述你卡在哪一步；教练会给你排查方向，不会代写。',
                          onChange: (event) => setChatInput(event.target.value),
                        }),
                        h(
                          'div',
                          { className: 'el-row' },
                          h('button', {
                            className: 'el-btn el-btn-primary',
                            disabled: chatBusy || chatLoading || !chat || !chatInput.trim(),
                            onClick: sendCoachMessage,
                          }, chatBusy ? '教练思考中…' : '发送'),
                          h('button', {
                            className: 'el-btn el-btn-ghost',
                            disabled: chatBusy || !chat || chat.messages.length === 0,
                            onClick: () => {
                              if (!clearArmed) {
                                setClearArmed(true)
                                setTimeout(() => setClearArmed(false), 3000)
                                return
                              }
                              setClearArmed(false)
                              clearCoachChat()
                            },
                          }, clearArmed ? '确认清空？' : '清空对话'),
                          h('span', { className: 'el-hint', style: { marginLeft: 'auto' } }, `${chatInput.length}/2000`)
                        )
                      ),
                      chatError
                        ? h('div', { className: 'el-error' },
                            chatError,
                            h('button', {
                              className: 'el-btn el-btn-ghost',
                              style: { marginLeft: 8 },
                              onClick: loadChat,
                            }, '重试'))
                        : null
                    )
                  : null
              ),

              h('div', { className: 'el-section-title' }, '版本历史'),
              node.versions.length
                ? node.versions.slice().reverse().map((version) =>
                    h(
                      'details',
                      { key: version.submission_id, className: 'el-version-block' },
                      h(
                        'summary',
                        { className: 'el-version' },
                        h('b', null, `v${version.version}`),
                        h('span', { className: 'el-event-at' }, fmtTime(version.submitted_at)),
                        h('span', { className: 'el-version-sum' }, version.summary),
                        version.review_decision
                          ? h(StatusChip, { status: version.review_decision })
                          : version.review_status === 'failed'
                            ? h(Chip, { tone: 'fail' }, '复盘失败')
                            : h(Chip, { tone: 'idle' }, '待复盘')
                      ),
                      h(
                        'div',
                        { className: 'el-version-body' },
                        version.rework_reason ? h('div', { className: 'el-hint' }, `重做理由：${version.rework_reason}`) : null,
                        version.review
                          ? h(
                              'div',
                              { className: 'el-review' },
                              (version.review.dimensions || []).map((dim) =>
                                h(
                                  'div',
                                  { key: dim.name, className: 'el-dim' },
                                  h('div', { className: 'el-dim-name' }, dim.name, ' ', h(VerdictChip, { verdict: dim.verdict })),
                                  h('div', { className: 'el-dim-reason' }, dim.reason)
                                )
                              ),
                              version.review.next_actions && version.review.next_actions.length
                                ? h('div', { className: 'el-hint' }, `下一步：${version.review.next_actions.map((action) => action.text).join('；')}`)
                                : null,
                              version.review.evidence_refs && version.review.evidence_refs.length
                                ? h(
                                    'div',
                                    null,
                                    h('div', { className: 'el-hint', style: { marginTop: 8, fontWeight: 600 } }, '外部证据（检索）'),
                                    h(
                                      'ul',
                                      { className: 'el-refs' },
                                      version.review.evidence_refs.map((ref, index) =>
                                        h(
                                          'li',
                                          { key: index },
                                          /^https?:\/\//i.test(ref.url || '')
                                            ? h('a', { href: ref.url, target: '_blank', rel: 'noreferrer' }, ref.title || ref.url)
                                            : h('span', null, ref.title || ref.url),
                                          h('span', { className: 'el-hint' }, `（查询：${ref.query}）`)
                                        )
                                      )
                                    )
                                  )
                                : version.review.external_check && version.review.external_check.ran
                                  ? h('div', { className: 'el-hint', style: { marginTop: 8 } },
                                      `已检索 ${(version.review.external_check.queries || []).length} 条查询，无可用来源。`)
                                  : null,
                              version.review.external_check && version.review.external_check.error
                                ? h('div', { className: 'el-hint' }, `外部检索提示：${version.review.external_check.error}`)
                                : null,
                              h('div', { className: 'el-hint', style: { marginTop: 4 } },
                                `复盘记录：reviews/${version.review.review_id}.json${version.review.model ? ` · ${version.review.model}` : ''}`)
                            )
                          : null,
                        h('pre', { className: 'el-pre' }, version.content)
                      )
                    )
                  )
                : h('div', { className: 'el-empty' }, '还没有提交版本。')
            )
          : null
      )
    }

    function SubmitForm({ node, mode, applyState, onFlash, previous, previousReview }) {
      const rework = mode === 'rework'
      const [content, setContent] = useState('')
      const [reason, setReason] = useState('')
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')

      const contentLength = content.trim().length
      const canSubmit = contentLength >= 10 && (!rework || reason.trim().length >= 5) && !busy

      async function submit() {
        if (!canSubmit) return
        setBusy(true)
        setError('')
        try {
          const payload = await request('submit', {
            nodeId: node.node_id,
            content,
            reworkReason: rework ? reason : '',
          })
          applyState(payload.state)
          setContent('')
          setReason('')
          if (onFlash) {
            onFlash(
              `已提交 v${payload.submission.version}，快照写入 submissions/${payload.submission.submission_id}.json，旧版本保留；AI 复盘已自动开始。${
                rework ? '重做理由已写入 rework-reasons/。' : ''
              }`
            )
          }
        } catch (err) {
          setError(err.message)
          if (err.state) applyState(err.state)
        } finally {
          setBusy(false)
        }
      }

      return h(
        'div',
        null,
        rework
          ? h(
              'div',
              { className: 'el-rework' },
              h(
                'div',
                { className: 'el-col' },
                h('h4', null, '① 上一版复盘意见'),
                previousReview
                  ? previousReview.dimensions.map((dim) =>
                      h(
                        'div',
                        { key: dim.name, className: 'el-dim' },
                        h('div', { className: 'el-dim-name' }, dim.name, ' ', h(VerdictChip, { verdict: dim.verdict })),
                        h('div', { className: 'el-dim-reason' }, dim.reason)
                      )
                    )
                  : h('div', { className: 'el-empty' }, '上一版没有复盘记录。')
              ),
              h(
                'div',
                { className: 'el-col' },
                h('h4', null, '② 上一版交付物摘要'),
                previous
                  ? h(
                      'div',
                      null,
                      h('div', { className: 'el-dim-reason' }, previous.summary),
                      h('div', { className: 'el-hint', style: { marginTop: 8 } }, `v${previous.version} · ${previous.chars} 字 · ${fmtTime(previous.submitted_at)}`)
                    )
                  : h('div', { className: 'el-empty' }, '没有上一版。')
              ),
              h(
                'div',
                { className: 'el-col' },
                h('h4', null, '③ 修改理由（必填）'),
                h('textarea', {
                  className: 'el-textarea', style: { minHeight: 90 }, value: reason,
                  placeholder: '你改了什么、为什么改？例如：补上了 v1 缺少的来源页码，并重写了第二段。',
                  onChange: (event) => setReason(event.target.value),
                }),
                h('div', { className: 'el-hint' }, reason.trim().length >= 5 ? '理由已填写' : '至少 5 个字，否则提交按钮保持禁用')
              )
            )
          : null,

        node.external_check
          ? h('div', { className: 'el-hint', style: { marginBottom: 8 } },
              '本节点提交后会在复盘前联网核对（只发送节点标题与证据要求，不发送交付物全文）。')
          : null,

        h('div', { className: 'el-section-title' }, rework ? '新版交付物' : '交付物'),
        h('textarea', {
          className: 'el-textarea', value: content,
          placeholder: rework ? '粘贴重做后的完整交付物…' : '粘贴本次作业的完整内容（每个判断都应能指回原文来源）…',
          onChange: (event) => setContent(event.target.value),
        }),
        h(
          'div',
          { className: 'el-row' },
          h('button', { className: 'el-btn el-btn-primary', disabled: !canSubmit, onClick: submit },
            busy ? '提交中…' : rework ? '提交新版本' : '提交作业'),
          h('span', { className: 'el-hint' },
            contentLength === 0
              ? '交付物为空，不能提交。'
              : contentLength < 10
                ? `交付物至少 10 个字才能提交（当前 ${contentLength} 字）。`
                : rework && reason.trim().length < 5
                  ? '重做必须填写修改理由，提交按钮已禁用。'
                  : `将生成 v${node.versions.length + 1}，旧版本不会被覆盖。`)
        ),
        error ? h('div', { className: 'el-error' }, error) : null
      )
    }

    function AuditView({ data, onJump, refreshToken }) {
      const [audit, setAudit] = useState(null)
      const [loading, setLoading] = useState(true)
      const [error, setError] = useState('')
      const [filter, setFilter] = useState('')
      const [note, setNote] = useState('')
      const [savedNote, setSavedNote] = useState('')
      const [preview, setPreview] = useState(null)
      const [noteBusy, setNoteBusy] = useState(false)
      const [noteSaved, setNoteSaved] = useState('')
      const [shareMsg, setShareMsg] = useState('')
      const [shareBusy, setShareBusy] = useState(false)
      const [shareResult, setShareResult] = useState(null)
      const [shareError, setShareError] = useState('')

      const loadAudit = useCallback(async () => {
        setLoading(true)
        try {
          const payload = await request('audit')
          setAudit(payload)
          setError('')
        } catch (err) {
          setError(err.message)
        } finally {
          setLoading(false)
        }
      }, [])

      const loadShare = useCallback(async () => {
        try {
          const [notePayload, previewPayload] = await Promise.all([
            request('share/note'),
            request('share/preview'),
          ])
          setNote(notePayload.note || '')
          setSavedNote(notePayload.note || '')
          setPreview(previewPayload)
        } catch {
          // 分享数据读取失败不阻断审计台其它区块。
        }
      }, [])

      useEffect(() => {
        loadAudit()
        loadShare()
      }, [loadAudit, loadShare, refreshToken])

      if (loading && !audit) return h('div', { className: 'el-empty' }, '正在读取审计数据…')
      if (error && !audit) {
        return h(
          'div',
          { className: 'el-path', style: { padding: '12px 16px' } },
          h('div', { className: 'el-error' }, error),
          h('div', { className: 'el-row' }, h('button', { className: 'el-btn', onClick: loadAudit }, '重试'))
        )
      }

      const summary = audit.summary
      const events = (audit.events || []).slice(0, 120)
      const nodeOptions = []
      const seen = new Set()
      for (const point of audit.series) {
        if (seen.has(point.node_id)) continue
        seen.add(point.node_id)
        nodeOptions.push({ node_id: point.node_id, title: point.node_title })
      }
      const series = filter ? audit.series.filter((point) => point.node_id === filter) : audit.series
      const points = series.map((point) => ({
        xLabel: filter ? `v${point.version}` : `#${point.seq}`,
        node_id: point.node_id,
        version: point.version,
        at: point.at,
        values: point.values,
        verdicts: point.verdicts,
      }))
      const maxRework = audit.hotspots.length ? audit.hotspots[0].rework_count : 0
      const activeDims = DIMENSIONS.filter((dim) => points.some((point) => point.values[dim] !== undefined))

      return h(
        'div',
        null,
        h(
          'div',
          { className: 'el-stats' },
          h('span', null, '复盘 ', h('b', null, String(summary.reviews)), ' 次'),
          h('span', null, '已通过 ', h('b', null, String(summary.passed))),
          h('span', null, '重做提交 ', h('b', null, String(summary.rework_total))),
          h('span', null, '重做节点 ', h('b', null, String(summary.rework_nodes))),
          h('span', null, '覆盖节点 ', h('b', null, String(summary.nodes_with_reviews)))
        ),

        h(
          'section',
          { className: 'el-path' },
          h(
            'div',
            { className: 'el-path-head' },
            h('span', { className: 'el-path-name' }, '轨迹时间线'),
            h('span', { className: 'el-path-id' }, '重做事件高亮'),
            h('span', { className: 'el-path-summary' }, `最近 ${events.length} 条`)
          ),
          h(
            'div',
            { className: 'el-audit-body' },
            events.length
              ? h(
                  'div',
                  { className: 'el-events' },
                  events.map((event) =>
                    h(
                      'div',
                      { key: event.id, className: `el-event${event.rework ? ' el-event-rework' : ''}` },
                      h('span', { className: 'el-event-at' }, fmtTime(event.at)),
                      (() => {
                        const failed = event.rework || ['review_failed', 'blocked', 'review_rejected'].includes(event.action)
                        const tone = failed
                          ? 'fail'
                          : event.action === 'review_applied'
                            ? (event.to === '已通过复盘' ? 'pass' : 'wait')
                            : 'idle'
                        const label = event.action === 'review_attempt_failed'
                          ? (Number(event.attempt) > 1 ? '复盘重试' : '复盘尝试失败')
                          : EVENT_LABEL[event.action] || event.action
                        return h(Chip, { tone }, label)
                      })(),
                      h(
                        'span',
                        null,
                        [
                          event.node_id ? `${event.node_id}` : null,
                          event.node_title || null,
                          event.from && event.to ? `${event.from} → ${event.to}` : null,
                          event.trigger ? `(${TRIGGER_LABEL[event.trigger] || event.trigger})` : null,
                          event.reason ? `· ${event.reason}` : null,
                          event.action === 'review_applied' && event.verdicts
                            ? `· ${Object.entries(event.verdicts).map(([name, verdict]) => `${name}=${verdict}`).join('，')}`
                            : null,
                        ].filter(Boolean).join(' ')
                      )
                    )
                  )
                )
              : h('div', { className: 'el-empty' }, '还没有审计事件。开始或提交一个节点后再看这里。')
          )
        ),

        h(
          'section',
          { className: 'el-path' },
          h(
            'div',
            { className: 'el-path-head' },
            h('span', { className: 'el-path-name' }, '质量趋势'),
            h('span', { className: 'el-path-id' }, filter ? '横轴：提交版本序号' : '横轴：复盘序号（时间序）'),
            h('span', { className: 'el-path-summary' }, '通过=3 · 部分=2 · 不通过=1')
          ),
          h(
            'div',
            { className: 'el-audit-body' },
            h(
              'div',
              { className: 'el-row', style: { marginTop: 0, marginBottom: 10 } },
              h(
                'select',
                {
                  className: 'el-select',
                  value: filter,
                  'aria-label': '选择要查看的节点',
                  onChange: (event) => setFilter(event.target.value),
                },
                h('option', { value: '' }, '全部提交（按提交序号）'),
                nodeOptions.map((item) =>
                  h('option', { key: item.node_id, value: item.node_id }, `${item.node_id} ${item.title}`)
                )
              ),
              h('span', { className: 'el-hint' }, filter ? '该节点内的版本序号（v1、v2…）' : '全部提交按时间排序的复盘序号；跨节点只画散点，选节点后显示折线')
            ),
            points.length
              ? h(TrendChart, { points, connected: Boolean(filter), dims: activeDims })
              : h('div', { className: 'el-empty' }, '还没有复盘数据；提交并完成一次 AI 复盘后出现。'),
            h(
              'div',
              { className: 'el-legend' },
              activeDims.map((dim) =>
                h(
                  'span',
                  { key: dim, className: 'el-legend-item' },
                  h('i', { className: 'el-legend-dot', style: { background: DIM_COLOR[dim] }, 'aria-hidden': true }),
                  dim
                )
              )
            )
          )
        ),

        h(
          'section',
          { className: 'el-path' },
          h(
            'div',
            { className: 'el-path-head' },
            h('span', { className: 'el-path-name' }, '重做热区'),
            h('span', { className: 'el-path-id' }, '按重做次数排序'),
            h('span', { className: 'el-path-summary' }, `${audit.hotspots.length} 个节点`)
          ),
          h(
            'div',
            { className: 'el-audit-body' },
            audit.hotspots.length
              ? audit.hotspots.map((item) =>
                  h(
                    'div',
                    { key: item.node_id, className: 'el-hotspot' },
                    h(
                      'button',
                      { className: 'el-hotspot-row', onClick: () => onJump(item.node_id) },
                      h('span', { className: 'el-hotspot-name' }, `${item.node_id} ${item.title}`),
                      h('span', { className: 'el-hotspot-count' }, `重做 ${item.rework_count} 次 / 共 v${item.version_count}`)
                    ),
                    h(
                      'div',
                      { className: 'el-hotspot-bar' },
                      h('i', { style: { width: `${maxRework ? Math.round((item.rework_count / maxRework) * 100) : 0}%` } })
                    ),
                    item.last_reason ? h('div', { className: 'el-hint', style: { marginTop: 4 } }, `最近理由：${item.last_reason}`) : null
                  )
                )
              : h('div', { className: 'el-empty' }, '还没有重做记录。')
          )
        ),

        h(
          'section',
          { className: 'el-path' },
          h(
            'div',
            { className: 'el-path-head' },
            h('span', { className: 'el-path-name' }, '当前下一步'),
            h('span', { className: 'el-path-id' }, '来自复盘 next_actions'),
            h('span', { className: 'el-path-summary' }, `${audit.next_actions.length} 条待办`)
          ),
          h(
            'div',
            { className: 'el-audit-body' },
            audit.next_actions.length
              ? audit.next_actions.map((action, index) =>
                  h(
                    'button',
                    { key: `${action.node_id}-${index}`, className: 'el-todo', onClick: () => onJump(action.target_node_id) },
                    h('span', { className: 'el-todo-box', 'aria-hidden': true }),
                    h('span', null, action.text),
                    h(
                      'span',
                      { className: 'el-todo-node' },
                      action.node_id === action.target_node_id
                        ? action.node_id
                        : `${action.node_id} → ${action.target_node_id}`
                    )
                  )
                )
              : h('div', { className: 'el-empty' }, '还没有下一步动作；复盘写入后会出现在这里。')
          )
        ),

        h(
          'section',
          { className: 'el-path' },
          h(
            'div',
            { className: 'el-path-head' },
            h('span', { className: 'el-path-name' }, 'HR 分享页'),
            h('span', { className: 'el-path-id' }, '只读 · 公开链接'),
            h('span', { className: 'el-path-summary' },
              preview ? `${preview.key_events} 次关键重做 · ${preview.badcases} 组 Bad Case` : '')
          ),
          h(
            'div',
            { className: 'el-audit-body' },
            h('div', { className: 'el-hint' },
              '页面只收录摘要片段（每条 ≤80 字）、复盘判定与修改理由；公网隧道不可用时可用「本机预览」直接打开。'),
            h('div', { className: 'el-section-title' }, '我从这次重做中学到了什么'),
            h('textarea', {
              className: 'el-textarea',
              value: note,
              maxLength: 5000,
              placeholder: '写给 HR 看的三五句话：你重复犯的错、你改了哪一步流程、下次怎么避免。',
              onChange: (event) => { setNote(event.target.value); setNoteSaved('') },
            }),
            h('div', { className: 'el-hint' },
              `${note.length}/5000${note !== savedNote ? ' · 有未保存的修改，生成时会先保存' : ''}`),
            h(
              'div',
              { className: 'el-row' },
              h('button', {
                className: 'el-btn',
                disabled: noteBusy,
                onClick: async () => {
                  setNoteBusy(true)
                  setShareError('')
                  try {
                    await request('share/note', { note })
                    setSavedNote(note)
                    setNoteSaved(`已保存 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`)
                    loadShare()
                  } catch (err) {
                    setShareError(err.message)
                  } finally {
                    setNoteBusy(false)
                  }
                },
              }, noteBusy ? '保存中…' : '保存心得'),
              h('span', { className: 'el-hint' }, noteSaved),
              h('span', { className: 'el-hint', style: { marginLeft: 'auto' } }, `将收录最近 ${Math.min(3, (preview && preview.key_events) || 0)} 次重做`)
            ),
            h(
              'div',
              { className: 'el-row' },
              h('button', {
                className: 'el-btn el-btn-primary',
                disabled: shareBusy,
                onClick: async () => {
                  setShareBusy(true)
                  setShareError('')
                  setShareResult(null)
                  setShareMsg('')
                  try {
                    // 生成前先落盘心得：绝不把旧稿或空稿发出去。
                    if (note !== savedNote) {
                      await request('share/note', { note })
                      setSavedNote(note)
                      setNoteSaved('心得已保存')
                    }
                    const payload = await request('share/build', { ttlHours: 168 })
                    setShareResult(payload)
                    loadShare()
                  } catch (err) {
                    setShareError(err.message)
                  } finally {
                    setShareBusy(false)
                  }
                },
              }, shareBusy ? '生成并发布中…' : '生成并发布只读链接'),
              h('span', { className: 'el-hint' }, '有效期 7 天')
            ),
            shareError ? h('div', { className: 'el-error' }, shareError) : null,
            !shareResult && preview && preview.last_publish
              ? h(
                  'div',
                  { className: 'el-share-result' },
                  preview.last_publish.url
                    ? h('div', null,
                        '上次发布：',
                        h('a', { href: preview.last_publish.url, target: '_blank', rel: 'noreferrer' }, preview.last_publish.url))
                    : h('div', null, '上次生成（未发布成功）'),
                  preview.last_publish.local_path
                    ? h('div', null,
                        '本机预览：',
                        h('a', {
                          href: preview.last_publish.local_path,
                          target: '_blank',
                          rel: 'noreferrer',
                        }, `${location.origin}${preview.last_publish.local_path}`))
                    : null,
                  h('div', { className: 'el-hint' },
                    `时间：${fmtTime(preview.last_publish.at)}${preview.last_publish.id ? ` · 撤销 id：${preview.last_publish.id}` : ''}`),
                  preview.last_publish.error
                    ? h('div', { className: 'el-hint' }, `上次失败原因：${preview.last_publish.error}`)
                    : null
                )
              : null,
            shareResult
              ? h(
                  'div',
                  { className: 'el-share-result' },
                  shareResult.publish && shareResult.publish.url
                    ? h('div', null,
                        '只读链接：',
                        h('a', { href: shareResult.publish.url, target: '_blank', rel: 'noreferrer' }, shareResult.publish.url),
                        h('button', {
                          className: 'el-btn el-btn-ghost',
                          style: { marginLeft: 8 },
                          onClick: async () => {
                            try {
                              await navigator.clipboard.writeText(shareResult.publish.url)
                              setShareMsg('链接已复制')
                            } catch {
                              setShareMsg('复制失败，请手动选择链接')
                            }
                          },
                        }, '复制'))
                    : null,
                  shareMsg ? h('div', { className: 'el-hint' }, shareMsg) : null,
                  shareResult.local_path
                    ? h('div', null,
                        '本机预览（可直接打开）：',
                        h('a', {
                          href: shareResult.local_path,
                          target: '_blank',
                          rel: 'noreferrer',
                        }, `${location.origin}${shareResult.local_path}`))
                    : null,
                  shareResult.publish && shareResult.publish.expires_at
                    ? h('div', { className: 'el-hint' }, `到期：${fmtTime(shareResult.publish.expires_at)}`)
                    : null,
                  shareResult.publish && shareResult.publish.id
                    ? h('div', { className: 'el-hint' }, `撤销 id：${shareResult.publish.id}`)
                    : null,
                  shareResult.publish && shareResult.publish.degraded
                    ? h('div', { className: 'el-hint' }, '已降级为局域网链接，仅同一网络可访问。')
                    : null,
                  shareResult.publish && shareResult.publish.provider === 'lan'
                    ? h('div', { className: 'el-hint' }, '这是局域网链接（lan），仅同一网络可访问。')
                    : null,
                  shareResult.publish_error
                    ? h('div', { className: 'el-error' },
                        `发布失败：${shareResult.publish_error}。本地文件已生成，可让 Agent 用 share_artifact 发布。`)
                    : null,
                  h('div', { className: 'el-hint' }, `本地文件：${shareResult.path}`)
                )
              : null
          )
        )
      )
    }

    function TrendChart({ points, connected, dims }) {
      const width = 720
      const height = 280
      const padL = 58
      const padR = 16
      const padT = 18
      const padB = 40
      const plotW = width - padL - padR
      const plotH = height - padT - padB
      const count = points.length
      const xAt = (index) => padL + (count === 1 ? plotW / 2 : (index * plotW) / (count - 1))
      const yAt = (value) => padT + plotH - ((value - 1) / 2) * plotH
      const xStep = count > 10 ? Math.ceil(count / 8) : 1
      const elements = []
      const dimensions = dims && dims.length ? dims : DIMENSIONS

      for (const value of [1, 2, 3]) {
        elements.push(
          h('line', {
            key: `grid-${value}`,
            x1: padL, x2: width - padR, y1: yAt(value), y2: yAt(value),
            stroke: 'color-mix(in srgb, var(--dsw-alias-label-primary) 12%, transparent)', strokeWidth: 1,
          }),
          h('text', {
            key: `ylab-${value}`, x: padL - 10, y: yAt(value) + 4, textAnchor: 'end',
            fill: 'var(--dsw-alias-label-secondary)', fontSize: 11,
          }, VERDICT_TEXT[value])
        )
      }

      points.forEach((point, index) => {
        if (index % xStep !== 0 && index !== count - 1) return
        elements.push(
          h('text', {
            key: `xlab-${index}`, x: xAt(index), y: height - 14, textAnchor: 'middle',
            fill: 'var(--dsw-alias-label-secondary)', fontSize: 10,
          }, point.xLabel)
        )
      })

      for (const dim of dimensions) {
        const color = DIM_COLOR[dim] || 'var(--dsw-alias-label-secondary)'
        const coords = []
        points.forEach((point, index) => {
          if (point.values[dim] === undefined) return
          coords.push(`${xAt(index)},${yAt(point.values[dim])}`)
        })
        if (connected && coords.length > 1) {
          elements.push(
            h('polyline', {
              key: `line-${dim}`, points: coords.join(' '), fill: 'none',
              stroke: color, strokeWidth: 2, strokeLinejoin: 'round', strokeLinecap: 'round',
            })
          )
        }
        points.forEach((point, index) => {
          if (point.values[dim] === undefined) return
          const verdict = point.verdicts[dim] || VERDICT_TEXT[point.values[dim]]
          elements.push(
            h('circle', {
              key: `dot-${dim}-${index}`, cx: xAt(index), cy: yAt(point.values[dim]), r: 3.5,
              fill: color,
            }, h('title', null, `${point.node_id} ${point.xLabel} · ${dim}：${verdict}（${fmtTime(point.at)}）`))
          )
        })
      }

      return h(
        'svg',
        {
          className: 'el-chart',
          viewBox: `0 0 ${width} ${height}`,
          role: 'img',
          'aria-label': '四维复盘判定趋势，横轴为提交版本序号',
          preserveAspectRatio: 'xMidYMid meet',
        },
        elements
      )
    }

    const CSS = `
.el-root { height: 100%; overflow-y: auto; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: 13px/1.65 ui-sans-serif, system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; }
.el-inner { max-width: 1000px; margin: 0 auto; padding: 30px 36px 80px; }
.el-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.el-title { font-size: 18px; font-weight: 600; letter-spacing: .01em; }
.el-sub { color: var(--dsw-alias-label-secondary); font-size: 12px; margin-top: 2px; }
.el-banner { border: 1px solid var(--dsw-alias-state-warn-primary); background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 10%, transparent); border-radius: 10px; padding: 10px 14px; margin: 0 0 16px; font-size: 12px; line-height: 1.7; }
.el-banner-info { border-color: var(--dsw-alias-border-l2); background: color-mix(in srgb, var(--dsw-alias-label-primary) 4%, transparent); }
.el-tabs { display: inline-flex; gap: 4px; padding: 3px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); margin: 18px 0 20px; }
.el-tab { border: 0; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; padding: 5px 14px; border-radius: 7px; cursor: pointer; }
.el-tab[data-active="true"] { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font-weight: 600; }
.el-tab:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px; }
.el-stats { display: flex; gap: 18px; flex-wrap: wrap; margin: 0 0 16px; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.el-stats b { color: var(--dsw-alias-label-primary); font-weight: 600; }
.el-focus { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1); border-radius: 10px; padding: 10px 14px; font: inherit; color: var(--dsw-alias-label-primary); cursor: pointer; margin-bottom: 20px; }
.el-focus:hover { border-color: var(--dsw-alias-brand-primary); }
.el-focus-tag { color: var(--dsw-alias-label-secondary); font-size: 12px; }
.el-path { border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); margin-bottom: 16px; overflow: hidden; }
.el-path-head { display: flex; align-items: baseline; gap: 10px; padding: 14px 16px 12px; }
.el-path-name { font-size: 14px; font-weight: 600; }
.el-path-id { color: var(--dsw-alias-label-secondary); font-size: 12px; }
.el-path-summary { color: var(--dsw-alias-label-secondary); font-size: 12px; margin-left: auto; }
.el-bar { height: 4px; background: color-mix(in srgb, var(--dsw-alias-label-primary) 10%, transparent); border-radius: 2px; margin: 0 16px 10px; }
.el-bar i { display: block; height: 100%; border-radius: 2px; background: var(--dsw-alias-brand-primary); transition: width .2s ease; }
.el-nodes { padding: 0 8px 8px; }
.el-node-row { display: flex; gap: 12px; align-items: flex-start; padding: 11px 10px; border-radius: 9px; cursor: pointer; border: 1px solid transparent; }
.el-node-row:hover { background: color-mix(in srgb, var(--dsw-alias-label-primary) 6%, transparent); }
.el-node-row:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px; }
.el-dot { width: 8px; height: 8px; border-radius: 50%; margin-top: 7px; flex: none; background: var(--dsw-alias-state-idle-primary); }
.el-dot[data-tone="active"] { background: var(--dsw-alias-brand-primary); }
.el-dot[data-tone="wait"] { background: var(--dsw-alias-state-warn-primary); }
.el-dot[data-tone="pass"] { background: var(--dsw-alias-state-success-primary); }
.el-dot[data-tone="fail"] { background: var(--dsw-alias-state-error-primary); }
.el-node-title { font-weight: 500; }
.el-week { font-size: 11px; color: var(--dsw-alias-label-secondary); opacity: .78; margin-top: 1px; }
.el-node-meta { margin-left: auto; display: flex; align-items: center; gap: 8px; flex: none; }
.el-more { color: var(--dsw-alias-state-error-primary); }
.el-caret { color: var(--dsw-alias-label-secondary); transition: transform .15s ease; display: inline-block; transform: rotate(0deg); font-size: 16px; line-height: 1; }
.el-caret[data-open="true"] { transform: rotate(90deg); }
.el-chip { font-size: 11px; padding: 1px 8px; border-radius: 999px; white-space: nowrap; line-height: 18px; }
.el-chip[data-tone="idle"] { color: var(--dsw-alias-label-secondary); background: color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent); }
.el-chip[data-tone="active"] { color: var(--dsw-alias-brand-primary); background: color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent); }
.el-chip[data-tone="wait"] { color: var(--dsw-alias-state-warn-primary); background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 14%, transparent); }
.el-chip[data-tone="pass"] { color: var(--dsw-alias-state-success-primary); background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 14%, transparent); }
.el-chip[data-tone="fail"] { color: var(--dsw-alias-state-error-primary); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 14%, transparent); }
.el-count { font-size: 11px; color: var(--dsw-alias-label-secondary); }
.el-detail { padding: 4px 12px 18px 30px; }
.el-evidence { margin: 0 0 12px; padding: 10px 12px; border-left: 2px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-secondary); font-size: 12px; background: color-mix(in srgb, var(--dsw-alias-label-primary) 4%, transparent); border-radius: 0 6px 6px 0; }
.el-tutorial { margin: 0 0 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; padding: 12px 14px; background: color-mix(in srgb, var(--dsw-alias-brand-primary) 5%, transparent); }
.el-tutorial-title { font-weight: 600; font-size: 13px; margin-bottom: 6px; }
.el-tutorial-text { white-space: pre-wrap; font-size: 13px; line-height: 1.85; color: var(--dsw-alias-label-primary); }
.el-tutorial-steps { margin: 4px 0 0; padding-left: 20px; font-size: 13px; line-height: 1.85; color: var(--dsw-alias-label-primary); }
.el-tutorial-steps li { margin: 2px 0; }
.el-tutorial-link { display: inline-block; margin-top: 10px; text-decoration: none; color: var(--dsw-alias-brand-primary); }
.el-coach { margin-top: 16px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; padding: 12px 14px; background: var(--dsw-alias-bg-layer-1); }
.el-coach-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.el-chat-log { max-height: 340px; overflow-y: auto; margin-top: 10px; display: flex; flex-direction: column; gap: 8px; }
.el-chat-msg { display: flex; flex-direction: column; max-width: 92%; }
.el-chat-user { align-self: flex-end; align-items: flex-end; }
.el-chat-assistant { align-self: flex-start; align-items: flex-start; }
.el-chat-bubble { padding: 8px 11px; border-radius: 10px; font-size: 13px; line-height: 1.7; white-space: pre-wrap; word-break: break-word; }
.el-chat-user .el-chat-bubble { background: var(--dsw-alias-brand-primary); color: var(--dsw-alias-bg-base); }
.el-chat-assistant .el-chat-bubble { background: color-mix(in srgb, var(--dsw-alias-label-primary) 6%, transparent); border: 1px solid var(--dsw-alias-border-l1); }
.el-chat-at { font-size: 10px; color: var(--dsw-alias-label-secondary); margin-top: 2px; }
.el-chat-input { margin-top: 10px; }
.el-section-title { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-secondary); margin: 16px 0 8px; letter-spacing: .02em; }
.el-textarea { width: 100%; box-sizing: border-box; min-height: 110px; resize: vertical; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); border-radius: 8px; padding: 10px 12px; font: inherit; line-height: 1.7; }
.el-textarea:focus { outline: none; border-color: var(--dsw-alias-brand-primary); }
.el-row { display: flex; gap: 10px; align-items: center; margin-top: 10px; flex-wrap: wrap; }
.el-btn { border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); border-radius: 8px; padding: 6px 12px; font: inherit; font-size: 12px; cursor: pointer; }
.el-btn:hover:not(:disabled) { border-color: var(--dsw-alias-brand-primary); }
.el-btn-primary { background: var(--dsw-alias-brand-primary); border-color: transparent; color: var(--dsw-alias-bg-base); }
.el-btn-primary:hover:not(:disabled) { filter: brightness(1.06); }
.el-btn-ghost { background: transparent; border-color: transparent; color: var(--dsw-alias-label-secondary); padding: 4px 8px; }
.el-btn:disabled { opacity: .4; cursor: not-allowed; }
.el-hint { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.el-error { font-size: 12px; color: var(--dsw-alias-state-error-primary); margin-top: 8px; }
.el-ok { font-size: 12px; color: var(--dsw-alias-state-success-primary); }
.el-empty { color: var(--dsw-alias-label-secondary); font-size: 12px; padding: 6px 0; }
.el-rework { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin: 10px 0 6px; align-items: stretch; }
.el-col { border: 1px solid var(--dsw-alias-border-l2); border-radius: 9px; padding: 10px 12px; background: color-mix(in srgb, var(--dsw-alias-label-primary) 4%, transparent); min-height: 120px; }
.el-col h4 { margin: 0 0 8px; font-size: 12px; font-weight: 600; }
.el-dim { margin-bottom: 8px; }
.el-review { margin: 6px 0 2px; }
.el-refs { margin: 6px 0 0; padding-left: 18px; font-size: 12px; }
.el-refs li { margin: 4px 0; overflow-wrap: anywhere; }
.el-refs a { color: var(--dsw-alias-brand-primary); text-decoration: none; }
.el-refs a:hover { text-decoration: underline; }
.el-share-result { margin-top: 12px; padding: 12px 14px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: color-mix(in srgb, var(--dsw-alias-label-primary) 4%, transparent); font-size: 13px; word-break: break-all; }
.el-share-result a { color: var(--dsw-alias-brand-primary); font-weight: 600; }
.el-dim-name { font-size: 11px; color: var(--dsw-alias-label-secondary); }
.el-dim-reason { font-size: 12px; margin-top: 2px; }
.el-version-block { border-top: 1px solid var(--dsw-alias-border-l1); }
.el-version-block:first-of-type { border-top: 0; }
.el-version-block summary { display: flex; gap: 10px; align-items: center; padding: 8px 0; cursor: pointer; list-style: none; font-size: 12px; }
.el-version-block summary::-webkit-details-marker { display: none; }
.el-version-block summary:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px; }
.el-version-sum { color: var(--dsw-alias-label-secondary); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.el-version-body { padding: 4px 0 12px; }
.el-pre { white-space: pre-wrap; word-break: break-word; margin: 8px 0 0; font: inherit; font-size: 12px; line-height: 1.7; color: var(--dsw-alias-label-primary); background: color-mix(in srgb, var(--dsw-alias-label-primary) 4%, transparent); border-radius: 8px; padding: 10px 12px; }
.el-event { display: flex; gap: 10px; font-size: 12px; padding: 7px 0; border-top: 1px solid var(--dsw-alias-border-l1); align-items: baseline; }
.el-events { display: flex; flex-direction: column; }
.el-event:first-child { border-top: 0; }
.el-event-at { color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; flex: none; }
.el-event-rework { background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent); border-radius: 6px; padding-left: 8px; padding-right: 8px; }
.el-audit-body { padding: 0 16px 16px; }
.el-select { font: inherit; font-size: 12px; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l2); border-radius: 7px; padding: 4px 8px; max-width: 100%; }
.el-chart { width: 100%; height: auto; display: block; margin: 6px 0 4px; }
.el-legend { display: flex; gap: 14px; flex-wrap: wrap; margin-top: 6px; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.el-legend-item { display: inline-flex; align-items: center; gap: 6px; }
.el-legend-dot { display: inline-block; width: 12px; height: 3px; border-radius: 2px; }
.el-hotspot { padding: 10px 0; border-top: 1px solid var(--dsw-alias-border-l1); }
.el-hotspot:first-child { border-top: 0; }
.el-hotspot-row { display: flex; justify-content: space-between; gap: 10px; width: 100%; text-align: left; background: none; border: 0; color: inherit; font: inherit; padding: 0; cursor: pointer; }
.el-hotspot-row:hover .el-hotspot-name { color: var(--dsw-alias-brand-primary); }
.el-hotspot-name { font-weight: 500; }
.el-hotspot-count { color: var(--dsw-alias-state-error-primary); font-size: 12px; flex: none; }
.el-hotspot-bar { height: 4px; background: color-mix(in srgb, var(--dsw-alias-label-primary) 10%, transparent); border-radius: 2px; margin-top: 6px; overflow: hidden; }
.el-hotspot-bar i { display: block; height: 100%; background: var(--dsw-alias-state-error-primary); border-radius: 2px; }
.el-todo { display: flex; gap: 10px; align-items: flex-start; width: 100%; text-align: left; background: transparent; border: 0; border-top: 1px solid var(--dsw-alias-border-l1); color: inherit; font: inherit; padding: 9px 0; cursor: pointer; }
.el-todo:first-child { border-top: 0; }
.el-todo:hover { color: var(--dsw-alias-brand-primary); }
.el-todo-box { width: 12px; height: 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 3px; margin-top: 3px; flex: none; }
.el-todo-node { margin-left: auto; color: var(--dsw-alias-label-secondary); font-size: 11px; flex: none; }
.el-event > span:last-child, .el-todo > span:nth-child(2) { min-width: 0; overflow-wrap: anywhere; }
.el-spinner { width: 12px; height: 12px; border: 2px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 30%, transparent); border-top-color: var(--dsw-alias-brand-primary); border-radius: 50%; animation: el-spin .8s linear infinite; display: inline-block; flex: none; }
@keyframes el-spin { to { transform: rotate(360deg); } }
.el-foot { margin-top: 26px; font-size: 11px; color: var(--dsw-alias-label-secondary); }
@media (max-width: 760px) { .el-rework { grid-template-columns: 1fr; } .el-inner { padding: 20px 16px 60px; } }
`

    function apply(ctx) {
      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register(
          { name: 'sidebar.panellist', id: PANEL_ID, order: 12, label: () => '证据回路' },
          PanelIcon
        )
      )
      ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID }, EvidencePanel))
    }

    return { isPlugin: true, inject: ['slots'], apply }
  },
})
