# -*- coding: utf-8 -*-
"""论文数据真实性核对（严格模式下，论文写作步骤收尾时运行）。

做三件事：
1. 把 figures/**/*.json 和根目录结果 JSON 的真实数据拍平成可检索的数字清单；
2. 扫论文正文里的「数据性数字」，逐个回到 JSON 里找对应值（允许四舍五入与 0.5% 容差）；
3. 产出两份 md：PAPER_DATA_CHECKLIST.md（数据原料 + 自检步骤）与
   PAPER_DATA_CHECK_REPORT.md（统计 + 结论），以及绑定输入快照的 PAPER_DATA_CHECK_RESULT.json。
   每次重跑先撤销旧通过证据，全部对上后写入通过标记并计算最终快照。

用法：
    python _utils/paper_data_check.py --mode pdf        # LaTeX（main.tex 实际正文引用链）
    python _utils/paper_data_check.py --mode docx       # Word/Markdown（paper/main.md）
    python _utils/paper_data_check.py --mode auto --workspace .
退出码：0=通过  1=有对不上的数字（必须修）  2=没找到论文或没有 JSON 数据
"""
from __future__ import annotations

from collections import defaultdict
import argparse
import hashlib
import json
import math
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
RESULT_NAME = "PAPER_DATA_CHECK_RESULT.json"
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
    elif isinstance(value, (int, float)) and math.isfinite(value):
        out.append((prefix, float(value)))
    return out


def collect_json_sources(workspace: Path):
    files = []
    figures = workspace / "figures"
    if figures.is_dir():
        files += sorted(p for p in figures.rglob("*.json")
                        if not p.name.startswith("TABLE_DATA_CHECK_"))
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

# 正文文件：排除附录代码/AI 声明/参考文献/临时章节（与 gatePages 的正文口径一致）。
# 英文模板会把代码放在 sections/A_code.tex、AI 声明放 sections/Z_ai_disclosure.tex，
# 这些文件里的大量数字（索引、常量、日期）不是论文引用数据，不能参与核对。
# 摘要（0_*）保留：摘要里的结果数字也必须与 results.json 一致。
NON_BODY_SECTION_RE = re.compile(
    r"^(?:(?:[abz]_)?(?:appendix|appendices|references?(?:[_.]|$)|code(?:[_.]|$)|"
    r"ai_(?:disclosure|detail))|current_chapter)", re.IGNORECASE)


def strip_tex_comments(text: str) -> str:
    # A percent is escaped only by an odd run of backslashes (\\\\% starts a comment).
    lines = []
    for line in text.splitlines(keepends=True):
        for match in re.finditer(r"(\\*)%", line):
            if len(match[1]) % 2 == 0:
                ending = "\n" if line.endswith("\n") else ""
                line = line[:match.start() + len(match[1])] + ending
                break
        lines.append(line)
    return "".join(lines)


INPUT_RE = re.compile(r"\\(?P<command>input|include)(?![A-Za-z@])\s*(?:\{(?P<braced>[^}]+)\}|(?P<bare>[^\s{}%]+))")
NON_BODY_HEADING_RE = re.compile(
    r"\\(?:section|chapter)\*?(?:\[[^]]*\])?\s*\{\s*(?:参考文献|附录|"
    r"代码(?:清单|附录)?|AI\s*(?:工具|使用|声明)|人工智能|references?\b|bibliography\b|"
    r"appendix\b|appendices\b|code\s+(?:listing|appendix)|AI\s+(?:use|usage|disclosure)\b)", re.I)


