// 初始学习路径（硬编码）。suggested_week 只是参考节奏，不参与任何状态判定。
// 节点标题与准入证据是本插件对三条路径的具体化；学习者可以在 paths.json 里改，状态机不变。

export const STORE_VERSION = 1

export const RANK_LADDER = [
  { name: '观察者', min: 0 },
  { name: '拆解者', min: 3 },
  { name: '搭建者', min: 7 },
  { name: '审计者', min: 11 },
]

export const STATUSES = ['未开始', '练习中', '已提交', '已通过复盘', '需重做']

// 需要外部事实校验的节点：复盘前会调用 Host 的 web.search（web_search 工具同源能力），
// 检索结果只作为辅助证据写入 evidence_refs，不得作为「通过」的唯一依据。
export const NODE_EXTERNAL_CHECK = {
  A3: true,
  B1: true,
  B2: true,
  B3: true,
  B4: true,
  C5: true,
}

// 每个节点的「手把手实操指南」与真实环境入口。
// tutorial 是给学习者看的操作步骤；label/url 是节点详情里的跳转按钮。
export const NODE_TUTORIALS = {
  A1: {
    text: '第一步：去 Dify 注册账号，新建一个 Workflow；第二步：拖入 Start 和 LLM 节点连线；第三步：配置 DeepSeek 模型，输入测试词「剧场效应」；第四步：截图 Preview 界面，作为作业提交。',
    label: '点击前往 Dify 实操',
    url: 'https://cloud.dify.ai',
  },
  A2: {
    text: '第一步：用简单指令、角色+任务、完整结构化（角色+任务+约束+强制格式）三种方式让 AI 写一段文案；第二步：截图三次输出，并写一段 100 字的归因分析；第三步：提交截图和分析。',
    label: '打开 DeepSeek 对话',
    url: 'https://chat.deepseek.com',
  },
  A3: {
    text: '第一步：打开 Dify 的 Workflow，把 A1 的流程改出一个反例：只连 Start，不接 LLM；第二步：再做一个边界版：LLM 节点加一个「输入为空时返回提示」的条件分支；第三步：分别运行两次，截图正常与失效两种结果；第四步：写 100 字说明规则在哪种输入下会失效，连同两张截图一起提交。',
    label: '回到 Dify 改流程',
    url: 'https://cloud.dify.ai',
  },
  A4: {
    text: '第一步：把 A1–A3 的三次截图和结论整理成一页纸；第二步：先只放例子与截图，不要写概念名；第三步：最后一行再写你总结出来的概念名；第四步：提交这一页纸（可导出 PDF 或长截图）。',
    label: '打开 Dify（可选素材库）',
    url: 'https://cloud.dify.ai',
  },
  B1: {
    text: '第一步：在 Dify 里新建一个 Knowledge Base，上传 3 份你熟悉的资料；第二步：给每条资料标出来源类型（一手/二手/传闻）和日期；第三步：挑 8 条主张，逐条记录来源链接或页码；第四步：把这张台账导出为表格或截图提交。',
    label: '去 Dify 建知识库',
    url: 'https://cloud.dify.ai',
  },
  B2: {
    text: '第一步：从 B1 的台账里选 3 条结论；第二步：为每条找 1 条支持证据和 1 条反证（可以问 AI 或搜索）；第三步：给证据标强度（强/中/弱），至少一条写「证据不足」；第四步：提交这张主张—证据映射表。',
    label: '打开 DeepSeek 找反证',
    url: 'https://chat.deepseek.com',
  },
  B3: {
    text: '第一步：在知识库里找两条互相矛盾的说法（或让 AI 生成一对矛盾证据）；第二步：分别截图原文；第三步：写下你裁决时看重的标准（时间、来源级别、样本量）；第四步：说明裁决后你改掉了哪条主张，提交截图与裁决说明。',
    label: '打开 DeepSeek 做裁决演练',
    url: 'https://chat.deepseek.com',
  },
  B4: {
    text: '第一步：打开 B1 的知识库，按日期从旧到新排序；第二步：找出 3 条超过一年或来源失效的条目；第三步：逐条写下失效信号（链接 404、政策更新、数据过期）；第四步：给出替换来源或删除建议，截图提交。',
    label: '回 Dify 做复查',
    url: 'https://cloud.dify.ai',
  },
  B5: {
    text: '第一步：把 B1–B4 的记录汇总成一份审计报告大纲（范围/抽样/发现/处置）；第二步：每个发现配一条可定位的条目编号；第三步：检查每条发现都能回到原文；第四步：导出 PDF 或长截图提交。',
    label: '打开 Dify（可选素材库）',
    url: 'https://cloud.dify.ai',
  },
  C1: {
    text: '第一步：在 Dify 里新建一个 Chatflow；第二步：写一条规则：输入包含「退款」才触发，否则走默认回复；第三步：各测一次正例和反例，截图；第四步：补一条豁免条件（如已发货不退），再测一次，提交三张截图。',
    label: '去 Dify 搭规则',
    url: 'https://cloud.dify.ai',
  },
  C2: {
    text: '第一步：设计一张例外申请单（申请人/原因/影响范围/审批人）；第二步：写清楚缺哪一项就拒绝批准；第三步：用 Dify 做一个表单或让 AI 模拟一次审批；第四步：提交模板 + 一次模拟记录。',
    label: '打开 Dify 做例外流程',
    url: 'https://cloud.dify.ai',
  },
  C3: {
    text: '第一步：找两条会打架的规则（如「7 天无理由」与「定制商品不退」）；第二步：写出冲突点与裁决顺序；第三步：把两条规则合并成一版，用 3 个案例验证；第四步：提交冲突说明 + 合并版 + 验证截图。',
    label: '打开 Dify 验证规则冲突',
    url: 'https://cloud.dify.ai',
  },
  C4: {
    text: '第一步：选一条你写过的规则，列出受影响条款；第二步：标出受影响对象（用户/客服/仓库）；第三步：写回滚方案与生效时间；第四步：提交影响评估表和一句「哪些判断依赖假设」。',
    label: '打开 Dify（可选）',
    url: 'https://cloud.dify.ai',
  },
  C5: {
    text: '第一步：选一个真实场景（如退款），列出事实、适用规则、判定；第二步：每条判定都附规则条文或截图；第三步：检查全文没有无出处断言；第四步：导出判定书 PDF 提交。',
    label: '打开 Dify（可选）',
    url: 'https://cloud.dify.ai',
  },
}

