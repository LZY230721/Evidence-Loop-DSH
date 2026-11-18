// 呼叫教练自测：系统提示、按节点落盘、多轮上下文、清空、错误边界。
import assert from 'node:assert/strict'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { COACH_SYSTEM_PROMPT, readChat, resetChat, sendChat } from '../lib/chat.js'

assert.ok(process.env.DSH_HOME && process.env.DSH_HOME.includes('.tmp-selftest'), 'DSH_HOME 必须指向临时目录')
rmSync(join(process.env.DSH_HOME, 'evidence-loop'), { recursive: true, force: true })

const captured = []
function fakeCtx(reply = '先别急着写作业：把节点要求拆成三步，再告诉我你卡在哪一步。') {
  const llm = {
    async prepareCall(config) {
      return {
        config,
        async *stream(options) {
          captured.push(options)
          yield { type: 'text-delta', text: reply }
          yield { type: 'finish', reason: { kind: 'stop' } }
        },
      }
    },
  }
  return {
    get(name) {
      if (name === 'llm') return llm
      if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'fake', model: 'fake-coach' }) }
      return undefined
    },
  }
}

// 1. 首轮：系统提示固定、上下文包含节点与问题、按节点落盘
const ctx = fakeCtx()
const first = await sendChat(ctx, 'A1', '我卡在第一步，不知道打开哪个网站。')
assert.equal(first.messages.length, 2)
assert.equal(first.messages[0].role, 'user')
assert.equal(first.messages[1].role, 'assistant')
assert.match(first.reply, /拆成三步/)
assert.equal(captured[0].system, COACH_SYSTEM_PROMPT, '教练的系统提示必须固定')
const transcript = captured[0].messages[0].content[0].text
assert.match(transcript, /A1 概念拆解/)
assert.match(transcript, /我卡在第一步/)
assert.equal(existsSync(join(process.env.DSH_HOME, 'evidence-loop', 'chat', 'A1.json')), true)

// 2. 第二轮：历史被带进上下文
const second = await sendChat(ctx, 'A1', '我打开了 Dify，但不知道拖哪个节点。')
assert.equal(second.messages.length, 4)
assert.match(captured[1].messages[0].content[0].text, /对话历史/)
assert.match(captured[1].messages[0].content[0].text, /拆成三步/)

// 3. 按节点隔离
const other = await sendChat(ctx, 'A2', '这个节点的三种写法怎么对比？')
assert.equal(other.messages.length, 2)
assert.equal(readChat('A1').messages.length, 4)
assert.equal(readChat('A2').messages.length, 2)

// 4. 清空
resetChat('A1')
assert.equal(readChat('A1').messages.length, 0)
assert.equal(readChat('A2').messages.length, 2)

// 5. 边界
await assert.rejects(() => sendChat(ctx, 'Z9', '在吗'), (err) => err.status === 404)
await assert.rejects(() => sendChat(ctx, 'A1', '   '), (err) => err.status === 400)

console.log('COACH OK', { system: COACH_SYSTEM_PROMPT.slice(0, 12), turns: 2 })
