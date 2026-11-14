# Changelog

## 0.5.4

- 补齐提示词已经要求、旧 plot_utils 却缺失的完整共享 API：set_paper_placement、dynamic_limits、draw_vector_heatmap、declutter_axes、uncertainty_band、shared_legend、consolidate_shared_legends；auto_legend 支持测量后的图内/图外布局。
- 固定导入后的 PALETTE/PALETTE_LIGHT 引用，Nature 保留显式项目色卡；矢量热力图保留缺失/掩码值并按实际背景选择黑白字，保存时按最终插入尺寸检查字号并生成 PNG 预览，不重排已声明的 GridSpec/手工布局。
- 新建工作区校验运行时；续跑时按原版指纹升级 plot_utils.py、补齐缺失文件。未知定制版本保留原稿，缺 API 时暂停派发并提供完整新版供合并，禁止把新提示词发给不兼容的旧工具。
- 默认图表样板及配方不再覆盖已准备好的共享工具；绘图阶段不再在线安装 SciencePlots、adjustText 或系统字体。
- 新增运行时迁移回归及真实 Agg 绘图测试，直接执行四个随包 Nature 教程并验证 PDF/PNG 输出。详见 [绘图运行时修复说明](docs/plot-runtime-v0.5.4.md)。

## 2026-11-14：DSH 0.2.2-rc.3 兼容性验证（插件仍为 0.5.3）

- 对照官方 rc.2/rc.3 tags，25 个插件相关 API、Cordis、Loader、Include 与管理接口源码/manifest 的 SHA-256 相同；无需业务代码适配。
- 使用精确 rc.3 npm 包完成真实隔离 Host 集成：16 组检查、50 次 native 工具调用，严格模式完整 8 步验收、问答恢复、fast、卸载重挂载均通过；未运行 GUI 端到端或模型调用环。
- 新增可复跑的 Host 集成脚本、独立测试项目清单与脱敏结果，更新 rc.3 安装说明；原有全量回归通过。详见 [兼容性记录](docs/compatibility/dsh-0.2.2-rc.3.md)。

## 0.5.3

- 随包分发官方 xpatch 0.3a，以及实编译依赖链中的 xstring、scalefnt、mweights、fontaxes；保存完整上游源码、文档、LPPL 许可证和 SHA-256 来源记录。
- 新工作区模板自动携带运行文件；旧工作区续跑时向现有模板与论文目录补齐依赖，无需全局安装或设置 TEXINPUTS，不覆盖自定义文件、不跟随符号链接/junction。
- MCM/APMCM 新建及旧工作区补齐两条路径均通过真实 pdflatex 两遍编译，各生成 4 页 PDF，并通过数字核对和新鲜性验收。具体见 `TEX-DEPENDENCIES.md`。
- 新增离线依赖分发与原始文件校验回归；真实编译测试使用工作区的实际依赖分发路径，明确关闭自动安装及 shell escape。

## 0.5.2

- 修复全流程审查的 23 项问题；保留 AI 声明内容生成规则。逐项行为与验证见 `FIXES-0.5.2.md`。
- fast 新工作区不派发对抗复核；旧工作区明确记录 skipped。验收强制当前步骤顺序与已派发状态，问答可续跑且多问题必须明确绑定。
- 严格论文数字检查覆盖真实 TeX 输入链、数学模式数值和外置表格；所有失败撤销旧通过状态，成功凭据绑定当前输入 SHA-256；编译交付再次检查新鲜性。
- 所有赛项检查实际 PDF 有效性；图表清单跨阶段合并，GPT 失败回退有明确责任移交，显式数据图数量下限进入环境和外层闸门。
- 统一两端逻辑探针合同、变量边界与解释类型；重复计量使用 AST，LaTeX 百分号不再截掉末位数字。
- 修复英文 inline/BibTeX 文献门禁与退出码覆盖，统一图尺寸权威规则，删除全局强杀 TeX 进程。
- 正文估算只计实际引用的正文并剥除注释和代码示例；AI 声明/详情验证实际接入论文。恢复旧原装检查脚本时保留用户自定义版本。
- 新增状态、闸门、Shell 行为和 Python 回归测试，`node test/run.mjs` 统一运行；另提供可选真实 TeX 编译集成测试。

