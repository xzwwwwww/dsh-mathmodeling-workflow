---
name: Word导出
description: 将通过验收的竞赛 Markdown 论文导出为 Word，并校验可编辑性、完整性与分页。
---

# Word 导出与合规

从 `paper/main.md` 生成 `paper/main.docx`。使用当前工作区 `_utils/docx_paper.py`，以本步参数指定语言和赛项，使用随包定义的中英文排版样式。命令见本步提示末尾。

1. 预检源稿与本地图片，读 `DOCX_PRECHECK_REPORT.md`，修复报告中的问题。需要修稿时同步检查引用与图表。严格模式重跑 `paper_data_check.py --mode docx`，待通过后再导出。
2. 执行 `export`。Markdown 表格、标题和支持的 LaTeX 数学将写成可编辑的 Word 内容。已登记图片按原长宽比嵌入。遇到不能转换的公式或图片时修复输入后重跑。
3. 执行 `verify` 核对生成的文档和输入摘要。有比赛总页数硬上限时，导出工具会用 LibreOffice 真实分页，并记录布局检查 PDF。按正文质量和比赛规则修正超页问题。
4. 完成后报告主产物 `paper/main.docx`、源稿和预检结果。每次修改源稿、图或 Word 成品后，重新检查并导出。用户提供自定义排版或官方提交要求时在交付中注明已确认的适用范围。

运行环境：Python 3.10+、`python-docx` 和 Pandoc 3.x。`MMW_PANDOC` 可指定可执行文件。单页 PDF 图需要匹配的 PNG/JPEG 或 `pdftoppm`。赛事要求总页数时还需要 LibreOffice 或 DSH 的 LibreOffice Kit。若缺必要环境，给出具体错误并等解决后复验。
