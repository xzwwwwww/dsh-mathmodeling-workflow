# Changelog

## 0.3.3

- 随包提供 `_utils/_gpt_image_config.json` 模板（`api_key` / `base_url` 留空），初始化时复制进工作区，用户不用猜该填哪个文件。
- CLAUDE.md 参数段加一行「概念图配置」说明。
- README 概念图一节改成直接打开该文件填 key/base_url；环境变量仍可用且优先级更高。
- 版本号 0.3.3。
## 0.3.2

- README 重写为面向使用者的文档：安装 → 使用（准备文件夹/提示词/19 个开关/完整示例/跑起来之后）→ 流程 → 概念图说明。
- `figures` 闸门：未配置 `GPT_IMAGE_API_KEY` / `_gpt_image_config.json` 时，概念图自动跳过（不卡步），并在 detail 里记 `gptImgSkipped`。
- 版本号 0.3.2。
## 0.3.1

修两个真实跑流程时暴露的问题：

- **图步各管各的**：`figures` 闸门按步骤拆分对账范围——数据图步只对账 `DATA`/`GPTIMG`，流程图步只对账 `DRAWIO`/`TIKZ`，`TABLE` 不参与。之前数据图步会把下一步的流程图/架构图也算进本步，导致第 4 步永远验收不过、被迫提前干第 5 步的活。闸门现在会回 `scope` 与 `deferred`（不属于本步的类别及数量），prompt 里也写明「别的图由后续步骤负责，本步不要提前画」。
- **页数口径下沉到主代理**：`max_pages` 统一表述为「正文页数目标（下限）」——目录之后→参考文献之前（无目录则摘要后→参考文献前），不含摘要/目录/参考文献/附录代码/AI 声明；是下限不是全文上限。新增/强化到：system prompt 协议、`modeling_init` 报告、`modeling_next` 子代理派发文本、CLAUDE.md 竞赛规则、论文步 prompt 契约、工具参数说明。

## 0.3.0

- 技能目录改中文命名（步骤 key 保持 ASCII）。
- `figure_style=nature` 改用 `自然风格图表` 技能；补 `plot_utils.nature_palette()` / `nature_markers()`。
- 随包 HTML 渲染管线：`_utils/screenshot_capture.py` + `_utils/katex/`。
- 子代理提问中转：`modeling_ask` / `modeling_pending` / `modeling_answer`。
- 严格模式论文数据核对（`paper_data_check` 闸门 + 两份 md）。
- 新图标 `icon.png`。

## 0.2.x

- 初始版本：8 步流水线、确定性闸门、CLAUDE.md、技能整包复制。
