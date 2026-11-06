# -*- coding: utf-8 -*-
"""数据图 PDF 质量检查（纯标准库，随插件提供）。

用法：
  python _utils/figure_pdf_quality_check.py figures
  python _utils/figure_pdf_quality_check.py figures --paper paper
  python _utils/figure_pdf_quality_check.py figures --only fig_q1_trend.pdf

检查项（errors 会导致非 0 退出；warnings 只提示）：
  - PDF 存在、非空、以 %PDF 开头
  - 页面尺寸合理（过小/过大报错，极端宽高比告警）
  - --paper 下引用 \\includegraphics{figures/xxx} 的文件存在；width 过小告警

退出码：0 = 通过（可能带 warning）；1 = 有 error。
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

PDF_HEADER = b"%PDF"
PAGE_RE = re.compile(rb"/Type\s*/Page(?![s])")
COUNT_RE = re.compile(rb"/Count\s+(\d+)")
MEDIABOX_RE = re.compile(rb"/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]")
INCLUDE_RE = re.compile(r"\\includegraphics(?:\[[^\]]*\])?\{([^}]+)\}")


def check_pdf(pdf: Path, min_bytes: int, max_aspect: float):
    errors, warnings = [], []
    if not pdf.is_file():
        return ["文件不存在"], []
    data = pdf.read_bytes()
    size = len(data)
    if size < min_bytes:
        errors.append(f"文件过小（{size} B < {min_bytes} B）")
    if not data.startswith(PDF_HEADER):
        errors.append("不是 PDF（缺 %PDF 头）")
        return errors, warnings
    pages = PAGE_RE.findall(data)
    count = COUNT_RE.search(data)
    page_count = len(pages) or (int(count.group(1)) if count else 0)
    if page_count == 0:
        warnings.append("无法从文件结构判断页数（可能被压缩），请人工确认")
    elif page_count > 1:
        warnings.append(f"PDF 有 {page_count} 页；论文插图应单页")
    m = MEDIABOX_RE.search(data)
    if m:
        w, h = float(m.group(3)) - float(m.group(1)), float(m.group(4)) - float(m.group(2))
        if min(w, h) < 100:
            errors.append(f"页面过小：{w:.0f}×{h:.0f} pt")
        if max(w, h) > 2000:
            errors.append(f"页面过大：{w:.0f}×{h:.0f} pt（检查 figsize/dpi）")
        if h > 0 and max(w, h) / min(w, h) > max_aspect:
            warnings.append(f"宽高比 {max(w, h) / min(w, h):.1f}:1 过于极端，排版会被压扁")
    else:
        warnings.append("未解析到页面尺寸（MediaBox），请人工确认")
    return errors, warnings


def resolve_include(paper: Path, target: str):
    """论文里 \\includegraphics 的路径可能是相对 paper/、workdir、figures/ 或 graphicspath。"""
    target = target.strip()
    name = Path(target).name
    candidates = [
        (paper / target).resolve(),
        (paper / "figures" / target).resolve(),
        (paper.parent / target).resolve(),
        (paper.parent / "figures" / target).resolve(),
    ]
    for cand in candidates:
        if cand.is_file():
            return cand
    # graphicspath 里写了目录、include 只给文件名
    for dirname in ("figures", "paper/figures"):
        cand = (paper.parent / dirname / name).resolve()
        if cand.is_file():
            return cand
    return None


def check_paper(paper: Path, max_aspect: float):
    """检查 paper 下 \\includegraphics 引用的图文件是否存在、宽度是否过小。"""
    errors, warnings = [], []
    tex_files = [paper / "main.tex"] + sorted((paper / "sections").glob("*.tex"))
    for tex in tex_files:
        if not tex.is_file():
            continue
        text = tex.read_text(encoding="utf-8", errors="replace")
        for m in INCLUDE_RE.finditer(text):
            target = m.group(1).strip()
            if target.startswith("{"):
                continue
            if resolve_include(paper, target) is None:
                errors.append(f"{tex.name} 引用的图不存在：{target}")
                continue
            width = re.search(r"width\s*=\s*([\d.]+)\s*\\(?:textwidth|linewidth|columnwidth)", m.group(0))
            if width and float(width.group(1)) < 0.5:
                warnings.append(f"{tex.name} 的 {target} 宽度只有 {width.group(1)}\\textwidth，可能过小")
    return errors, warnings


def main() -> int:
    ap = argparse.ArgumentParser(description="数据图 PDF 质量检查")
    ap.add_argument("targets", nargs="*", help="要检查的 PDF 文件或目录（默认 figures）")
    ap.add_argument("--paper", default=None, help="论文目录（检查 \\includegraphics 引用）")
    ap.add_argument("--only", nargs="+", default=None, help="只检查这些文件名/主干")
    ap.add_argument("--min-kb", type=float, default=1.0, help="最小文件大小 KB（默认 1）")
    ap.add_argument("--max-aspect", type=float, default=8.0, help="宽高比告警阈值（默认 8）")
    args = ap.parse_args()

    targets = [Path(t) for t in (args.targets or ["figures"])]
    pdfs = []
    for t in targets:
        if t.is_dir():
            pdfs.extend(sorted(t.glob("*.pdf")))
        elif t.is_file():
            pdfs.append(t)
    if args.only:
        wanted = {Path(o).stem for o in args.only}
        pdfs = [p for p in pdfs if p.stem in wanted or p.name in args.only]

    errors, warnings = [], []
    if not pdfs:
        errors.append("没有找到可检查的 PDF")
    for pdf in pdfs:
        e, w = check_pdf(pdf, int(args.min_kb * 1024), args.max_aspect)
        tag = "OK" if not e else "FAIL"
        print(f"[{tag}] {pdf}")
        for item in e:
            errors.append(f"{pdf.name}: {item}")
            print(f"  ✗ {item}")
        for item in w:
            warnings.append(f"{pdf.name}: {item}")
            print(f"  ⚠ {item}")

    if args.paper:
        paper = Path(args.paper)
        if paper.is_dir():
            pe, pw = check_paper(paper, args.max_aspect)
            errors.extend(pe)
            warnings.extend(pw)
            for item in pe:
                print(f"  ✗ {item}")
            for item in pw:
                print(f"  ⚠ {item}")

    print(f"\n检查 {len(pdfs)} 个 PDF：{len(errors)} 个错误，{len(warnings)} 个告警")
    return 0 if not errors else 1


if __name__ == "__main__":
    sys.exit(main())