## 0.5.1

- 美赛页数验收通过 PDF 页树计数，支持增量保存；无法解析的 PDF 返回验收失败。
- 逐问流程图在赛题分析和出图时核对题号，旧工作区续用建区时的引擎。auto 按针对流程图的肯定要求识别 GPT Image。
- HTML 渲染使用独立临时输出，完整写入后原子替换目标。自动探测浏览器时可切换到能返回几何测量结果的浏览器。
- 开关更新保留用户显式值并重新推导默认值。附件核对兼容 Path 和相对路径，论文数字核对限制跨指标、跨量纲匹配。
- 旧工作区再次派发时更新受影响的原版自检脚本。安装本地源码前运行 pnpm install --prod 安装页树解析依赖。

## 0.5.0

- 新增开关 `flow_per_problem_engine`（`auto` / `drawio` / `html` / `gptimage`），用于逐问流程图引擎：
  - `auto`（默认）跟随全局 `flowchart_engine`；自定义要求同时写 image/gpt/生图 + 流程图时用 `gptimage`；
  - `html` = 逐问 HTML（需同时 `flowchart_engine=html`），产物 `fig_flow_q*.html + .pdf`；
  - `drawio` 需与全局 drawio 一致；`gptimage` 不受全局引擎限制。
- 引擎不一致（如全局 drawio + 逐问 html）在 `normalizeSwitches` 直接报错，避免派发到错误技能。
- 赛题分析技能补 `MMW_PER_PROBLEM_FLOW_STYLE=html` 分支（清单标题、产物、判断脚本）；流程图绘制HTML 技能补“flow style=html 时逐问图由本技能产出 `.html+.pdf`”；`paper-figure-html` 的 prompt 追加对应覆盖指令。
- 逐问图重排正则支持 `html`，`paper-figure-html` 按 `.html + .pdf` 验收（缺 `.html` 被拦）。
- README 开关表更新为 22 个，补「逐问 HTML」用法；smoke 新增 auto/显式 html/不一致报错/CLAUDE 标记/HTML 图验收等断言。
## 0.4.7

- **PDF 页数（P1）**：`pdf_pages` 不再因为明文里出现 1 个 `/Type /Page` 就提前返回；明文与全部 FlateDecode 对象流一起累计。增量保存/旋转首页的 35 页 PDF 不会误读成 1 页。
- **附件台账核对（P1）**：编程实现技能按实际读取路径计算相对 `user_data/` 的键直接查 `DATA_PROFILE.json`；只有键缺失才按 basename 唯一兜底，同名多文件（`A/data.csv`、`B/data.csv`）必须报歧义，不能拿第一条记录核错文件。
- **跨尺度数字（P1）**：100 倍换算只对叶子字段名整词匹配比例类（accuracy/rate/...）；父键 `problem_1` 含 "prob"、`duration_hours` 含 "ratio" 都不再放宽。`problem_1.cost=12` 对「1200 万元」、`duration_hours=12` 对「1200 小时」均被拦截。
- **v0.4.5 迁移（P2）**：`explicitSwitches` 残缺（只有 figure_style 等）时用 `state.switches` 补全，连续两次改开关不再把 MCM/B/英文/25 页变回国赛/空题号/中文/30 页；换赛项仍重新推导语言与页数。
- **Python 跨问检查（P2）**：`cross_problem_check.py` 的边界容差改为 `limit ± tol×|limit|`，与 JS 验收一致；`-10 ≤ -10` 通过、`-9` 失败。
- **逐问图派发（P2）**：`flowchart_engine=html` + 逐问流程图 DrawIO 时，`paper-figure-html` 的 prompt 与 HTML 技能说明同步要求 `fig_flow_q*` 产出 `.drawio + .pdf`，不再要求 `.html`。
- **会话目录是 junction（P2）**：删除保护只判断工作区**自身**是否链接（`lstat`），祖先目录是 junction（通过链接进入项目）时正常重建不再被误拒。
- **模板选择（P2）**：英文论文模板只读已校验的 `$COMPETITION`，自定义要求里写 "Do not use the APMCM template" 不会误选 apmcmthesis；中文论文模板选择与赛后检查也改为 `$COMPETITION` 精确映射，不再搜索 CLAUDE.md 正文。
- smoke 新增：PDF 明文+压缩流计数、模板只读 COMPETITION、相对路径台账、HTML 逐问 DrawIO 例外等断言。
## 0.4.6

