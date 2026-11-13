# v0.5.3 验证记录

验证日期：2026-11-13。修复基线为 v0.5.1（`e0dca93`），本次发布包含 v0.5.2 全流程修复及 v0.5.3 随包 TeX 依赖。

## 程序回归

在源码目录运行：

```powershell
node test/run.mjs
```

Python 不在 PATH 时，可通过 `MMW_PYTHON` 指定 Python 3.10+ 可执行文件。

| 测试集合 | 实际结果 |
|---|---|
| 工作流冒烟测试 | ALL PASS |
| 状态机、开关、问答与旧工作区迁移 | 10 组通过 |
| 图表、逻辑、论文、PDF 与新鲜性闸门 | 22 项通过 |
| 编译与技能 Shell 行为 | 13 组通过 |
| TeX 离线依赖分发、边界保护与真实文件校验 | 11 组通过 |
| Python 辅助脚本（含原有回归） | 30 项通过 |

最终输出为：

```text
ALL WORKFLOW REGRESSIONS PASS
```

独立复验还检查了代码区伪引用、includeonly、错误的章节目录回退、工作区其他目录输入变更，以及 lstinline 星号分隔符，均得到预期结果。

## 原模板真实编译

使用现有 MiKTeX 25.12 的 pdflatex，每个用例编译两遍。引擎参数包含：

```text
--disable-installer -no-shell-escape -interaction=nonstopmode -halt-on-error
```

| 模板与分发路径 | PDF | 数字检查 | 输入哈希凭据 |
|---|---:|---|---|
| MCM，新建工作区模板同步 | 4 页 | 通过 | 当前有效 |
| APMCM，新建工作区模板同步 | 4 页 | 通过 | 当前有效 |
| MCM，旧论文目录补齐依赖 | 4 页 | 通过 | 当前有效 |
| APMCM，旧论文目录补齐依赖 | 4 页 | 通过 | 当前有效 |

每例的数字检查输出为 9 个源文件、2 个 JSON 数值条目、17 个论文数据性数字、0 个未对上。编译日志确认从论文目录加载随包 xpatch、xstring、scalefnt、fontaxes 等运行文件。没有靠删除原模板的字体宏包或在本次编译中自动安装宏包来绕过缺失依赖。

复跑命令：

```powershell
$env:MMW_TEX_BIN = '包含 pdflatex 的现有 TeX bin 目录'
$env:MMW_PYTHON = 'Python 可执行文件绝对路径'
$env:MMW_TEX_CASES = 'mcm,apmcm'
node test/tex-integration.mjs
```

通用论文另用 XeLaTeX、pdflatex 分别进行过真实编译，两种引擎均生成有效 PDF，并通过数学结果、外置表格和新鲜凭据检查。

## 分发完整性

- 使用 pnpm pack 生成 v0.5.3 插件归档，并实际读取归档内文件检查。
- 五个第三方分发包的运行文件、完整上游材料、许可证和来源记录均进入归档。
- 归档内各上游文件 SHA-256 与对应来源记录一致。
- 图像生成配置保持空凭据模板。
- `git diff --check` 通过；AI 声明内容生成规则与修复基线保持一致。

## 范围

以上是程序回归、缺陷复验、真实模板编译和分发检查。没有调用外部生图 API，也没有实际求解一轮完整竞赛赛题。随包依赖不替代完整 TeX 运行环境、字体及其他标准宏包。

相关说明：[全流程修复](../FIXES-0.5.2.md)、[TeX 离线依赖](../TEX-DEPENDENCIES.md)。
