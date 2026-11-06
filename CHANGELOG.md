# Changelog

## 0.3.11

- 初始化警告：逐问流程图选了 GPT Image 但没配置 key（环境变量或 `_utils/_gpt_image_config.json`）时，`modeling_init` 直接提示"这些图会被跳过"。
- smoke 增加逐问框架图的闸门级回归：无 key 自动跳过、有 key 时缺图即失败。
- 版本号 0.3.11。
## 0.3.10

- 新增「逐问流程图」能力（默认关）：开关 `flow_per_problem`；开启后每个子问题各一张 `fig_flow_qN`。
- 画法由自定义要求决定（`perProblemFlowStyle`）：`custom_requirements` 里同时出现 image/gpt/生图 与 流程图 → GPT Image；否则 DrawIO。
- 新增 GPT Image 固定风格 `--style framework`（Visual Modeling Framework Diagram / graphical abstract：白底、低饱和 pastel、卡片式模块、中间核心模型、四周输入/对比/输出面板、图标与迷你图表、扁平 2D）。
- CLAUDE.md 写入 `MMW_FLOW_PER_PROBLEM=1` 与 `MMW_PER_PROBLEM_FLOW_STYLE=gptimage|drawio` 标记，并说明逐问流程的画法与来源。
- 赛题分析技能：逐问流程标记分流（DrawIO 段 vs `**逐问流程图（GPT Image）**` 段），`fig_flow_q` 计入 GPTIMG 统计。
- 图表生成技能：新增 framework 模板（只在标记为 gptimage 时生成），`fig_flow_q*` 纳入 GPT Image 对账/统计/质检跳过规则。
- README：开关表 +「逐问建模框架图」小节；smoke 增加标记、判定、章节归类与风格块断言。
## 0.3.9

全流程自检（真实 8 步模拟跑通）后修的问题：

- `modeling_next` 重复调用同一步不再重复计次（之前"重读 prompt"会把 attempts 抬到 2）。
- `modeling_finish` 通过分支的 report 之前是数组（工具输出变成 JSON），改为字符串。
- `modeling_finish` 对已完成步骤直接返回"已验收通过"，不再重跑闸门导致回退；传错 step key 现在给出可用 key 列表。
- `modeling_switches` 在步骤 running/waiting 时拒绝改开关（之前会把运行中步骤重置为 pending、丢掉提问状态），并区分"运行中"与"已完成"两种提示。
- 步骤阈值与技能对齐：建模报告 3000→1500 B（技能要求 1.5KB）；编程实现 800→1000 B；逻辑对抗复核 100→50 B（零问题 JSON 可能只有 80 B）。
- 编程实现步新增二级产物 `figures/*.json`（技能强制要求；缺它会让论文数据核对全部对不上）。
- 新增 `_utils/figure_pdf_quality_check.py`（自然风格图表技能引用了但之前缺失）：检查 PDF 头/页数/页面尺寸/宽高比，并核对 `\includegraphics` 引用的图是否存在、宽度是否过小。
- 流程图 HTML 技能里不存在的 `_utils/html_pdf_check.py` 路径改为只用技能自带 `tools/html_pdf_check.py`。
- `modeling_ask` 的 question/options 做 trim（避免空白选项混进问题表）。
- 初始化默认工作区名的时间戳精确到分钟（之前同目录同小时会撞名）。
- 等待回答的步骤在进度行显示 ⏸（之前显示 ?）。
- smoke 新增：8 步闸门串联、技能引用 `_utils` 脚本存在性、编程步结果 JSON 要求、机理图章节归类等回归用例。
## 0.3.8

- 修机理图进闸门的一个漏洞：manifest 标题写成「**机理示意图**」时，章节关键词只匹配「机理图/机制示意」等，会被归到 OTHER 而**静默不计入对账**（有 key 时漏检、缺图也不报错）。新增关键词「机理示意」，并补回归测试：章节归类、无 key 自动跳过、有 key 时必须产出。
- 第 4 步 prompt 的图表对账说明改为「数据图 / 概念图（场景图 + 机理图）」，与两类 GPT 图对齐。
- CLAUDE.md：配置项改为「图像生成配置（场景图/机理图/概念图）」，并新增一行 GPT Image 两种风格（`--style scene` / `--style mechanism`）的用法提示。
- 闸门无 key 跳过提示改为「概念图/机理图」。
## 0.3.7

- GPT Image 新增**机理图**能力：`--style mechanism` 出「Scientific Mechanism Diagram」风格（白底、低饱和 pastel、圆角矩形模块、细箭头、中心节点层次、公式与变量标注、扁平 2D 矢量、论文级排版），默认 `--style scene` 保持原有黑白灰场景图不变。
- 机理图提示词模板：【主题】【内容要求】，附可选补充关键词（热网络示意图/紧凑模块化布局/方程式整合信息图…）。
- 图表生成技能：区分「场景图 fig_scene」与「机理图 fig_mechanism」两种 GPT Image 用途，给出各自模板与使用边界（技术路线/求解流程仍用 DrawIO）；对账/统计脚本纳入 `fig_mechanism*`。
- 赛题分析技能：manifest 可规划机理图（`fig_mechanism`），示例与统计同步。
- 闸门：manifest 粗体章节关键词增加「机理图/机制图/机制示意/系统示意图」→ 归入 GPTIMG。
- README 增加机理图小节；smoke 增加机理图风格断言。
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
