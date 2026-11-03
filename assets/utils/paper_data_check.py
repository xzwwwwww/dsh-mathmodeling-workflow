# -*- coding: utf-8 -*-
"""论文数据真实性核对（严格模式下，论文写作步骤收尾时运行）。

做三件事：
1. 把 figures/*.json 里的真实数据拍平成可检索的数字清单；
2. 扫论文正文里的「数据性数字」，逐个回到 JSON 里找对应值（允许四舍五入与 0.5% 容差）；
3. 产出两份 md：PAPER_DATA_CHECKLIST.md（数据原料 + 自检步骤）与
   PAPER_DATA_CHECK_REPORT.md（统计 + 结论）。全部对上时写入通过标记。

用法：
    python _utils/paper_data_check.py --mode pdf        # LaTeX（paper/sections/*.tex）
    python _utils/paper_data_check.py --mode docx       # Word/Markdown（paper/main.md）
    python _utils/paper_data_check.py --mode auto --workspace .
退出码：0=通过  1=有对不上的数字（必须修）  2=没找到论文或没有 JSON 数据
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

PASS_MARKER_TEX = "% DATA_CHECK_PASSED"
PASS_MARKER_MD = "<!-- DATA_CHECK_PASSED -->"
CHECKLIST_NAME = "PAPER_DATA_CHECKLIST.md"
REPORT_NAME = "PAPER_DATA_CHECK_REPORT.md"
TOLERANCE = 0.005  # 相对容差（0.5%）


# ---------------------------------------------------------------- 数据侧

def flatten_json(value, prefix="", out=None):
    out = [] if out is None else out
    if isinstance(value, dict):
        for key, item in value.items():
            flatten_json(item, f"{prefix}.{key}" if prefix else str(key), out)
    elif isinstance(value, list):
        for index, item in enumerate(value):
            flatten_json(item, f"{prefix}[{index}]", out)
    elif isinstance(value, bool):
        pass
    elif isinstance(value, (int, float)):
        out.append((prefix, float(value)))
    return out


def collect_json_sources(workspace: Path):
    files = []
    figures = workspace / "figures"
    if figures.is_dir():
        files += sorted(figures.glob("*.json"))
    for name in ("results.json", "all_results.json"):
        candidate = workspace / name
        if candidate.is_file():
            files.append(candidate)
    entries = []
    for path in files:
        try:
            data = json.loads(path.read_text(encoding="utf-8", errors="replace"))
        except Exception:
            continue
        rel = path.relative_to(workspace).as_posix()
        for key, value in flatten_json(data):
            entries.append((rel, key, value))
    return files, entries


# ---------------------------------------------------------------- 论文侧

def paper_files(workspace: Path, mode: str):
    paper = workspace / "paper"
    if mode == "docx":
        target = paper / "main.md"
        return [target] if target.is_file() else []
    sections = paper / "sections"
    files = sorted(sections.glob("*.tex")) if sections.is_dir() else []
    if files:
        return files
    fallback = paper / "main.md"
    return [fallback] if fallback.is_file() else []


def strip_non_data(text: str, mode: str) -> str:
    text = re.sub(r"(?s)```.*?```", " ", text)                 # 代码块
    text = re.sub(r"(?s)<!--.*?-->", " ", text)                 # HTML 注释
    text = re.sub(r"(?s)\$\$.*?\$\$", " ", text)                # 独立公式
    text = re.sub(r"(?s)\$[^$\n]{1,200}\$", " ", text)          # 行内公式
    text = re.sub(r"(?s)\\\(.*?\\\)", " ", text)
    text = re.sub(r"(?s)\\\[.*?\\\]", " ", text)
    text = re.sub(r"(?s)\\begin\{(equation|align|eqnarray|gather)\*?\}.*?\\end\{\1\*?\}", " ", text)
    if mode == "pdf":
        text = re.sub(r"(?m)(?<!\\)%.*$", " ", text)            # LaTeX 注释
    else:
        text = re.sub(r"(?m)^\s{0,3}#{1,6}\s.*$", " ", text)    # Markdown 标题行
    text = re.sub(r"\\(?:label|ref|eqref|cite|citep|citet)\{[^}]*\}", " ", text)
    return text


NUMBER_RE = re.compile(r"(?<![\w.])-?\d+(?:\.\d+)?(?![\w.])")
SKIP_PREFIX = ("图", "表", "式", "第", "附录", "节", "章", "年", "月", "日", "页", "[", "(", "（", "【")
SKIP_SUFFIX = ("页", "年", "月", "日", "章", "节", "图", "表", "式", "个", "条", "次", "步", "维")


def extract_numbers(text: str):
    """返回 [(原始串, 浮点值, 上下文, 小数位, 是否百分数)]，已过滤编号/年份/章节号。"""
    found = []
    for match in NUMBER_RE.finditer(text):
        raw = match.group(0)
        start, end = match.span()
        before = text[max(0, start - 6):start].rstrip()
        after = text[end:end + 4]
        if before and before[-1] in SKIP_PREFIX:
            continue
        if after[:1] in SKIP_SUFFIX:
            continue
        if re.fullmatch(r"(19|20)\d{2}", raw):                   # 年份
            continue
        if raw.lstrip("-").startswith("0") and len(raw) > 1 and "." not in raw:
            continue
        percent = after.startswith("%") or after.startswith("\\%")
        try:
            value = float(raw)
        except ValueError:
            continue
        decimals = len(raw.split(".")[1]) if "." in raw else 0
        found.append((raw, value, (before[-12:] + raw + after[:12]).replace("\n", " "), decimals, percent))
    return found


def matches(number: float, decimals: int, percent: bool, entries) -> bool:
    """同尺度四舍五入容差 + 0.5% 相对容差；百分数按 /100 后再比。"""
    half = 0.5 * (10 ** -decimals)
    target = number / 100.0 if percent else number
    half = half / 100.0 if percent else half
    for _, _, data_value in entries:
        if abs(target - data_value) <= max(half, TOLERANCE * abs(data_value)):
            return True
        # JSON 存百分数（94.1）而论文写小数（0.941）
        if not percent and abs(number - data_value / 100.0) <= max(half, TOLERANCE * abs(data_value / 100.0)):
            return True
        # JSON 存小数（0.9412）而论文写百分数但漏了 % 号
        if not percent and abs(number / 100.0 - data_value) <= max(half / 100.0, TOLERANCE * abs(data_value)):
            return True
    return False


# ---------------------------------------------------------------- 产出

def write_checklist(workspace: Path, mode: str, sources, entries, pending):
    lines = [
        "# 论文数据真实性核对清单（数据原料）",
        "",
        f"**模式**: {mode.upper()}",
        "**JSON 源**: " + (", ".join(p.name for p in sources) or "（无）"),
        f"**JSON 数据条目**: {len(entries)}",
        "",
        "---",
        "",
        "## 自检步骤",
        "",
        "1. 打开论文源文件（LaTeX 看 `paper/sections/*.tex`，Word 看 `paper/main.md`）。",
        "2. 只核对「数据性数字」：表格单元格、正文里引用实验结果/统计量/最优解/对比指标的数字。",
        "3. 编号（图 3、表 2、式 5）、年份、日期、章节序号、公式内常数、文献里的数字都不必核对。",
        "4. 每个数据性数字都必须能在下面 JSON 清单或 `figures/TABLE_*` 里找到来源；找不到就改数或改表述。",
        "5. 修完重新跑本脚本，直到报告给出「通过」。",
        "",
        "---",
        "",
        "## JSON 数据清单",
        "",
        "| 来源 | 字段路径 | 值 |",
        "|---|---|---|",
    ]
    for source, key, value in entries[:500]:
        lines.append(f"| {source} | `{key}` | {value:g} |")
    if len(entries) > 500:
        lines.append(f"| … | 另有 {len(entries) - 500} 条，用 `python -c` 或 grep 查 | — |")
    lines += ["", "---", "", "## 未对上 JSON 的数字（必须处理）", ""]
    if not pending:
        lines.append("（无）")
    else:
        lines += ["| 文件 | 行 | 数字 | 上下文 |", "|---|---|---|---|"]
        for item in pending[:200]:
            lines.append(f"| {item['file']} | {item['line']} | {item['raw']} | {item['context']} |")
    (workspace / CHECKLIST_NAME).write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_report(workspace: Path, mode: str, sources, entries, numbers, pending):
    passed = not pending
    lines = [
        "# 论文数据真实性核对报告",
        "",
        f"**模式**: {mode.upper()}",
        "**核对源**: " + (", ".join(p.name for p in sources) or "（未找到论文文件）"),
        "",
        "## 统计",
        "",
        f"- JSON 源文件: {len(sources)}",
        f"- JSON 数据条目: {len(entries)}",
        f"- 论文数据性数字: {numbers}",
        f"- 未对上: {len(pending)}",
        "",
        "## 结论",
        "",
        ("通过：论文里的数据性数字都能在 JSON 找到来源。" if passed else
         f"未通过：有 {len(pending)} 个数字对不上 JSON，必须修改论文后重跑本脚本。"),
        "",
    ]
    if pending:
        lines += ["## 待修列表", "", "| 文件 | 行 | 数字 | 上下文 |", "|---|---|---|---|"]
        for item in pending[:200]:
            lines.append(f"| {item['file']} | {item['line']} | {item['raw']} | {item['context']} |")
        lines.append("")
    (workspace / REPORT_NAME).write_text("\n".join(lines) + "\n", encoding="utf-8")
    return passed


def stamp_pass(workspace: Path, mode: str) -> None:
    paper = workspace / "paper"
    if mode == "docx":
        target, marker = paper / "main.md", PASS_MARKER_MD
    else:
        target, marker = paper / "main.tex", PASS_MARKER_TEX
    if not target.is_file():
        return
    text = target.read_text(encoding="utf-8", errors="replace")
    if marker in text:
        return
    target.write_text(text.rstrip() + "\n\n" + marker + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="论文数据真实性核对")
    parser.add_argument("--mode", choices=["pdf", "docx", "auto"], default="auto")
    parser.add_argument("--workspace", default=".")
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args()

    workspace = Path(args.workspace).resolve()
    mode = args.mode
    if mode == "auto":
        mode = "docx" if (workspace / "paper" / "main.md").is_file() and not (
            workspace / "paper" / "sections").is_dir() else "pdf"

    sources = paper_files(workspace, mode)
    if not sources:
        print(f"[paper_data_check] 没找到论文文件（mode={mode}，workspace={workspace}）")
        return 2

    json_files, entries = collect_json_sources(workspace)
    if not entries:
        print("[paper_data_check] figures/*.json 里没有数值数据，无法核对（请确认图表步已产出结果 JSON）")
        return 2

    numbers, pending = 0, []
    for path in sources:
        text = strip_non_data(path.read_text(encoding="utf-8", errors="replace"), mode)
        for raw, value, context, decimals, percent in extract_numbers(text):
            numbers += 1
            if not matches(value, decimals, percent, entries):
                line = text[:0]  # 行号在原文里找
                original = path.read_text(encoding="utf-8", errors="replace")
                line_no = original.find(raw)
                line_no = original[:line_no].count("\n") + 1 if line_no >= 0 else 0
                pending.append({
                    "file": path.relative_to(workspace).as_posix(),
                    "line": line_no,
                    "raw": raw,
                    "context": context.replace("\n", " ")[:60],
                })

    passed = write_report(workspace, mode, sources, entries, numbers, pending)
    write_checklist(workspace, mode, sources, entries, pending)
    if passed:
        stamp_pass(workspace, mode)

    if not args.quiet:
        print(f"[paper_data_check] mode={mode} 源文件={len(sources)} JSON条目={len(entries)} "
              f"论文数字={numbers} 未对上={len(pending)}")
        print(f"[paper_data_check] 清单: {CHECKLIST_NAME}")
        print(f"[paper_data_check] 报告: {REPORT_NAME}")
        print("[paper_data_check] 结论: " + ("通过" if passed else "未通过（按清单修复后重跑）"))
        for item in pending[:15]:
            print(f"  ✗ {item['file']}:{item['line']} {item['raw']}  ←  {item['context']}")
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
