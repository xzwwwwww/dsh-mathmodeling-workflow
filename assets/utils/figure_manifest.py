#!/usr/bin/env python3
"""Merge every upstream FIGURE_MANIFEST for downstream figure skills."""
from __future__ import annotations

import argparse
import re
from collections import OrderedDict
from pathlib import Path


BLOCK_RE = re.compile(
    r"<!-- BEGIN FIGURE_MANIFEST -->(.*?)<!-- END FIGURE_MANIFEST -->",
    re.DOTALL,
)
ITEM_RE = re.compile(
    r"^\s*(?:-\s*)?(?:\[[ xX]\]\s*)?((?:fig_|tikz_|TABLE_)[A-Za-z0-9_]+)(.*)$"
)
TABLE_ROW_RE = re.compile(
    r"^\s*\|\s*(TABLE_[A-Za-z0-9_]+)(.*\|\s*)$"
)


def _stage_priority(path: Path) -> int:
    """Keep common workflow stages deterministic while accepting other plans."""
    name = path.stem.lower()
    if "problem" in name or "analysis" in name:
        return 10
    if "topic" in name:
        return 20
    if "plan" in name or "proposal" in name or "outline" in name:
        return 30
    if "model" in name or "result" in name:
        return 40
    return 25


def manifest_sources(workspace: Path) -> list[Path]:
    """Discover all root-level planning documents that define a manifest."""
    candidates = []
    for source in workspace.glob("*.md"):
        text = source.read_text(encoding="utf-8", errors="replace")
        if BLOCK_RE.search(text):
            candidates.append(source)
    return sorted(
        candidates,
        key=lambda source: (_stage_priority(source), source.stat().st_mtime_ns, source.name.lower()),
    )


def _category(heading: str) -> str:
    value = heading.lower()
    if "tikz" in value:
        return "TIKZ"
    # A data-figure heading may list HTML as an optional output format.
    # Classify by the semantic heading before inspecting that suffix.
    if re.search(r"数据图|data\s*(?:figure|plot|chart)s?", heading, re.IGNORECASE):
        return "DATA"
    if "drawio" in value or "html" in value:
        return "DRAWIO"
    if "gpt" in value or "场景" in heading:
        return "GPTIMG"
    if "table" in value or "表格" in heading:
        return "TABLE"
    return "DATA"


def merge_manifests(workspace: Path) -> OrderedDict[str, tuple[str, str]]:
    """Return entries in upstream order; later stages replace duplicate names."""
    merged: OrderedDict[str, tuple[str, str]] = OrderedDict()
    for source in manifest_sources(workspace):
        for block in BLOCK_RE.findall(source.read_text(encoding="utf-8", errors="replace")):
            category = "DATA"
            for line in block.splitlines():
                if line.lstrip().startswith("**"):
                    # Summary lines contain tokens such as ``TIKZ=0`` but are
                    # not category headings and must not change the current
                    # category.
                    if re.search(r"(?:总数|total|count)", line, re.IGNORECASE):
                        continue
                    category = _category(line)
                    continue
                match = ITEM_RE.match(line)
                if not match:
                    # Modeling reports commonly express tables as Markdown
                    # rows rather than list items. Preserve the row context
                    # while extracting its TABLE_* key for reconciliation.
                    row_match = TABLE_ROW_RE.match(line)
                    if row_match:
                        match = row_match
                if match:
                    name = match.group(1)
                    merged[name] = (category, f"- {name}{match.group(2)}")
    return merged


def render_manifest(entries: OrderedDict[str, tuple[str, str]]) -> str:
    headings = (
        ("DATA", "**数据图（matplotlib gen_fig_*.py，paper-figure 产出 .png/.pdf）：**"),
        ("DRAWIO", "**DrawIO / HTML 流程或架构图（paper-figure-drawio 产出）：**"),
        ("TIKZ", "**TikZ 图（paper-figure-drawio 产出 tikz_*.pdf）：**"),
        ("GPTIMG", "**GPT Image 场景图（paper-figure 产出 .png/.pdf）：**"),
        ("TABLE", "**TABLE 表格（paper-figure 产出 .tex）：**"),
    )
    groups = {name: [] for name, _ in headings}
    for category, line in entries.values():
        groups.setdefault(category, []).append(line)
    counts = {name: len(groups[name]) for name, _ in headings}
    lines = ["<!-- BEGIN FIGURE_MANIFEST -->", "## 合并图表清单（FIGURE_MANIFEST）"]
    for name, heading in headings:
        lines.extend(["", heading, *groups[name]])
    lines.extend(
        [
            "",
            "**总数："
            f"DATA={counts['DATA']}, DRAWIO={counts['DRAWIO']}, TIKZ={counts['TIKZ']}, "
            f"GPTIMG={counts['GPTIMG']}, TABLE={counts['TABLE']}, ALL={len(entries)}**",
            "<!-- END FIGURE_MANIFEST -->",
            "",
        ]
    )
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workspace", default=".")
    parser.add_argument("--output", default="figures/FIGURE_MANIFEST_MERGED.md")
    args = parser.parse_args()
    workspace = Path(args.workspace).resolve()
    output = Path(args.output)
    if not output.is_absolute():
        output = workspace / output
    output.parent.mkdir(parents=True, exist_ok=True)
    entries = merge_manifests(workspace)
    output.write_text(render_manifest(entries), encoding="utf-8")
    sources = ",".join(source.name for source in manifest_sources(workspace)) or "(none)"
    print(f"FIGURE_MANIFEST_MERGED={output} ALL={len(entries)} SOURCES={sources}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
