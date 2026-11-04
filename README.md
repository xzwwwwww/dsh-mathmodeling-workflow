# dsh-mathmodeling-workflow

把「数学建模竞赛全流程」做成 DSH 插件：**扫描赛题目录 → 建 workspace + CLAUDE.md → 逐步派发子代理 → 确定性闸门验收**。

骨架是**状态机 + 技能规格 + 确定性闸门 + 共享记忆文件**（CLAUDE.md），不是「一条长 prompt」。技能与工具脚本随插件打包在 `assets/skills/`、`assets/utils/`，初始化时把**整个技能文件夹**（SKILL.md + references/ + templates/ + tools/）原样复制到工作区 `skills/`。

## 安装

需要 DSH（桌面版 / Web 版均可）。可选依赖按需装：Python 3.10+（要能 `import matplotlib`）、XeLaTeX（出 PDF）、Chromium 浏览器（仅 `flowchart_engine=html` 用）。缺哪个，对应那一步会报错，其余步骤照常跑。

### 方式一：npx 直接装（不用 clone）

```bash
npx -y @deepseek-ai/dsh plugin --profile desktop add github:xzwwwwww/dsh-mathmodeling-workflow
```

一条命令完成：拉取仓库 → 装进 `desktop` profile → 自动注册进 bundle 列表。Web 版把 `desktop` 换成 `web`。

- 需要本机有 Node.js 和 pnpm（DSH 桌面版自带 pnpm；纯 Node 环境先 `npm i -g pnpm`）。
- 仓库是私有的，所以要有访问权限；没有权限就先 clone，再用方式二。
- 已经装过本地链接版时，先移除再加，否则 Windows 上 pnpm 会报 `EPERM`。

### 方式二：从本地目录装

```bash
git clone https://github.com/xzwwwwww/dsh-mathmodeling-workflow.git
```

装进当前 profile（二选一）：

- **桌面端**：插件管理 → 安装 bundle → 目标填克隆下来的目录
- **Agent**：`plugin_manager({ action: "install_bundle", target: "<克隆目录的绝对路径>" })`

更新：方式一重跑 npx 命令；方式二 `git pull` 后把插件关闭再启用一次（或重启 DSH）。只改 `assets/` 的话下次 `modeling_init` 自动生效。卸载：`plugin_manager({ action: "remove_bundle", target: "@local/dsh-mathmodeling-workflow" })`。

装好直接说：

> 用建模插件跑这个赛题：`D:\path\to\赛题目录`（国赛 A 题，正文 25 页）

## 技能目录（中文命名）

`assets/skills/` 下按中文命名，初始化时整包复制到工作区 `skills/`：

| 技能目录 | 用途 | 对应步骤 key |
|---|---|---|
| `赛题分析` | 拆题、子问题、变量、图表预规划 | `comp-prob-analysis` |
| `建模求解` | 模型假设/建立/检验、逻辑合同 | `comp-modeling` |
| `编程实现` | 代码实现、结果 JSON、能力验收 | `comp-code` |
| `图表生成` | 数据图（`figure_style=default` 时使用） | `paper-figure` |
| `自然风格图表` | 数据图（`figure_style=nature` 时替换上一步技能；Nature 排版 + `nature_palette()` 取色） | `paper-figure` |
| `流程图绘制` | DrawIO 流程图/架构图（可拖拽编辑） | `paper-figure-drawio` |
| `流程图绘制HTML` | HTML+截图流程图（`flowchart_engine=html` 时替换上一步） | `paper-figure-html` |
| `逻辑对抗复核` | 六类逻辑缺口复核（默认开） | `comp-review` |
| `论文撰写` | 竞赛论文 LaTeX 写作 + 严格模式数据核对 | `comp-paper-zh` |
| `编译与合规` | 编译、模板完整性、图嵌入、合规检查 | `comp-compile-zh` |

> 步骤 `key` 与状态文件仍用 ASCII（`comp-paper-zh` 等），只有**技能目录名**是中文：闸门、`state.json`、prompt 标记（`MMW_STEP_DONE <key>`）都不受改名影响。

## 用法（主代理视角）

1. 用户在任意目录准备一个文件夹：赛题 PDF/DOCX、数据（csv/xlsx）、自定义要求（md/txt）。
2. 调 `modeling_init`：
   - `input_dir`：上述文件夹
   - 开关：`competition`（cumcm/wuyi/huazhong/apmcm_zh/diangong/mathorcup/zhongqing/yangtze/liaoning/huashu/huawei/generic）、`problem_id`、`max_pages`、`figure_style`、`flowchart_engine`、`diagram_style`、`rich_mode`、`validation_mode`、`ai_disclosure`、`enable_comp_review`、`custom_requirements`…
3. 循环 `modeling_next` → `subagent` → `modeling_finish`，每步一个子代理，串行执行。
4. 全部完成后 `modeling_status` 查看产物（最终 `paper/main.pdf`）。

工作流生成在**当前会话工作目录**下：`modeling-<赛题目录名>-<时间戳>/`。默认 8 步（含逻辑对抗复核）；一个工作区约 20 MB（`_templates` 只回填当前赛项的字体）。

