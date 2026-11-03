// 竞赛注册表：模板 id → 显示名 / 页数 / LaTeX 模板目录（assets/templates 下的子目录）
// 只收录中文赛项（插件 MVP 只带中文写作/编译技能）。
export const COMPETITIONS = {
  cumcm: {
    label: '国赛 (CUMCM)',
    name: '全国大学生数学建模竞赛 (CUMCM)',
    pages: 30,
    latex: 'cumcm',
    problemTitles: 'A/B/C/D/E',
  },
  wuyi: {
    label: '五一杯',
    name: '五一杯数学建模竞赛',
    pages: 30,
    latex: 'wuyi',
    problemTitles: 'A/B/C',
  },
  huazhong: {
    label: '华中杯',
    name: '华中杯数学建模邀请赛',
    pages: 30,
    latex: 'huazhong',
    problemTitles: 'A/B/C',
  },
  apmcm_zh: {
    label: '亚太赛中文 (APMCM)',
    name: '亚太地区数学建模竞赛中文赛项 (APMCM 中文)',
    pages: 25,
    latex: 'apmcm_zh',
    problemTitles: 'A/B/C',
  },
  diangong: {
    label: '电工杯',
    name: '电工杯数学建模竞赛',
    pages: 30,
    latex: 'diangongbei',
    problemTitles: 'A/B',
  },
  mathorcup: {
    label: 'MathorCup',
    name: 'MathorCup 高校数学建模挑战赛',
    pages: 30,
    latex: 'mathorcup',
    problemTitles: 'A/B/C/D',
  },
  zhongqing: {
    label: '中青杯',
    name: '中青杯数学建模竞赛',
    pages: 30,
    latex: 'default',
    problemTitles: 'A/B/C',
  },
  yangtze: {
    label: '长三角',
    name: '长三角高校数学建模竞赛',
    pages: 30,
    latex: 'changsanjiao',
    problemTitles: 'A/B/C',
  },
  liaoning: {
    label: '辽宁省/东三省',
    name: '辽宁省大学生数学建模/东三省数学建模联赛',
    pages: 30,
    latex: 'dongsansheng',
    problemTitles: 'A/B/C',
  },
  huashu: {
    label: '华数杯',
    name: '华数杯数学建模竞赛',
    pages: 30,
    latex: 'huashubei',
    problemTitles: 'A/B/C',
  },
  huawei: {
    label: '华为杯（研究生）',
    name: '中国研究生数学建模竞赛（华为杯）',
    pages: 30,
    latex: 'huawei',
    problemTitles: 'A/B/C/D/E/F',
  },
  generic: {
    label: '通用（其他中文赛项）',
    name: '数学建模竞赛',
    pages: 30,
    latex: 'default',
    problemTitles: 'A/B/C',
  },
};

export const COMPETITION_KEYS = Object.keys(COMPETITIONS);

// 开关默认值（以下语义与竞赛工作流工具的常见做法一致）：
//   - figure_style 缺省 default 时仍显式写入（CLAUDE.md 需要它决定风格规则块）
//   - validation_mode=fast → CLAUDE.md 写 MMW_FAST_MODE=1
//   - ai_disclosure=off   → 不写任何 MMW_AI_DISCLOSURE 标记
//   - flowchart_engine=html 时 diagram_style 才生效
export const DEFAULT_SWITCHES = {
  competition: 'cumcm',
  problem_id: '',
  title: '',
  max_pages: 0, // 0 = 用竞赛默认页数
  figure_style: 'default', // default | nature
  flowchart_engine: 'drawio', // drawio | html
  diagram_style: 'mono', // mono | plain | modern（仅 html）
  rich_mode: false,
  validation_mode: 'strict', // strict | fast
  ai_disclosure: 'off', // off | used | none
  comp_date_start: '',
  comp_date_end: '',
  // 逻辑对抗复核默认开启（用户要求）：多一次子代理调用，但能拦方向反/跨问矛盾/任务读歪
  enable_comp_review: true,
  skip_figures: false,
  skip_drawio: false,
  min_figures: 'auto',
  min_tables: 'auto',
  min_models: 'auto',
  custom_requirements: '',
  language: 'zh',
  output_format: 'pdf',
  tools: 'python',
};

