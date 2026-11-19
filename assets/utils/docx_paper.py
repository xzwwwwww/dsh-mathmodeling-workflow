#!/usr/bin/env python3
"""Precheck, export, and verify the modeling workflow's competition Word paper.

Pandoc parses Markdown and produces native Word objects, including OMML.
python-docx applies the layout. A separate package check and a digest stamp
bind the final outputs to the canonical Markdown and the referenced figures.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from dataclasses import dataclass
import hashlib
import io
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile
import unicodedata
from urllib.parse import unquote, urlsplit
import warnings
import zipfile


SOURCE = "paper/main.md"
OUTPUT = "paper/main.docx"
LAYOUT = "paper/docx-layout-check.pdf"
STAMP = ".mmw/docx-export.json"
REPORT = "DOCX_PRECHECK_REPORT.md"
SOURCE_MAX = 8 * 1024 * 1024
FIGURE_MAX = 48 * 1024 * 1024
OUTPUT_MAX = 512 * 1024 * 1024
STAMP_VERSION = 1
READER = "commonmark_x+sourcepos+implicit_figures-yaml_metadata_block-smart"

ATX_TITLE = re.compile(r"^ {0,3}#(?:[ \t]+|$)")
COMMENT = re.compile(r"\s*(?:<!--[\s\S]*?-->\s*)+\Z")
TABLE_LABEL = re.compile(r"<!--\s*label\s*:\s*(TABLE_[\w.-]+)\s*-->", re.I)
TABLE_ID = re.compile(r"TABLE_[\w.-]+\Z", re.I)
NUMBER_PREFIX = re.compile(r"^(?:(?:\d+(?:[.．]\d+)*|[一二三四五六七八九十]+)[\s.．、：:]+)+")
LATEX_COMMAND = re.compile(
    r"\\(?:documentclass|usepackage|begin|end|input|include|includegraphics|"
    r"cite\w*|ref|eqref|pageref|label|section|subsection|subsubsection|chapter|"
    r"maketitle|tableofcontents|bibliography|bibliographystyle|bibitem|"
    r"newcommand|renewcommand|def|textbf|textit|texttt|frac|sum|alpha|beta)\b"
)
LATEX_DELIMITER = re.compile(r"\\[\[\]()]")
PLACEHOLDER = re.compile(
    r"\b(?:TODO|TBD|FIXME|Lorem\s+ipsum)\b|"
    r"(?:\[|［|【|<)\s*(?:待补充|待填写|待插入|此处(?:填写|插入)|"
    r"placeholder\b|(?:insert|replace|fill\s+in)\s+(?:here|title|text|result|figure|table|reference))"
    r"|(?:此处|在此)(?:填写|插入)(?:标题|摘要|正文|图表|结果|参考文献)"
    r"|^\s*(?:占位符|待补充|待填写|待插入|暂缺|N/?A|none|无)\s*[。.!]?\s*$",
    re.I,
)
PARSE_ERROR = re.compile(r"\b(?:undefined control sequence|math input error|latex error|parse error)\b", re.I)
NO_AI_STATEMENT = re.compile(
    r"(?:\b(?:the|our) team did not use any ai tools during the competition\b[.!]?|"
    r"(?:本参赛队|本队)在竞赛过程中未使用任何\s*ai\s*工具[。.!]?)",
    re.I,
)
WINDOWS_RESERVED = re.compile(r"(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)", re.I)


class PaperError(Exception):
    """An actionable failure reported to the workflow as JSON."""


@dataclass
class Paper:
    tree: dict
    source_digest: str
    figure_digests: dict[str, str]
    stats: dict
    counts: dict[str, int]


def is_redirected(info):
    reparse_flag = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)
    return stat.S_ISLNK(info.st_mode) or bool(getattr(info, "st_file_attributes", 0) & reparse_flag)


def workspace_root(value):
    path = Path(os.path.abspath(value))
    info = path.lstat()
    if is_redirected(info) or not stat.S_ISDIR(info.st_mode):
        raise PaperError(f"Workspace must be a real directory: {path}")
    return path.resolve(strict=True)


def checked_path(root, relative, *, missing=False, directory=False):
    """Check every component before opening or publishing a workspace file."""
    path = root
    parts = relative.split("/")
    for index, name in enumerate(parts):
        if (
            not name or name in {".", ".."} or ":" in name or "\\" in name
            or any(ord(char) < 32 for char in name)
            or (os.name == "nt" and (name.endswith((" ", ".")) or WINDOWS_RESERVED.match(name)))
        ):
            raise PaperError(f"Invalid workspace path: {relative}")
        path = path / name
        last = index == len(parts) - 1
        try:
            info = path.lstat()
        except FileNotFoundError:
            if last and missing:
                return path
            raise PaperError(f"Missing workspace path: {relative}") from None
        if is_redirected(info):
            raise PaperError(f"Symlinks and junctions are not allowed: {relative}")
        expected = stat.S_ISDIR if directory or not last else stat.S_ISREG
        if not expected(info.st_mode):
            raise PaperError(f"Unexpected file type: {relative}")
    return path


def read_checked(root, relative, max_size):
    path = checked_path(root, relative)
    flags = os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0)
    with os.fdopen(os.open(path, flags), "rb") as stream:
        info = os.fstat(stream.fileno())
        current = checked_path(root, relative).lstat()
        if not stat.S_ISREG(info.st_mode) or not os.path.samestat(info, current):
            raise PaperError(f"Workspace file changed while opening: {relative}")
        if info.st_size > max_size:
            raise PaperError(f"Workspace file is too large: {relative}")
        data = stream.read(max_size + 1)
    if len(data) > max_size:
        raise PaperError(f"Workspace file is too large: {relative}")
    return data


def digest(data):
    return hashlib.sha256(data).hexdigest()


def find_tool(variable, command, extra=()):
    override = os.environ.get(variable)
    if override:
        path = Path(override).expanduser()
        if not path.is_absolute() or not path.is_file():
            raise PaperError(f"{variable} must be an absolute path to an executable: {override}")
        return str(path.resolve(strict=True))
    # Ignore implicit current-directory executable discovery on Windows.
    for entry in os.environ.get("PATH", "").split(os.pathsep):
        folder = Path(entry.strip('"'))
        if not folder.is_absolute():
            continue
        candidate = folder / (command + (".exe" if os.name == "nt" else ""))
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return str(candidate.resolve(strict=True))
    for candidate in extra:
        if candidate.is_file():
            return str(candidate.resolve(strict=True))
    return None


def require_tool(variable, command):
    path = find_tool(variable, command)
    if not path:
        raise PaperError(f"Install {command} or set {variable} to its absolute executable path.")
    return path


def run_tool(label, argv, cwd, *, timeout, input_data=None):
    try:
        result = subprocess.run(
            argv, cwd=cwd, input=input_data, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, timeout=timeout, shell=False,
        )
    except subprocess.TimeoutExpired:
        raise PaperError(f"{label} timed out after {timeout} seconds.") from None
    except OSError as exc:
        raise PaperError(f"Cannot start {label}: {exc}") from None
    if result.returncode:
        detail = (result.stderr or result.stdout).decode("utf-8", "replace").strip()
        raise PaperError(f"{label} failed ({result.returncode}): {detail[-2200:]}")
    return result.stdout


def nodes(obj):
    """Iterate Pandoc AST objects, including table cells and footnotes."""
    if isinstance(obj, dict):
        if "t" in obj:
            yield obj
        yield from nodes(obj.get("c"))
    elif isinstance(obj, list):
        for item in obj:
            yield from nodes(item)


def visible(obj):
    if isinstance(obj, list):
        return "".join(map(visible, obj))
    if not isinstance(obj, dict):
        return ""
    tag, contents = obj["t"], obj.get("c")
    if tag == "Str":
        return contents
    if tag in {"Space", "SoftBreak", "LineBreak"}:
        return " "
    if tag in {"Code", "CodeBlock", "Math", "RawInline", "RawBlock", "Image", "Note"}:
        return ""
    if tag in {"Table", "Div", "Figure", "BulletList", "OrderedList", "DefinitionList", "BlockQuote"}:
        parts = [visible(item) for item in contents]
        return " ".join(part for part in parts if part)
    text = visible(contents)
    return f"{text} " if tag in {"Para", "Plain", "Header"} and text else text


def prose(obj):
    return re.sub(r"\s+", " ", visible(obj)).strip()


def attrs_of(node):
    """Return the source attribute triplet for nodes that support it."""
    if node["t"] == "Header":
        return node["c"][1]
    if node["t"] in {"Code", "CodeBlock", "Div", "Figure", "Image", "Link", "Span", "Table"}:
        return node["c"][0]
    return None


def source_slice(lines, position):
    match = re.fullmatch(r"(\d+):(\d+)-(\d+):(\d+)", position)
    if not match:
        return ""
    first, start, last, end = (int(item) for item in match.groups())
    if first == last and first <= len(lines):
        return lines[first - 1][start - 1:end - 1]
    if first <= len(lines):
        return "\n".join([lines[first - 1][start - 1:], *lines[first:last - 1], lines[last - 1][:end - 1] if last <= len(lines) else ""])
    return ""


def heading_kind(text):
    name = NUMBER_PREFIX.sub("", unicodedata.normalize("NFKC", text)).strip().casefold()
    name = name.rstrip(":： ")
    if name in {"摘要", "中文摘要", "英文摘要", "abstract", "summary", "summary sheet", "概要"}:
        return "abstract"
    if name in {"目录", "table of contents", "contents"}:
        return "toc"
    if name in {"参考文献", "参考资料", "references", "bibliography", "works cited"}:
        return "references"
    if re.match(r"^(?:附录|附件|appendix\b|appendices\b|supplementary material\b)", name):
        return "appendix"
    if re.match(r"^(?:致谢|感谢|acknowledg(?:e)?ments?\b)", name):
        return "backmatter"
    if re.match(
        r"^(?:(?:(?:生成式\s*)?(?:ai|人工智能)\s*(?:工具\s*)?(?:的\s*)?(?:使用\s*)?(?:情况\s*)?(?:声明|说明|报告|详情))|"
        r"(?:report\s+(?:on|of)\s+(?:the\s+)?use\s+of\s+(?:generative\s+)?ai\b)|"
        r"(?:(?:generative\s+)?ai(?:\s+tools?)?\s*(?:(?:use|usage)\s+)?(?:statement|disclosure|report|details?)\b)|"
        r"(?:use\s+of\s+(?:generative\s+)?ai\b))",
        name,
    ):
        return "backmatter"
    return "body"


def comment_only(node):
    return node["t"] in {"RawInline", "RawBlock"} and node["c"][0] == "html" and COMMENT.fullmatch(node["c"][1])


def sanitized_blocks(tree, lines):
    """Remove source mapping wrappers and raw comments. Keep only supported attributes."""
    markers = {}
    titles = set()
    for node in nodes(tree["blocks"]):
        tag = node["t"]
        if tag in {"RawInline", "RawBlock"} and not comment_only(node):
            raise PaperError("Raw HTML, LaTeX, and converter-specific blocks are unsupported. Use Markdown and $…$ math.")
        if tag in {"Para", "Plain", "Header"}:
            text = prose(node)
            match = LATEX_COMMAND.search(text) or PLACEHOLDER.search(text) or PARSE_ERROR.search(text)
            if match or "$$" in text or re.search(r"!\[[^\n]*?\]\s*(?:\(|\[)", text):
                clue = match.group() if match else text[:100]
                raise PaperError(f"Unconverted LaTeX, unresolved image, or placeholder in the paper: {clue}")
        attrs = attrs_of(node)
        if attrs is None:
            continue
        details = dict(attrs[2])
        if tag == "Header" and node["c"][0] == 1:
            pos = details.get("data-pos", "").split(":", 1)[0]
            if pos.isdecimal() and int(pos) <= len(lines) and ATX_TITLE.match(lines[int(pos) - 1]):
                titles.add(id(node))
        if tag == "Span" and details.get("wrapper") == "1":
            raw = source_slice(lines, details.get("data-pos", ""))
            if all(item["t"] in {"Str", "Space"} for item in node["c"][1]) and LATEX_DELIMITER.search(raw):
                raise PaperError("Use $…$ or $$…$$ for math. LaTeX \\(…\\) and \\[…\\] delimiters are unsupported.")
        if tag in {"Div", "Span"} and not attrs[0] and not attrs[1] and details.get("wrapper") == "1":
            markers[id(node)] = True
        if tag == "Link":
            url = node["c"][2][0]
            try:
                parsed = urlsplit(url)
            except ValueError:
                raise PaperError(f"Invalid hyperlink: {url[:120]}") from None
            if not (
                url.startswith("#") or parsed.scheme in {"http", "https", "mailto"}
            ):
                raise PaperError(f"Only HTTP(S), mailto, and internal anchor links are supported: {url[:120]}")
        if tag == "Image":
            dims = [(key, value) for key, value in attrs[2] if key in {"width", "height"}]
            for key, value in dims:
                match = re.fullmatch(r"([0-9]+(?:\.[0-9]+)?)(?:px|cm|mm|in|pt|%)?", value)
                if not match or not 0 < float(match.group(1)) <= 10000:
                    raise PaperError(f"Invalid image {key}: {value[:80]}")
            attrs[2] = dims
        else:
            attrs[2] = []

    table_labels = {}

    def clean(obj):
        if isinstance(obj, dict):
            if comment_only(obj):
                return None
            if "c" in obj:
                obj["c"] = clean(obj["c"])
            return obj
        if not isinstance(obj, list):
            return obj
        output = []
        for item in obj:
            if isinstance(item, dict) and id(item) in markers:
                output.extend(clean(item["c"][1]))
            elif isinstance(item, dict) and comment_only(item):
                continue
            else:
                output.append(clean(item))
        return output

    # Support the workflow's label after a table as well as an adjacent label
    # before a table, where the latter can precede its caption.
    pending = []
    previous_table = None
    for block in tree["blocks"]:
        unwrapped = block["c"][1] if id(block) in markers else [block]
        for item in unwrapped:
            tag = item["t"]
            if comment_only(item):
                labels = TABLE_LABEL.findall(item["c"][1])
                if previous_table is not None:
                    table_labels[previous_table].extend(labels)
                else:
                    pending.extend(labels)
            elif tag == "Table":
                explicit = item["c"][0][0]
                table_labels[id(item)] = pending + ([explicit] if TABLE_ID.fullmatch(explicit) else [])
                pending = []
                previous_table = id(item)
            else:
                previous_table = None
                if not (tag in {"Plain", "Para"} and is_table_caption(prose(item))):
                    pending = []
    seen_labels = set()
    for labels in table_labels.values():
        distinct = set(labels)
        if len(distinct) > 1:
            raise PaperError(f"One table claims multiple manifest IDs: {', '.join(sorted(distinct))}")
        if seen_labels & distinct:
            raise PaperError(f"Multiple tables claim the same manifest ID: {labels[0]}")
        seen_labels.update(distinct)
    tree["blocks"] = [
        block for block in clean(tree["blocks"])
        if block["t"] not in {"Plain", "Para"} or block["c"]
    ]
    return titles, table_labels


def is_table_caption(text):
    return bool(re.match(r"^(?:表\s*\d|Table\s+(?:\d|[A-Z](?:[.:-]|\s|$)))", text, re.I))


def figure_path(root, link):
    try:
        url = urlsplit(link)
    except ValueError:
        raise PaperError(f"Invalid image path: {link[:200]}") from None
    path = unquote(url.path, errors="strict")
    if (
        url.scheme or url.netloc or url.query or url.fragment or not path
        or path.startswith(("/", "\\")) or "\\" in path or ":" in path
    ):
        raise PaperError(f"Image must be a relative workspace file: {link[:200]}")
    # Markdown paths are relative to paper/main.md. Also accept the original
    # competition profile's workspace-relative figures/... spelling.
    parts = [] if path.startswith("figures/") else ["paper"]
    for name in path.split("/"):
        if name == "..":
            if not parts:
                raise PaperError(f"Image path leaves workspace: {link[:200]}")
            parts.pop()
        elif name not in {".", ""}:
            parts.append(name)
    relative = "/".join(parts)
    if Path(relative).suffix.lower() not in {".png", ".jpg", ".jpeg", ".pdf"}:
        raise PaperError(f"Image must be PNG, JPEG, or single-page PDF: {link[:200]}")
    checked_path(root, relative)
    return relative


def validate_figure(relative, data):
    suffix = Path(relative).suffix.lower()
    if suffix == ".pdf":
        if not data.startswith(b"%PDF-"):
            raise PaperError(f"Invalid PDF figure: {relative}")
        return
    try:
        from PIL import Image
    except ImportError:
        raise PaperError("Pillow is required to validate PNG and JPEG figures.") from None
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as image:
                expected = "PNG" if suffix == ".png" else "JPEG"
                if image.format != expected or getattr(image, "n_frames", 1) != 1:
                    raise PaperError(f"Figure must be a single {expected} image: {relative}")
                image.verify()
    except (OSError, ValueError, Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        raise PaperError(f"Invalid image {relative}: {exc}") from None


def emitted_nodes(obj):
    """Walk content emitted by the DOCX writer, ignoring image alt formatting."""
    if isinstance(obj, dict):
        yield obj
        tag = obj["t"]
        children = obj.get("c")
        if tag == "Image":
            return
        if tag in {"Table", "Figure"}:
            # A short caption is an alternative title, not a second caption.
            children = [children[1][1], children[2:]]
        yield from emitted_nodes(children)
    elif isinstance(obj, list):
        for item in obj:
            yield from emitted_nodes(item)


def precheck(root, pandoc, scratch, *, summary_sheet=False):
    data = read_checked(root, SOURCE, SOURCE_MAX)
    text = data.decode("utf-8-sig").replace("\r\n", "\n").replace("\r", "\n")
    if "\x00" in text:
        raise PaperError(f"Unexpected NUL character in {SOURCE}.")
    parsed = run_tool(
        "Pandoc Markdown precheck",
        [pandoc, "--sandbox", "--fail-if-warnings", "--from", READER, "--to", "json"],
        scratch, timeout=30, input_data=text.encode("utf-8"),
    )
    tree = json.loads(parsed)
    title_nodes, table_labels = sanitized_blocks(tree, text.split("\n"))
    blocks = tree["blocks"]
    headings = [node for node in nodes(blocks) if node["t"] == "Header" and node["c"][0] == 1]
    if (
        len(headings) != 1 or headings[0] is not (blocks[0] if blocks else None)
        or id(headings[0]) not in title_nodes or not prose(headings[0])
    ):
        raise PaperError("Start paper/main.md with exactly one genuine '# Title' heading.")

    sections = []
    for block in blocks[1:]:
        if block["t"] == "Header" and block["c"][0] == 2:
            sections.append((heading_kind(prose(block)), block, []))
        elif sections:
            sections[-1][2].append(block)
        else:
            raise PaperError("Start the paper with a level-two Abstract / 摘要 / Summary Sheet heading.")
    if not sections or sections[0][0] != "abstract":
        raise PaperError("Add a level-two Abstract / 摘要 / Summary Sheet before the main body.")

    if summary_sheet and prose(sections[0][1]).strip().casefold() != "summary sheet":
        raise PaperError("MCM/ICM English papers must open with a Summary Sheet.")

    body_blocks = []
    body_headings = []
    body_content = []
    reference_sections = 0
    state = "abstract"
    for kind, heading, content in sections:
        if kind == "abstract":
            if state != "abstract" or not prose(content):
                raise PaperError("Each abstract must contain text and precede the contents and body.")
        elif kind == "toc":
            if state != "abstract":
                raise PaperError("The table of contents belongs after the abstract and before the body.")
            state = "toc"
        elif kind == "references":
            reference_sections += 1
            if not body_blocks or not any(prose(item) for item in content if item["t"] != "Header"):
                raise PaperError("Add nonempty References / 参考文献 after the main body.")
            state = "backmatter"
        elif kind in {"appendix", "backmatter"}:
            if not body_blocks:
                raise PaperError("The appendix and declarations must follow the main body.")
            state = "backmatter"
        elif state == "backmatter":
            raise PaperError(f"Main body heading follows references, a declaration, or an appendix: {prose(heading)}")
        else:
            state = "body"
            body_blocks.extend([heading, *content])
            body_content.extend(
                item for item in content if item["t"] != "Header" and not NO_AI_STATEMENT.fullmatch(prose(item))
            )
            body_headings.extend(
                prose(item) for item in [heading, *content]
                if item["t"] == "Header" and 2 <= item["c"][0] <= 4
            )
    if not body_blocks or not prose(body_content):
        raise PaperError("Add a nonempty main body after the abstract or contents.")
    if reference_sections != 1:
        raise PaperError("Provide exactly one nonempty References / 参考文献 section.")

    figure_digests = {}
    counts = {"equations": 0, "images": 0, "tables": 0}
    for node in emitted_nodes(blocks):
        tag = node["t"]
        if tag == "Image":
            relative = figure_path(root, node["c"][2][0])
            node["c"][2][0] = relative
            if relative not in figure_digests:
                image = read_checked(root, relative, FIGURE_MAX)
                validate_figure(relative, image)
                figure_digests[relative] = digest(image)
            counts["images"] += 1
        elif tag == "Math":
            if not node["c"][1].strip():
                raise PaperError("Empty math delimiters in the paper.")
            counts["equations"] += 1
        elif tag == "Table":
            counts["tables"] += 1
    body_figures = []
    body_table_ids = []
    body_tables = 0
    for node in emitted_nodes(body_blocks):
        if node["t"] == "Image":
            body_figures.append(node["c"][2][0])
        elif node["t"] == "Table":
            body_tables += 1
            body_table_ids.extend(table_labels.get(id(node), ()))
    return Paper(
        tree, digest(data), figure_digests, {
            "body_chars": len(prose([item for item in body_blocks if not NO_AI_STATEMENT.fullmatch(prose(item))])),
            "figures": list(figure_digests),
            "body_figures": list(dict.fromkeys(body_figures)),
            "tables": body_tables,
            "body_table_ids": list(dict.fromkeys(body_table_ids)),
            "body_headings": body_headings,
        }, counts,
    )


def stage_figures(root, paper, scratch):
    staged = {}
    for index, (relative, expected) in enumerate(paper.figure_digests.items(), start=1):
        image = read_checked(root, relative, FIGURE_MAX)
        if digest(image) != expected:
            raise PaperError(f"Figure changed after precheck: {relative}")
        suffix = Path(relative).suffix.lower()
        name = f"figure-{index}{suffix}"
        (scratch / name).write_bytes(image)
        if suffix == ".pdf":
            pdftoppm = require_tool("MMW_PDFTOPPM", "pdftoppm")
            prefix = f"raster-{index}"
            run_tool(
                f"Rasterizing {relative}",
                [pdftoppm, "-f", "1", "-l", "2", "-r", "180", "-scale-to", "1800", "-png", name, prefix],
                scratch, timeout=30,
            )
            rasters = list(scratch.glob(f"{prefix}-*.png"))
            if len(rasters) != 1:
                raise PaperError(f"Expected a single-page PDF figure: {relative}")
            name = rasters[0].name
            validate_figure(name, rasters[0].read_bytes())
        staged[relative] = name
    for node in nodes(paper.tree["blocks"]):
        if node["t"] == "Image":
            relative = node["c"][2][0]
            if relative not in staged:
                raise PaperError("Nested images inside image alternative text are unsupported.")
            node["c"][2][0] = staged[relative]


def style_paper(raw, styled, language, *, summary_sheet=False):
    from docx import Document
    from docx.enum.style import WD_STYLE_TYPE
    from docx.enum.text import WD_ALIGN_PARAGRAPH as Align
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    from docx.shared import Cm, Pt, RGBColor
    from docx.text.paragraph import Paragraph

    doc = Document(raw)
    chinese = language == "zh"
    latin, cjk, display, code = "Times New Roman", "SimSun", "SimHei", "Consolas"
    normal_size, table_size = (12, 10.5) if chinese else (11, 10)
    line_spacing = 1.5 if chinese else 1.15
    size_by_level = [15, 14, 12, 11] if chinese else [14, 12, 11, 11]

    def child(parent, tag):
        item = parent.find(qn(tag))
        if item is None:
            item = OxmlElement(tag)
            parent.append(item)
        return item

    def fonts(obj, size, family=latin, east_asia=cjk):
        obj.font.name = family
        obj.font.size = Pt(size)
        obj.font.color.rgb = RGBColor(0, 0, 0)
        rpr = obj._element.get_or_add_rPr()
        rfonts = rpr.rFonts
        for attr in ("asciiTheme", "hAnsiTheme", "eastAsiaTheme", "cstheme", "csTheme"):
            rfonts.attrib.pop(qn(f"w:{attr}"), None)
        rfonts.set(qn("w:eastAsia"), east_asia)
        rfonts.set(qn("w:cs"), family)
        lang = child(rpr, "w:lang")
        lang.set(qn("w:val"), "zh-CN" if chinese else "en-US")
        lang.set(qn("w:eastAsia"), "zh-CN")

    def set_style(name, size, *, family=latin, east_asia=cjk, alignment=None, bold=None,
                  indent=0, spacing=None, before=0, after=0, keep_next=False):
        if name not in doc.styles:
            doc.styles.add_style(name, WD_STYLE_TYPE.PARAGRAPH)
        sty = doc.styles[name]
        if name != "Normal":
            sty.base_style = doc.styles["Normal"]
        fonts(sty, size, family, east_asia)
        sty.font.bold = bold
        sty.font.italic = None
        fmt = sty.paragraph_format
        fmt.alignment = alignment
        fmt.first_line_indent = Pt(indent)
        fmt.line_spacing = spacing or line_spacing
        fmt.space_before = Pt(before)
        fmt.space_after = Pt(after)
        fmt.keep_with_next = keep_next
        fmt.widow_control = True
        return sty

    set_style("Footer", 10, alignment=Align.CENTER, spacing=1.0)
    for section in doc.sections:
        section.page_width, section.page_height = Cm(21), Cm(29.7)
        section.top_margin = section.bottom_margin = section.left_margin = section.right_margin = Cm(2.5)
        section.footer_distance = Cm(1.25)
        footer = section.footer.paragraphs[0]
        footer.style = doc.styles["Footer"]
        footer.alignment = Align.CENTER
        footer.paragraph_format.first_line_indent = Pt(0)
        field = OxmlElement("w:fldSimple")
        field.set(qn("w:instr"), "PAGE")
        footer._p.append(field)

    for name in ("Normal", "Body Text", "First Paragraph", "Compact"):
        set_style(name, normal_size, alignment=Align.JUSTIFY, indent=24 if chinese else 0, after=0 if chinese else 6)
    set_style("Title", 18 if chinese else 16, east_asia=display if chinese else cjk,
              alignment=Align.CENTER, bold=True, spacing=1.15, before=12, after=8, keep_next=True)
    for level in range(1, 9):
        set_style(f"Heading {level}", size_by_level[min(level - 1, 3)],
                  alignment=Align.CENTER if chinese and level == 1 else Align.LEFT,
                  east_asia=display if chinese else cjk, bold=True, spacing=1.15,
                  before=10, after=5, keep_next=True)
    for name in ("Caption", "Image Caption", "Table Caption"):
        set_style(name, table_size, alignment=Align.CENTER, bold=True,
                  after=5, before=3, spacing=1.1, keep_next=name == "Table Caption")
    for name in ("Figure", "Captioned Figure"):
        set_style(name, table_size, alignment=Align.CENTER, after=3, spacing=1.0, keep_next=name == "Captioned Figure")
    set_style("Source Code", 9, family=code, alignment=Align.LEFT, spacing=1.0, before=3, after=3)
    set_style("Block Text", normal_size, indent=0, after=3)
    reference_style = set_style("MMW Reference", table_size, alignment=Align.LEFT, spacing=1.15, after=2)
    reference_style.paragraph_format.left_indent = Cm(0.74)
    reference_style.paragraph_format.first_line_indent = -Cm(0.74)
    set_style("MMW Equation", normal_size, alignment=Align.CENTER, spacing=1.15, before=3, after=3)
    set_style("MMW Equation Number", normal_size, alignment=Align.RIGHT, spacing=1.15)
    set_style("MMW Table Text", table_size, alignment=Align.CENTER, spacing=1.15)
    set_style("Footer", 10, alignment=Align.CENTER, spacing=1.0)

    # The first Markdown heading is the paper title. Promote remaining Markdown
    # headings one level to make the Word navigation hierarchy start at Heading 1.
    in_references = False
    first_heading = True
    summary_ended = False
    previous_equation = False
    for paragraph in doc.paragraphs:
        name = paragraph.style.name
        text = paragraph.text.strip()
        pf = paragraph.paragraph_format
        match = re.fullmatch(r"Heading ([1-9])", name)
        has_math_block = bool(paragraph._p.xpath(".//m:oMathPara"))
        if match:
            level = int(match.group(1))
            if first_heading and level == 1:
                paragraph.style = doc.styles["Title"]
                first_heading = False
            else:
                paragraph.style = doc.styles[f"Heading {max(1, level - 1)}"]
                if level == 2:
                    kind = heading_kind(text)
                    in_references = kind == "references"
                    if summary_sheet and not summary_ended and kind != "abstract":
                        pf.page_break_before = True
                        summary_ended = True
                    if kind in {"abstract", "toc"}:
                        pf.alignment = Align.CENTER
                pf.keep_with_next = True
        elif name == "Source Code":
            shade = child(paragraph._p.get_or_add_pPr(), "w:shd")
            shade.set(qn("w:fill"), "F5F5F5")
        elif has_math_block:
            paragraph.style = doc.styles["MMW Equation"]
        elif paragraph._p.xpath(".//w:drawing") and not text:
            paragraph.alignment = Align.CENTER
            pf.first_line_indent = Pt(0)
            pf.keep_together = True
        elif previous_equation and re.fullmatch(r"[（(]\s*[\d.\-]+\s*[)）]", text):
            paragraph.style = doc.styles["MMW Equation Number"]
        elif is_table_caption(text):
            paragraph.style = doc.styles["Table Caption"]
        elif in_references and text and not paragraph._p.xpath("./w:pPr/w:numPr"):
            paragraph.style = reference_style
        if paragraph._p.xpath("./w:pPr/w:numPr"):
            # The Word numbering definition supplies the list's hanging indent.
            if chinese:
                paragraph.style = doc.styles["Compact"]
            pf.first_line_indent = None
        previous_equation = has_math_block

    def border(parent, edge, value, size=None):
        element = child(parent, f"w:{edge}")
        element.set(qn("w:val"), value)
        if size is not None:
            element.set(qn("w:sz"), str(size))
            element.set(qn("w:color"), "000000")

    for table in doc.element.body.xpath(".//w:tbl"):
        tbl_pr = table.find(qn("w:tblPr"))
        if tbl_pr is None:
            continue
        for name in ("w:tblBorders", "w:tblStyle"):
            old = tbl_pr.find(qn(name))
            if old is not None:
                tbl_pr.remove(old)
        borders = OxmlElement("w:tblBorders")
        # OOXML element order matters: insert borders ahead of the layout/cell props.
        following = next((item for item in tbl_pr if item.tag in {
            qn("w:shd"), qn("w:tblLayout"), qn("w:tblCellMar"), qn("w:tblLook"),
        }), None)
        if following is None:
            tbl_pr.append(borders)
        else:
            following.addprevious(borders)
        for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
            border(borders, edge, "single", 12) if edge in {"top", "bottom"} else border(borders, edge, "nil")
        for row in table.findall(qn("w:tr")):
            tr_pr = row.find(qn("w:trPr"))
            header = tr_pr is not None and tr_pr.find(qn("w:tblHeader")) is not None
            for cell in row.findall(qn("w:tc")):
                if header:
                    cell_pr = cell.get_or_add_tcPr()
                    border(cell_pr.get_or_add_tcBorders() if hasattr(cell_pr, "get_or_add_tcBorders")
                           else child(cell_pr, "w:tcBorders"), "bottom", "single", 6)
                for element in cell.findall(qn("w:p")):
                    paragraph = Paragraph(element, doc._body)
                    if paragraph.style.name != "Source Code":
                        paragraph.style = doc.styles["MMW Table Text"]
                    if header:
                        for run in paragraph.runs:
                            if run.bold is None:
                                run.bold = True

    for shape in doc.inline_shapes:
        if shape.width > Cm(14):
            scale = Cm(14) / shape.width
            shape.height = round(shape.height * scale)
            shape.width = Cm(14)
        if shape.height > Cm(21):
            scale = Cm(21) / shape.height
            shape.width = round(shape.width * scale)
            shape.height = Cm(21)
    doc.core_properties.language = "zh-CN" if chinese else "en-US"
    doc.core_properties.author = ""
    doc.core_properties.last_modified_by = ""
    doc.core_properties.title = next((p.text for p in doc.paragraphs if p.style.name == "Title"), "")
    doc.save(styled)


def inspect_docx(data, expected):
    from docx import Document
    from lxml import etree

    doc = Document(io.BytesIO(data))
    if not doc.sections or not any(p.style.name == "Title" and p.text.strip() for p in doc.paragraphs):
        raise PaperError("DOCX could not be reopened with its paper title and page layout.")
    namespaces = {
        "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
        "m": "http://schemas.openxmlformats.org/officeDocument/2006/math",
        "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
        "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    }
    counts = dict.fromkeys(expected, 0)
    xml = etree.XMLParser(resolve_entities=False, no_network=True)
    with zipfile.ZipFile(io.BytesIO(data)) as package:
        names = package.namelist()
        if len(names) != len(set(names)) or sum(info.file_size for info in package.infolist()) > OUTPUT_MAX:
            raise PaperError("DOCX has duplicate or oversized ZIP parts.")
        bad = package.testzip()
        if bad:
            raise PaperError(f"DOCX ZIP part failed its CRC check: {bad}")
        required = {"[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/styles.xml"}
        if not required.issubset(names):
            raise PaperError("DOCX is missing required Word package parts.")
        for name in names:
            if name.endswith(".rels"):
                relationships = etree.fromstring(package.read(name), xml)
                for item in relationships:
                    if item.get("TargetMode") == "External" and not item.get("Type", "").endswith("/hyperlink"):
                        raise PaperError("DOCX has an external relationship other than a text hyperlink.")
            if not re.fullmatch(r"word/(?:document|footnotes|endnotes)\.xml", name):
                continue
            content = etree.fromstring(package.read(name), xml)
            counts["equations"] += len(content.xpath(".//m:oMath", namespaces=namespaces))
            counts["images"] += len(content.xpath(".//a:blip[@r:embed]", namespaces=namespaces))
            counts["tables"] += len(content.xpath(".//w:tbl", namespaces=namespaces))
    if counts != expected:
        raise PaperError(f"DOCX content counts do not match Markdown. Expected {expected}. Reopened {counts}.")
    return counts


def validate_layout(data):
    if not data.startswith(b"%PDF-") or not data.rstrip().endswith(b"%%EOF"):
        raise PaperError("The layout proof is missing or is not a renderer-generated PDF.")


def render_layout(styled, scratch):
    extras = []
    if os.name == "nt":
        extras = [Path(os.environ[key]) / "LibreOffice" / "program" / "soffice.exe"
                  for key in ("ProgramFiles", "ProgramFiles(x86)") if key in os.environ]
    layout = scratch / "layout.pdf"
    dsoffice_cli = os.environ.get("MMW_DSOFFICE_CLI")
    soffice = None if dsoffice_cli else find_tool("MMW_SOFFICE", "soffice", extra=extras)
    if dsoffice_cli:
        cli = Path(dsoffice_cli)
        if not cli.is_absolute() or not cli.is_file():
            raise PaperError("MMW_DSOFFICE_CLI must be an absolute path to the LibreOffice Kit CLI script.")
        node = require_tool("MMW_NODE", "node")
        run_tool(
            "LibreOffice Kit PDF rendering",
            [node, str(cli.resolve(strict=True)), "convert", "--input", str(styled), "--output", str(layout)],
            scratch, timeout=75,
        )
    elif soffice:
        profile = (scratch / "lo-profile").as_uri()
        run_tool(
            "LibreOffice PDF rendering",
            [soffice, f"-env:UserInstallation={profile}", "--headless", "--convert-to", "pdf:writer_pdf_Export",
             "--outdir", str(scratch), str(styled)],
            scratch, timeout=75,
        )
    else:
        raise PaperError("Actual page-limit verification requires LibreOffice (MMW_SOFFICE or PATH) or LibreOffice Kit (MMW_DSOFFICE_CLI).")
    if not layout.is_file():
        raise PaperError("The renderer did not create the layout PDF.")
    validate_layout(layout.read_bytes())
    return layout


def make_state_dir(root):
    path = checked_path(root, ".mmw", directory=True, missing=True)
    path.mkdir(exist_ok=True)
    return checked_path(root, ".mmw", directory=True)


@contextmanager
def export_lock(root):
    make_state_dir(root)
    relative = ".mmw/.docx-export.lock"
    lock_path = checked_path(root, relative, missing=True)
    flags = os.O_CREAT | os.O_RDWR | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0)
    with os.fdopen(os.open(lock_path, flags, 0o600), "r+b") as stream:
        if not os.path.samestat(os.fstat(stream.fileno()), checked_path(root, relative).lstat()):
            raise PaperError("DOCX export lock changed while opening.")
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            raise PaperError("Another DOCX export is already running in this workspace.") from None
        yield


def publish(root, relative, data):
    target = checked_path(root, relative, missing=True)
    # Stage on the same filesystem so replacement is atomic even for large files.
    with tempfile.NamedTemporaryFile(dir=target.parent, prefix=".docx-paper-", delete=False) as stream:
        temp = Path(stream.name)
        try:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        except BaseException:
            stream.close()
            temp.unlink(missing_ok=True)
            raise
    try:
        os.replace(temp, checked_path(root, relative, missing=True))
    finally:
        temp.unlink(missing_ok=True)


def summary_sheet_required(args):
    return args.language == "en" and args.competition in {"mcm", "icm"}


def settings(args):
    return {"language": args.language, "competition": args.competition, "page_limit": args.page_limit}


def assert_inputs(root, paper):
    if digest(read_checked(root, SOURCE, SOURCE_MAX)) != paper.source_digest:
        raise PaperError("paper/main.md changed during DOCX processing. Run export again.")
    for relative, expected in paper.figure_digests.items():
        if digest(read_checked(root, relative, FIGURE_MAX)) != expected:
            raise PaperError(f"Figure changed during DOCX processing: {relative}. Run export again.")


def export(root, args, scratch):
    with export_lock(root):
        # The stamp is the commit marker. Invalidate it before any operation
        # which might subsequently fail, including Markdown precheck.
        checked_path(root, STAMP, missing=True).unlink(missing_ok=True)
        checked_path(root, OUTPUT, missing=True)
        checked_path(root, LAYOUT, missing=True)
        pandoc = require_tool("MMW_PANDOC", "pandoc")
        paper = precheck(root, pandoc, scratch, summary_sheet=summary_sheet_required(args))
        stage_figures(root, paper, scratch)
        raw = scratch / "pandoc.docx"
        styled = scratch / "layout.docx"
        run_tool(
            "Pandoc DOCX export",
            [pandoc, "--fail-if-warnings", "--data-dir", str(scratch), "--from", "json", "--to", "docx",
             "--resource-path", str(scratch), "--output", str(raw)],
            scratch, timeout=60, input_data=json.dumps(paper.tree, ensure_ascii=False).encode("utf-8"),
        )
        style_paper(raw, styled, args.language, summary_sheet=summary_sheet_required(args))
        docx_data = styled.read_bytes()
        actual = inspect_docx(docx_data, paper.counts)
        pdf_data = render_layout(styled, scratch).read_bytes() if args.page_limit else None
        assert_inputs(root, paper)
        stamp = {
            "version": STAMP_VERSION, "source_sha256": paper.source_digest,
            "figure_sha256": paper.figure_digests, "docx_sha256": digest(docx_data),
            "settings": settings(args), "stats": paper.stats, "counts": actual,
        }
        result = {**paper.stats, "counts": actual, "output": OUTPUT}
        publish(root, OUTPUT, docx_data)
        if pdf_data is not None:
            publish(root, LAYOUT, pdf_data)
            stamp["rendered_pdf"] = {"path": LAYOUT, "sha256": digest(pdf_data)}
            result["rendered_pdf"] = LAYOUT
        else:
            checked_path(root, LAYOUT, missing=True).unlink(missing_ok=True)
        publish(root, STAMP, (json.dumps(stamp, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
        return result


def verify(root, args, scratch):
    pandoc = require_tool("MMW_PANDOC", "pandoc")
    paper = precheck(root, pandoc, scratch, summary_sheet=summary_sheet_required(args))
    stamp_bytes = read_checked(root, STAMP, 2 * SOURCE_MAX)
    stamp = json.loads(stamp_bytes)
    expected = {
        "version": STAMP_VERSION, "source_sha256": paper.source_digest,
        "figure_sha256": paper.figure_digests, "settings": settings(args),
        "stats": paper.stats, "counts": paper.counts,
    }
    if not isinstance(stamp, dict) or any(stamp.get(key) != value for key, value in expected.items()):
        raise PaperError("The DOCX export stamp differs from the current Markdown, figures, or settings. Run export again.")
    docx_data = read_checked(root, OUTPUT, OUTPUT_MAX)
    if stamp.get("docx_sha256") != digest(docx_data):
        raise PaperError("paper/main.docx differs from the verified export. Run export again.")
    actual = inspect_docx(docx_data, paper.counts)
    result = {**paper.stats, "counts": actual, "output": OUTPUT}
    if args.page_limit:
        pdf_data = read_checked(root, LAYOUT, OUTPUT_MAX)
        validate_layout(pdf_data)
        if stamp.get("rendered_pdf") != {"path": LAYOUT, "sha256": digest(pdf_data)}:
            raise PaperError("The layout PDF differs from the verified export. Run export again.")
        result["rendered_pdf"] = LAYOUT
    elif "rendered_pdf" in stamp:
        raise PaperError("Unexpected layout proof in the DOCX export stamp. Run export again.")
    assert_inputs(root, paper)
    if read_checked(root, STAMP, 2 * SOURCE_MAX) != stamp_bytes:
        raise PaperError("The DOCX export was replaced during verification. Retry verification.")
    return result


def write_report(root, result=None, error=None):
    if error is None:
        details = [
            "# Competition DOCX precheck", "", "Passed for `paper/main.md`.", "",
            f"- Body characters: {result['body_chars']}",
            f"- Figures: {len(result['figures'])} ({len(result['body_figures'])} in the body)",
            f"- Body tables: {result['tables']}",
        ]
        if result["figures"]:
            details += ["", "Figure files:", *[f"- {item}" for item in result["figures"]]]
    else:
        details = ["# Competition DOCX precheck", "", "Failed for `paper/main.md`.", "", str(error)]
    publish(root, REPORT, ("\n".join(details) + "\n").encode("utf-8"))


class JsonArgumentParser(argparse.ArgumentParser):
    def error(self, message):
        raise PaperError(message)


def main(argv=None):
    args = None
    root = None
    try:
        parser = JsonArgumentParser(description=__doc__)
        parser.add_argument("operation", choices=("precheck", "export", "verify"))
        parser.add_argument("--workspace", required=True)
        parser.add_argument("--language", required=True, choices=("zh", "en"))
        parser.add_argument("--competition", required=True)
        parser.add_argument("--page-limit", type=int, default=0)
        parser.add_argument("--report", action="store_true", help=f"write {REPORT} after precheck")
        args = parser.parse_args(argv)
        if args.page_limit < 0:
            raise PaperError("--page-limit must be a nonnegative integer.")
        if args.report and args.operation != "precheck":
            raise PaperError("--report is only available for precheck.")
        root = workspace_root(args.workspace)
        # Staging contains generated filenames only. Never run converters from
        # the paper directory or hand them workspace-controlled path arguments.
        with tempfile.TemporaryDirectory(prefix="mmw-docx-") as temp:
            scratch = Path(temp).resolve(strict=True)
            if args.operation == "precheck":
                pandoc = require_tool("MMW_PANDOC", "pandoc")
                result = precheck(root, pandoc, scratch, summary_sheet=summary_sheet_required(args)).stats
                if args.report:
                    write_report(root, result=result)
            elif args.operation == "export":
                result = export(root, args, scratch)
            else:
                result = verify(root, args, scratch)
    except Exception as exc:
        message = str(exc) or type(exc).__name__
        if isinstance(exc, ImportError):
            message = f"DOCX runtime dependency is unavailable: {message}. Install python-docx, lxml and Pillow."
        if root is not None and args.operation == "precheck" and args.report:
            try:
                write_report(root, error=message)
            except (OSError, PaperError) as report_error:
                message += f" Report could not be written: {report_error}."
        print(json.dumps({"ok": False, "error": message}, ensure_ascii=True))
        return 1
    print(json.dumps({"ok": True, **result}, ensure_ascii=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
