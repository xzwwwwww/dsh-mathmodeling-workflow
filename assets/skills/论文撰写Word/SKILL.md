---
name: 论文撰写Word
description: 中英文竞赛论文 Markdown 写作与严格验收，供后续 Word 导出。
---

# 竞赛论文 Markdown 写作

主产物为 UTF-8 的 `paper/main.md`。阅读 `CLAUDE.md` 确定赛项、题号、语言、正文目标、AI 声明开关和用户要求。这个步骤只交 Markdown。执行导出由下一步负责。

## 开始写作前

1. 读赛题、`PROBLEM_ANALYSIS.md`、`MODELING_REPORT.md`、`RESULTS.md`、结果 JSON 和已有复核裁定，建立逐问的「主张—证据—图/表」对应关系。按真实计算和题设单位写作。遇到上游矛盾，按工作流回报，不改结果迁就稿件。
2. 读取 `_utils/writing_rules.md` 中关于证据、章深与引用的通用规则，再核对合并的 FIGURE_MANIFEST。按赛题决定验证、敏感性、鲁棒性、对照实验的内容。正文叙述并解释图表所支持的结论。
3. 按赛项要求组织摘要、关键词、问题重述与分析、假设、符号、逐问建模及求解、验证和评价、结论、参考文献与附录。MCM/ICM 的开头使用 `## Summary Sheet`，按赛题填写团队编号等已核实信息。需要正式封面或承诺书时遵照用户提供的赛项要求。

## Markdown 合同

- 全文一个 `# 论文标题`。使用 `## 摘要`、`## Abstract` 或 `## Summary Sheet`。如有目录，标题为 `## 目录` 或 `## Table of Contents`。正文从下一章开始，各问用明确的 `## 4 问题 1` / `## 4 Sub-Problem 1` 等标题。后置章节用 `## 参考文献` / `## References` 和 `## 附录` / `## Appendix`。
- `## 参考文献` 至少含一条经核实的书目条目。采用连续编号，正文编号与书目逐一对照。需要查证文献时读取原始来源，核对作者、题名、年份及 DOI 或真实出版信息。
- 用 `$...$` 写行内公式，用独立段落 `$$...$$` 写陈列公式。Pandoc 将支持的公式生成可编辑 Word 公式。文档结构使用 Markdown 标题、段落和表格。
- 图片用相对于 `paper/main.md` 的路径，例如 `![图 1 数据分布](../figures/fig_distribution.png)`，标题写入简短替代文字。可引用仓内 PNG、JPEG 或单页 PDF。连续图之间加解读。每张应嵌入的规划图必须是正文里真实存在的图片节点。
- 表格直接嵌入 Markdown 管道表，表上方写简短标题。每张规划表后留一空行，再单独写 `<!-- label: TABLE_name -->`，`TABLE_name` 与清单完全一致。表内数值和相应结果文件核对。把过宽的表拆分，把长表的完整明细放附录。
- 代码用封闭的围栏代码块，主要代码按赛项要求附上。写正文时不用 HTML 布局或 TeX 文档命令。`max_pages` 只估算目录之后（无目录则摘要之后）到参考文献之前的正文。中文 900 字/页，英文 2200 字符/页。追加摘要、附录代码和 AI 声明不会增加正文计数。

## AI 声明

- `off` 时省略声明和使用详情。
- `none` 时在参考文献前单独一段写「本参赛队在竞赛过程中未使用任何 AI 工具。」英文写 `Our team did not use any AI tools during the competition.`。
- `used` 时在参考文献前写 `## AI 工具使用声明` / `## AI Tool Usage Statement`，按工作区要求列明工具与用途，在附录用 `## AI 工具使用详情` / `## AI Tool Usage Details` 和四张有数据的 Markdown 表记录详情。遵守赛项的申报要求。

## 自检和修复

先确认 `docx_paper.py` 可用，Python 能导入 `docx`，Pandoc 3.x 在 PATH 中或通过 `MMW_PANDOC` 配置。使用本步提示末尾给出的完整预检命令。修完全部问题后重跑，生成 `DOCX_PRECHECK_REPORT.md`。主产物至少 5120 字节，须覆盖所有子问题、已验证的模型、计算结果与图表。检查小节内容和引用是否缺漏，检查结论与上游数据。

严格模式应在本步骤完成 `paper_data_check.py --mode docx` 的检查、按清单修稿、重跑到通过。每次修改稿件或结果后重新核对。不手写通过标记。快速模式仍执行 Markdown 预检、正文和图表覆盖及 AI 声明检查。