const ENUMS = {
  figure_style: ['default', 'nature'],
  flowchart_engine: ['drawio', 'html'],
  diagram_style: ['mono', 'plain', 'modern'],
  validation_mode: ['strict', 'fast'],
  ai_disclosure: ['off', 'used', 'none'],
  language: ['zh'],
  output_format: ['pdf', 'latex'],
};

function asBool(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return fallback;
}

function asCount(value, fallback) {
  if (value === 'auto' || value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

/** 规范用户传入的开关；返回 { switches, errors } */
export function normalizeSwitches(input = {}) {
  const errors = [];
  const s = { ...DEFAULT_SWITCHES };

  const competition = String(input.competition ?? s.competition).trim();
  if (!COMPETITIONS[competition]) {
    errors.push(`未知竞赛 ${competition}；可选：${COMPETITION_KEYS.join(', ')}`);
  } else {
    s.competition = competition;
  }

  for (const [key, allowed] of Object.entries(ENUMS)) {
    if (input[key] === undefined) continue;
    const value = String(input[key]).trim();
    if (!allowed.includes(value)) {
      errors.push(`${key} 只接受 ${allowed.join(' | ')}，收到 ${value}`);
    } else {
      s[key] = value;
    }
  }

  s.problem_id = String(input.problem_id ?? s.problem_id).trim();
  s.title = String(input.title ?? s.title).trim();
  s.custom_requirements = String(input.custom_requirements ?? s.custom_requirements ?? '').trim();
  s.comp_date_start = String(input.comp_date_start ?? '').trim();
  s.comp_date_end = String(input.comp_date_end ?? '').trim();

  const pages = Number(input.max_pages ?? s.max_pages);
  s.max_pages = Number.isFinite(pages) && pages > 0 ? Math.floor(pages) : 0;

  s.rich_mode = asBool(input.rich_mode, s.rich_mode);
  s.enable_comp_review = asBool(input.enable_comp_review, s.enable_comp_review);
  s.skip_figures = asBool(input.skip_figures, s.skip_figures);
  s.skip_drawio = asBool(input.skip_drawio, s.skip_drawio);
  s.min_figures = asCount(input.min_figures, s.min_figures);
  s.min_tables = asCount(input.min_tables, s.min_tables);
  s.min_models = asCount(input.min_models, s.min_models);

  // 丰满模式默认把页数抬到 50
  const spec = COMPETITIONS[s.competition] ?? COMPETITIONS.generic;
  if (s.rich_mode && s.max_pages < 40) s.max_pages = Math.max(50, s.max_pages);
  if (!s.max_pages) s.max_pages = spec.pages;

  if (s.flowchart_engine === 'drawio' && s.diagram_style !== 'mono') {
    // diagram_style 只对 html 生效，静默回落到默认，不报错
    s.diagram_style = 'mono';
  }
  if (s.ai_disclosure === 'off') {
    s.comp_date_start = '';
    s.comp_date_end = '';
  }

  return { switches: s, errors };
}

/** 给模型看的开关摘要（单行一条，便于工具结果里回显） */
export function summarizeSwitches(s) {
  const spec = COMPETITIONS[s.competition] ?? COMPETITIONS.generic;
  return [
    `竞赛=${spec.label}(${s.competition})`,
    `题号=${s.problem_id || '未填'}`,
    `页数(正文)=${s.max_pages}`,
    `数据图风格=${s.figure_style}`,
    `流程图引擎=${s.flowchart_engine}${s.flowchart_engine === 'html' ? `/${s.diagram_style}` : ''}`,
    `丰满模式=${s.rich_mode ? '开' : '关'}`,
    `审查模式=${s.validation_mode}`,
    `AI声明=${s.ai_disclosure}`,
    `对抗复核=${s.enable_comp_review ? '开' : '关'}`,
    `跳过图表=${s.skip_figures ? '是' : '否'}`,
  ].join(' ｜ ');
}
