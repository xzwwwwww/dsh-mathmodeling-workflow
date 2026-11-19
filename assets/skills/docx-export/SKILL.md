---
name: docx-export
description: "Use when a workflow must export its completed Markdown deliverable as a validated Word DOCX file."
argument-hint: [source-markdown]
allowed-tools: Bash(*), Read, Grep, Glob
---

# DOCX Export

Export the completed Markdown paper to `paper/main.docx` using the packaged DOCX runtime.

## Runtime Contract

```bash
PYTHON="${MH_PYTHON:-python}"
PRECHECK=""
EXPORTER=""
for f in _utils/docx_precheck.py _utils/docx_precheck.pyc; do [ -f "$f" ] && { PRECHECK="$f"; break; }; done
for f in _utils/docx_export.py _utils/docx_export.pyc; do [ -f "$f" ] && { EXPORTER="$f"; break; }; done
[ -n "$PRECHECK" ] || { echo "Missing DOCX precheck tool"; exit 1; }
[ -n "$EXPORTER" ] || { echo "Missing DOCX export tool"; exit 1; }
```

## Step 1: Resolve Source And Profile

The competition DOCX writing Skills produce `paper/main.md`. Do not export an older root-level draft when this file exists.

```bash
SOURCE="paper/main.md"
[ -f "$SOURCE" ] || { echo "Missing paper/main.md"; exit 1; }
mkdir -p paper

PROFILE="_utils/docx_style_profiles/competition_zh.json"
if grep -qE '^## (Summary Sheet|Problem Restatement|Assumptions|References)' "$SOURCE"; then
  PROFILE="_utils/docx_style_profiles/competition_en.json"
fi
[ -f "$PROFILE" ] || { echo "Missing DOCX profile: $PROFILE"; exit 1; }
echo "DOCX source=$SOURCE profile=$PROFILE"
```

## Step 2: Precheck

Run the deterministic precheck first. Fatal findings must be repaired in `paper/main.md`; rerun until it passes. Keep the report as workflow evidence.

```bash
PYTHON="${MH_PYTHON:-python}"
PRECHECK=""; for f in _utils/docx_precheck.py _utils/docx_precheck.pyc; do [ -f "$f" ] && { PRECHECK="$f"; break; }; done
SOURCE="paper/main.md"
[ -n "$PRECHECK" ] && [ -f "$SOURCE" ] || { echo "DOCX precheck runtime/source missing"; exit 1; }
"$PYTHON" "$PRECHECK" \
  --source "$SOURCE" \
  --workspace . \
  --report DOCX_PRECHECK_REPORT.md \
  --fail-on-fatal
```

## Step 3: Export

Use the packaged exporter. It automatically converts referenced PDF figures to PNG for Word and uses `_template_map.json` plus an uploaded `.docx/.dotx` template when the validated custom-template flow prepared them.

```bash
PYTHON="${MH_PYTHON:-python}"
EXPORTER=""; for f in _utils/docx_export.py _utils/docx_export.pyc; do [ -f "$f" ] && { EXPORTER="$f"; break; }; done
SOURCE="paper/main.md"
PROFILE="_utils/docx_style_profiles/competition_zh.json"
grep -qE '^## (Summary Sheet|Problem Restatement|Assumptions|References)' "$SOURCE" && PROFILE="_utils/docx_style_profiles/competition_en.json"
[ -n "$EXPORTER" ] && [ -f "$SOURCE" ] && [ -f "$PROFILE" ] || { echo "DOCX export runtime/source/profile missing"; exit 1; }
"$PYTHON" "$EXPORTER" \
  --source "$SOURCE" \
  --output paper/main.docx \
  --profile "$PROFILE" \
  --workspace . \
  --engine auto
```

## Step 4: Hard Output Gate

```bash
PYTHON="${MH_PYTHON:-python}"
PASS=true
[ -f DOCX_PRECHECK_REPORT.md ] || { echo "Missing DOCX_PRECHECK_REPORT.md"; PASS=false; }
[ -f paper/main.docx ] && SIZE=$(wc -c < paper/main.docx) || SIZE=0
[ "$SIZE" -ge 10000 ] || { echo "paper/main.docx missing or too small: $SIZE"; PASS=false; }
"$PYTHON" -m zipfile -t paper/main.docx >/dev/null 2>&1 || { echo "paper/main.docx is not a valid DOCX ZIP"; PASS=false; }
[ "$PASS" = true ] || exit 1
echo "DOCX_EXPORT_OK paper/main.docx ($SIZE bytes)"
```

Never finish this step with only Markdown or a precheck report. The required primary output is `paper/main.docx`.

## 本地覆盖规则（最高优先级）

> 本章节由 `docs/LOCAL_SKILL_MODIFICATIONS.md` 恢复。若与前文冲突，以本章节为准。

<!-- BEGIN LOCAL MODIFICATION: MOD-SKILL-015 -->
### 本地最高优先级：竞赛 DOCX 最终导出契约

竞赛 DOCX 工作流必须从 `paper/main.md` 导出 `paper/main.docx`。依次解析 `_utils/docx_precheck.py` 或 `.pyc`、`_utils/docx_export.py` 或 `.pyc`，先用 `--fail-on-fatal` 生成 `DOCX_PRECHECK_REPORT.md`，再按中文或英文赛事 profile 执行导出。结束前必须确认 DOCX 至少 10 KB 且通过 ZIP 完整性检查；只产出 Markdown、预检报告或临时模板试填文件均不算完成。
<!-- END LOCAL MODIFICATION: MOD-SKILL-015 -->
