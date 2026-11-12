import { COMPETITIONS, perProblemFlowStyle } from './switches.js';
import { RULES, richModeBlock } from './rules.js';

const CORE_PRINCIPLES = `优先级：物理/业务约束 > 数据忠实度 > 计算正确性

如果计算结果违反了题目给定的物理/业务约束（如超出最大值、为负、不守恒）：
- 禁止：发现超出后只写一句「这是因为XXX」然后继续使用超出的结果
- 禁止：把不合理的值写进 JSON/报告，旁边加注释说明
- 禁止：写「后续可改进」或「留给下一步处理」然后跳过
- 必须：分析原因 → 修正数据或模型（加物理约束）→ 重新计算 → 用修正后的合理值
- 必须：在报告中写明「原始结果为 X（不合理），修正后为 Y，修正方法为 Z」
- 必须：修正后重新验证，确认结果在合理范围内

⛔ 关键认知：数学正确 ≠ 物理合理。检测到问题 = 必须修复，解释原因 ≠ 处理完毕。`;

function markerLines(s) {
  const lines = [];
  if (s.validation_mode === 'fast') lines.push('MMW_FAST_MODE=1');
  if (s.ai_disclosure === 'used' || s.ai_disclosure === 'none') {
    lines.push(`MMW_AI_DISCLOSURE=${s.ai_disclosure}`);
    lines.push(`MMW_AI_DISC_DATE_START=${s.comp_date_start || '（未填，按创建日期）'}`);
    lines.push(`MMW_AI_DISC_DATE_END=${s.comp_date_end || '（未填，按创建日期）'}`);
  }
  if (s.figure_style === 'nature') lines.push('MMW_FIGURE_STYLE=nature');
  const flowStyle = perProblemFlowStyle(s);
  if (flowStyle !== 'off') {
    lines.push('MMW_FLOW_PER_PROBLEM=1');
    lines.push(`MMW_PER_PROBLEM_FLOW_STYLE=${flowStyle}`);
  }
  return lines;
}

