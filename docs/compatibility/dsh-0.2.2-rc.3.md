# DSH 0.2.2-rc.3 兼容性验证

验证日期：2026-11-14。插件版本：v0.5.3；被测业务源码提交：`ed864c764a66cd5ef7bf6e229d830749078d2d25`。

## 结论

**插件 v0.5.3 与 DSH 0.2.2-rc.3 的 Host 服务和工具接口兼容。** 静态 API 对照、真实 rc.3 隔离 Host 集成以及原有全量回归均通过，无需修改业务代码或 Bundle 配置；本次提交新增兼容性证据和可复跑的测试，插件版本保持 v0.5.3。

本次没有将当前桌面程序视为 rc.3：测试先核对本机实际运行包版本，再单独安装精确版本的公开 npm 包，在隔离目录中挂载插件。没有升级当前桌面程序、改写用户 profile 或启动另一台 Web 服务器。

## 官方版本与变更

- [官方 rc.3 发布说明](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.2-rc.3)：新增实验性 DeepSeek 历史会话导入插件；修复 Windows 桌面应用内更新和重新打开的问题。
- rc.3 tag 提交：`38a6a5c965aa99ab525161efb7cc5cf1fe62fced`。
- rc.2 tag 提交：`ddac96760b6edf8fa0fe17cbdcf0b512f4c12b2c`。
- [官方两个 tag 的对比](https://github.com/deepseek-ai/deepseek-harness/compare/dsh-v0.2.2-rc.2...dsh-v0.2.2-rc.3)。不使用后续 master 代码推断已发布版本的兼容性。
- [npm 精确版本元数据](https://registry.npmjs.org/@deepseek-ai/dsh/0.2.2-rc.3)：Node.js 要求为 `>=24.9.0`。

## 插件接口逐项核对

| 插件使用点 | rc.3 契约 | 结果 |
|---|---|---|
| Host 模块导出 | named `apply(ctx, config)` 与 `inject` 仍受支持 | 匹配 |
| 工具注册 | `tools.register(definition, options?)` 返回释放函数 | 匹配 |
| 工具执行 | `execute(args, exec)`；exec 保留 agent、signal 等上下文 | 匹配 |
| 工具输出 | `output.schema` 与 `output.render(args, value)` | 匹配 |
| 提示注入 | `systemPrompt.section(section)`，有限 order、字符串 text、interpolate 等字段 | 匹配 |
| 会话工作目录 | `workingDirectory.ensure(agent, signal?)` | 匹配 |
| 生命周期 | Cordis 收集 apply 返回的释放函数，卸载时清理注册资源 | 匹配 |
| Bundle 解析 | ESM exports、named module、根 insert 配置继续受支持 | 匹配 |

针对 tools、system-prompt、working-directory、scope、Cordis、Loader、Include 与插件管理接口的 **25 个源码/manifest 文件**，两个发布 tag 的 SHA-256 均相同。另记录了已发生变化的 lockfile，未将整套发行版表述为完全相同。

完整文件列表与哈希：[API 对照证据](dsh-rc3-api-hashes.json)。

## 真实 rc.3 Host 集成

测试环境：Node.js 24.21.0、pnpm 11.28.5、Cordis 4.1.0；10 个显式 DSH 依赖包（含主包）均核对为精确版本 `0.2.2-rc.3`。

最终结果为 **16 组检查通过、50 次原生工具管线调用、严格模式 8/8 步全部完成**：

| 验证项 | 结果 |
|---|---|
| 8 个 modeling 工具注册与 schema 导出 | 通过 |
| 工作流提示注入及工作目录上下文 | 通过 |
| Session 的目录 set/ensure、真实文件系统访问与目录变更通知 | 通过 |
| 初始化相对路径、模板/工具/附件复制、启动前开关修改 | 通过 |
| 重复 next 幂等、问答 pending/answer、空白与歧义回答阻塞、决策恢复 | 通过 |
| 缺主产物、逻辑方向反、缺二级文件、缺图或 HTML 源的阻塞与修复后放行 | 通过 |
| 复核未清零阻塞与严格模式完整 8 步验收 | 通过，进度 8/8 |
| 真正运行 Python 数字检查、修改输入后哈希过期阻塞、重新核对后放行 | 通过，Python 执行 3 次均退出 0 |
| 损坏 PDF 拒绝、有效 PDF 页树解析 | 通过 |
| fast 新流程省略复核、旧 waiting 复核显式 skipped 且不生成清零裁定 | 通过 |
| 卸载后工具 8→0、提示移除；重新挂载再卸载无重复注册 | 通过 |
| 测试中触发网络请求、模型或生图调用 | 0 次 |

结构化运行证据：[Host 结果](dsh-rc3-host-result.json)。保留了版本、检查项、各步闸门结果和测试范围，未发布本机绝对路径或用户配置。

负例的缺参数请求验证的是业务错误返回：插件使用原始 ToolDefinition，rc.3 native pipeline 不会替它执行 defineTool 包装器的入参校验。本记录不将这一负例描述为“自动 required 参数 schema 校验通过”；工具输出则经过真实管线的 schema/render 路径。

测试通过真实 Cordis Context 挂载 SystemPrompt、Tools、SessionStore、SessionProjectionRegistry、LocalFileSystem、WorkingDirectoryService、NativeToolExecutor 和插件。模型调用环未挂载；Agent 仅提供持有真实 Session 和活动 Context 的最小载体。

所有建模工具调用通过真实 `ctx.tools.execute` 和 native pipeline 执行，没有用 Map 模拟工具注册器，也没有直接调用插件 execute 来替代 Host 管线。

## 原有回归

从发布提交创建干净工作树后运行 `node test/run.mjs`，以避免本地私有生图配置影响验证或进入提交：

| 测试集合 | 结果 |
|---|---|
| 工作流冒烟 | ALL PASS |
| 状态机、开关、问答与迁移 | 10 组通过 |
| 图表、逻辑、论文、PDF 闸门 | 22 项通过 |
| Shell 编译与技能行为 | 13 组通过 |
| TeX 离线依赖 | 11 组通过 |
| Python 辅助脚本 | 30 项通过 |

此前 v0.5.3 的 MCM/APMCM 真实 TeX 编译记录继续见 [版本验证记录](../validation-v0.5.3.md)。本次 Host 兼容测试使用确定性产物测试状态机和闸门，不冒充新一轮竞赛求解或真实 TeX 编译。

## 复跑与范围

可复用脚本：[test/dsh-host-compat.mjs](../../test/dsh-host-compat.mjs)。精确运行依赖：[独立测试项目清单](../../test/fixtures/dsh-rc3-runtime/package.json)，不会加入插件生产依赖。

请在干净源码 checkout 中执行，避免把本地私有生图配置复制进测试工作区。需要 Node.js 24.9.0+、pnpm 和 Python 3.10+：

```powershell
pnpm install --prod --ignore-scripts
pnpm --dir test/fixtures/dsh-rc3-runtime install --ignore-scripts
$env:MMW_DSH_ROOT = (Resolve-Path test/fixtures/dsh-rc3-runtime).Path
$env:MMW_PLUGIN_ROOT = (Get-Location).Path
$env:MMW_PYTHON = (Get-Command python).Source
node test/dsh-host-compat.mjs
```

若 Python 不在 PATH，请把 `MMW_PYTHON` 改成解释器绝对路径。结果和确定性产物默认保存在独立测试项目的 host-results 子目录；也可通过 `MMW_HOST_RESULTS_DIR` 指定另一个目录。脚本会先核对实际包版本，再进行挂载和调用；测试不修改用户当前 DSH profile。

运行普通插件回归仍使用 `node test/run.mjs`。rc.3 测试作为显式集成入口，未强制加入不含 DSH 开发依赖的默认回归。

本次兼容结论限定于隔离的真实 rc.3 Host 服务与插件工具链，不等同于 Desktop/Web GUI 端到端交互、桌面更新器或新会话导入功能已经实测。测试未调用真实 LLM 或生图 API；不改变生产插件的依赖，不要求把 DSH 安装进用户当前 profile。