def _tex_clean(text: str, comments=True) -> str:
    """One lexical pass: comments cannot open code, code cannot open inputs or comments."""
    out, pos = [], 0
    while pos < len(text):
        if text[pos] == "%" and comments:
            end = text.find("\n", pos)
            pos = len(text) if end < 0 else end
            continue
        if text[pos] != "\\":
            out.append(text[pos])
            pos += 1
            continue
        block = re.match(r"\\begin\s*\{(verbatim\*?|lstlisting|minted|comment)\}", text[pos:])
        if block:
            end = re.search(r"\\end\s*\{" + re.escape(block[1]) + r"\}", text[pos + block.end():])
            stop = len(text) if end is None else pos + block.end() + end.end()
            out.append(" " + "\n" * text[pos:stop].count("\n"))
            pos = stop
            continue
        inline = re.match(r"\\(?:verb\*?|lstinline)(?![A-Za-z@])(?:\[[^]]*\])?\s*", text[pos:])
        if inline and pos + inline.end() < len(text):
            start = pos + inline.end()
            delimiter = text[start]
            stop = start + 1
            if delimiter == "{":
                depth = 1
                while stop < len(text) and depth:
                    if text[stop] == "\\":
                        stop += 2
                        continue
                    depth += (text[stop] == "{") - (text[stop] == "}")
                    stop += 1
            else:
                end = text.find(delimiter, stop)
                newline = text.find("\n", stop)
                stop = (end + 1) if end >= 0 and (newline < 0 or end < newline) else (newline if newline >= 0 else len(text))
            out.append(" " + "\n" * text[pos:stop].count("\n"))
            pos = stop
            continue
        # Escaped percent and doubled backslash are consumed as pairs, preserving parity.
        out.append(text[pos:pos + 2])
        pos += 2
    return "".join(out)


def _without_code(text: str) -> str:
    text = re.sub(r"(?s)```.*?```|<!--.*?-->", " ", text)
    return _tex_clean(text, comments=False)


def _tex_source(path):
    return _without_code(_tex_clean(path.read_text(encoding="utf-8")))


def _include_only(text):
    match = re.search(r"\\includeonly\s*\{([^}]*)\}", text)
    return {name.strip().removesuffix(".tex") for name in match[1].split(",")} if match else None


def _input_name(match):
    return (match["braced"] or match["bare"]).strip()


def _input_target(workspace, name):
    if re.search(r"[\\#$]", name):
        raise ValueError(f"无法解析 TeX input: {name}")
    rel = Path(name)
    if not rel.suffix:
        rel = rel.with_suffix(".tex")
    target = (workspace / "paper" / rel).resolve()
    if not target.is_relative_to(workspace):
        raise ValueError(f"TeX input 超出 workspace: {name}")
    return target


def tex_input_paths(workspace):
    """All literal compiler-reachable inputs, including non-body files, for freshness binding."""
    main = workspace / "paper" / "main.tex"
    if not main.is_file():
        return {}
    sources, ancestors = {}, set()
    include_only = _include_only(_tex_source(main))
    ended = False

    def visit(path):
        nonlocal ended
        if path in ancestors:
            raise ValueError(f"TeX input 循环: {path.relative_to(workspace).as_posix()}")
        if ended:
            return
        text = _tex_source(path)
        sources[path] = text
        ancestors.add(path)
        end = re.search(r"\\end\s*\{document\}", text)
        body = text[:end.start()] if end else text
        for match in INPUT_RE.finditer(body):
            if ended:
                break
            name = _input_name(match)
            if match["command"] == "include" and include_only is not None and name.removesuffix(".tex") not in include_only:
                continue
            visit(_input_target(workspace, name))
        ancestors.remove(path)
        ended = ended or end is not None

    visit(main.resolve())
    return sources


def _body_prefix(text: str) -> str:
    stops = [m.start() for pattern in (
        r"\\appendix\b", r"\\end\s*\{document\}", r"\\begin\s*\{(?:thebibliography|appendices|appendix|appendixx)\}",
        r"\\(?:bibliography|printbibliography)\b") for m in re.finditer(pattern, text)]
    heading = NON_BODY_HEADING_RE.search(text)
    if heading:
        stops.append(heading.start())
    return text[:min(stops)] if stops else text


