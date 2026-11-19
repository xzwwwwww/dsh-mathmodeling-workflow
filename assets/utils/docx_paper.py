#!/usr/bin/env python3
"""Precheck, export, and verify the modeling workflow's competition Word paper.

The local Agent's packaged DOCX tools apply the competition profile. Pandoc
parses Markdown solely for independent source checks, and a separate Word
package check binds the output to the source, figures, and Agent runtime.
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
STAMP_VERSION = 2
AGENT_CONFIG = ".mmw/docx-agent.json"
TEMPLATE_MAP = "_template_map.json"
TEMPLATE_PREVIEW = "_template_test_filled.docx"
TEMPLATE_KEYS = ("title", "abstract", "body", "references", "appendix")
READER = "commonmark_x+sourcepos+implicit_figures-yaml_metadata_block-smart"
FRONTMATTER = re.compile(r"\A---\s*\n[\s\S]*?\n---\s*\n")
AGENT_IMAGE = re.compile(r"!\[([^\]]*)\]\(([^)]+)\)")
SUP_SUB = re.compile(r"</?(?:sup|sub)>", re.I)
INLINE_TAG = re.compile(r"\\tag\{([^}]+)\}")

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
    lines: list[str]
    source_digest: str
    figure_digests: dict[str, str]
    image_lines: dict[int, tuple[str, str]]
    title: str
    first_body_heading: str
    stats: dict
    counts: dict[str, int]


@dataclass
class AgentRuntime:
    app: Path
    python: str
    node: str
    pandoc: str
    precheck: Path
    exporter: Path
    profile: Path
    engine: Path
    filler: Path | None

    def environment(self):
        # The original exporter locates Node through PATH and allows an engine
        # override. Use the resolved originals and disable Node preload/options.
        env = {key: value for key, value in os.environ.items()
               if key.upper() not in {"NODE_OPTIONS", "NODE_PATH", "ELECTRON_RUN_AS_NODE", "PATH"}}
        env["PATH"] = str(Path(self.node).parent)
        env["DOCX_CN_ENGINE_DIR"] = str(self.engine)
        return env

    def fingerprint(self):
        paths = (Path(self.python), Path(self.node), self.precheck, self.exporter, self.profile,
                 self.engine / "md_to_docx.js", self.engine / "mathml-to-docx.js", self.engine / "package.json",
                 self.engine / "package-lock.json", self.filler)
        files = {}
        for path in paths:
            if path is not None and path.is_file():
                with path.open("rb") as stream:
                    files[str(path)] = hashlib.file_digest(stream, "sha256").hexdigest()
        return {"app": str(self.app), "files": files}


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
        try:
            if candidate.is_file() and os.access(candidate, os.X_OK):
                return str(candidate.resolve(strict=True))
        except OSError:
            # Windows PATH may contain Microsoft Store executable aliases.
            continue
    for candidate in extra:
        if candidate.is_file():
            return str(candidate.resolve(strict=True))
    return None


def resolve_agent_python(override, bundled, extension, external):
    probe = ["-I", "-X", "utf8", "-c",
             "import sys; sys.exit(1) if sys.version_info[:2] != (3, 11) else print(sys.executable)"]

    def compatible(path, args=()):
        try:
            result = subprocess.run([str(path), *args, *probe], cwd=Path(sys.executable).parent,
                                    capture_output=True, timeout=10, check=True)
            return external(result.stdout.decode("utf-8").strip(), "Agent Python 3.11")
        except (OSError, subprocess.SubprocessError):
            return None

    if override:
        path = external(override, "Agent Python 3.11")
        selected = compatible(path)
        if not selected:
            raise PaperError(f"Agent DOCX bytecode requires Python 3.11; check MMW_DOCX_AGENT_PYTHON: {path}")
        return selected

    candidates = [bundled / "python" / ("python" + extension), Path(sys.executable)]
    candidates.extend(find_tool("MMW_DOCX_AGENT_PYTHON", name) for name in ("python3.11", "python3", "python"))
    for candidate in dict.fromkeys(candidate for candidate in candidates if candidate):
        if Path(candidate).is_file():
            selected = compatible(external(candidate, "Agent Python"))
            if selected:
                return selected
    launcher = find_tool("MMW_DOCX_AGENT_PYTHON", "py") if os.name == "nt" else None
    if launcher:
        selected = compatible(external(launcher, "Windows Python launcher"), ("-3.11",))
        if selected:
            return selected
    raise PaperError("Agent DOCX bytecode needs Python 3.11. Set MMW_DOCX_AGENT_PYTHON to its absolute executable path.")


def agent_runtime(root, args):
    config = {}
    config_path = root / AGENT_CONFIG
    if not args.agent_app and (config_path.exists() or config_path.is_symlink()):
        config = json.loads(read_checked(root, AGENT_CONFIG, 16 * 1024))
        if not isinstance(config, dict):
            raise PaperError(f"{AGENT_CONFIG} must contain an object.")
    packaged = Path(__file__).resolve().parents[1] / "docx-agent"
    value = args.agent_app or os.environ.get("MMW_DOCX_AGENT_APP") or config.get("agentApp") or packaged

    def external(value, label, *, directory=False):
        if not isinstance(value, (str, Path)) or not Path(value).is_absolute():
            raise PaperError(f"{label} must be an absolute local path.")
        path = Path(value).resolve()
        if path.is_relative_to(root) or str(path).startswith(("\\\\", "//")):
            raise PaperError(f"{label} must be installed locally outside the modeling workspace.")
        if not (path.is_dir() if directory else path.is_file()):
            raise PaperError(f"Missing {label}: {path}")
        return path

    app = external(value, "Agent resources/app", directory=True)
    bundled = app.parent.parent / "runtime"
    extension = ".exe" if os.name == "nt" else ""
    python_override = os.environ.get("MMW_DOCX_AGENT_PYTHON") or config.get("python")
    python = resolve_agent_python(python_override, bundled, extension, external)
    if os.environ.get("MMW_NODE"):
        node_value = os.environ["MMW_NODE"]
    else:
        node_value = config.get("node") or find_tool("MMW_NODE", "node", (
            bundled / "node" / ("node" + extension), bundled / "node" / "bin" / ("node" + extension),
        ))
    if not node_value:
        raise PaperError("Install Node.js or set MMW_NODE to the actual absolute node executable path.")
    node = external(node_value, "Node executable")
    if node.name.casefold() != ("node" + extension):
        raise PaperError("The Agent exporter requires a plain node executable named node or node.exe.")
    pandoc = find_tool("MMW_PANDOC", "pandoc", (bundled / "pandoc" / ("pandoc" + extension),))
    if not pandoc:
        raise PaperError("Install Pandoc for independent Markdown checks or set MMW_PANDOC to its absolute executable path.")
    pandoc = external(pandoc, "Pandoc executable")
    tools = app / "tools"
    engine = external(tools / "docx-cn-engine", "Agent docx-cn-engine", directory=True)
    external(engine / "md_to_docx.js", "Agent Node engine entry point")
    profile = external(tools / "docx_style_profiles" / f"competition_{args.language}.json", "Agent competition profile")

    def original_tool(name):
        source = tools / f"{name}.py"
        return external(source if source.is_file() else tools / f"{name}.pyc", f"Agent {name}")

    filler = original_tool("docx_template_fill") if (root / TEMPLATE_MAP).exists() else None
    return AgentRuntime(app, str(python), str(node), str(pandoc), original_tool("docx_precheck"),
                        original_tool("docx_export"), profile, engine, filler)


def run_tool(label, argv, cwd, *, timeout, input_data=None, env=None, with_stderr=False):
    try:
        result = subprocess.run(
            argv, cwd=cwd, input=input_data, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, timeout=timeout, shell=False, env=env,
        )
    except subprocess.TimeoutExpired:
        raise PaperError(f"{label} timed out after {timeout} seconds.") from None
    except OSError as exc:
        raise PaperError(f"Cannot start {label}: {exc}") from None
    if result.returncode:
        detail = (result.stderr or result.stdout).decode("utf-8", "replace").strip()
        raise PaperError(f"{label} failed ({result.returncode}): {detail[-2200:]}")
    return (result.stdout, result.stderr) if with_stderr else result.stdout


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
            kind, raw = node["c"]
            if tag != "RawInline" or kind != "html" or not SUP_SUB.fullmatch(raw):
                raise PaperError("Use Markdown, supported inline superscripts/subscripts, and $…$ math instead of raw HTML or LaTeX blocks.")
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
    lines = text.split("\n")
    # The original engine accepts and omits an optional front matter header.
    # Mask it for source validation without changing the line numbers.
    frontmatter = FRONTMATTER.match(text)
    validation_text = "\n" * frontmatter.group().count("\n") + text[frontmatter.end():] if frontmatter else text
    parsed = run_tool(
        "Pandoc Markdown precheck",
        [pandoc, "--sandbox", "--fail-if-warnings", "--from", READER, "--to", "json"],
        scratch, timeout=30, input_data=validation_text.encode("utf-8"),
    )
    tree = json.loads(parsed)
    image_positions = {id(node): dict(attrs_of(node)[2]).get("data-pos", "")
                       for node in nodes(tree["blocks"]) if node["t"] == "Image"}
    title_nodes, table_labels = sanitized_blocks(tree, lines)
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
    image_lines = {}
    counts = {"equations": 0, "images": 0, "tables": 0}
    for node in emitted_nodes(blocks):
        tag = node["t"]
        if tag == "Image":
            relative = figure_path(root, node["c"][2][0])
            number = image_positions[id(node)].split(":", 1)[0]
            if not number.isdecimal() or not 0 < int(number) <= len(lines):
                raise PaperError("Could not locate the source line for a Markdown figure.")
            index = int(number) - 1
            image = AGENT_IMAGE.fullmatch(lines[index].strip())
            if index in image_lines or not image:
                raise PaperError(f"Put each figure on its own line as ![caption](figures/file.png), line {number}.")
            image_lines[index] = (relative, image.group(1))
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
        lines, digest(data), figure_digests, image_lines, prose(headings[0]),
        next(prose(heading) for kind, heading, _ in sections if kind != "abstract"), {
            "body_chars": len(prose([item for item in body_blocks if not NO_AI_STATEMENT.fullmatch(prose(item))])),
            "figures": list(figure_digests),
            "body_figures": list(dict.fromkeys(body_figures)),
            "tables": body_tables,
            "body_table_ids": list(dict.fromkeys(body_table_ids)),
            "body_headings": body_headings,
        }, counts,
    )


def stage_paper(root, paper, scratch, runtime):
    figures = scratch / "figures"
    figures.mkdir()
    staged = {}
    for index, (relative, expected) in enumerate(paper.figure_digests.items(), start=1):
        image = read_checked(root, relative, FIGURE_MAX)
        if digest(image) != expected:
            raise PaperError(f"Figure changed after precheck: {relative}")
        suffix = Path(relative).suffix.lower()
        name = f"mmw-image-{index}{suffix}"
        (figures / name).write_bytes(image)
        if suffix == ".pdf":
            pdftoppm = find_tool("MMW_PDFTOPPM", "pdftoppm")
            prefix = f"mmw-raster-{index}"
            if pdftoppm:
                run_tool(
                    f"Rasterizing {relative}",
                    [pdftoppm, "-f", "1", "-l", "2", "-r", "180", "-scale-to", "1800", "-png", name, prefix],
                    figures, timeout=30,
                )
                rasters = list(figures.glob(f"{prefix}-*.png"))
                if len(rasters) != 1:
                    raise PaperError(f"Expected a single-page PDF figure: {relative}")
                name = rasters[0].name
            else:
                # Agent includes PyMuPDF. Keep the same extent bound as Poppler.
                output = f"{prefix}.png"
                run_tool(
                    f"Rasterizing {relative} with Agent PyMuPDF",
                    [runtime.python, "-I", "-X", "utf8", "-c", PDF_RASTER_SCRIPT, name, output],
                    figures, timeout=30, env=runtime.environment(),
                )
                name = output
            validate_figure(name, read_checked(scratch, f"figures/{name}", FIGURE_MAX))
        staged[relative] = f"figures/{name}"

    lines = paper.lines.copy()
    for index, (relative, caption) in paper.image_lines.items():
        lines[index] = f"![{caption}]({staged[relative]})"
    markdown = "\n".join(lines)
    # Table and figure manifest comments were captured from the canonical AST.
    # Agent precheck removes non-code comments, and the Node engine omits them.
    chunks = re.split(r"(```[\s\S]*?```)", markdown)
    markdown = "".join(
        chunk if index % 2 else re.sub(r"<!--[\s\S]*?-->", lambda match: "\n" * match.group().count("\n"), chunk)
        for index, chunk in enumerate(chunks)
    )
    assert_staged_images(markdown, staged.values())
    source = scratch / SOURCE
    source.parent.mkdir()
    source.write_bytes(markdown.encode("utf-8"))
    return source, staged


PDF_RASTER_SCRIPT = """
import fitz
import sys
with fitz.open(sys.argv[1]) as doc:
    if doc.page_count != 1:
        raise ValueError("Expected a single-page PDF figure")
    page = doc[0]
    zoom = min(180 / 72, 1800 / max(page.rect.width, page.rect.height))
    page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False).save(sys.argv[2])
