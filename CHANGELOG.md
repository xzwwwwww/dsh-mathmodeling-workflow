# Changelog

## 0.3.6

- 场景图风格放开 3D：`Flat 2D vector-style rendering` → **`Flat 2D/3D vector-style rendering`**（扁平矢量 2D/3D 都允许），Avoid 清单里的 `3D rendering` 改为 `photorealistic 3D rendering`（仍禁止照片级写实 3D）。
- 图表生成/赛题分析技能与 README 同步：不再笼统禁止 3D，只禁"写实/照片级 3D"。
- smoke 断言补充 `Flat 2D/3D`。
## 0.3.5

场景图（GPT Image 概念图）固定为数学建模竞赛论文风格：

- `gpt_image.py` 内置固定风格 **MCM Academic Illustration**：纯白背景、黑白灰配色、纤细灰色线稿、二维矢量、正视图/平视、轻灰阴影、细引线标注，并附 Avoid 清单（彩色/卡通/3D/写实/渐变/粗描边/复杂纹理）。
- 提示词模板改为三段结构：【场景主题】【场景元素】【构图要求】，风格/安全/输出约束由工具注入。
- 新增 `--dry-run`：只打印最终提示词（含固定风格），不调用 API、不要求 key。
- 图表生成技能：删掉旧的"不同颜色区分/图例彩色"等与黑白风格冲突的要求，改为灰度高/低与线宽区分，并示例改为场景图。
- 赛题分析技能：规划场景图时注明会套用 MCM 学术插图风格，不要写"彩色/卡通/3D"。
- README 增加「固定出图风格」小节。
## 0.3.4

兼容性验证与文档：

- 在 DSH `0.2.2-rc.1`（Node 24.21 / pnpm 11.28.5）实测通过：bundle 正常加载、8 个 `modeling_*` 工具注册、system prompt 协议注入、`modeling_init` 建工作区、`modeling_next` 渲染 prompt、`modeling_ask`/`modeling_pending`/`modeling_answer` 提问中转、`modeling_switches` 改开关、`modeling_finish` 闸门验收全部正常。
- 已知升级行为：升级 DSH 后 profile 的 bundle 选择可能被重置（本插件与 dsh-purge 都被置为未启用），在插件管理里重新启用一次即可。
- README 增加兼容性说明。
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