/** 生成 workspace/CLAUDE.md 全文 */
export function buildClaudeMd({ switches: s, steps, title, uploaded = [] }) {
  const spec = COMPETITIONS[s.competition] ?? COMPETITIONS.generic;
  const out = [];

  out.push(`# 研究项目: ${title}`, '');

  out.push('## 项目说明');
  out.push(
    `这是一个自动化数学建模工作流，当前执行「${spec.name}」流水线。主代理负责逐步派发子代理，` +
      `每个子代理只做一步；所有跨步骤信息都写在本文件与工作区文件里，不依赖对话上下文。`,
  );
  out.push('');

  out.push('## 流水线步骤');
  steps.forEach((st, i) => out.push(`  ${i + 1}. ${st.title} (${st.key}) → ${st.primaryOutput}`));
  out.push('');

  out.push('## 重要规则');
  out.push('- 所有产出文件都写入当前工作目录（workspace 根），不要写到其他位置');
  out.push('- 你是子代理：能安全假设的就写清「假设：…；依据：…」继续；必须用户拍板的关键信息用 `modeling_ask` 提问并等主代理回传答案，不要自己编答案');
  out.push('- 每步至少产出一个文件；只读上游产物，不要重写上游文件');
  out.push('- 严禁使用 matplotlib 默认样式；绘图脚本必须 `from _utils.plot_utils import setup_style` 并调用 `setup_style()`');
  out.push(s.language === 'en' ? '- Write the paper in English (including figure labels and captions); LaTeX commands stay as-is' : '- 使用中文撰写论文（LaTeX 命令除外）');
  out.push('');

  if (uploaded.length) {
    out.push('## 用户上传的文件');
    for (const f of uploaded) out.push(`- ${f}`);
    out.push('请仔细阅读并利用这些文件作为研究基础（赛题原文优先读 user_data/）。');
    out.push('');
  }

  out.push('## 参数');
  out.push(`- 研究主题: ${title}`);
  out.push(`- competition: ${s.competition}`);
  out.push(`- problem_id: ${s.problem_id || '（未填）'}`);
  out.push(`- language: ${s.language}`);
  out.push(`- max_pages: ${s.max_pages}（正文页数；目录后→参考文献前，无目录则摘要后→参考文献前）`);
  out.push(`- output_format: ${s.output_format}`);
  out.push(`- tools: ${s.tools}`);
  out.push(`- figure_style: ${s.figure_style}`);
  out.push(`- flowchart_engine: ${s.flowchart_engine}`);
  out.push(`- diagram_style: ${s.diagram_style}`);
  out.push(`- rich_mode: ${s.rich_mode}`);
  out.push(`- validation_mode: ${s.validation_mode}`);
  out.push(`- ai_disclosure: ${s.ai_disclosure}`);
  out.push(`- min_figures: ${s.min_figures}`);
  out.push(`- min_tables: ${s.min_tables}`);
  out.push(`- min_models: ${s.min_models}`);
  if (s.custom_requirements) out.push(`- custom_requirements: ${s.custom_requirements}`);
  out.push('- 图像生成配置（场景图/机理图/概念图）: 填 `_utils/_gpt_image_config.json` 的 `api_key` / `base_url`（base_url 留空=官方），或设环境变量 `GPT_IMAGE_API_KEY` / `GPT_IMAGE_BASE_URL`；未配置时 GPT 图自动跳过，不影响其他步骤');
  out.push('');

  out.push('## Bash 环境变量（页数/字数等检查脚本会用到）');
  out.push('工作区已生成 `.env_skill`，含以下数值参数：');
  out.push('');
  out.push('```bash');
  out.push(`export MAX_PAGES=${Number(s.max_pages) || 0}`);
  out.push(`export COMPETITION=${shellQuote(s.competition)}`);
  if (s.problem_id) out.push(`export PROBLEM_ID=${shellQuote(s.problem_id)}`);
  out.push('```');
  out.push('');
  out.push('**说明**：这些是目标参考值，不是硬约束。技能里的自检脚本在 bash 块开头加 `source .env_skill 2>/dev/null || true` 即可取到变量。');
  out.push('');

  out.push(`## 竞赛规则（${spec.name}）`);
  out.push(`- 语言: ${s.language === 'en' ? 'English（正文、图表标签与图注全部英文）' : '中文'}`);
  out.push(`- 页数目标: **正文 ${s.max_pages} 页**（正文口径：目录之后 → 参考文献之前；无目录则是摘要之后 → 参考文献之前。不含摘要、目录、参考文献、附录代码、AI 声明${s.language === 'en' ? '；英文按 2200 字符/页估算' : ''}）`);
  out.push('- ⛔ `max_pages` 是**正文页数的目标（下限）**，不是全文页数上限、不是天花板：正文超了不扣分，低于目标 80% 才要扩写；不许为了"不超页"压图、缩字号、缩行距');
  out.push('- ⛔ 正文页数按上面口径单独计算；若赛事另有「总页数上限（含附录/参考文献）」，两个约束要同时满足，超了先压正文再压附录');
  if (spec.pageLimit) {
    out.push(`- ⛔ **总页数硬上限: ${spec.pageLimit} 页**（含 Summary Sheet / Table of Contents / References / Appendix；AI 使用报告另附不计）。编译后按实际 PDF 页数验收；正文目标与总上限必须同时满足，超过硬上限先压正文与附录，不许缩字号/压图规避`);
  }
  out.push(`- LaTeX 模板: ${spec.latex}（模板包在 _templates/${spec.latex}/）`);
  for (const line of RULES[s.competition] ?? RULES.generic) out.push(line);
  if (s.problem_id) out.push(`- 题号: ${s.problem_id}`);
  out.push(`- 编程工具: ${s.tools}`);
  if (s.rich_mode && s.language === 'en') {
    out.push('');
    out.push('- ⛔ **Rich mode (English)**: keep the whole paper within the contest page limit; Summary Sheet 300-400 words with quantitative results; 20+ figures/tables; expand analysis depth (data preprocessing / method comparison / sensitivity / ablation / complexity / robustness / error decomposition) without padding pages.');
    out.push(`  Template stays unchanged. Body target ${s.max_pages} pages; total hard limit ${spec.pageLimit ?? '见赛事规则'} pages.`);
  } else if (s.rich_mode) {
    out.push('');
    for (const line of richModeBlock()) out.push(line);
  }
  out.push('');

  out.push('## 图表风格与引擎（本工作流的选择）');
  if (s.figure_style === 'nature') {
    out.push(`- 数据图由 \`自然风格图表\` 技能产出：Nature 排版（左下两边框、刻度朝外、无网格、字号 8pt 级），标签用 ${s.language === 'en' ? '英文' : '中文'}。`);
    out.push('- 取色必须调 `nature_palette()`（15 键语义字典，按工作区种子同族微调），不要抄 hex 字面量；marker 用 `nature_markers()`。');
  } else {
    out.push('- 数据图由 `图表生成` 技能产出：调用 `setup_style()` 让绘图库按工作区种子随机挑配色与版式（同篇统一、跨篇不同）。');
    out.push('- ⛔ 绝不硬编码十六进制颜色，用 `PALETTE[i]` / `COLORS[...]`。');
  }
  if (s.flowchart_engine === 'html') {
    out.push(`- 流程图/架构图由 ` + '`流程图绘制HTML`' + ` 技能产出（HTML+截图）：figures/fig_*.html（中间）+ figures/fig_*.pdf（最终），公式用 KaTeX；版式档 ${s.diagram_style}。`);
  } else {
    out.push('- 流程图/架构图由 `流程图绘制` 技能产出（DrawIO）：figures/fig_*.drawio + figures/fig_*.pdf；用户可拖拽二次编辑。');
  }
  out.push('- TikZ 只用于必须按真实坐标画的精密几何示意图。');
  out.push('- GPT Image（需 API key）：场景图用 `--style scene`（黑白灰技术插图，fig_scene_*）；机理图用 `--style mechanism`（低饱和粉彩机制示意图，fig_mechanism_*）；逐问框架图用 `--style framework`（叙事型建模框架图 / graphical abstract，fig_flow_q*）；都必须先用 `--dry-run` 看最终提示词。');
  const flowStyle = perProblemFlowStyle(s);
  if (flowStyle === 'gptimage') {
    out.push('- 逐问流程图：用户已开启「每问都画流程图」并在自定义要求里指定 image → 由 `图表生成` 用 GPT Image `--style framework` 产出 `figures/fig_flow_q1…`（PPT 式卡片布局）；技术路线总图仍由 `流程图绘制` 用 DrawIO。');
  } else if (flowStyle === 'drawio') {
    out.push('- 逐问流程图：用户已开启「每问都画流程图」→ 由 `流程图绘制` 用 DrawIO 产出 `figures/fig_flow_q1…`；不要改用其他引擎。');
  } else {
    out.push('- 逐问流程图：默认**不规划**每问一张（避免同质化框图）；只有用户显式开启「每问都规划流程图」时才出现。');
  }
  out.push('');

  if (s.ai_disclosure !== 'off') {
    out.push('## AI 工具使用声明（合规，必做）');
    if (s.ai_disclosure === 'used') {
      out.push('- 本队**使用了** AI 工具：写 `paper/sections/Z_ai_disclosure.tex`（参考文献前），并在 `paper/appendix/B_ai_detail.tex` 写四张使用详情表（附录不占正文页数），参考文献中列出所用 AI 工具。');
      out.push('- 只用国产模型，随机 1-3 个；用途限定在：语言润色、代码报错调试、LaTeX/Word 排版、参考文献著录、术语翻译。');
      out.push('- ⛔ 严禁把 AI 用于：核心方法设计、数据生成或篡改、作者信息、引言核心内容、核心创新、整篇生成、附录生成。');
      out.push(`- 比赛日期区间：${s.comp_date_start || '（创建日）'} 至 ${s.comp_date_end || '（创建日）'}；交互日期在该区间内随机，只到日。`);
      out.push('- 写完后运行 `_utils/inject_ai_disclosure.py` 把 \\input 注入 main.tex。');
      if (s.language === 'en') out.push('- 英文赛事：声明文件与附录表一律用英文措辞（“AI Tool Usage Statement”，表格表头用英文）。');
    } else {
      out.push('- 本队**未使用** AI 工具：只在参考文献前加一句「本参赛队在竞赛过程中未使用任何 AI 工具。」，不要附录详情、不要在参考文献列 AI 工具。');
    }
    out.push('');
  }

  out.push('## ⛔ 核心原则：发现问题必须修正（不能只解释）');
  out.push(CORE_PRINCIPLES);
  out.push('');

  const markers = markerLines(s);
  if (markers.length) {
    out.push('## 运行模式标记（机器读取，勿删）');
    out.push('```');
    for (const m of markers) out.push(m);
    out.push('```');
    out.push('');
  }

  out.push('## 输入与工具');
  out.push('- 赛题与数据：`user_data/`（PDF/DOCX 已由主代理登记；如无法读取，用 pdftotext 或 python 解析）');
  out.push('- 工具库：`_utils/`（plot_utils / 各类 check 脚本 / scholar_fetch / gpt_image 等）');
  out.push('- 技能参考资料：`_references/`（防错手册、图表配方、检查清单）');
  out.push('- LaTeX 模板包：`_templates/<赛事>/`（论文步从这里复制，不要自己重写 preamble）');
  out.push('- 技能原文：`skills/<技能名>/SKILL.md`（整包目录，含 references/、templates/、tools/；当前步骤规格已内联在 prompt 里）');
  out.push('');

  return out.join('\n');
}

/** Shell 单引号安全引用（防止题号里的引号、分号、$() 注入）。 */
function shellQuote(value) {
  const s = String(value ?? '');
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

export function buildEnvSkill(s) {
  return [
    '#!/bin/bash',
    '# Auto-generated by dsh-mathmodeling-workflow.',
    '# source .env_skill 2>/dev/null || true',
    `export MAX_PAGES=${Number(s.max_pages) || 0}`,
    `export COMPETITION=${shellQuote(s.competition)}`,
    `export LANGUAGE=${shellQuote(s.language)}`,
    ...(s.problem_id ? [`export PROBLEM_ID=${shellQuote(s.problem_id)}`] : []),
    '',
  ].join('\n');
}
