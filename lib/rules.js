// 各赛项「竞赛规则」段（进 CLAUDE.md）。整理自真实竞赛论文规范与样本，
// 去掉随 params 变化的行（题号/编程工具/页数），这些在 claudeMd.js 里动态补充。
export const RULES = {
  cumcm: [
    '- 正文篇幅按 max_pages 目标；总页数仅受本赛题已核实的官方硬性要求约束，默认正文目标不等于全文上限',
    '- 必须有摘要页（约 1 页），含关键词',
    '- ⛔ 只需要中文摘要，不要英文摘要（国赛不要求）',
    '- 论文结构：摘要 → 问题重述 → 问题分析 → 模型假设 → 符号说明 → 模型建立与求解 → 模型检验 → 模型评价与推广 → 参考文献 → 附录',
    '- 附录中必须包含完整代码',
    '- 使用 cumcmthesis 文档类，XeLaTeX 编译',
  ],
  wuyi: [
    '- 正文篇幅按 max_pages 目标；若赛题另有已核实的总页数硬上限，应单独满足，不把默认正文目标当作全文上限',
    '- 使用 cumcmthesis 文档类（withoutpreface 选项），XeLaTeX 编译',
    '- 论文第一页为承诺书（模板已包含，不要删除）',
    '- 第二页为封面（题目 + 关键词 + 摘要，手动排版格式）',
    '- 论文结构：承诺书 → 封面 → 目录 → 问题重述 → 问题分析 → 模型假设 → 符号说明 → 各问题建模与求解 → 模型评价 → 参考文献 → 附录',
    '- ⛔ 只需要中文摘要，不要英文摘要',
    '- 附录第一节为文件列表表格；参考文献使用 gbt7714-numerical 样式',
    '- ⛔ 不要加 \\usepackage{cite}（和 natbib 冲突导致编译错误）',
    '- ⛔ 不要重复加载 subcaption 和 float（cls 已包含）',
  ],
  huazhong: [
    '- 正文篇幅按 max_pages 目标；若赛题另有已核实的总页数硬上限，应单独满足，不把默认正文目标当作全文上限',
    '- 使用 cumcmthesis 文档类（withoutpreface 选项去掉封面），XeLaTeX 编译',
    '- 论文结构：摘要 → 目录 → 问题重述 → 问题分析 → 模型假设 → 符号说明 → 模型建立与求解 → 模型检验 → 参考文献 → 附录',
    '- ⛔ 只需要中文摘要，不要英文摘要',
  ],
  apmcm_zh: [
    '- 页数目标约 25 页（参考值，最终以实际质量为准，不要注水）',
    '- 按官网 PDF 模板格式提交；中文撰写，封面含参赛队号与队员',
    '- 论文结构：摘要 → 关键词 → 问题重述 → 问题分析 → 模型假设 → 符号说明 → 模型建立与求解 → 灵敏度分析 → 模型评价 → 参考文献 → 附录',
    '- 需要中文摘要 + 关键词（3-5 个）',
    '- 复用 cumcmthesis 中文模板（withoutpreface + bwprint），XeLaTeX 编译',
  ],
  diangong: [
    '- 正文篇幅按 max_pages 目标；若赛题另有已核实的总页数硬上限，应单独满足，不把默认正文目标当作全文上限',
    '- 使用 ctexart 文档类，XeLaTeX 编译',
    '- 论文结构：摘要 → 问题重述 → 问题分析 → 模型假设 → 符号说明 → 模型建立与求解 → 结果分析 → 参考文献 → 附录',
    '- ⛔ 只需要中文摘要，不要英文摘要',
    '- 侧重电气工程与能源方向',
  ],
  mathorcup: [
    '- 正文篇幅按 max_pages 目标；若赛题另有已核实的总页数硬上限，应单独满足，不把默认正文目标当作全文上限',
    '- 使用 MathorCupmodeling 文档类，XeLaTeX 编译',
    '- 论文结构：摘要 → 问题重述 → 问题分析 → 模型假设 → 符号说明 → 模型建立与求解 → 模型检验 → 参考文献 → 附录',
    '- ⛔ 只需要中文摘要，不要英文摘要',
  ],
  zhongqing: [
    '- 正文篇幅按 max_pages 目标；若赛题另有已核实的总页数硬上限，应单独满足，不把默认正文目标当作全文上限',
    '- 使用 ctexart 文档类，XeLaTeX 编译',
    '- 论文结构：摘要 → 问题重述 → 问题分析 → 模型假设 → 符号说明 → 模型建立与求解 → 结果分析 → 参考文献 → 附录',
    '- ⛔ 只需要中文摘要，不要英文摘要',
  ],
  yangtze: [
    '- 正文篇幅按 max_pages 目标；若赛题另有已核实的总页数硬上限，应单独满足，不把默认正文目标当作全文上限',
    '- 使用 ctexart 文档类，XeLaTeX 编译',
    '- 论文结构：摘要 → 问题重述 → 问题分析 → 模型假设 → 符号说明 → 模型建立与求解 → 结果分析 → 参考文献 → 附录',
    '- ⛔ 只需要中文摘要，不要英文摘要',
  ],
  liaoning: [
    '- 正文篇幅按 max_pages 目标；若赛题另有已核实的总页数硬上限，应单独满足，不把默认正文目标当作全文上限',
    '- 使用 ctexart 文档类，XeLaTeX 编译',
    '- 论文结构：摘要 → 问题重述 → 问题分析 → 模型假设 → 符号说明 → 模型建立与求解 → 结果分析 → 参考文献 → 附录',
    '- ⛔ 只需要中文摘要，不要英文摘要',
  ],
  huashu: [
    '- 正文篇幅按 max_pages 目标；若赛题另有已核实的总页数硬上限，应单独满足，不把默认正文目标当作全文上限',
    '- 使用 ctexart 文档类，XeLaTeX 编译',
    '- 论文结构：摘要 → 问题重述 → 问题分析 → 模型假设 → 符号说明 → 模型建立与求解 → 模型检验 → 参考文献 → 附录',
    '- ⛔ 只需要中文摘要，不要英文摘要',
  ],
  huawei: [
    '- 正文篇幅按 max_pages 目标；丰满模式只在 rich_mode=true 时启用，赛事另有已核实总页数硬上限时单独满足',
    '- 使用 ctexart 文档类，XeLaTeX 编译',
    '- 论文结构：摘要 → 问题重述 → 问题分析 → 模型假设 → 符号说明 → 模型建立与求解 → 结果分析 → 参考文献 → 附录',
    '- 华为杯可显式开启丰满模式（摘要 1500-2200 字、30+ 图表）；未开启时按普通篇幅目标',
  ],
  mcm: [
    '- 论文用英文撰写（COMAP 官方要求），使用 mcmthesis 文档类，pdflatex 编译（CTeX=false，newtxtext）',
    '- ⛔ 总页数硬上限 25 页（含 Summary Sheet / Table of Contents / References / Appendix；AI 使用报告另附不计），编译后按实际 PDF 页数核对',
    '- 第一页必须是 Summary Sheet（摘要页，300-400 词，单页；含每题方法与关键数值结果，可加粗核心内容）',
    '- 论文结构：Summary Sheet → Table of Contents → Introduction → Assumptions and Justifications → Notations → Model Development（按问题分章）→ Results → Sensitivity Analysis → Model Evaluation → References → Appendix',
    '- 正文区间目标见参数 `max_pages`（Summary Sheet / Table of Contents / References / Appendix 不计入正文）',
    '- 附录放完整代码（代码不进正文）；参考文献用 BibTeX（references.bib）',
    '- 图表标签、图注、章节标题全部用英文',
  ],
  icm: [
    '- 论文用英文撰写（COMAP 官方要求），使用 mcmthesis 文档类，pdflatex 编译（CTeX=false，newtxtext）',
    '- ⛔ 总页数硬上限 25 页（含 Summary Sheet / Table of Contents / References / Appendix；AI 使用报告另附不计），编译后按实际 PDF 页数核对',
    '- 第一页必须是 Summary Sheet（摘要页，300-400 词，单页；含每题方法与关键数值结果，可加粗核心内容）',
    '- 论文结构：Summary Sheet → Table of Contents → Introduction → Assumptions and Justifications → Notations → Model Development（按问题分章）→ Results → Sensitivity Analysis → Model Evaluation → References → Appendix',
    '- ICM 侧重交叉学科（政策/社会/环境/健康），模型选择要贴合题目情境，不要套纯技术模板',
    '- 正文区间目标见参数 `max_pages`（Summary Sheet / Table of Contents / References / Appendix 不计入正文）',
    '- 附录放完整代码（代码不进正文）；参考文献用 BibTeX（references.bib）',
    '- 图表标签、图注、章节标题全部用英文',
  ],
  apmcm: [
    '- 论文用英文撰写，使用 APMCM 官方模板（apmcmthesis），pdflatex 编译',
    '- 摘要页 300-400 词，含每问方法与关键数值结果，单页',
    '- 论文结构：Abstract → Introduction → Assumptions and Notations → Model Development（按问题分章）→ Results and Sensitivity Analysis → Model Evaluation → References → Appendix',
    '- 正文区间目标见参数 `max_pages`（摘要 / 目录 / 参考文献 / 附录不计入正文）',
    '- 附录放完整代码；图表标签与图注用英文',
  ],
  generic: [
    '- 正文篇幅按 max_pages 目标；若赛题另有已核实的总页数硬上限，应单独满足，不把默认正文目标当作全文上限',
    '- 使用 ctexart 或赛题指定文档类，XeLaTeX 编译',
    '- 论文结构：摘要 → 问题重述 → 问题分析 → 模型假设 → 符号说明 → 模型建立与求解 → 模型检验 → 参考文献 → 附录',
    '- ⛔ 只需要中文摘要，不要英文摘要',
  ],
};