def collect_paper_texts(workspace: Path, mode: str):
    """Read reachable body inputs, including external TABLE files; never sweep drafts for a real main.

    Legacy workspaces without a usable main may still keep only sections/*.tex.
    Missing reachable inputs are errors: a partial input graph cannot certify the paper.
    """
    paper = workspace / "paper"
    md = paper / "main.md"
    if mode == "docx":
        return [(md, md.read_text(encoding="utf-8"))] if md.is_file() else []
    main = paper / "main.tex"
    graph = tex_input_paths(workspace)
    raw = graph.get(main.resolve(), "")
    include_only = _include_only(raw)
    usable = bool(re.search(r"\\begin\s*\{document\}|\\(?:input|include)\b|\\(?:section|chapter)\b", raw))
    chunks, visited = [], set()
    ended = False

    def visit(path, root=False):
        nonlocal ended
        path = path.resolve()
        if not path.is_relative_to(workspace):
            raise ValueError(f"TeX input 超出 workspace: {path}")
        excluded_dir = any(part.lower() in {"appendix", "appendices"}
                           for part in path.relative_to(workspace).parts[:-1])
        if ended or path in visited or NON_BODY_SECTION_RE.match(path.name) or excluded_dir:
            return
        visited.add(path)
        text = graph[path] if path in graph else _tex_source(path)
        begin = re.search(r"\\begin\s*\{document\}", text)
        if root and begin:
            text = text[begin.end():]
        body = _body_prefix(text)
        truncated = len(body) < len(text)
        position = 0
        for match in INPUT_RE.finditer(body):
            if ended:
                break
            chunks.append((path, body[position:match.start()]))
            name = _input_name(match)
            if match["command"] == "include" and include_only is not None and name.removesuffix(".tex") not in include_only:
                position = match.end()
                continue
            visit(_input_target(workspace, name))
            position = match.end()
        if not ended:
            chunks.append((path, body[position:]))
        ended = ended or truncated

    if usable:
        visit(main, root=True)
    else:
        sections = paper / "sections"
        for path in sorted(sections.rglob("*.tex")) if sections.is_dir() else []:
            # Legacy files are independent sections; one appendix must not hide another body file.
            ended = False
            visit(path)
        if not chunks and md.is_file():
            chunks.append((md, md.read_text(encoding="utf-8")))
    return chunks


def paper_files(workspace: Path, mode: str):
    return list(dict.fromkeys(path for path, _ in collect_paper_texts(workspace.resolve(), mode)))


def _math_data(match):
    """Keep displayed numeric results, but not symbolic formula coefficients/subscripts/tags."""
    text = match[1]
    text = re.sub(r"\\(?:label|tag)\*?\{[^}]*\}", " ", text)
    # Percentages are data even inside a larger math expression.
    percentages = re.findall(r"[-+]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][-+]?\d+)?\s*\\?%", text)
    if percentages:
        return " " + " ".join(p.replace(" ", "") for p in percentages) + " "
    text = re.sub(r"\\(?:text|textrm|mathrm|mathbf|operatorname)\{([^{}]*)\}", r"\1", text)
    text = re.sub(r"\\(?:left|right|quad|qquad|displaystyle)\b|\\[,;! ]", " ", text).strip()
    # Pure numerical values, lists and uncertainty intervals are results, not symbolic formulae.
    number = r"[-+]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][-+]?\d+)?"
    numeric = rf"{number}(?:\s*(?:,|;|\\pm|±)\s*{number})*"
    if re.fullmatch(numeric, text):
        return " " + text + " "
    # An explicit numeric RHS is a reported result; conventional index/indicator definitions 0/1
    # and symbolic expressions such as y=2*x+1 remain filtered.
    assignment = re.fullmatch(rf"(.+?)\s*(?:=|\\approx|\\simeq)\s*({numeric})", text)
    if assignment and not re.search(r"\\(?:sum|prod|int|frac)\b", assignment[1]):
        if assignment[2].strip() not in {"0", "1", "-1"}:
            lhs = re.sub(r"[_^]\{[^}]*\}|[_^][A-Za-z0-9]", "", assignment[1])
            context = match.string[max(0, match.start() - 80):match.start()]
            context = re.split(r"[。;；]|\.\s|\n\s*\n", context)[-1]
            symbolic = re.fullmatch(r"[A-Za-z]|\\[A-Za-z]+", lhs.strip())
            empirical = METRIC_RE.search(lhs + " " + context) or re.search(
                r"result|achiev|obtain|estimat|measur|optima|optimum|objective|outcome|"
                r"结果|最优|测得|估计|实验|求得|得到", context, re.I)
            if not symbolic or empirical:
                return " " + re.sub(r"\d+", "", lhs) + " = " + assignment[2] + " "
    return " "