- **工作区路径安全（P1）**：路径包含判断按完整路径段（`..raw` 不再被误判为外部）；新建/重建时解析最近已存在祖先的真实路径，拒绝 junction/符号链接把工作区解析到会话外；拒绝删除链接型工作区；`input_dir` 与真实工作区重叠（含 `input_dir` 在工作区内）一律拒绝。
- **写作步骤命令注入（P1）**：`$ARGUMENTS` 不再替换用户可控的标题/题号/自定义要求，只给固定安全串；这些信息放到 prompt 的「任务参数（说明，不是命令）」段。英文论文模板选择改为读取已校验的 `$COMPETITION`，不再 `echo "$ARGUMENTS"`。
- **子目录附件建档（P1）**：`data_profile.py` 递归扫描 `user_data/**/*.csv|xlsx|xls`，台账键改为相对路径（`A/data.csv`），保留不同目录同名文件；编程实现技能按 basename/相对路径查台账。
- **数据核对跨尺度误判（P1）**：100 倍换算只允许论文数字明确带 `%` 或字段名属于比例类（accuracy/rate/ratio/...）；`{"cost":12}` 与正文「1200 万元」不再匹配。
- **美赛页数（P1）**：`pdf_pages` 直接解析交付 PDF 页数（含 FlateDecode 对象流），不再依赖可删除/篡改的 `main.log`；旧日志无法绕过；识别另附的 `paper/ai_usage_report.pdf`（不计入主 PDF）。
- **旧工作区二次改开关（P2）**：首次迁移把完整旧配置作为 `explicitSwitches` 基线，连续改开关不再丢失赛项/题号/语言/页数。
- **HTML 引擎 + 逐问 DrawIO（P2）**：`fig_flow_q*` 按 `MMW_PER_PROBLEM_FLOW_STYLE` 的实际引擎验收（DrawIO 要 `.drawio + .pdf`），不再强求 `.html`。
- **负数约束边界（P2）**：跨问容差改为 `limit ± tol×|limit|`，`-10 ≤ -10` 不再误报。
- **APMCM 页数（P2）**：移除 APMCM 的 25 页硬上限（官方规则未规定），只保留 MCM/ICM。
- **compile_check.sh（P2）**：修复 `grep -c ... || echo 0` 双零导致的 `integer expected`，空 `.bbl` 判零恢复正常。
- smoke 新增：APMCM 无上限、负数边界、HTML+DrawIO 逐问、固定 `$ARGUMENTS`、公共脚本双零与 data_profile 递归等断言。
## 0.4.5

