# v0.5.4：绘图提示词与共享运行时对齐

## 根因

v0.5.3 的 Nature 提示词和教程已经要求新版共享 API，但随包的绘图工具仍是旧实现。新工作区会直接复制该旧文件，旧工作区的原版脚本升级清单也没有包含绘图工具，因此仅重试提示词无法消除 ImportError。

## 修复内容

| 运行时接口/行为 | 本次实现 |
|---|---|
| `set_paper_placement` | 记录真实模板宽高和插入比例，保存时反算最终字号；不重排已经声明的 GridSpec 或手工布局 |
| `dynamic_limits` | 忽略非有限值，处理常数序列、零基线、对数轴和反向坐标轴；全缺失输入不伪造零数据 |
| `draw_vector_heatmap` | 生成矢量 QuadMesh，保留掩码和非有限单元格；常量范围安全展开、支持中心归一化和独立 colorbar 区域，按实际背景对比选择黑白标注 |
| `declutter_axes` | 克制框线、网格和刻度；保留读数需要的轴与标签 |
| `uncertainty_band` | 只画调用者给出的上下界，检查形状和区间，不推测或生成统计区间 |
| `auto_legend` | 优先保留安全位置，测量图内候选；放不下时按实际尺寸预留顶部/右侧区域 |
| `shared_legend` / `consolidate_shared_legends` | 仅合并相同语义和样式的系列，不覆盖最后一个数据 panel，不把不同系列强行合并 |
| `PALETTE` / `PALETTE_LIGHT` | 原地更新，修复先 import 再 setup 后颜色引用过期；Nature 尊重显式项目数据色卡 |
| `save_fig` | 保存前检查字号与画布边界；矢量输出附带 PNG 预览；保留位置参数及旧的 output 关键字调用 |

运行时声明 `PLOT_UTILS_API_VERSION = 1`。这些接口为实际实现，不是只为消除导入错误而添加的空包装器。

绘图中不再自动 pip 安装 SciencePlots、adjustText 或安装系统字体。可选库未安装时使用已有本地能力；字体缺失继续提示，不在渲染过程中改动系统环境。

## 新旧工作区如何处理

1. 新建工作区时，复制后立即核对共享 API 声明，包内文件本身不完整则明确报错。
2. 每次下一步派发前，已发布原版绘图工具按 SHA-256 指纹升级，兼容 LF/CRLF。缺失文件会补齐。
3. 原版旧文件的规范化指纹为 `32eed4cfb0a3373e3761d5879cd5707823073df558f851bddcf7273c93adbb3d`，对应仓库中此前发布的该工具版本。
4. 未知定制文件不覆盖。若已具备 API 声明则保留；若缺接口，停止派发新提示词，并在工具目录写入带内容指纹的完整新版候选文件，供合并。结构检查不替代对用户自定义实现的语义验证。
5. 默认绘图样板和配方不会再从父目录的旧 shared-scripts 覆盖已准备的工具，减少再次降级和并行复制竞态。
6. 工具目录/文件的符号链接或 junction 不跟随写入外部位置。

更新插件后请重启 DSH，确保下一步使用新的同步逻辑。已经 import 旧模块的长驻 Python 绘图进程也需要重启；更新磁盘文件不会自动重载其模块缓存。

## 验证

新增两套回归：

- [Node 运行时同步回归](../test/plot-runtime-regression.mjs)：10 组，覆盖新建、原版升级、LF/CRLF、缺失补齐、定制保留、不兼容阻塞、新提示词派发顺序和链接边界。
- [Python 绘图回归](../test/test_plot_utils.py)：14 项，覆盖真实接口签名、色卡引用、最终字号、GridSpec/手工布局、有限值范围、矢量热力图、掩码、文字对比、公共图例、PNG 预览和离线渲染行为。

实绘环境为 Python 3.11.9、Matplotlib 3.10.8，使用 Agg。四个随包 Nature 教程直接执行，全部生成 PDF 和 PNG；另检查 SVG 没有热力图栅格图层，并保留可编辑文字。对示例热力图和多 panel 对比图进行了目检。

在干净源码副本上运行完整回归，原有测试与新增迁移/绘图用例均通过；Python 合计 44 项，其中 14 项属于本次绘图合同与实绘回归。真实 DSH rc.3 Host 另复验 16 组、50 次原生工具调用和完整 8 步验收，通过；不涉及本次模型求解或 GUI 端到端验证。

这些示例是教程中的合成数据，仅用于验证绘图，不是任何竞赛结论。

复跑：

```powershell
node test/plot-runtime-regression.mjs
python -m unittest discover -s test -p test_plot_utils.py -v
node test/run.mjs
```

真实绘图测试需要现有的 NumPy 和 Matplotlib，建议 Matplotlib 3.7+。没有安装 Matplotlib 时，实绘用例会明确标为 skipped，API 声明检查仍运行；不能把 skipped 表述为实绘通过。可通过 `MMW_PYTHON` 为完整回归指定带这些库的 Python。

## 相关文件

- [随包绘图运行时](../assets/utils/plot_utils.py)
- [工作区同步与派发前检查](../lib/plotRuntime.js)
- [脚手架与已发布脚本升级](../lib/scaffold.js)
- [共享 API 文档](../assets/skills/自然风格图表/references/api.md)