def strip_non_data(text: str, mode: str) -> str:
    if mode == "pdf":
        text = _tex_clean(text)
    text = _body_prefix(_without_code(text))
    text = re.sub(r"(?s)\\begin\{(?:equation|align|eqnarray|gather)\*?\}(.*?)\\end\{(?:equation|align|eqnarray|gather)\*?\}", _math_data, text)
    for pattern in (r"(?s)\$\$(.*?)\$\$", r"(?s)(?<!\\)\$(.*?)(?<!\\)\$",
                    r"(?s)\\\((.*?)\\\)", r"(?s)\\\[(.*?)\\\]"):
        text = re.sub(pattern, _math_data, text)
    if mode != "pdf":
        text = re.sub(r"(?m)^\s{0,3}#{1,6}\s.*$", " ", text)
    text = re.sub(r"\\(?:label|(?:auto|eq|c|C)?ref|cite\w*|tag)\*?(?:\[[^]]*\])*\{[^}]*\}", " ", text)
    text = re.sub(r"\\(?:input|include|includegraphics|documentclass|usepackage|setlength|hspace|vspace)\*?(?:\[[^]]*\])*\{[^}]*\}", " ", text)
    text = re.sub(r"\\(?:section|subsection|subsubsection|chapter)\*?(?:\[[^]]*\])?\{([^}]*)\}",
                  lambda m: " " + re.sub(r"^\s*\d+(?:\.\d+)*[.)、]?\s+", "", m[1]) + " ", text)
    text = re.sub(r"\\title(?:\[[^]]*\])?\{[^}]*\}", " ", text)
    text = re.sub(r"\\(?:begin|end)\{[^}]*\}(?:\[[^]]*\])?(?:\{[^}]*\})?", " ", text)
    text = re.sub(r"\\item\s*\[[^]]*\]", " ", text)
    return text


NUMBER_RE = re.compile(r"(?<![A-Za-z0-9_.])[-+]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][-+]?\d+)?(?![A-Za-z0-9_]|\.\d)")
SKIP_PREFIX = ("图", "表", "式", "第", "附录", "节", "章", "年", "月", "日", "页", "[", "(", "（", "【")
SKIP_SUFFIX = ("页", "年", "月", "日", "章", "节", "图", "表", "式", "个", "条", "次", "步", "维")
# 英文论文里的编号类前缀（Figure 3 / Table 2 / Section 4 / [12] 等），不当作数据
EN_SKIP_PREFIX = {
    "figure", "fig", "figs", "table", "tab", "eq", "equation", "equations", "section", "sec",
    "chapter", "ch", "appendix", "step", "ref", "reference", "references", "year", "page", "no",
    "number", "problem", "question", "model", "subproblem", "algorithm", "assumption", "lemma",
    "theorem", "proof", "example", "remark", "footnote", "item", "part", "phase", "stage",
}
# 数量声明后缀（3 sub-problems / 5 figures / 9 tables…），不是论文引用数据
EN_SKIP_SUFFIX = {
    "subproblem", "subproblems", "sub-problem", "sub-problems", "problem", "problems",
    "question", "questions", "model", "models", "step", "steps", "figure", "figures",
    "table", "tables", "section", "sections", "equation", "equations", "appendix",
    "reference", "references", "page", "pages", "year", "years", "chapter", "chapters",
}


# 将正文的局部量纲和 JSON 叶子字段对齐；未标注的值只可做同尺度核对。
METRIC_RE = re.compile(
    r"(?P<money>成本|费用|金额|价格|收入|利润|预算|美元|元|(?<![a-z])(?:costs?|prices?|revenue|profit|budget|dollars?|yuan|rmb|cny|usd)(?![a-z]))|"
    r"(?P<duration>耗时|时长|小时|分钟|秒|(?<![a-z])(?:duration|hours?|minutes?|seconds?|elapsed)(?![a-z]))|"
    r"(?P<distance>距离|里程|千米|公里|(?<![a-z])(?:distance|mileage|kilomet(?:er|re)s?|km)(?![a-z]))|"
    r"(?P<count>人数|数量|人次|(?<![a-z])(?:headcount|persons?|people|count)(?![a-z]))|"
    r"(?P<ratio>准确率|精确率|召回率|覆盖率|概率|比例|占比|百分比|百分率|(?<![a-z])"
    r"(?:accuracy|precision|recall|coverage|probability|prob|percent(?:age)?|ratio|rate|share|auc|f1(?:_score)?|pct)(?![a-z]))",
    re.I,
)


def claim_metric(before, after, percent):
    if percent:
        return "ratio"
    # 优先匹配紧随数字的单位，再看同一短句、上一个数字之后最近的指标。
    unit = re.match(r"^\s*(?:万|亿)?(美元|元|小时|分钟|秒|公里|千米|人次|人)", after)
    if unit:
        return {"人": "count", "人次": "count"}.get(unit[1]) or METRIC_RE.search(unit[1]).lastgroup
    english_unit = METRIC_RE.match(after.lstrip())
    if english_unit:
        return english_unit.lastgroup
    clause = re.split(r"[,，。;；%]", before)[-1]
    hints = list(METRIC_RE.finditer(clause))
    return hints[-1].lastgroup if hints else None