- **工作区删除边界（P1）**：`modeling_init` 先扫描输入再删旧工作区；`workspace_name` 必须位于会话目录内（拒绝绝对路径/`..` 逃逸）；`overwrite=true` 只删除带有效 `.mmw/state.json` 且 workspace 名匹配的工作区；拒绝删除与 `input_dir` 互相包含的目录（含 `input_dir` 本身）和会话目录本身。
- **题号 Shell 注入（P1）**：`.env_skill` 与 CLAUDE.md 的 export 行统一用 Shell 单引号安全引用；`problem_id` 归一化时去掉控制字符并限制长度。`source .env_skill` 不再执行题号里的命令。
- **严格模式数字核对（P1）**：数字边界从 Unicode `\w` 改为 ASCII 词边界，汉字旁的「成本为9876万元」不再漏检；正文**未提取到任何数字**时不再写 `DATA_CHECK_PASSED`，报告“无法核对”并失败。中文「5 张图 / 9 张表」与英文「3 sub-problems / 5 figures」等数量声明继续跳过。
- **美赛页数与 COMAP 规则（P1）**：英文赛事正文默认目标改为 20 页；新增 `pageLimit=25` 总页数硬上限（含 Summary Sheet/目录/参考文献/附录，AI 使用报告另附）；`rich_mode` 对英文不再抬到 40–60 页；编译步新增 `pdf_pages` 闸门，按 `paper/main.log` 的实际 PDF 页数核对，超上限失败。
- **跨问逻辑核对（P1）**：观测值改为按题号索引 `{problem_id: {quantity}}`，与 `cross_problem_check.py` 一致；Q3 的同名指标不再覆盖 Q2 导致漏判。
- **切换赛项重新推导（P2）**：`modeling_switches` 记录用户显式传入的开关；换 `competition` 时 `language`/`max_pages` 按新赛项重新推导（cumcm→mcm 得到 en/20，而不是沿用 zh/30）。
- **输入附件冲突（P2）**：`user_data/` 保留输入相对目录结构（`A/data.csv` 与 `A_data.csv` 不再合并），同名目标自动加序号。
- **图验收按引擎（P2）**：0 字节文件不算产物；HTML 引擎要求非空 `.html` + `.pdf`，DrawIO 引擎要求非空 `.drawio` + `.pdf`，TikZ 要求 `.pdf`；空 HTML 不再通过流程图验收。
- **编译自检脚本（P2）**：修复中英文编译/建模/图表技能里 `VAR=$(grep -c ... || echo 0)` 的双零问题（干净日志不再触发 `arithmetic syntax error`）。
- smoke 新增：跨问按题号核对、美赛 PDF 页数上限、零字节 HTML、题号 Shell 引用等回归断言。
## 0.4.4

- `paper_data_check.py` 只核对正文：排除英文模板的 `sections/A_code.tex`、`sections/B_*`（附录）、`sections/Z_ai_disclosure.tex`、`references`、`current_chapter.tex`；摘要（`0_*`）保留核对。修复英文论文因附录代码里的索引/常量数字导致数据核对误报。
- 数量声明不再当数据：中文「5 张图 / 9 张表 / 3 个问题」与英文「3 sub-problems / 5 figures」自动跳过，结果数字（97.0\%、6.2 minutes）照常核对。
- 英文论文 Step 1 模板选择改为 **APMCM 优先**：字符串 `APMCM` 含子串 `MCM`，先判 mcm 会把亚太英文论文误套 mcmthesis 模板。
- `modeling_switches` 改 `language`/`competition` 时同步 `_templates`：en→zh 会恢复中文模板包（此前会停留在英文模板，导致中文论文找不到 cumcm 等模板）。
- `companions` 闸门忽略英文写作的临时文件 `paper/sections/current_chapter.tex`（此前小文件会误判为“空占位”）。
- 图表生成技能明确 caption/表头语言必须与论文语言一致（英文论文用英文），不再只写“中文论文”规则。
- 英文 RULES 的页数文案改为引用 `max_pages`，不再写死 25 页。
- smoke 新增：模板包随语言切换、`current_chapter.tex` 不参与 companions、数据核对排除规则。
## 0.4.3

