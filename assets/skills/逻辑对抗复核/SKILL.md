---
name: 逻辑对抗复核
description: "数学建模竞赛·逻辑对抗复核。在编程实现后、论文撰写前，用独立视角挑'方向反/重复计量/外推过硬/漏变量/跨问矛盾'这类自查看不见的硬错。Use between 编程实现 and comp-paper."
argument-hint: [problem-context]
allowed-tools: Bash(*), Read, Grep, Glob, Agent
---

# 竞赛·逻辑对抗复核（独立视角，专挑自查盲区）

**为什么需要这一步**：建模/编程用的是同一个"心智模型"，如果它在建模阶段就把某个方向想反了（如把上界当下界）、或把某项算了两次，**自查时用的还是那个反的脑子，永远看不见**。这一步换一个独立视角，只干一件事——挑那五类"数值合法但逻辑错"的硬伤。

## ⚡ 开关说明 + FAST_MODE 二级保险（开头先跑）

⛔ **本步默认「关」**：后端 `_resolve_template` 默认把 逻辑对抗复核 从步骤链里移除，**只有用户显式 `enable_comp_review=true` 时本步才会出现并执行**（这才是真省额度——不出现在链里就不启动进程）。所以你现在能读到这段，说明用户已选择开启。

```bash
# 二级保险：即便被开启，FAST_MODE 下仍跳过（速度优先场景），产占位不阻塞。
if grep -q 'MMW_FAST_MODE=1' CLAUDE.md 2>/dev/null; then
  echo "⏭ FAST_MODE：逻辑对抗复核跳过。确定性闸(logic_audit/cross_problem_check)已在 编程实现 兜底。"
  printf '# 逻辑对抗复核\n\nFAST_MODE 跳过（省额度）。确定性逻辑闸仍在 编程实现 阶段跑过。\n' > COMP_REVIEW.md
  exit 0
fi
```
> ⛔ 本步是**唯一多花一次 AI 调用**的环节。默认关(后端移除)、开启后 FAST_MODE 仍可跳。跳过时确定性闸(logic_audit/cross_problem_check)已在上一步兜底，不影响主流程。

## 输入（只读摘要，禁整读大 JSON）

- `PROBLEM_ANALYSIS.md`（题面/逐句表/硬约束）、`DATA_FACTS.json`（数据事实台账）
- `MODELING_REPORT.md`（假设/`LOGIC_CONTRACT_MACHINE`/`CROSS_PROBLEM_LEDGER`）
- `RESULTS.md` + `AUDIT_REPORT.md`（前面各闸的结论）
- `figures/*_results.json` 用 `_utils` 下的 summarize 或 `Grep`/`Read` 局部看，**⛔ 禁 `cat` 整包大 JSON**（吃光 context）

## Step 1: 先看确定性闸的既有结论（不重复劳动）

```bash
# logic_audit / cross_problem_check 已在 编程实现 阶段跑过，先复用它们的裁定作锚点
[ -f AUDIT_REPORT.md ] && grep -nE "外推|特征完整性|重复计量|跨问|矛盾|❌|⚠" AUDIT_REPORT.md | head -30
```

## Step 2: 逐条对撞五类缺口（核心，用证据说话）

对每一类，找**具体代码行/具体数值**当证据，不泛泛而谈：

1. **方向/界反没反**：核对 `LOGIC_CONTRACT_MACHINE.bounds` 声明的上/下界与代码实现是否一致。凡有删失/封顶/反解，代入观测值验证不等号方向。（这是确定性闸抓不到、最需要独立视角的一类）
2. **重复计量**：任何"总量=A+B"，查 A 的拟合/标定是否已吸收 B（如截距用含某分项的总量拟合、又显式加该分项）。
3. **外推口吻过硬**：预测点落在 `DATA_FACTS` 观测区间外的，正文是否用了确定性口吻当"数据结论"（应标"情景模拟、需现场标定"）。
4. **漏真实变量**：`DATA_FACTS` 里 `role=observed` 的关键变量，是否都进了模型；被当"不重要"丢掉的要质疑。
5. **跨问矛盾**：某问算出的关键结论（如峰值/边界）是否与另一问的优化约束/结论冲突。
6. **任务理解 vs 题目原文（⛔ 最该由你独立视角兜的一类）**：拿 `PROBLEM_ANALYSIS.md` 的**关键概念对齐表**和 `MODELING_REPORT.md` 的**目标/约束原文溯源**，逐条核对——建的目标函数/约束/关键量，和题目**原句**要的是不是同一件事？重点抓：求 A 做成了求 B（如覆盖宽度→面积）、最优化方向反（min↔max）、约束理解反、关键量物理含义错、漏做某个明确要求。⛔ **这是"赛题读歪"唯一的独立防线**——下游所有确定性闸都只核"是否忠于建模者的理解"，核不了"理解本身对不对"，只有你带着题目原文重看才可能发现。发现"任务读歪/目标搞错"属 **fatal**（方向全错，回炉重来）。

⛔ **诚实认知（天花板）**：本复核 AI 与答题同源，有共同盲区，**显著降漏网率但非万无一失**（尤其"任务理解"这类：你也可能和答题时一样误读同一句话）。机器可判的部分已由 logic_audit/cross_problem_check 确定性拦截，本步只兜"确定性查不了的语义残余"。发现存疑处要给出"哪行代码/哪个数/哪句原文"支撑，不做无证据的断言。机器可判的部分已由 logic_audit/cross_problem_check 确定性拦截，本步只兜"确定性查不了的语义残余"。发现存疑处要给出"哪行代码/哪个数"支撑，不做无证据的断言。