def extract_numbers(text: str):
    """返回 [(原始串, 浮点值, 上下文, 小数位, 是否百分数, 指标量纲)]，已过滤编号/年份/章节号（中英文都覆盖）。"""
    found = []
    for match in NUMBER_RE.finditer(text):
        raw = match.group(0)
        start, end = match.span()
        before = text[max(0, start - 24):start].rstrip()
        after = text[end:end + 32]
        if before and before[-1] in SKIP_PREFIX:
            continue
        # 英文编号前缀：Figure 3 / Table~2 / Section 4 / Eq.(5)
        word = re.search(r"([A-Za-z]+)\.?$", before.replace("~", " ").replace("(", " ").rstrip())
        if word and word.group(1).lower() in EN_SKIP_PREFIX:
            continue
        # 英文数量声明：数字后面紧跟 sub-problems / figures / tables 等（不是结果数据）
        tail = re.match(r"\s*([A-Za-z-]+)", text[end:end + 30])
        if tail and tail.group(1).lower() in EN_SKIP_SUFFIX:
            continue
        if re.match(r"\s*[张个只条次步维页年月日章节图表式]", after):
            continue
        if re.match(r"(?i)(st|nd|rd|th)\b", after):              # 1st / 2nd / 3rd / 4th
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
        if not math.isfinite(value):
            continue
        mantissa, _, exponent = raw.lower().partition("e")
        decimals = (len(mantissa.split(".")[1]) if "." in mantissa else 0) - int(exponent or 0)
        found.append((raw, value, (before[-12:] + raw + after[:12]).replace("\n", " "), decimals, percent, claim_metric(before, after, percent)))
    return found


def index_values(entries):
    groups = defaultdict(list)
    for _, key, value in entries:
        leaf = re.sub(r"\[.*$", "", str(key).split(".")[-1])
        kinds = [m.lastgroup for m in METRIC_RE.finditer(leaf)]
        kind = "ratio" if "ratio" in kinds else (kinds[-1] if kinds else None)
        groups[kind].append(value)
        groups["all"].append(value)
    return groups


def matches(number, decimals, percent, groups, metric):
    # 有同量纲字段时只用这些字段；旧结果中未标注量纲的值仅作为同尺度兜底。
    values = groups.get(metric, []) if metric else groups["all"]
    known_metric = bool(metric and values)
    if metric and not values:
        values = groups.get(None, [])
    half = 0.5 * 10 ** -decimals
    for value in values:
        if abs(number - value) <= max(half, TOLERANCE * abs(value)):
            return True
        if percent or (metric == "ratio" and known_metric):
            if abs(number / 100 - value) <= max(half / 100, TOLERANCE * abs(value)):
                return True
            if not percent and abs(number - value / 100) <= max(half, TOLERANCE * abs(value / 100)):
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
        "1. 打开论文源文件（LaTeX 沿 `paper/main.tex` 的正文引用链核对，含外置表格；Word 看 `paper/main.md`）。",
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
    if numbers == 0:
        passed = False
        conclusion = (
            "未通过：正文没有提取到任何数据性数字，无法核对数据真实性。"
            "必须在正文/表格里引用 figures/*.json 的结果数据后重跑本脚本。"
        )
    elif pending:
        passed = False
        conclusion = f"未通过：有 {len(pending)} 个数字对不上 JSON，必须修改论文后重跑本脚本。"
    else:
        passed = True
        conclusion = "通过：论文里的数据性数字都能在 JSON 找到来源。"
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
        conclusion,
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


def input_snapshot(workspace: Path):
    """Contract shared with the JS gate: all candidate inputs, including unreferenced drafts.

    The *check* follows the actual input graph; its evidence expires on any candidate input change.
    Hash raw bytes and sort POSIX workspace-relative paths, never locale-dependent filesystem order.
    """
    paths = set()
    paper, figures = workspace / "paper", workspace / "figures"
    if paper.is_dir():
        paths.update(p for p in paper.rglob("*") if p.is_file() and not p.is_symlink()
                     and (p.suffix == ".tex" or p.relative_to(workspace).as_posix() == "paper/main.md"))
    if figures.is_dir():
        paths.update(p for p in figures.rglob("*") if p.is_file() and not p.is_symlink()
                     and p.suffix in {".json", ".tex", ".md"}
                     and not p.name.startswith("TABLE_DATA_CHECK_"))
    paths.update(workspace / name for name in ("results.json", "all_results.json")
                 if (workspace / name).is_file())
    paths.update(tex_input_paths(workspace))
    return [{"path": p.relative_to(workspace).as_posix(),
             "sha256": hashlib.sha256(p.read_bytes()).hexdigest()}
            for p in sorted(paths, key=lambda p: p.relative_to(workspace).as_posix().encode("utf-16-be", "surrogatepass"))]


