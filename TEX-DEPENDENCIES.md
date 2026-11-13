# v0.5.3：MCM/APMCM 的 TeX 离线依赖

日期：2026-11-13

## 已解决的问题

插件现在随包提供 `xpatch.sty`。继续验证字体依赖链时发现的 `xstring`、`scalefnt`、`mweights`、`fontaxes` 也一并补齐。

MCM、APMCM 两套原模板，分别通过了“新建工作区”和“旧工作区补齐依赖”两条路径的真实 pdflatex 编译。四个用例均生成 **4 页 PDF**，并通过论文数字检查与输入 SHA-256 新鲜性验收。未通过删除字体包或改写原模板来绕过依赖。

## 随包提供哪些文件

| 分发包 | 固定版本/日期 | 放到论文根目录的运行文件 | 上游与授权 |
|---|---|---|---|
| xpatch | 0.3a，2020-03-25 | `xpatch.sty` | [CTAN](https://ctan.org/pkg/xpatch)，Enrico Gregorio，LPPL 1.3c 或更高 |
| xstring | 1.86，2023-08-22 | `xstring.sty`、`xstring.tex` | [CTAN](https://ctan.org/pkg/xstring)，Christian Tellechea，LPPL 1.3c 或更高 |
| carlisle | 2021-06-13 分发包 | `scalefnt.sty` | [CTAN](https://ctan.org/pkg/scalefnt)，David Carlisle，LPPL 1 或更高 |
| mweights | 2020-01-23 分发包 | `mweights.sty` | [CTAN](https://ctan.org/pkg/mweights)，Bob Tennent，LPPL（按上游说明） |
| fontaxes | 2.0.2，2026-01-02 | `fontaxes.sty`、`fontaxes-v1.sty` | [CTAN](https://ctan.org/pkg/fontaxes)，Andreas Bühmann / Michael Ummels，LPPL 1.3c 或更高 |

xpatch 与 fontaxes 的运行文件用原版 `.ins` / `.dtx` 和 docstrip 生成，其余上游文件保持原样。fontaxes 自带的 v1 回退文件同时分发，保留上游对旧环境及未安装 figureversions 的兼容行为。

中央资源在插件的 `assets/tex-deps/<分发包>/`。每个包保留完整上游分发材料、许可证，以及记录下载地址、归档 SHA-256、文件 SHA-256 和运行文件名单的 `PROVENANCE.json`。Git 属性固定这些文件的原始字节，避免换行转换破坏校验值。

主要来源记录：

- [xpatch 来源与校验](<assets/tex-deps/xpatch/PROVENANCE.json>)
- [xstring 来源与校验](<assets/tex-deps/xstring/PROVENANCE.json>)
- [carlisle 来源与校验](<assets/tex-deps/carlisle/PROVENANCE.json>)
- [mweights 来源与校验](<assets/tex-deps/mweights/PROVENANCE.json>)
- [fontaxes 来源与校验](<assets/tex-deps/fontaxes/PROVENANCE.json>)

第三方文件继续适用其上游许可证，插件本身的 MIT 许可证不改变这些文件的授权。

## 工作流如何自动取得依赖

**新建工作区**：模板同步时，会把运行文件补入每个实际模板目录。论文步骤整包复制赛事模板后，运行文件就位于论文主文件旁，直接在论文目录运行 pdflatex 即可找到；不需要另外设置 TEXINPUTS。

**旧工作区**：下一次派发步骤时，插件刷新函数会同时补齐已有模板和已有论文目录。即使旧工作区缺少工具目录，也能执行依赖补齐。

**源码与许可证**：每个生成模板和论文目录的 `third-party/tex/<分发包>/` 保存完整来源材料，随论文源码导出时请一起保留。

**自定义文件**：已有同名文件或冲突目录不覆盖；符号链接、junction 和断链不跟随。重复同步只补缺失项，不重写用户改过的文件。

实现入口：[texDependencies.js](<lib/texDependencies.js>)；工作区接入：[scaffold.js](<lib/scaffold.js>)。

## 验证结果

| 用例 | 结果 |
|---|---|
| 新建 MCM 工作区 → 模板含离线依赖 → pdflatex 两遍 | 通过，4 页 PDF |
| 新建 APMCM 工作区 → 模板含离线依赖 → pdflatex 两遍 | 通过，4 页 PDF |
| 旧 MCM 论文目录 → 补齐依赖 → pdflatex 两遍 | 通过，4 页 PDF |
| 旧 APMCM 论文目录 → 补齐依赖 → pdflatex 两遍 | 通过，4 页 PDF |
| 上述四例的数学结果、外置表格、数字检查及新鲜凭据 | 全部通过 |

真实编译使用现有 MiKTeX，并明确传入 `--disable-installer -no-shell-escape`。日志确认从论文目录加载随包 xpatch、xstring、scalefnt、fontaxes 等运行文件。它们不是靠本次编译临时在线安装取得的。

新增依赖回归覆盖：新建模板、旧论文补齐、保留自定义内容、幂等性、来源与许可证同步、运行文件名单、非法路径、缺失文件、符号链接/junction 边界、真实分发文件哈希。

集成测试结果摘要及复跑方法：[MCM/APMCM 实编译验证记录](docs/validation-v0.5.3.md)。

复跑全部程序回归：

```powershell
node test/run.mjs
```

复跑 MCM/APMCM 的新建与旧工作区实编译（使用自己已有的 TeX 和 Python 路径）：

```powershell
$env:MMW_TEX_BIN = '包含 pdflatex 的 TeX bin 目录'
$env:MMW_PYTHON = 'Python 可执行文件绝对路径'
$env:MMW_TEX_CASES = 'mcm,apmcm'
node test/tex-integration.mjs
```

## 使用范围

此功能补齐的是这些轻量 TeX 宏包，不包含整套 TeX 运行时、newtx 字体文件或所有赛事的全部宏包。仍需已有的 TeX Live / MiKTeX 及模板本身的标准环境。

使用本地目录安装时，插件会链接源码仓库。更新后保存工作并重启 DSH，即可由新的初始化和步骤刷新逻辑自动分发依赖；只刷新网页不会更新已缓存的后端模块。