## Step 3: 产出首轮问题清单（人读）

```bash
# 先建立审查与修复总账本；后续修复轮次继续追加，不覆盖首轮发现。
cat > COMP_REVIEW.md <<'EOF'
# 逻辑对抗复核报告
（首轮逐条：问题 ID / 问题描述 / 严重性(fatal|major|minor) / 定位(文件:行或数值) / 证据 / 根因 / 修复要求）
EOF
```

首轮和中间轮的机器可读状态只写入 `_tmp/COMP_REVIEW_WORKING_VERDICT.json`，格式为：
```json
{"findings":[
  {"category":"bound_direction|double_count|extrapolation|missing_feature|cross_problem",
   "severity":"fatal|major|minor","where":"calibrate.py:L692 或 Q1峰值","evidence":"...","root_cause":"...","fix":"..."}
],"fatal_count": 0,"major_count": 0,"minor_count": 0,"repair_round": 0}
```

`COMP_REVIEW.md` 必须保留首轮全部发现。不得为了得到零计数删除、降级或掩盖已发现的问题。

## Step 4: 本步骤内闭环修复（fatal/major/minor 全部必修）

从首轮问题清单开始，在 `逻辑对抗复核` 本步骤内持续执行“修复 -> 重新生成受影响产物 -> 从头复核”，不再把问题交给外部回炉步骤：

1. 按问题 ID 逐条修复 `fatal`、`major`、`minor`，三种严重性都是本步骤的必修项。**不得把 major/minor 留到论文写作阶段**，也不得只改描述而不改根因。
2. 修复必须落到真实源产物：建模问题修改 `PROBLEM_ANALYSIS.md` 和 `MODELING_REPORT.md` 及其相关问题分析与模型产物；代码/数据问题修改 `code/` 下源码或配置并重跑，同步 `RESULTS.md`；图表问题修改生成脚本、数据源、HTML/CSS/JS 或 `.drawio` 源文件，然后重新生成图片、表格、HTML 或 DrawIO/TikZ 产物。图表风格继承当前工作流选择，Nature 分支不得降级为普通 `图表生成`。
3. 每一轮修复后重跑受影响的计算、检查、图表生成和 manifest/includes 对账；禁止用手工修改结果数字代替重跑。
4. 在 `COMP_REVIEW.md` 追加“修复轮次 N”：记录已修复问题 ID、改动的源文件、执行命令、重生成产物和验证证据。
5. 基于当前最新产物重新执行 Step 1-2 的完整复核，不得只检查上轮命中项。将新发现追加到账本，更新 `_tmp/COMP_REVIEW_WORKING_VERDICT.json`，然后继续下一轮。
6. 不设“第二次暂停”或固定轮数上限。只要任一计数大于 0，就不得结束本步骤、不得进入论文写作。
注1：修改的时候可以读取对应阶段的skills.md文件（在skills目录文件夹里），图表风格为nature时，注意读取的是nature-figure-skills.md文件，图表风格为普通时，注意读取的是图表生成-skills.md文件。
注2：若重新生成图片，要进行人工目检，确定图片没有重叠缺失、坐标轴标签正确、图例完整、颜色/线型/符号与正文一致。
注3：必须仔细检查是否所有受到影响的图表已重新生成，有时候容易遗漏（有些受到影响的图片有时候没检查到）。
注4：之前受时间限制的代码工作未完成的，本轮代码运行时间不受约束，必须保证所有受影响的代码都已运行完成，且结果已更新到 `RESULTS.md`。
## Step 5: 零问题放行与最终裁定

只有一次全量复核确认 **fatal/major/minor 全部为 0** 后，才能写入最终 `COMP_REVIEW_VERDICT.json`：

```json
{
  "findings": [],
  "resolved_findings": [
    {"id":"R001","original_severity":"fatal|major|minor","changed_sources":["..."],"verification":"..."}
  ],
  "fatal_count": 0,
  "major_count": 0,
  "minor_count": 0,
  "repair_rounds": 1
}
```

最终写入前必须校验 `findings` 为空，三个 count 字段都是数字 0，且 `COMP_REVIEW.md` 有完整的首轮发现和每轮修复证据。禁止在存在未解决问题时伪造全零裁定。

<!-- BEGIN LOCAL MODIFICATION: MOD-SKILL-017 -->
### 本地最高优先级：审查步骤内闭环清零

`逻辑对抗复核` 先把首轮 fatal、major、minor 问题写入 `COMP_REVIEW.md`，然后在本步骤内直接修改建模报告、代码、计算结果、数据图表、HTML 和 DrawIO/TikZ 的真实源产物，重跑受影响计算与生成链后再全量复核。每轮修复及验证证据追加到 `COMP_REVIEW.md`，中间裁定只写 `_tmp/COMP_REVIEW_WORKING_VERDICT.json`。任一 fatal/major/minor 未清零时不得结束本步骤，不得把 major/minor 留到论文写作阶段。只有全量复核确认三类计数都为 0 时，才能写入最终 `COMP_REVIEW_VERDICT.json` 并放行论文写作。
<!-- END LOCAL MODIFICATION: MOD-SKILL-017 -->