"""


def assert_staged_images(markdown, staged_paths):
    allowed = set(staged_paths)
    # The Agent's PDF scanner looks for image syntax even in comments and code.
    # Permit those literals only where they cannot escape the staging directory.
    for image in AGENT_IMAGE.finditer(markdown):
        value = image.group(2).strip().split(" ", 1)[0]
        if value in allowed:
            continue
        if (
            not value or value.startswith(("/", "\\")) or re.search(r"[:\\\x00-\x1f]", value)
            or any(part == ".." or (os.name == "nt" and part.endswith((" ", ".")) and part != ".")
                   for part in value.split("/"))
        ):
            raise PaperError("An image reference outside the validated paper figures uses an unsafe staging path.")


def original_precheck(runtime, scratch, source, staged):
    report = scratch / REPORT
    run_tool(
        "Agent DOCX precheck",
        [runtime.python, "-I", "-X", "utf8", str(runtime.precheck), "--source", str(source),
         "--workspace", str(scratch), "--report", str(report), "--fail-on-fatal"],
        scratch, timeout=60, env=runtime.environment(),
    )
    repaired = read_checked(scratch, SOURCE, SOURCE_MAX)
    assert_staged_images(repaired.decode("utf-8"), staged.values())
    # Agent may normalize its staged copy (for example, a valid one-line
    # display equation). Word output is still checked against the canonical AST.
    return read_checked(scratch, REPORT, SOURCE_MAX)


@dataclass
class CustomTemplate:
    path: str
    data: bytes
    mapping: bytes
    counts: dict[str, int]

    def fingerprint(self):
        return {"path": self.path, "sha256": digest(self.data), "map_sha256": digest(self.mapping)}


def custom_template(root):
    map_path = checked_path(root, TEMPLATE_MAP, missing=True)
    if not map_path.exists():
        return None
    mapping = read_checked(root, TEMPLATE_MAP, SOURCE_MAX)
    config = json.loads(mapping)
    if not isinstance(config, dict):
        raise PaperError(f"{TEMPLATE_MAP} must be a template anchor object.")
    anchor_values = [config.get(f"{name}_anchor_para_idx") for name in TEMPLATE_KEYS]
    indices = [value for value in anchor_values if value is not None]
    deleted = config.get("delete_paragraph_indices", [])
    if (any(value is None for value in anchor_values[:4]) or not isinstance(deleted, list)
            or any(type(value) is not int or value < 0 for value in indices + deleted)
            or len(set(indices)) != len(indices) or set(indices) & set(deleted)
            or config.get("body_anchor_mode", "delete") not in {"keep", "delete"}):
        raise PaperError(f"{TEMPLATE_MAP} has missing, invalid, or conflicting paragraph anchors.")
    user_data = checked_path(root, "user_data", directory=True)
    files = sorted(candidate.name for candidate in user_data.iterdir()
                   if candidate.suffix.lower() in {".docx", ".dotx"} and not candidate.name.startswith("~$"))
    if len(files) != 1:
        raise PaperError(f"{TEMPLATE_MAP} requires exactly one .docx or .dotx template in user_data/.")
    relative = f"user_data/{files[0]}"
    data = read_checked(root, relative, OUTPUT_MAX)
    counts = package_counts(data)
    return CustomTemplate(relative, data, mapping, counts)


def template_fingerprint(template):
    return template.fingerprint() if template else None


TEMPLATE_FILL_SCRIPT = """
import importlib.util
import runpy
import shutil
import sys