const PATHS = [
  {
    path_id: 'A',
    title: '概念折叠引擎',
    summary: '把一个概念拆到能被检验的最小单位，再折回一句可复用的规则。',
    nodes: [
      {
        node_id: 'A1',
        title: '概念拆解：找出最小可定义单元',
        suggested_week: 'W1—W2',
        evidence_required:
          '提交一份概念拆解：定义、一个最小例子、一个反例，每个判断都要能指回你引用的原文或教材页码；只写结论不算证据。',
      },
      {
        node_id: 'A2',
        title: '折叠规则：把一段解释压成一条可复用规则',
        suggested_week: 'W1—W2',
        evidence_required:
          '提交压缩前后的对照：原文摘要、你折叠出的规则、以及用该规则解释一个新例子的推演过程。',
      },
      {
        node_id: 'A3',
        title: '反例与边界：证明规则在哪里失效',
        suggested_week: 'W3—W4',
        evidence_required:
          '提交两个边界案例：一个规则成立、一个不成立，并说明分界点由哪条原文或哪次实验结果支撑。',
      },
      {
        node_id: 'A4',
        title: '一页纸综合：从例子反推概念',
        suggested_week: 'W4',
        evidence_required:
          '提交一页纸说明：只给例子与推演，最后一句才给概念名；读者应能仅凭证据复述定义。',
      },
    ],
  },
  {
    path_id: 'B',
    title: '知识库审计员',
    summary: '让知识库里的每条主张都能被追溯、被质疑、被判为过期。',
    nodes: [
      {
        node_id: 'B1',
        title: '信息源台账：标记每条主张的来源',
        suggested_week: 'W5',
        evidence_required:
          '提交一份来源台账：任意 8 条主张，逐条写明来源类型（一手/二手/传闻）、日期与可核查链接或页码。',
      },
      {
        node_id: 'B2',
        title: '主张—证据映射：为每个结论找到落地证据',
        suggested_week: 'W5—W6',
        evidence_required:
          '提交一张映射表：结论、支撑证据、证据强度、反证检索结果；至少一条要标注「证据不足」。',
      },
      {
        node_id: 'B3',
        title: '冲突裁决：两条证据矛盾时怎么判',
        suggested_week: 'W7',
        evidence_required:
          '提交一次真实冲突的裁决：双方证据、裁决依据、裁决后你改掉了哪条主张，并引用冲突原文。',
      },
      {
        node_id: 'B4',
        title: '过期与失效复查',
        suggested_week: 'W7',
        evidence_required:
          '提交一次知识库复查：找出至少 3 条已过期或已失效的条目，写明失效信号来自哪里。',
      },
      {
        node_id: 'B5',
        title: '审计报告综合',
        suggested_week: 'W8',
        evidence_required:
          '提交一份审计报告：范围、抽样方法、发现、处置建议；每个发现都要能定位到具体条目。',
      },
    ],
  },
  {
    path_id: 'C',
    title: '规则守门人',
    summary: '把规则写成可执行、可例外、可变更影响评估的判定。',
    nodes: [
      {
        node_id: 'C1',
        title: '规则边界：写清触发条件与豁免条件',
        suggested_week: 'W9',
        evidence_required:
          '提交一份规则改写：给定原始规则，写出触发条件、豁免条件，以及各配一个正例与反例。',
      },
      {
        node_id: 'C2',
        title: '例外流程：例外如何被批准与留痕',
        suggested_week: 'W10',
        evidence_required:
          '提交一份例外申请单与审批留痕模板，并说明哪些信息缺失时应当拒绝批准。',
      },
      {
        node_id: 'C3',
        title: '规则冲突检测：两条规则打架时',
        suggested_week: 'W10—W11',
        evidence_required:
          '提交一组互相冲突的真实规则，写出冲突点、裁决顺序与依据，并给出合并后的版本。',
      },
      {
        node_id: 'C4',
        title: '规则变更影响评估',
        suggested_week: 'W11',
        evidence_required:
          '提交一次变更影响评估：受影响条款清单、受影响对象、回滚方案，并标注哪些判断依赖假设。',
      },
      {
        node_id: 'C5',
        title: '合规判定书综合',
        suggested_week: 'W12',
        evidence_required:
          '提交一份合规判定书：事实、适用规则、判定、例外与否、证据附件；不得出现无出处的断言。',
      },
    ],
  },
]

export function buildSeed(nowIso) {
  return {
    version: STORE_VERSION,
    created_at: nowIso,
    updated_at: nowIso,
    meta: {
      streak: { current: 0, longest: 0, last_submit_date: null },
      seeded_at: nowIso,
    },
    paths: PATHS.map((path) => ({
      path_id: path.path_id,
      title: path.title,
      summary: path.summary || '',
      nodes: path.nodes.map((node) => ({
        node_id: node.node_id,
        title: node.title,
        suggested_week: node.suggested_week,
        status: '未开始',
        evidence_required: node.evidence_required,
        external_check: NODE_EXTERNAL_CHECK[node.node_id] === true,
        tutorial: NODE_TUTORIALS[node.node_id]?.text || '',
        tutorial_label: NODE_TUTORIALS[node.node_id]?.label || '',
        tutorial_url: NODE_TUTORIALS[node.node_id]?.url || '',
        versions: [],
        next_actions: [],
        created_at: nowIso,
        updated_at: nowIso,
      })),
    })),
  }
}

export function rankFor(passed) {
  let rank = RANK_LADDER[0].name
  for (const step of RANK_LADDER) if (passed >= step.min) rank = step.name
  return rank
}