/** 丰满模式条款（注入文本原文） */
export function richModeBlock() {
  return [
    '- ⛔ **丰满模式 · 正文**页数目标区间: 40-60 页（目标 50 页中位数）— 短于 40 页 = 分析单薄高风险。',
    '  **正文** = 章节 1（绪论）到结论（含图表），**不含附录代码 / 参考文献 / 摘要 / 目录**。',
    '  鼓励过程图表化（建模/算法/推导流程图也算图表）；写完正文不到 40 页**必须扩展**',
    '  开启了「丰满模式」(rich_mode=true)，采用研究生级竞赛丰满标准：',
    '  - 摘要 1500-2200 字（可跨两页）+ 6 项展示要素 + 候选方法对比 + 附件预测代表值',
    '  - 30+ 张图表（过程图 + 数据图 + 算法流程图 + 推导示意图）',
    '  - 每子问题段：首先 / 再 / 接着 / 最后 过程式叙述骨架',
    '  - 自动触发 12 类章节扩展：数据预处理 / 多算法对比 / 超参敏感性 / 消融实验 / 复杂度分析 / 理论支撑 / 可解释性 / Pareto 前沿 / 鲁棒性 / 求解器对比 / 规模扩展 / 误差分解',
    '  ⛔ 注意：丰满模式只调整内容标准（页数 / 图表数 / 写作风格），**模板（LaTeX cls / 标题约束 / 封面）仍按本赛项保持原样**。',
    '  ⛔ 若赛事规则另有硬性页数上限，取两者更严者，并在正文开头注明取舍。',
  ];
}