exporter, filler = sys.argv[1:3]
name = '_mh_tools_docx_export_fill_view'
spec = importlib.util.spec_from_file_location(name, exporter)
module = importlib.util.module_from_spec(spec)
sys.modules[name] = module
spec.loader.exec_module(module)
# The original filler checks for node_modules immediately beside its JS entry.
# Node resolves bundled dependencies through the enclosing plugin directory.
module._is_node_engine_available = lambda: bool(shutil.which('node'))
sys.argv = [filler, *sys.argv[3:]]
runpy.run_path(filler, run_name='__main__')
"""


def template_export(runtime, template, scratch, source, raw):
    target = scratch / ("template" + Path(template.path).suffix.lower())
    target.write_bytes(template.data)
    (scratch / TEMPLATE_MAP).write_bytes(template.mapping)
    env = runtime.environment()
    env.update({"TEMP": str(scratch), "TMP": str(scratch), "TMPDIR": str(scratch)})
    _, log = run_tool(
        "Agent DOCX template fill",
        [runtime.python, "-I", "-X", "utf8", "-c", TEMPLATE_FILL_SCRIPT, str(runtime.exporter),
         str(runtime.filler), "--template", str(target), "--source", str(source), "--output", str(raw),
         "--profile", str(runtime.profile), "--workspace", str(scratch)],
        scratch, timeout=140, env=env, with_stderr=True,
    )
    return log


def apply_summary_break(raw, first_heading, template=None):
    from docx import Document
    from docx.oxml.ns import qn

    doc = Document(raw)
    heading = next((p for p in doc.paragraphs if normalized_text(p.text) == normalized_text(first_heading)
                    and (template or (p.style is not None and p.style.name == "Heading 2"))), None)
    if heading is None:
        raise PaperError(f"DOCX is missing the heading after the Summary Sheet: {first_heading}")
    if heading.paragraph_format.page_break_before:
        return
    style = heading.style
    while style is not None:
        if style.paragraph_format.page_break_before:
            return
        style = style.base_style
    previous = heading._p.getprevious()
    if previous is not None and previous.tag == qn("w:p") and (
        previous.xpath(".//w:br[@w:type='page']") or previous.xpath("./w:pPr/w:sectPr")
    ):
        return
    heading.paragraph_format.page_break_before = True
    doc.save(raw)


def normalized_text(text):
    mapped = unicodedata.normalize("NFKC", text).translate(str.maketrans("‘’“”", "''\"\""))
    return " ".join(mapped.split())

def package_counts(data):
    from lxml import etree

    namespaces = {
        "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
        "m": "http://schemas.openxmlformats.org/officeDocument/2006/math",
        "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
        "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    }
    counts = dict.fromkeys(("equations", "images", "tables"), 0)
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
            # The original engine uses a borderless, single-row, three-cell
            # table for each centered display equation and its equation number.
            counts["tables"] += len(content.xpath(
                ".//w:tbl[not(count(w:tr)=1 and count(w:tr/w:tc)=3 and w:tr/w:tc[2]//m:oMath"
                " and w:tblPr/w:tblBorders/w:top/@w:val='none' and not(w:tr/w:trPr/w:tblHeader))]",
                namespaces=namespaces,
            ))
            for equation in content.xpath(".//m:oMath", namespaces=namespaces):
                text = "".join(equation.xpath(".//m:t/text()", namespaces=namespaces))
                if PARSE_ERROR.search(text) or LATEX_COMMAND.search(text) or INLINE_TAG.search(text):
                    raise PaperError(f"Agent DOCX contains unconverted math: {text[:120]}")
    return counts


def inspect_docx(data, paper, template=None):
    from docx import Document

    if len(data) < 10000:
        raise PaperError("Agent DOCX output is smaller than the original 10 KB minimum.")
    counts = package_counts(data)
    expected = paper.counts
    if template:
        expected = {key: count + template.counts[key] for key, count in expected.items()}
    doc = Document(io.BytesIO(data))
    paragraphs = [normalized_text(p.text) for p in doc.paragraphs if p.text.strip()]
    title = normalized_text(paper.title)
    title_matches = title in (paragraphs if template else paragraphs[:1])
    if not doc.sections or not title_matches:
        raise PaperError("DOCX could not be reopened with the expected paper title and page layout.")
    if len(doc.inline_shapes) < paper.counts["images"]:
        raise PaperError("DOCX could not be reopened with the expected figures.")
    if counts != expected:
        raise PaperError(f"DOCX content counts do not match Markdown and template. Expected {expected}. Reopened {counts}.")
    return paper.counts


def validate_layout(data):
    if not data.startswith(b"%PDF-") or not data.rstrip().endswith(b"%%EOF"):
        raise PaperError("The layout proof is missing or is not a renderer-generated PDF.")


def render_layout(styled, scratch, node):
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
        if not args.template_preview:
            checked_path(root, STAMP, missing=True).unlink(missing_ok=True)
            checked_path(root, OUTPUT, missing=True)
            checked_path(root, LAYOUT, missing=True)
        runtime = agent_runtime(root, args)
        runtime_stamp = runtime.fingerprint()
        paper = precheck(root, runtime.pandoc, scratch, summary_sheet=summary_sheet_required(args))
        source, staged = stage_paper(root, paper, scratch, runtime)
        template = custom_template(root)
        if args.template_preview and template is None:
            raise PaperError(f"--template-preview requires {TEMPLATE_MAP} and one template in user_data/.")
        report = run_precheck_report(root, runtime, scratch, source, staged, write=not args.template_preview)
        raw = scratch / "layout.docx"
        if template:
            log = template_export(runtime, template, scratch, source, raw)
        else:
            _, log = run_tool(
                "Agent DOCX export",
                [runtime.python, "-I", "-X", "utf8", str(runtime.exporter), "--source", str(source),
                 "--output", str(raw), "--profile", str(runtime.profile), "--workspace", str(scratch),
                 "--engine", "node"],
                scratch, timeout=140, env=runtime.environment(), with_stderr=True,
            )
        if b"DOCX exported via Node engine:" not in log:
            raise PaperError("Agent export did not confirm use of the packaged Node DOCX engine.")
        if summary_sheet_required(args):
            apply_summary_break(raw, paper.first_body_heading, template)
        docx_data = read_checked(scratch, raw.name, OUTPUT_MAX)
        actual = inspect_docx(docx_data, paper, template)
        if args.template_preview:
            assert_inputs(root, paper)
            if template_fingerprint(custom_template(root)) != template.fingerprint():
                raise PaperError("The template or its map changed during preview. Run export again.")
            publish(root, TEMPLATE_PREVIEW, docx_data)
            return {**paper.stats, "counts": actual, "output": TEMPLATE_PREVIEW}
        pdf_data = render_layout(raw, scratch, runtime.node).read_bytes() if args.page_limit else None
        assert_inputs(root, paper)
        if runtime.fingerprint() != runtime_stamp or template_fingerprint(custom_template(root)) != template_fingerprint(template):
            raise PaperError("Agent DOCX runtime, profile, or template changed during export. Run export again.")
        stamp = {
            "version": STAMP_VERSION, "source_sha256": paper.source_digest,
            "figure_sha256": paper.figure_digests, "docx_sha256": digest(docx_data),
            "agent_runtime": runtime_stamp, "precheck_report_sha256": digest(report),
            "template": template_fingerprint(template),
            "settings": settings(args), "stats": paper.stats, "counts": actual,
        }
        result = {**paper.stats, "counts": actual, "output": OUTPUT, "report": REPORT}
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
    runtime = agent_runtime(root, args)
    paper = precheck(root, runtime.pandoc, scratch, summary_sheet=summary_sheet_required(args))
    template = custom_template(root)
    stamp_bytes = read_checked(root, STAMP, 2 * SOURCE_MAX)
    stamp = json.loads(stamp_bytes)
    expected = {
        "version": STAMP_VERSION, "source_sha256": paper.source_digest,
        "figure_sha256": paper.figure_digests, "settings": settings(args),
        "stats": paper.stats, "counts": paper.counts, "agent_runtime": runtime.fingerprint(),
        "precheck_report_sha256": digest(read_checked(root, REPORT, SOURCE_MAX)), "template": template_fingerprint(template),
    }
    if not isinstance(stamp, dict) or any(stamp.get(key) != value for key, value in expected.items()):
        raise PaperError("The DOCX export stamp differs from the current Markdown, figures, report, settings, or Agent runtime. Run export again.")
    docx_data = read_checked(root, OUTPUT, OUTPUT_MAX)
    if stamp.get("docx_sha256") != digest(docx_data):
        raise PaperError("paper/main.docx differs from the verified export. Run export again.")
    actual = inspect_docx(docx_data, paper, template)
    result = {**paper.stats, "counts": actual, "output": OUTPUT, "report": REPORT}
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


def run_precheck_report(root, runtime, scratch, source, staged, *, write):
    try:
        return original_precheck(runtime, scratch, source, staged)
    finally:
        if write and (scratch / REPORT).is_file():
            publish(root, REPORT, read_checked(scratch, REPORT, SOURCE_MAX))


def write_error_report(root, error):
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
        parser.add_argument("--agent-app", help="absolute path to the Agent DOCX assets directory")
        parser.add_argument("--template-preview", action="store_true", help=f"write {TEMPLATE_PREVIEW} only")
        parser.add_argument("--report", action="store_true", help=f"write {REPORT} after precheck")
        args = parser.parse_args(argv)
        if args.page_limit < 0:
            raise PaperError("--page-limit must be a nonnegative integer.")
        if args.report and args.operation != "precheck":
            raise PaperError("--report is only available for precheck.")
        if args.template_preview and args.operation != "export":
            raise PaperError("--template-preview is only available for export.")
        root = workspace_root(args.workspace)
        # Staging contains generated filenames only. Never run converters from
        # the paper directory or hand them workspace-controlled path arguments.
        with tempfile.TemporaryDirectory(prefix="mmw-docx-") as temp:
            scratch = Path(temp).resolve(strict=True)
            if args.operation == "precheck":
                try:
                    runtime = agent_runtime(root, args)
                    paper = precheck(root, runtime.pandoc, scratch, summary_sheet=summary_sheet_required(args))
                    source, staged = stage_paper(root, paper, scratch, runtime)
                    run_precheck_report(root, runtime, scratch, source, staged, write=args.report)
                    assert_inputs(root, paper)
                    result = paper.stats
                except Exception as exc:
                    if args.report and not (scratch / REPORT).is_file():
                        write_error_report(root, str(exc) or type(exc).__name__)
                    raise
            elif args.operation == "export":
                result = export(root, args, scratch)
            else:
                result = verify(root, args, scratch)
    except Exception as exc:
        message = str(exc) or type(exc).__name__
        if isinstance(exc, ImportError):
            message = f"DOCX runtime dependency is unavailable: {message}. Install python-docx, lxml and Pillow."
        print(json.dumps({"ok": False, "error": message}, ensure_ascii=True))
        return 1
    print(json.dumps({"ok": True, **result}, ensure_ascii=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
