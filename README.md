# dsh-mathmodeling-workflow

给 [DSH](https://github.com/deepseek-ai/deepseek-harness) 用的**数学建模竞赛全流程插件**：把赛题和数据放进一个文件夹，说一句话，它就会按 8 个步骤跑完——赛题分析、建模求解、编程实现、数据图、流程图、逻辑对抗复核、论文撰写、编译出 PDF。

```text
赛题目录/ ──► 8 步流水线 ──► paper/main.pdf + 全部源码/图表/中间产物
```

## 安装

前置：DSH（桌面版或 Web 版）。用 npx 方式装需要 Node.js + pnpm（DSH 桌面版自带 pnpm；纯 Node 环境先 `npm i -g pnpm`）。

其余依赖按需装，缺哪个只影响对应那一步：

| 依赖 | 什么时候需要 |
|---|---|
| Python 3.10+（能 `import matplotlib`） | 数据图、结果核对 |
| XeLaTeX（TeX Live / MiKTeX） | 编译论文 PDF |
| Chromium 内核浏览器（Edge / Chrome） | 仅 `flowchart_engine=html` 时需要 |
| 中文字体 | 编译中文模板（初始化时会尝试从系统字体回填） |

### 方式一：npx 一条命令（推荐）

```bash
npx -y @deepseek-ai/dsh plugin --profile desktop add github:xzwwwwww/dsh-mathmodeling-workflow
```

拉取仓库 → 装进 `desktop` profile → 自动注册进 bundle 列表。Web 版把 `desktop` 换成 `web`。

### 方式二：从本地目录装

```bash
git clone https://github.com/xzwwwwww/dsh-mathmodeling-workflow.git
```

然后在 DSH 里二选一：

- **桌面端**：插件管理 → 安装 bundle → 目标填克隆下来的目录
- **Agent**：`plugin_manager({ action: "install_bundle", target: "<克隆目录的绝对路径>" })`

更新：方式一重跑 npx 命令；方式二 `git pull` 后把插件关闭再启用一次（或重启 DSH）。
卸载：插件管理里移除，或 `plugin_manager({ action: "remove_bundle", target: "@local/dsh-mathmodeling-workflow" })`。

## 使用

### 1. 把赛题和数据放进一个文件夹

```text
2026国赛A/
├─ 赛题A.docx          # 赛题原文：PDF / DOCX / MD 都行
├─ 数据.csv            # 附件数据：csv / xlsx / json
└─ 自定义要求.md        # 可选：导师规范、评审偏好、必须包含的内容
```

### 2. 在 DSH 里说一句话

```
用建模插件跑这个赛题：D:\2026国赛A
```

插件会让 agent 先确认开关（没填的用默认值并回显），再建工作区、开始逐步推进。

### 3. 提示词怎么写

**最简**（全部默认）：

```
用建模插件跑这个赛题：D:\2026国赛A
```

**带要求**（只写你在意的，其余默认）：

```
用建模插件跑：D:\2026国赛A，国赛 A 题，正文 25 页，
数据图用 nature 风格，流程图用 HTML 引擎，严格审查
```

agent 收到后会回显最终开关，然后生成工作区 `modeling-2026国赛A-<时间戳>/`。

### 4. 开关一览（19 个）

| 开关 | 取值 | 默认 | 用途 |
|---|---|---|---|
| `competition` | cumcm / wuyi / huazhong / apmcm_zh / diangong / mathorcup / zhongqing / yangtze / liaoning / huashu / huawei / generic | `cumcm` | 赛项：决定竞赛规则、默认页数、LaTeX 模板 |
| `problem_id` | A/B/C… | 空 | 题号，写进参数和规则段 |
| `title` | 任意字符串 | 空（取目录名） | 论文标题 / 赛题简称 |
| `max_pages` | 正整数 | 赛项默认（多数 30，`apmcm_zh` 25） | **正文页数目标（下限）**：目录之后→参考文献之前（无目录则摘要之后→参考文献之前），不含摘要/目录/参考文献/附录/AI 声明；不是全文上限 |
| `figure_style` | `default` / `nature` | `default` | 数据图风格：default=按工作区随机配色（去指纹）；nature=Nature 排版+深蓝主色 |
| `flowchart_engine` | `drawio` / `html` | `drawio` | 流程图引擎：drawio 产物可拖拽编辑；html 布局更好、不可拖拽 |
| `diagram_style` | `mono` / `plain` / `modern` | `mono` | 流程图版式，仅 html 引擎生效 |
| `rich_mode` | true / false | `false` | 丰满模式：正文 40-60 页、30+ 图、摘要 1500-2200 字、12 类章节扩展 |
| `validation_mode` | `strict` / `fast` | `strict` | strict=完整审查（含论文数据真实性核对）；fast=省额度，跳过复核和深度自修 |
| `enable_comp_review` | true / false | `true` | 是否插入「逻辑对抗复核」步（图表之后、论文之前），关掉省一次子代理调用 |
| `ai_disclosure` | `off` / `none` / `used` | `off` | AI 声明：off 不写且不许残留；none 一句话；used 声明章节+附录四表 |
| `comp_date_start` / `comp_date_end` | `YYYY-MM-DD` | 空 | 仅 `ai_disclosure=used` 用于生成比赛期内的交互日期 |
| `skip_figures` | true / false | `false` | 跳过两个图表步 |
| `skip_drawio` | true / false | `false` | 只跳过流程图步 |
| `min_figures` / `min_tables` / `min_models` | 整数 或 `auto` | `auto` | 数量下限参考，写进 CLAUDE.md 供技能自检 |
| `custom_requirements` | 自由文本 | 空 | 自定义要求（导师规范、必须包含的内容），最高优先级，会进 CLAUDE.md |

另外 3 个不是开关的初始化参数：`input_dir`（必填，赛题目录）、`workspace_name`（工作区目录名，默认按目录名+时间戳）、`overwrite`（工作区已存在时是否重建）。

### 5. 一个完整示例

```
用建模插件跑：D:\2026国赛A，国赛 A 题，正文 25 页，
数据图用 nature 风格，流程图用 HTML 引擎（modern 版式），
AI 声明按"使用过 AI 工具"写，开启逻辑对抗复核，
自定义要求：摘要不超过一页，必须包含灵敏度分析。
```

agent 会回显类似：

```
赛项：国赛 (CUMCM)(cumcm) ｜ 题号=A ｜ 页数(正文)=25 ｜ 数据图风格=nature
流程图=html/modern ｜ 丰满模式=关 ｜ 审查=strict ｜ AI声明=used ｜ 对抗复核=开
→ 8 步，工作区 modeling-2026国赛A-20261104-2030/
```

### 6. 跑起来之后

- **每步一个子代理、串行执行**：上一步闸门通过才进下一步，主会话只做调度和验收。
- **需要你拍板时会来问你**：子代理拿不准关键信息（题号口径、数据取舍、硬性要求）会先问你，拿到回答再继续；能靠合理假设推进的，它会在产物里写明假设。
- **随时可以问进度**：`看下当前进度` → 会列出 8 步状态、产物大小和待答问题。
- **产物**：工作区根目录有 `PROBLEM_ANALYSIS.md`、`MODELING_REPORT.md`、`RESULTS.md`、`code/`、`figures/`、`paper/main.pdf`。

## 整个流程

| # | 步骤 | 干什么 | 主产物 |
|---|---|---|---|
| 01 | 赛题分析 | 拆子问题、定义变量、规划建模思路和图表清单 | `PROBLEM_ANALYSIS.md` |
| 02 | 建模求解 | 假设、模型建立、求解、检验、逻辑合同 | `MODELING_REPORT.md` |
| 03 | 编程实现 | 写可运行代码、跑出结果、生成结果 JSON | `RESULTS.md` + `code/` |
| 04 | 图表生成 | 数据图（matplotlib，按 manifest 对账） | `figures/fig_*.pdf` + `latex_includes.tex` |
| 05 | 流程图/架构图 | DrawIO 或 HTML 引擎画流程、架构、TikZ 图 | `figures/fig_*` |
| 06 | 逻辑对抗复核 | 六类逻辑缺口复核（方向反、跨问矛盾、任务读歪…） | `COMP_REVIEW_VERDICT.json` |
| 07 | 论文撰写 | LaTeX 正文、摘要、图表嵌入、引用；strict 时做数据真实性核对 | `paper/main.tex` |
| 08 | 编译与合规检查 | XeLaTeX 编译、模板完整性、图嵌入、AI 声明合规 | `paper/main.pdf` |

可调整：`flowchart_engine=html` 会把第 05 步换成 HTML 引擎技能；`skip_figures` 去掉 04+05；`enable_comp_review=false` 去掉 06；`fast` 模式跳过 06 的深度复核和数据核对。

每一步结束都由**确定性闸门**验收（产物存在、图表对账、正文页数、逻辑合同、AI 声明、数据核对），不通过就带着修复提示重派，最多重试 2 次。

## 生成概念图（可选）

数据图和流程图都是**全本地**的（matplotlib / 本机浏览器渲染），不需要任何 key。

只有「概念图 / 场景图」这类需要图像模型。工作区里**已经带了配置文件**，直接打开填：

```text
<workspace>/_utils/_gpt_image_config.json
```

```json
{
  "api_key": "",
  "base_url": ""
}
```

- `api_key`：你从**中转站或官方**拿到的 key；
- `base_url`：中转站给接口地址就填（例如 `https://xxx.com/v1`），**留空则用官方** `https://api.openai.com/v1`；
- 也可以不改文件，直接设环境变量 `GPT_IMAGE_API_KEY` / `GPT_IMAGE_BASE_URL`（环境变量优先级更高）；
- 检查是否配好：`python _utils/gpt_image.py --check`；
- **没配也能跑**：规划里的概念图会被自动跳过，不影响其余步骤。

如果你自己有 ChatGPT 账号，也可以直接拉 Codex CLI，用它内置的 image gen 出图（本仓库的插件图标就是这么生成的）：

```bash
codex exec -i 参考图.png "按这张参考图的角色生成一张方形应用图标，纯白背景、粗描边、无文字，保存为 icon.png"
```

`codex` 不在 PATH 时，用 Codex 桌面版自带的那份：`%LOCALAPPDATA%\OpenAI\Codex\bin\<最新版本目录>\codex.exe`。

## License

MIT