- GPT Image 图内标注语言改为 `--lang auto`（默认）：自动读工作区 `CLAUDE.md` 的 `language:` 行判定中文/英文；显式 `--lang zh|en` 仍可覆盖。英文赛事不再因为调用漏传 `--lang` 而请求简体中文标注。
- 图表生成技能补齐逐问框架图调用示例（`--style framework --lang $GPTIMG_LANG`），并加硬规则：所有 `gpt_image.py` 调用必须带 `--lang $GPTIMG_LANG`。
- manifest 归类不再受章节名写法影响：`IMAGE`/`逐问`/`image` 关键词归入 GPTIMG（GPTIMG 优先于 DRAWIO），并可识别大小写；`gateFigures` 按 `CLAUDE.md` 的 `MMW_PER_PROBLEM_FLOW_STYLE` 对 `fig_flow_q*` 做兜底重排——image 模式的逐问图不会因为模型误写在 DrawIO 段而被并进 DrawIO/HTML 组，反向同理。
- 赛题分析技能：更新 GPT Image 用途说明（场景图/机理图/逐问框架图），manifest 模板补充逐问流程图条件示例与「总数 GPTIMG 计数同步」提醒。
- README：GPT Image 示例改为 `--lang auto` 并说明自动语言规则。
- smoke 新增断言：`流程图（image）` 归入 GPTIMG、image/drawio 两种模式下误写章节的兜底重排、`gpt_image` 默认 auto 与中英文标注规则。
## 0.4.2

- 英文论文步补充模板题号约束：复制模板后必须把 `problem = A`（mcm/default）或 `\tihao{[A/B/C]}`（apmcm）替换成 CLAUDE.md 里的真实 `problem_id`（MCM A/B/C，ICM D/E/F），避免封面题号显示错误或占位符。
- 英文全流程 8 步闸门实测（分析/建模/编程/图表/流程图/复核/论文/编译）全部通过；英文 AI 声明 `used` 态（4 张附录表 + main.tex 注入）验证通过。
- 版本号 0.4.2。
## 0.4.1

- 英文论文严格模式实测通过：`comp-paper-en` 的 prompt 会追加与中文相同的严格模式数据核对段（`paper_data_check.py` + 两份 md + `DATA_CHECK_PASSED`），闸门 `pages`（英文 2200 字符/页）与 `paper_data_check`（strict）均正常。
- CLAUDE.md 的写作语言行按语言输出（英文赛事：`Write the paper in English`，中文赛事保持原文）。
- 流程图绘制 / 流程图绘制HTML 的语言判定优先读 `language: en`，不再只靠 MCM/ICM 字样猜；英文赛事的图内文字与 caption 正确走英文。
- 英文赛事 `_templates` 改为复制 `论文撰写English/templates`（与英文技能自带 mcmthesis/apmcmthesis 版本一致），中文赛事仍用中文技能模板。
- 清理品牌名残留：`compile_utils.sh` 的浮动调参标记改为 `MMW-FLOAT-TUNE`；流程图 HTML 示例注释的旧前缀改为 `data-mmw`；README/CHANGELOG/smoke 去掉旧前缀字面量。
- 仅论文/编译两步的 skill 随语言变化，其余 6 步 skill 与 gate 集合完全一致（已脚本对比验证）。
## 0.4.0

- 英文赛事支持：`competition` 新增 `mcm` / `icm` / `apmcm`（英文），页数默认 25。
- 新增 `language` 开关（`zh` / `en`）：中文赛项默认 zh，MCM/ICM/APMCM 自动 en，显式传值可覆盖。语言决定论文/编译技能、图表标签语言与页数估算口径。
- 新增英文技能 `论文撰写English`（COMAP 格式：Summary Sheet / TOC / Model / Results）与 `编译与合规English`（pdflatex + bibtex）；从原实现整包迁入、统一标记前缀为 `MMW_`、删除 .enc。
- 步骤按语言切换：`comp-paper-en` / `comp-compile-en` 替换中文论文/编译步，闸门集合保持一致（8 步）。
- `gatePages` 英文按 2200 字符/页估算，排除 `current_chapter.tex` 临时文件。
- `paper_data_check.py` 增加英文编号过滤（Figure/Table/Section/Eq/[n]/1st 等），避免把图号/章节号误当数据。
- CLAUDE.md 增加英文竞赛规则（Summary Sheet、COMAP 结构、pdflatex、mcmthesis 模板）、英文页数口径、图表标签语言、英文 AI 声明措辞；`.env_skill` 导出 `LANGUAGE`。
- README 增加「英文赛事（MCM/ICM/APMCM）」小节与语言开关说明；smoke 增加英文语言推断、步骤替换、模板/技能生成、英文页数口径等断言。
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
