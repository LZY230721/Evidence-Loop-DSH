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
    text: '第一步：在 Dify 新建 Workflow，拖入 Start 与 LLM 节点，配置 DeepSeek，输入「剧场效应」跑通一次；第二步：基于这次运行写出一句话定义，并标出定义依据的原文或教材页码；第三步：各写一个最小例子和一个反例，分别注明它们对应哪条原文或观察；第四步：把「定义＋最小例子＋反例＋出处」整理成一份文档或截图提交。',
    label: '点击前往 Dify 实操',
    url: 'https://cloud.dify.ai',
  },
  A2: {
    text: '第一步：找一段 100 字左右的「原文摘要」并记下来；第二步：让 AI 帮你把这段原文「折叠」成一条可复用的「规则」；第三步：用这条规则，去解释一个全新的场景/例子；第四步：将上述三步的完整推演过程作为作业提交。',
    label: '打开 DeepSeek 对话',
    url: 'https://chat.deepseek.com',
  },
  A3: {
    text: '第一步：在 Dify 里搭一条最小规则流程（如「输入含关键词才走 LLM」）；第二步：构造一个规则成立的案例和一个不成立的案例，分别运行并截图；第三步：写出两者的分界点，并标注分界点由哪条原文、规则配置或实验输出支撑；第四步：提交两个案例、两张截图和一段分界点说明。',
    label: '回到 Dify 改流程',
    url: 'https://cloud.dify.ai',
  },
  A4: {
    text: '第一步：从 A1–A3 里选 2–3 个例子和推演过程，整理成一页纸；第二步：全篇先不写概念名，只放例子、推演和结论；第三步：最后一句才写出概念名，并回头检查「读者只看例子能否复述定义」；第四步：把这一页导出 PDF 或长截图提交。',
    label: '打开 Dify（可选素材库）',
    url: 'https://cloud.dify.ai',
  },
  B1: {
    text: '第一步：在 Dify 新建 Knowledge Base，上传 3 份你熟悉的资料；第二步：从中挑出 8 条主张，逐条标出来源类型（一手/二手/传闻）、日期和可核查链接或页码；第三步：检查每条主张都能点回原文；第四步：把这张来源台账导出为表格或截图提交。',
    label: '去 Dify 建知识库',
    url: 'https://cloud.dify.ai',
  },
  B2: {
    text: '第一步：从 B1 的台账里选 3 条结论；第二步：为每条结论找 1 条支撑证据和 1 条反证（可用 DeepSeek 或搜索）；第三步：给证据标强度（强/中/弱），并记录反证检索结果；第四步：至少给一条结论标注「证据不足」，把整张映射表提交。',
    label: '打开 DeepSeek 找反证',
    url: 'https://chat.deepseek.com',
  },
  B3: {
    text: '第一步：在知识库里找两条互相矛盾的说法，分别截图并引用冲突原文；第二步：列出双方证据，写下你裁决时看重的标准（时间、来源级别、样本量等）；第三步：给出裁决结论，并说明裁决后你改掉了哪条主张；第四步：提交双方原文截图、裁决依据和修改说明。',
    label: '打开 DeepSeek 做裁决演练',
    url: 'https://chat.deepseek.com',
  },
  B4: {
    text: '第一步：打开 B1 的知识库，按日期从旧到新排序；第二步：找出至少 3 条已过期或已失效的条目；第三步：逐条写明失效信号来自哪里（链接 404、政策更新、数据过期、来源被撤回等）；第四步：给出替换来源或删除建议，截图提交复查记录。',
    label: '回 Dify 做复查',
    url: 'https://cloud.dify.ai',
  },
  B5: {
    text: '第一步：确定审计范围与抽样方法（为什么抽这些条目），写成报告开头；第二步：从 B1–B4 中整理发现，每条发现标注具体条目编号；第三步：为每条发现写处置建议（保留/替换/删除），并检查能否定位到原文；第四步：导出审计报告 PDF 或长截图提交。',
    label: '打开 Dify（可选素材库）',
    url: 'https://cloud.dify.ai',
  },
  C1: {
    text: '第一步：选一条真实规则作为原始规则，抄下原文；第二步：写出触发条件、豁免条件，以及每个条件的一个正例和一个反例；第三步：在 Dify 的 Chatflow 里把这条规则跑一遍，各测一次正例与反例并截图；第四步：提交「原始规则＋改写后的触发/豁免条件＋四个测试结果」。',
    label: '去 Dify 搭规则',
    url: 'https://cloud.dify.ai',
  },
  C2: {
    text: '第一步：设计例外申请单（申请人/原因/影响范围/审批人/审批时间）；第二步：设计审批留痕模板，写清每一步由谁记录、记录什么；第三步：列出哪些信息缺失时必须拒绝批准；第四步：用 Dify 或 AI 模拟一次审批，提交模板与模拟记录。',
    label: '打开 Dify 做例外流程',
    url: 'https://cloud.dify.ai',
  },
  C3: {
    text: '第一步：找两条会打架的真实规则（如「7 天无理由」与「定制商品不退」），抄下原文；第二步：写出冲突点、裁决顺序和裁决依据；第三步：把两条规则合并成一版，用 3 个案例验证；第四步：提交冲突说明、裁决依据、合并版和验证截图。',
    label: '打开 Dify 验证规则冲突',
    url: 'https://cloud.dify.ai',
  },
  C4: {
    text: '第一步：选一条你写过的规则，列出所有受影响条款；第二步：标出受影响对象（用户/客服/仓库/财务）；第三步：写回滚方案与生效时间；第四步：标注哪些判断依赖假设，提交完整的影响评估表。',
    label: '打开 Dify（可选）',
    url: 'https://cloud.dify.ai',
  },
  C5: {
    text: '第一步：选一个真实场景（如退款），列出事实、适用规则和判定；第二步：写明是否适用例外，并为每条判定附规则条文或截图；第三步：检查全文有没有无出处的断言；第四步：导出判定书 PDF（含证据附件）提交。',
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