### `max_pages` 指**正文页数**

口径和用户约定一致：

- **有目录**：目录之后 → 参考文献之前；
- **无目录**：摘要之后 → 参考文献之前；
- **不含**摘要、目录、参考文献、附录（含附录代码）。

竞赛规则里若有「总页数上限（含附录/参考文献）」，那是另一个约束，两个要同时满足；页数闸门只按上面的正文口径判定（`paper/sections/` 里附录类文件 `A_*` / `Z_*` / 含 `\appendix` 的会被排除）。

## 工具

| 工具 | 作用 |
|------|------|
| `modeling_init` | 扫描目录、解析开关与步骤、建工作区（CLAUDE.md / .env_skill / _utils / _references / _templates / **skills（整包）** / user_data / .mmw/state.json） |
| `modeling_next` | 渲染当前步骤 `_steps/NN_<step>/prompt.md`（内联技能规格、参数、上游产物、产物契约），返回 prompt 路径与可直接交给 `subagent` 的文本 |
| `modeling_finish` | 跑闸门（artifact / companions / figures / pages / logic / review_verdict / ai_disclosure / paper_data_check），通过则推进，失败返回修复 hints |
| `modeling_status` | 进度表 + 产物大小 + 开关快照 |
| `modeling_switches` | 流程开始前改开关（会重新解析步骤并重写 CLAUDE.md） |
| `modeling_ask` | 子代理用：登记一个必须由用户决定的问题，然后结束本轮等待 |
| `modeling_pending` | 主代理用：列出待回答的问题（含可选答案） |
| `modeling_answer` | 主代理用：记录用户回答，返回要 send_message 给子代理的文本 |

## 开关语义

- `figure_style`：**决定数据图用哪个技能**——`default` 用 `图表生成`（按工作区种子随机配色、去指纹）；`nature` 用 `自然风格图表`（Nature 排版：左下两边框、刻度朝外、无网格、8pt 字级；取色调 `nature_palette()`，marker 用 `nature_markers()`）。两者产物契约相同（`fig_*.pdf` + `figures/latex_includes.tex`），步骤数量不变。
- `flowchart_engine`：`drawio`（产物可拖拽编辑）/ `html`（布局更好但不可拖拽）。**会替换流程图那一步的技能**，但两者产物契约一致（`fig_*.pdf` + `latex_includes.tex`）。
- `diagram_style`：`mono`/`plain`/`modern`，仅 html 引擎生效。
- `rich_mode`：正文 40-60 页、30+ 图、摘要 1500-2200 字、12 类章节扩展；自动把页数抬到 ≥50，以条款形式注入 CLAUDE.md。
- `validation_mode`：
  - `strict`（默认）：论文步结束前，在**同一个子代理会话**里继续做「论文数据真实性核对」（见下）。
  - `fast`：CLAUDE.md 写 `MMW_FAST_MODE=1`，技能跳过对抗复核与深度自修，数据核对闸门也跳过。
- `ai_disclosure`：`off`（默认，且**必须无残留**）/ `none`（一句话声明）/ `used`（声明章节 + 附录四表 + 参考文献 AI 条目）。
- `enable_comp_review`：插入「逻辑对抗复核」步，**默认开**，位置在**图表之后、论文之前**（它要复核图表并触发重画）；传 `false` 可省一次子代理调用。

## 子代理提问：`modeling_ask` → 用户 → 回传

子代理不是「闷头猜」：信息不足时分两档处理（prompt 与 CLAUDE.md 都写了规则）：

| 情况 | 行为 |
|---|---|
| 能安全假设 | 直接做，在产物里写「假设：…；依据：…」，不打断流程 |
| 猜错会做错方向（题号/竞赛口径、输出格式、数据取舍、硬性页数上限、自定义要求含义等） | 调 `modeling_ask(workspace, question, options?)` 登记问题 → **结束本轮** |

主代理接力的固定四步：

```
modeling_pending            # 看到 [q1] 问题 + 可选答案
→ ask_user_question         # 问用户（原样问，别改写）
→ modeling_answer           # 记录回答，返回要回传的文本
→ send_message(子代理, 回传文本)   # 同一子代理继续本步
→ modeling_finish           # 再验产物
```

闸门保护：有未回答问题或步骤处于 `waiting` 时，`modeling_finish` 会拒绝验收并提示先处理问题；`modeling_next` 也会返回「正在等回答」而不是把下一步渲染出来。问题与回答都落在 `.mmw/state.json` 的 `questions[]`，可追溯、可重放。

## 严格模式：论文步内的数据真实性核对

论文正文写完后，**同一个子代理不换会话**，继续执行 `_utils/paper_data_check.py`：

```bash
python _utils/paper_data_check.py --mode pdf    # Word/Markdown 用 --mode docx
```

它做三件事：

