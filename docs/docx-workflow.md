# 竞赛论文 Word 交付

用建模插件运行赛题时，可在自然语言里说明「论文最终交付 Word，严格模式」。参数 `output_format: "docx"` 适用于 `modeling_init`，也可在工作流开始前通过 `modeling_switches` 设置。默认格式为 PDF。

```json
{
  "input_dir": "D:/2026国赛A",
  "competition": "cumcm",
  "output_format": "docx",
  "validation_mode": "strict"
}
```

## 上传 Word 模板

`docx_template` 默认为 `auto`。将 `.dotx` 文件或名称包含「模板」「范本」或 `template` 的 `.docx` 放进 `input_dir`，插件会在 Markdown 写作之后、Word 导出之前加入「Word 模板映射与试填」。有多个候选时，通过 `docx_template` 传入所选文件相对 `input_dir` 的路径。普通名称的 Word 文件也可以用这种方式指定。设为 `off` 或未识别到模板时，流程跳过这一步。

该步骤使用原版映射技能生成 `_template_map.json`、`_template_check_report.md` 和 `_template_test_filled.docx`。验收将试填文件与所选模板、映射和当前稿件核对。最终导出前若修改了稿件、图表或映射，需重新试填。升级前创建的工作区可在开工前用 `modeling_switches` 重排步骤。已经开始的工作区继续使用原有步骤清单。

## 写作和导出

1. 「论文撰写（Markdown）」完成 `paper/main.md`，按赛题组织摘要、逐问正文、参考文献和附录。验收检查正文篇幅、子问题覆盖、清单中的图表嵌入和 AI 声明。正文使用中文 900 字/页或英文 2200 字符/页估算，与 PDF 写作闸门一样在低于目标 80% 时阻断。正文从目录后（无目录时从摘要后）计至参考文献或后置部分之前。
2. 严格模式在写作阶段执行 `paper_data_check.py --mode docx`。数字异常要追溯结果 JSON 并修稿，直至通过。验收读取模式、报告和输入哈希。摘要里的结果也参加核对。快速模式会跳过数字真实性核对，保留其余结构和合规门槛。
3. 「Word 导出与合规」按中文或英文排版生成 `paper/main.docx`。Markdown 表格和受支持的数学公式在 Word 中可编辑。单页 PDF 图可以转为 PNG 后嵌入。导出后校验可打开性、对象数量和导出清单里的源稿、图片及产物哈希。
4. 对有总页数硬上限的赛事，导出时还会用 LibreOffice 生成 `paper/docx-layout-check.pdf`，验收读取实际页树。若官方提交指定 PDF 或专用封面，按当届规则准备正式提交版。插件的内置 Word 版式按中英文区分。

按原技能使用工作区相对图片路径，例如 `figures/fig_accuracy.png`。之前使用的 `../figures/fig_accuracy.png` 也兼容。每张已规划的表要复制真实数据到正文的管道表，在表格后留一空行，再写 `<!-- label: TABLE_accuracy -->`。源稿和图表修改后，重新跑相关检查及导出。导出验收后如再次修改，可指定 `modeling_finish` 的 `step: "docx-export"` 复验。

## 运行环境

- Python 3.10+，含 `python-docx`、`lxml` 与 `Pillow`。DSH 自带的文档 Python 环境通常已包含。Host 可通过 `MMW_PYTHON` 指定解释器绝对路径。
- 原版预检和导出以 Python 3.11 字节码分发。可从 PATH 发现 Python 3.11，或用 `MMW_DOCX_AGENT_PYTHON` 指定其绝对路径。安装 `python-docx`、`lxml` 和 `Pillow` 可运行模板工具和后续独立核验。
- Word 引擎的 Node 依赖随插件安装。需要覆写 Node 时，使用 `MMW_NODE` 指向 Node 可执行程序。
- 独立 Markdown 核验使用 Pandoc 3.x，可从 PATH 发现或通过 `MMW_PANDOC` 指定绝对路径。
- 图表用 PNG 或 JPEG 时无需额外转换器。嵌入单页 PDF 图时需 `pdftoppm`（PATH 或 `MMW_PDFTOPPM`）。可直接引用原图对应的 PNG 预览。
- MCM/ICM 等带总页数上限的赛项需要 LibreOffice（PATH 或 `MMW_SOFFICE`），也可用 DSH 的 LibreOffice Kit CLI（`MMW_DSOFFICE_CLI` 指向 CLI 的 JavaScript 文件，`MMW_NODE` 可指定 Node.js 解释器）。

手工复跑请在工作区根目录使用所选解释器。示例为中文国赛。

```text
python _utils/docx_paper.py precheck --workspace . --language zh --competition cumcm --report
python _utils/paper_data_check.py --mode docx
python _utils/docx_paper.py export --workspace . --language zh --competition cumcm
python _utils/docx_paper.py verify --workspace . --language zh --competition cumcm
```

使用对应步骤提示里的语言、赛项及 `--page-limit`。如果解释器或转换器由环境变量配置，请确保运行 DSH 的进程和执行导出的终端均能读取。更新插件源码后重启 DSH 可加载新的工具参数和提示词。

## 实现与测试

插件的 `assets/skills` 下提供「中文Word论文撰写」「英文Word论文撰写」「Word格式自检」「Word导出」「Word模板映射」。派发时读取并复制到工作区。在提示词内，原 `MH_*` 开关映射为当前插件的 `MMW_*`。

适配器直接调用随插件分发的原版 `docx_precheck`、`docx_export` 和 `docx-cn-engine`，使用原版 `competition_zh.json` 或 `competition_en.json` 版式。严格数字核对、正文结构、对象完整性和文件新鲜度由插件验收。安装后可在任意赛题目录运行。

运行 `node test/run.mjs` 执行插件回归。设置 `MMW_TEST_DOCX=1` 要求真实 Word 转换用例通过。设置 `MMW_TEST_DOCX_PAGINATION=1` 同时执行英文 MCM 真实分页用例。可通过设置相同变量运行独立 DSH Host 集成测试。测试使用合成数据和真实转换器。
