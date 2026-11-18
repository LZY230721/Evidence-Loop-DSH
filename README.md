# 证据回路（Evidence Loop）

> 一个「先交证据、再谈掌握」的 DSH 插件：记录你**改了什么、为什么改、改对了没有**，而不是记录你「打卡了什么」。

![status](https://img.shields.io/badge/status-v2.0%20shipped-2ea043)
![platform](https://img.shields.io/badge/platform-DeepSeek%20Harness%20Desktop-2451b3)
![license](https://img.shields.io/badge/license-MIT-6e7781)

> 产品说明书：`PRODUCT_DOC.md`（业务痛点 / 产品目标 / 状态机与强引用 / 教练 / 界面拆解，非技术读者友好）

---

## 为什么做这个

大多数学习工具记录「完成了什么」：看完一节课、打完一次卡、连续学习多少天。但打卡不等于掌握。

这个插件把「掌握」定义成一个可审计的过程：

1. 学习者提交一份**可核查的交付物**；
2. AI 按固定维度复盘，且每个判断**必须引用交付物原文**；
3. 插件代码根据复盘 JSON 计算状态——**LLM 无权直接改状态**；
4. 不达标就重做，重做必须写**修改理由**；
5. 只有「已通过复盘」的节点才计入完成度与段位。

它同时保留每一版交付物、每一次复盘、每一次重做理由，最后能生成一页给 HR 看的**只读证据台账**。

---

## 核心功能

### V2.0 迭代亮点：从「静态审计官」到「互动式实战工作台」

V1 把状态机和 AI 复盘做严密了，但实机用起来仍有一个致命的体验断点：**打开节点不知道怎么开始，也不知道去哪学**——它只是一个静态的审计官。

V2.0 没有推翻状态机、没有改复盘规则，只在原数据结构上做兼容扩展（新增 `tutorial` 字段与 `chat/` 目录），完成了一次**以用户为中心的敏捷迭代**：把「学」和「练」接起来，让工具从「事后审计」变成「伴随式工作台」。

1. **保姆级实战指南 + 真实环境跳转，打通「学 → 练」闭环**
   每个节点配手把手步骤（如 A1：注册 Dify → 建 Workflow → 配 DeepSeek → 截图提交），并提供「点击前往 Dify / DeepSeek 实操」的外链按钮，新标签页直接开工；步骤按序数拆成列表，不再是挤成一坨的说明。**从「看要求」到「动手做」只差一次点击。**

2. **AI 导师对话 + 严格 Prompt 约束，实现伴随式辅导**
   节点内嵌「💬 呼叫教练」多轮对话，System Prompt 固定为「只给提示和排查方向，不代写作业、不直接给答案」；上下文带当前节点、通过要求与实操指南。对话按节点落盘、可恢复、可清空。**它不替你交作业，只在你卡住时给下一步的排查方向。**

3. **同样的状态机，更完整的用户体验：一次体现同理心的产品打磨**
   V2 没有改状态机、没有改复盘规则，只在原数据结构上做兼容扩展，补了「引导、互动、跳转」三块体验；从「打开节点一脸茫然」到「知道去哪、知道问谁、知道下一步」，验证了同一条产品判断——**规则可以硬，体验必须软**。

| 模块 | 能力 |
| --- | --- |
| 我的路径 | 三条硬编码路径（概念折叠引擎 / 知识库审计员 / 规则守门人）、14 个节点；每个节点带「手把手实操指南 + 真实环境跳转」；`suggested_week` 仅浅色小字展示，不参与判定 |
| 呼叫教练（V2.0） | 节点内多轮对话（固定导师提示、只给方向不代写），按节点落盘、可恢复、可清空 |
| 状态机 | 未开始 → 练习中 → 已提交 → 已通过复盘 / 需重做；重做必须带修改理由（前后端双重拦截） |
| AI 复盘 | 提交后自动异步复盘；四维判定（完成度/证据充分性/结构清晰度/迭代痕迹）、原文强引用、1–2 条 next_actions；失败可重试 |
| 审计台 | 轨迹时间线（重做高亮）、质量趋势（横轴=提交版本序号）、重做热区、当前下一步 |
| 外部校验 | 仅标记节点联网检索（A3/B1/B2/B3/B4/C5），结果写入 `evidence_refs`，只作辅助证据 |
| HR 分享页 | 关键重做前后对比 + Bad Case 台账 + 学习者心得；只展示 ≤80 字摘要片段，自包含 HTML |
| 游戏化 | 连续学习天数（仅提交计数）、路径完成度、段位（观察者/拆解者/搭建者/审计者） |

---

## 架构

```
┌────────────────────── DSH Web GUI（React Slot）──────────────────────┐
│  侧栏「证据回路」→ 我的路径 / 审计台 / HR 分享页                      │
└───────────────────────────────┬──────────────────────────────────────┘
                                │  fetch /evidence-loop/api/*
┌───────────────────────────────▼──────────────────────────────────────┐
│  Host 插件（Cordis）                                                  │
│                                                                      │
│  machine.js     状态机 + 复盘 JSON 校验（唯一写状态入口）              │
│  review.js      AI 复盘：提示词 / JSON 解析 / 重试 / 超时 / 并发控制    │
│  chat.js        呼叫教练：固定导师 Prompt / 多轮 / 按节点落盘           │
│  external.js    外部事实校验（ctx.web.search）                        │
│  audit.js       审计台投影（时间线 / 趋势 / 热区 / 待办）              │
│  share.js       分享页模型 + HTML 渲染 + 发布 + 本机预览              │
│  store.js       原子文件存储（tmp + rename）                          │
└──────┬────────────────────┬────────────────────┬─────────────────────┘
       │                    │                    │
 ~/.dsh/evidence-loop   ctx.llm（默认模型）   ctx.web / ctx.shareLink
 paths.json / submissions/ / reviews/ / rework-reasons/ / share/ / audit-log.json
```

### 关键技术选择

- **状态机硬编码**：`applyReview()` 只在「全部维度通过 + 每条理由都有原文引用 + next_actions 合规」时才把节点推进到「已通过复盘」，否则退回「需重做」或停在「已提交」。模型输出再漂亮，也绕不过这段代码。
- **强引用校验**：从复盘理由里提取引号片段，归一化空白后与交付物逐字比对；引用不到就拒绝整份复盘，并带错误原因重试一次。
- **异步复盘**：「提交」立即返回，复盘在后台跑；前端 1.5 秒轮询。120 秒整体超时 + 135 秒硬兜底，保证「运行中」一定会被清理，不会永久转圈。
- **隐私优先**：分享页只渲染 ≤80 字摘要片段；所有插值 HTML 转义；外部链接只允许 `http(s)`；检索词只取节点标题与证据要求，不发送交付物正文。
- **协议版本守卫**：`/api/state` 带 `api_version`，面板检测到宿主旧版会直接提示「完全退出 DSH 重开」，而不是静默错配。
- **可恢复**：所有数据落盘；复盘失败只记在版本上，节点停在「已提交」，界面提供「重新复盘」。

---

## 安装

插件以 bundle 形式安装到当前 DSH profile：

```bash
git clone <你的仓库地址>
```

然后 `Plugins → Add plugin` 选择仓库里的 `dsh-evidence-loop` 目录；或：

```
plugin_manager install_bundle <仓库目录>/dsh-evidence-loop
```

安装后需要**完全退出** DeepSeek Harness（含托盘图标）再重开；仅刷新页面只会更新浏览器半边。面板底部会显示「宿主协议 v4」表示宿主代码已加载。

数据目录：`~/.dsh/evidence-loop/`（Windows 上位于用户主目录下的 `.dsh\evidence-loop\`）。

### 开源与隐私

仓库只包含源码、测试与文档。学习数据（`paths.json`、`submissions/`、`reviews/`、`rework-reasons/`、`chat/`、`share/`、`share-note.json`、`audit-log.json`）都在用户主目录下，并由 `.gitignore` 排除；分享页快照包含个人学习内容，默认不随仓库发布。

---

## 数据模型

```jsonc
// paths.json
{
  "node_id": "A2",
  "title": "折叠规则：把一段解释压成一条可复用规则",
  "suggested_week": "W1—W2",
  "status": "需重做",
  "evidence_required": "提交压缩前后的对照：原文摘要、折叠出的规则、新例子推演",
  "external_check": false,
  "tutorial": "第一步：用简单指令、角色+任务、完整结构化三种方式让 AI 写一段文案；第二步：截图三次输出……",
  "tutorial_label": "打开 DeepSeek 对话",
  "tutorial_url": "https://chat.deepseek.com",
  "versions": [
    {
      "version": 1,
      "submission_id": "sub_...",
      "review_id": "rv_...",
      "review_decision": "需重做",
      "rework_reason": null,
      "content": "…"
    }
  ],
  "next_actions": [{ "text": "补齐来源后重做", "node_id": "A2" }]
}
```

```
~/.dsh/evidence-loop/
├── paths.json           路径与节点
├── submissions/         每次提交的版本快照
├── reviews/             每次复盘（判定、引用、证据、模型与用量）
├── rework-reasons/      每次重做的修改理由
├── chat/                每个节点的教练对话（按 node_id 分文件）
├── share-note.json      分享页心得
├── share/               分享页 HTML 快照（保留最近 20 份）
└── audit-log.json       状态流转 / 复盘 / 外部校验 / 拦截事件
```

---

## 测试

6 组自测，全部使用临时 `DSH_HOME` + 假 LLM/搜索服务，不污染真实数据：

```powershell
$env:DSH_HOME = "<repo>\.tmp-selftest"

node dsh-evidence-loop/test/smoke.mjs      # 状态机、落盘、强引用、连续天数
node dsh-evidence-loop/test/review.mjs     # 通过 / 重试 / 重做第 4 维 / 非法 JSON
node dsh-evidence-loop/test/external.mjs   # 标记节点检索、去重、非 http(s) 丢弃、失败不阻断
node dsh-evidence-loop/test/api.mjs        # 提交→复盘→流转、分享路由、本机预览、坏地址撤销
node dsh-evidence-loop/test/share.mjs      # 归因分组、80 字截断、转义、发布参数无 channel
node dsh-evidence-loop/test/coach.mjs      # 教练系统提示、按节点落盘、多轮上下文、清空
```

---

## 一次真实的排障记录

阶段三上线后，生成的分享链接打开是：

```json
{"success":false,"result":null,"errors":[{"code":10005,"message":"Method Not Allowed"}]}
```

排查结论：

1. 链接是 `https://api.trycloudflare.com/s/<id>/`——**把 Cloudflare API 主机当成了隧道地址**。
2. 根因在 `@vlln/dsh-share-link` v0.7.6：它用 `/https:\/\/[a-z0-9-]+\.trycloudflare\.com/` 从 cloudflared 输出里抓地址，而隧道失败时 cloudflared 会打印
   `Post "https://api.trycloudflare.com/tunnel": context deadline exceeded`，正则把错误日志里的 API 主机当成成功地址。
3. 更深一层是网络：cloudflared 直连 `api.trycloudflare.com` 超时，系统代理只服务浏览器（WinINET），cloudflared 不读 `HTTPS_PROXY`。

修复方式（本仓库）：

- 分享生成后校验地址：`api.*` 或非 `/s/<id>/` 形态一律判失败，**自动撤销该分享记录**，绝不把坏链接给用户；同时始终提供同源「本机预览」。
- 给上游 `share-link` 打了正则补丁（排除 `api.` 子域），并保留 `.bak-before-api-fix`。
- 分享页始终提供本机可打开的预览链接，刷新/切页签后可从「上次生成」找回。

---

## 已知限制

- 公网分享依赖 Cloudflare Quick Tunnel；网络环境（尤其代理 fake-IP/TUN 模式）可能阻断其 API 或边缘连接，此时面板会明确报错并给出本机预览，不伪造链接。
- 复盘使用 profile 默认模型；模型不可用/未登录账号时复盘会失败（可见、可重试），不会静默通过。
- 分享链接默认 7 天有效；本地 HTML 快照不随数据更新。

---

## 目录

```
.
├── README.md
├── PRODUCT_DOC.md
├── LICENSE
├── .gitignore
└── dsh-evidence-loop/
    ├── index.js                 Host 入口
    ├── client.js                面板（侧栏入口 / 我的路径 / 审计台 / 分享页）
    ├── cordis.patch.yml
    ├── lib/
    │   ├── machine.js           状态机与复盘裁决
    │   ├── review.js            AI 复盘引擎
    │   ├── external.js          外部事实校验
    │   ├── chat.js              呼叫教练（多轮对话）
    │   ├── audit.js             审计台投影
    │   ├── share.js             分享页生成与发布
    │   ├── state.js             面板状态投影
    │   ├── store.js             文件存储
    │   ├── seed.js              初始路径与节点
    │   └── version.js           协议版本
    ├── test/                    6 组自测
    ├── locale/                  中英文显示元数据
    ├── docs/DETAIL.md           插件详情页
    └── icon.svg
```

---

## License

MIT