1. 把 `figures/*.json` 里的真实数据拍平成数字清单；
2. 扫论文正文（LaTeX 看 `paper/sections/*.tex`，Word 看 `paper/main.md`）里的「数据性数字」，逐个回到 JSON 找来源（小数位对齐 + 0.5% 相对容差，百分数自动换尺度；图/表/式编号、年份、公式内常数、文献数字会跳过）；
3. 产出两份文件并给出结论：
   - `PAPER_DATA_CHECKLIST.md`：数据原料表 + 自检步骤 + 「未对上」清单；
   - `PAPER_DATA_CHECK_REPORT.md`：统计与结论（通过 / 未通过）。

全部对上时，脚本自动往 `paper/main.tex`（或 `paper/main.md`）写入 `DATA_CHECK_PASSED` 标记；对不上则列出行号与上下文，子代理必须逐个改数或改表述后重跑，直到通过。**禁止删表格/删结论来凑通过**；确属引用文献或题目给定常数的，要在报告末尾写「例外说明」。

闸门 `paper_data_check` 的判据：两份 md 存在 + 报告结论为「通过」+ 通过标记在位；`fast` 模式自动跳过（code 2）。`python` 不可用时，prompt 允许退化为人工核对并写明确结论。

## 闸门

- `artifact`：主产物存在且 ≥ 最小体积（非 0 字节）。
- `companions`：二级文件齐全（每个 > 50 字节，防空占位）。
- `figures`：解析 `FIGURE_MANIFEST`（按粗体章节分类 DATA/TABLE/GPTIMG/DRAWIO/TIKZ），与实际 `figures/` 产出对账。**按步骤分开对账**：数据图步只管 DATA/GPTIMG，流程图步只管 DRAWIO/TIKZ；别的类别由另一步负责，不会互相卡住（`TABLE` 不是文件，不参与对账）。
- `pages`：**正文页数**（目录后→参考文献前，无目录则摘要后→参考文献前；不含摘要/目录/参考文献/附录/AI 声明）。按 `paper/sections/` 正文 section 去 LaTeX 命令后 900 字/页估算，低于目标 80% 判失败；它是**目标/下限**，不是全文页数上限。
- `logic`：读 `LOGIC_CONTRACT_MACHINE` + `CROSS_PROBLEM_LEDGER.json` + `figures/*.json`，核方向探针（**数值证伪**）、零裕度、等价声称、漏变量、跨问矛盾；合同缺失则跳过（不误杀）。
- `review_verdict`：`COMP_REVIEW_VERDICT.json` 三类计数全 0 + findings 为空 + 账本存在。
- `ai_disclosure`：三态 × LaTeX/docx，`off` 时反查残留。
- `paper_data_check`：严格模式下的论文数据核对（见上）。

## 已知限制

- 只支持中文赛项（技能只打包了 `论文撰写` / `编译与合规` 两个中文写作链）。
- 只支持 `output_format=pdf|latex`；`docx` 未打包 docx 技能（`paper_data_check.py` 支持 `--mode docx`，但写作步没有对应技能）。
- 工具库只带 Python 源码，不带预编译 `.pyc`。
- 模板包不含中文字体（体积太大）：初始化时从模板 `.cls/.tex` 解析字体文件名并尝试从系统字体目录（`%WINDIR%\Fonts`）补齐，结果写进 `_templates/FONTS_MISSING.md`（XeLaTeX 也能按字体名解析，缺文件不必然是硬错）。
- `flowchart_engine=html` 的渲染管线**随包提供**：`_utils/screenshot_capture.py` + `_utils/katex/`（KaTeX，627 KB）。它调用本机已安装的 Chromium 内核浏览器（Edge / Chrome / Chromium）做无头渲染；找不到浏览器时可用环境变量 `MMW_BROWSER` 指定可执行文件路径。两者都没有就退回 `drawio`。
- 子代理不能直接跟用户对话；需要用户拍板时会走 `modeling_ask` → 主代理 `ask_user_question` → 回传 的链路（见下节）。

## 自测

```bash
node test/smoke.mjs
```

覆盖：开关规范化、步骤解析（html 替换 / 对抗复核插步 / skip_figures / nature 换技能）、目录扫描分类、workspace 生成（含 `_utils/screenshot_capture.py` 与 `_utils/katex/`）、CLAUDE.md 内容（丰满模式 / AI 标记 / 竞赛规则）、prompt 渲染（含严格模式数据核对任务）、闸门失败/通过/方向反/AI 残留、数据核对闸门四态。

HTML 出图链路（真实工作区实测）：

```bash
python _utils/screenshot_capture.py --geom-check figures/fig_flow.html --render-math   # 0=通过 1=有几何问题 2=无法检查
python _utils/screenshot_capture.py --file figures/fig_flow.html --out figures/fig_flow.pdf --format pdf --render-math
```

实测：KaTeX 公式正常渲染、几何自检通过、PDF 单页且含字体对象（`html_pdf_check.py` 全绿）、页面尺寸与 HTML 内容一致（481×308 px → 362×233 pt）。

> 插件以本地目录链接安装：改 `lib/*.js` 后需重启 DSH（或关闭再启用该插件）才加载新模块；`assets/` 是运行时读取，改完立即生效。
