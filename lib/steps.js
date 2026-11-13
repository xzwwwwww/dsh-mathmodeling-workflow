// 步骤定义与解析：模板只是默认值，开关会改变真实步骤集合。

export const CORE_STEPS = [
  {
    key: 'comp-prob-analysis',
    title: '赛题分析',
    skill: '赛题分析',
    primaryOutput: 'PROBLEM_ANALYSIS.md',
    minBytes: 1500,
    gates: ['artifact', 'logic'],
    checkpoint: 'approve',
  },
  {
    key: 'comp-modeling',
    title: '建模求解',
    skill: '建模求解',
    primaryOutput: 'MODELING_REPORT.md',
    minBytes: 1500,
    gates: ['artifact', 'logic'],
    checkpoint: 'feedback',
  },
  {
    key: 'comp-code',
    title: '编程实现',
    skill: '编程实现',
    primaryOutput: 'RESULTS.md',
    minBytes: 1000,
    companions: ['code/main.py', 'figures/*.json'],
    gates: ['artifact', 'companions', 'logic'],
    checkpoint: 'approve',
  },
  {
    key: 'paper-figure',
    title: '图表生成',
    skill: '图表生成',
    primaryOutput: 'figures/latex_includes.tex',
    minBytes: 50,
    gates: ['artifact', 'figures'],
  },
  {
    key: 'paper-figure-drawio',
    title: '流程与架构图绘制',
    skill: '流程图绘制',
    primaryOutput: 'figures/',
    gates: ['artifact', 'figures'],
  },
  {
    key: 'paper-figure-html',
    title: '流程与架构图绘制（HTML 引擎）',
    skill: '流程图绘制HTML',
    primaryOutput: 'figures/',
    gates: ['artifact', 'figures'],
  },
  // 逻辑对抗复核放在图表之后、论文之前：它要复核图表并对错误图表触发重生成，
  // 必须在全部图产物齐备之后跑（fatal 回炉段即
  // comp-modeling → comp-code → paper-figure → paper-figure-html → comp-review 一致）
  {
    key: 'comp-review',
    title: '逻辑对抗复核',
    skill: '逻辑对抗复核',
    primaryOutput: 'COMP_REVIEW_VERDICT.json',
    minBytes: 50,
    gates: ['artifact', 'review_verdict'],
    optional: true,
  },
  {
    key: 'comp-paper-zh',
    title: '竞赛论文撰写',
    skill: '论文撰写',
    primaryOutput: 'paper/main.tex',
    minBytes: 2000,
    companions: ['paper/sections/*.tex'],
    gates: ['artifact', 'companions', 'ai_disclosure', 'pages', 'paper_data_check'],
    checkpoint: 'approve',
  },
  {
    key: 'comp-compile-zh',
    title: '编译与合规检查',
    skill: '编译与合规',
    primaryOutput: 'paper/main.pdf',
    minBytes: 50000,
    gates: ['artifact', 'pdf_pages', 'paper_data_check'],
  },
  // 英文赛事（MCM/ICM/APMCM）：论文与编译技能换成英文链；由 resolveSteps 按 language 选择
  {
    key: 'comp-paper-en',
    title: 'Paper Writing (English)',
    skill: '论文撰写English',
    primaryOutput: 'paper/main.tex',
    minBytes: 2000,
    companions: ['paper/sections/*.tex'],
    gates: ['artifact', 'companions', 'ai_disclosure', 'pages', 'paper_data_check'],
    checkpoint: 'approve',
  },
  {
    key: 'comp-compile-en',
    title: 'Compile & Compliance (English)',
    skill: '编译与合规English',
    primaryOutput: 'paper/main.pdf',
    minBytes: 50000,
    gates: ['artifact', 'pdf_pages', 'paper_data_check'],
  },
];

/**
 * 按开关解析真实步骤列表。
 * - flowchart_engine=html  → paper-figure-drawio 换成 paper-figure-html
 * - enable_comp_review     → 图表之后、论文之前插入 comp-review（fast 模式省略）
 * - skip_figures           → 去掉两个图表步
 * - skip_drawio            → 只去掉流程图步
 */
export function resolveSteps(switches) {
  const en = switches.language === 'en';
  let steps = CORE_STEPS.filter((s) => {
    // 论文/编译步按语言二选一（步骤 key 保留 zh/en 便于排查，闸门不依赖具体后缀）
    if (s.key === 'comp-paper-zh' || s.key === 'comp-compile-zh') return !en;
    if (s.key === 'comp-paper-en' || s.key === 'comp-compile-en') return en;
    if (s.key === 'comp-review') return switches.enable_comp_review === true && switches.validation_mode !== 'fast';
    if (s.key === 'paper-figure-html') return false; // 由下面的替换逻辑决定
    if (switches.skip_figures && (s.key === 'paper-figure' || s.key === 'paper-figure-drawio')) return false;
    if (switches.skip_drawio && s.key === 'paper-figure-drawio') return false;
    return true;
  });

  if (switches.flowchart_engine === 'html' && !switches.skip_figures && !switches.skip_drawio) {
    const idx = steps.findIndex((s) => s.key === 'paper-figure-drawio');
    if (idx >= 0) steps = [...steps.slice(0, idx), CORE_STEPS.find((s) => s.key === 'paper-figure-html'), ...steps.slice(idx + 1)];
  }

  return steps.map((s, i) => {
    // 数据图风格决定用哪个技能：nature → 自然风格图表；default → 图表生成
    if (s.key === 'paper-figure' && switches.figure_style === 'nature') {
      return { ...s, order: i, skill: '自然风格图表', title: '图表生成（Nature 风格）' };
    }
    return { ...s, order: i };
  });
}

/** 步骤产物目录（放 prompt.md 与子代理日志） */
export function stepDirName(order, key) {
  return `${String(order + 1).padStart(2, '0')}_${key}`;
}