def write_result(workspace, mode, status, *, reason="", inputs=None, **stats):
    result = {"version": 1, "status": status, "mode": mode,
              "inputs": [] if inputs is None else inputs, "reason": reason, **stats}
    (workspace / RESULT_NAME).write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def revoke_pass(workspace, mode):
    # Revoke the machine-readable certificate first, including when cleanup itself fails.
    write_result(workspace, mode, "unavailable", reason="检查正在进行，旧通过证据已失效")
    for name in (CHECKLIST_NAME, REPORT_NAME):
        (workspace / name).unlink(missing_ok=True)
    paper = workspace / "paper"
    targets = list(paper.rglob("*.tex")) if paper.is_dir() else []
    if (paper / "main.md").is_file():
        targets.append(paper / "main.md")
    for path in targets:
        # Cleanup must still revoke ASCII markers in a malformed UTF-8 input.
        raw = path.read_bytes()
        cleaned = raw.replace(PASS_MARKER_TEX.encode(), b"").replace(PASS_MARKER_MD.encode(), b"")
        if cleaned != raw:
            path.write_bytes(cleaned)


def write_unavailable(workspace, mode, reason, status="unavailable"):
    # Every early return replaces both human reports as well as the JSON certificate.
    for name, title in ((CHECKLIST_NAME, "论文数据真实性核对清单"), (REPORT_NAME, "论文数据真实性核对报告")):
        (workspace / name).write_text(f"# {title}\n\n模式: {mode}\n\n未通过：{reason}\n", encoding="utf-8")
    write_result(workspace, mode, status, reason=reason)


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

    try:
        revoke_pass(workspace, mode)
        chunks = collect_paper_texts(workspace, mode)
        sources = list(dict.fromkeys(path for path, _ in chunks))
        if not sources:
            reason = f"没找到论文文件（mode={mode}）"
            write_unavailable(workspace, mode, reason)
            print(f"[paper_data_check] {reason}")
            return 2

        json_files, entries = collect_json_sources(workspace)
        if not entries:
            reason = "结果 JSON 里没有数值数据，无法核对（请确认图表步已产出结果 JSON）"
            write_unavailable(workspace, mode, reason)
            print(f"[paper_data_check] {reason}")
            return 2

        groups = index_values(entries)
        numbers, pending = 0, []
        for path, chunk in chunks:
            text = strip_non_data(chunk, "docx" if path.suffix == ".md" else mode)
            for raw, value, context, decimals, percent, metric in extract_numbers(text):
                numbers += 1
                if not matches(value, decimals, percent, groups, metric):
                    original = path.read_text(encoding="utf-8")
                    offset = original.find(raw)
                    line_no = original[:offset].count("\n") + 1 if offset >= 0 else 0
                    pending.append({
                        "file": path.relative_to(workspace).as_posix(),
                        "line": line_no, "raw": raw,
                        "context": context.replace("\n", " ")[:60],
                    })

        passed = write_report(workspace, mode, json_files, entries, numbers, pending)
        write_checklist(workspace, mode, json_files, entries, pending)
        if passed:
            stamp_pass(workspace, mode)
        # Stamping main mutates an input, so take the final snapshot afterwards.
        write_result(workspace, mode, "passed" if passed else "failed", inputs=input_snapshot(workspace),
                     checked_values=numbers, unmatched=len(pending), json_sources=len(json_files))
    except (OSError, UnicodeError, ValueError, RecursionError, OverflowError) as exc:
        # Parsing/read failures must never leave an earlier success observable to a gate.
        try:
            revoke_pass(workspace, mode)
        except OSError:
            pass
        try:
            write_unavailable(workspace, mode, f"检查无法完成：{exc}")
        except OSError:
            # A read-only/unavailable workspace cannot be repaired by this helper.
            pass
        print(f"[paper_data_check] 检查无法完成：{exc}")
        return 2

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
