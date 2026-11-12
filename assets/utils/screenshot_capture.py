# -*- coding: utf-8 -*-
"""HTML → PDF/PNG 截图与几何自检（随插件提供，无需额外安装）。

用本机已安装的 Chromium 内核浏览器（Edge / Chrome / Chromium）无头渲染：
- `--file x.html --out x.pdf --format pdf` 出矢量 PDF（@page 尺寸取自实际内容，无页边距、无页眉页脚）
- `--file x.html --out x.png --format png` 出位图预览
- `--render-math`：把页面里的 `\\(...\\)` / `\\[...\\]` / `$$...$$` 用随包 KaTeX 渲染
- `--geom-check x.html`：元素级几何自检（文字溢出/越界/文字块重叠/data-mmw-col|row 对齐），
  退出码 0=通过 1=有问题 2=无法检查（浏览器缺失）

浏览器查找顺序：`MMW_BROWSER` 环境变量 → 常见安装路径 → PATH（msedge/chrome/chromium）。
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

TOL = 2.0

BROWSER_CANDIDATES = [
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/usr/bin/microsoft-edge",
]


def browser_candidates():
    configured = os.environ.get("MMW_BROWSER", "").strip()
    if configured and Path(configured).is_file():
        return [configured]
    candidates = BROWSER_CANDIDATES + [
        shutil.which(name) for name in ("msedge", "chrome", "chromium", "chromium-browser", "google-chrome", "microsoft-edge")
    ]
    return list(dict.fromkeys(candidate for candidate in candidates if candidate and Path(candidate).is_file()))


def read_html(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def katex_dir(script_dir: Path) -> Path:
    for candidate in (script_dir / "katex", script_dir.parent / "katex", Path.cwd() / "_utils" / "katex"):
        if (candidate / "katex.min.js").is_file():
            return candidate
    return None


MATH_SCRIPT = """
<script>
(function () {
  function run() {
    if (typeof renderMathInElement !== 'function') return;
    try {
      renderMathInElement(document.body, {
        delimiters: [
          {left: '$$', right: '$$', display: true},
          {left: '\\\\[', right: '\\\\]', display: true},
          {left: '\\\\(', right: '\\\\)', display: false}
        ],
        throwOnError: false
      });
    } catch (e) {}
  }
  if (document.readyState === 'complete') run();
  else window.addEventListener('load', run);
})();
</script>
"""

GEOM_SCRIPT = """
<script>
(function () {
  function txt(el) {
    var t = (el.innerText || '').trim();
    return t.length > 0;
  }
  function inMath(el) {
    for (var n = el; n && n !== document.body; n = n.parentElement) {
      var c = n.className;
      if (typeof c === 'string' && c.indexOf('katex') >= 0) return true;
      if (n.tagName && n.tagName.toLowerCase() === 'mjx-container') return true;
    }
    return false;
  }
  function isLeafText(el) {
    if (!el || !el.getBoundingClientRect) return false;
    if (!txt(el)) return false;
    if (inMath(el)) return false;
    if (el.clientWidth === 0) return false;
    for (var i = 0; i < el.children.length; i++) {
      if (txt(el.children[i])) return false;
    }
    var cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) return false;
    return true;
  }
  function box(el) {
    var r = el.getBoundingClientRect();
    return {l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height};
  }
  function overlaps(a, b) {
    var x = Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l));
    var y = Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t));
    if (x <= 0 || y <= 0) return 0;
    var inter = x * y;
    return inter / Math.max(1, Math.min(a.w * a.h, b.w * b.h));
  }
  function run() {
    var body = document.body;
    var br = box(body);
    var problems = [];
    var leaves = [];
    var all = body.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (isLeafText(el)) leaves.push(el);
    }
    // 1) 文本溢出被裁
    leaves.forEach(function (el) {
      if (el.scrollWidth > el.clientWidth + 3 && getComputedStyle(el).overflow !== 'visible') {
        problems.push({type: 'text_clipped', tag: el.tagName.toLowerCase(),
          text: (el.innerText || '').trim().slice(0, 40)});
      }
    });
    // 2) 越出画布
    leaves.forEach(function (el) {
      var r = box(el);
      if (r.l < br.l - 2 || r.t < br.t - 2 || r.r > br.r + 2 || r.b > br.b + 2) {
        problems.push({type: 'out_of_canvas', tag: el.tagName.toLowerCase(),
          text: (el.innerText || '').trim().slice(0, 40)});
      }
    });
    // 3) 文字块重叠
    for (var a = 0; a < leaves.length; a++) {
      for (var b = a + 1; b < leaves.length; b++) {
        var ratio = overlaps(box(leaves[a]), box(leaves[b]));
        if (ratio > 0.15) {
          problems.push({type: 'text_overlap', ratio: Math.round(ratio * 100) / 100,
            a: (leaves[a].innerText || '').trim().slice(0, 24),
            b: (leaves[b].innerText || '').trim().slice(0, 24)});
        }
      }
    }
    // 4) data-mmw-col / data-mmw-row 对齐
    ['col', 'row'].forEach(function (axis) {
      var groups = {};
      var marked = body.querySelectorAll('[data-mmw-' + axis + ']');
      for (var i = 0; i < marked.length; i++) {
        var key = marked[i].getAttribute('data-mmw-' + axis);
        (groups[key] = groups[key] || []).push(box(marked[i]));
      }
      Object.keys(groups).forEach(function (key) {
        var centers = groups[key].map(function (r) { return axis === 'col' ? r.l + r.w / 2 : r.t + r.h / 2; });
        var spread = Math.max.apply(null, centers) - Math.min.apply(null, centers);
        if (spread > 3) {
          problems.push({type: 'misaligned_' + axis, group: key, spread: Math.round(spread * 10) / 10});
        }
      });
    });
    // 画布尺寸取 body 盒与文档滚动的较大者：width:fit-content 下 body rect 可能小于真实内容
    var canvasW = Math.max(br.w, document.documentElement.scrollWidth, body.scrollWidth);
    var canvasH = Math.max(br.h, document.documentElement.scrollHeight, body.scrollHeight);
    var payload = {
      ok: problems.length === 0,
      problems: problems.slice(0, 40),
      count: problems.length,
      size: {w: Math.round(canvasW), h: Math.round(canvasH)},
      scroll: {w: Math.round(document.documentElement.scrollWidth), h: Math.round(document.documentElement.scrollHeight)}
    };
    var node = document.createElement('div');
    node.id = 'mmw-geom-data';
    node.style.display = 'none';
    node.textContent = 'MMWGEOM:' + JSON.stringify(payload);
    document.body.appendChild(node);
  }
  if (document.readyState === 'complete') run();
  else window.addEventListener('load', run);
})();
</script>
"""


def inject(html: str, extra: str) -> str:
    if "</body>" in html:
        return html.replace("</body>", extra + "</body>", 1)
    return html + extra


def prepare(src: Path, workdir: Path, render_math: bool, measure: bool, script_dir: Path):
    html = read_html(src)
    extra = ""
    if measure:
        extra += GEOM_SCRIPT
    if render_math:
        kd = katex_dir(script_dir)
        if kd is not None:
            base = kd.as_uri()
            extra = (
                f'<link rel="stylesheet" href="{base}/katex.embedded.css">'
                f'<script src="{base}/katex.min.js"></script>'
                f'<script src="{base}/auto-render.min.js"></script>'
            ) + MATH_SCRIPT + extra
        else:
            print("[capture] ⚠ 未找到 KaTeX 素材（_utils/katex/），公式按原样输出", file=sys.stderr)
    html = inject(html, extra)
    target = workdir / (src.stem + (".measure.html" if measure else ".render.html"))
    target.write_text(html, encoding="utf-8")
    return target


def run_browser(browser: str, args, timeout: int):
    cmd = [browser, "--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage",
           "--hide-scrollbars", "--allow-file-access-from-files", "--force-device-scale-factor=2",
           *args]
    try:
        return subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace",
                              timeout=timeout, check=False)
    except subprocess.TimeoutExpired:
        return None


def measure(browser: str, page: Path, timeout: int):
    result = run_browser(browser, [
        "--virtual-time-budget=4000", "--dump-dom", page.as_uri(),
    ], timeout)
    if result is None or result.returncode != 0:
        return None
    match = re.search(r"MMWGEOM:(\{.*?\})<", result.stdout, re.S)
    if not match:
        return None
    try:
        return json.loads(match.group(1))
    except json.JSONDecodeError:
        return None


def measure_available(browsers, page, timeout):
    for browser in browsers:
        data = measure(browser, page, timeout)
        if data is not None:
            return browser, data
    return browsers[0], None


def inject_head(html: str, extra: str) -> str:
    if "</head>" in html:
        return html.replace("</head>", extra + "</head>", 1)
    return extra + html


def complete_output(file: Path, fmt: str) -> bool:
    try:
        with file.open("rb") as stream:
            signature = stream.read(8)
            stream.seek(-min(file.stat().st_size, 1024), os.SEEK_END)
            tail = stream.read()
    except OSError:
        return False
    if fmt == "pdf":
        return signature.startswith(b"%PDF-") and tail.rstrip().endswith(b"%%EOF")
    return signature == b"\x89PNG\r\n\x1a\n" and tail.endswith(b"\x00\x00\x00\x00IEND\xaeB\x60\x82")


def capture_output(browser, page, out, size, timeout, fmt):
    # 部分浏览器启动器会先退出，子进程随后才写文件。直到本轮的新文件
    # 完整写入前，保留临时 HTML 和原目标；同盘 replace 对并发读者也是原子的。
    out.parent.mkdir(parents=True, exist_ok=True)
    deadline = time.monotonic() + timeout
    with tempfile.TemporaryDirectory(dir=out.parent) as tmp:
        pending = Path(tmp) / ("capture." + fmt)
        flag = "--print-to-pdf" if fmt == "pdf" else "--screenshot"
        args = [f"--window-size={size[0]},{size[1]}", "--virtual-time-budget=4000",
                f"{flag}={pending}", "--no-pdf-header-footer", page.as_uri()]
        result = run_browser(browser, args, timeout)
        if result is None or result.returncode != 0:
            return False
        while True:
            if complete_output(pending, fmt):
                try:
                    pending.replace(out)
                    return True
                except PermissionError:  # Windows：写进程可能还未释放句柄
                    pass
            if time.monotonic() >= deadline:
                return False
            time.sleep(0.1)


def render_pdf(browser: str, page: Path, out: Path, size, timeout: int) -> bool:
    # 打印页尺寸取实测内容 + 2px 缓冲：Chromium 对 0.5px 级别的取整会把内容挤到第 2 页
    width, height = (size or {}).get("w", 1600), (size or {}).get("h", 900)
    width, height = int(width) + 2, int(height) + 2
    html = read_html(page)
    page_css = (
        f"<style>@page {{ size: {width}px {height}px; margin: 0; }}"
        "html,body{margin:0;padding:0;height:auto;}"
        "body{page-break-after:avoid;break-after:avoid;}</style>"
    )
    html = inject_head(html, page_css)
    sized = page.with_name(page.stem + ".sized.html")
    sized.write_text(html, encoding="utf-8")
    return capture_output(browser, sized, out, (width, height), timeout, "pdf")


def render_png(browser: str, page: Path, out: Path, size, timeout: int) -> bool:
    width, height = (size or {}).get("w", 1600), (size or {}).get("h", 900)
    return capture_output(browser, page, out, (int(width), int(height)), timeout, "png")


def main() -> int:
    ap = argparse.ArgumentParser(description="HTML → PDF/PNG 截图与几何自检")
    ap.add_argument("--file", help="输入 HTML")
    ap.add_argument("--out", help="输出文件（.pdf 或 .png）")
    ap.add_argument("--format", choices=["pdf", "png", "auto"], default="auto")
    ap.add_argument("--render-math", action="store_true", help="用 KaTeX 渲染公式")
    ap.add_argument("--geom-check", nargs="?", const="", help="几何自检，可跟 HTML 路径")
    ap.add_argument("--width", type=int, default=0)
    ap.add_argument("--height", type=int, default=0)
    ap.add_argument("--timeout", type=int, default=90)
    ap.add_argument("--quiet", action="store_true")
    ap.add_argument("--json", action="store_true", help="输出 JSON 摘要")
    ap.add_argument("pos_html", nargs="?", help=argparse.SUPPRESS)
    args = ap.parse_args()

    script_dir = Path(__file__).resolve().parent
    browsers = browser_candidates()
    browser = browsers[0] if browsers else None

    # ---------------- 几何自检模式
    if args.geom_check is not None:
        target = args.geom_check or args.file or args.pos_html
        if not target:
            print("[capture] --geom-check 需要 HTML 路径", file=sys.stderr)
            return 2
        src = Path(target).resolve()
        if not src.is_file():
            print(f"[capture] 文件不存在：{src}", file=sys.stderr)
            return 2
        if not browser:
            print("[capture] 未找到 Edge/Chrome/Chromium，无法做几何自检（可设 MMW_BROWSER 指定路径）", file=sys.stderr)
            return 2
        with tempfile.TemporaryDirectory() as tmp:
            page = prepare(src, Path(tmp), args.render_math, True, script_dir)
            browser, data = measure_available(browsers, page, args.timeout)
        if data is None:
            print("[capture] 几何自检无法取得结果（浏览器执行失败）", file=sys.stderr)
            return 2
        if args.json:
            print(json.dumps(data, ensure_ascii=False))
        else:
            if data["ok"]:
                print(f"[capture] 几何自检通过（画布 {data['size']['w']}x{data['size']['h']}px）")
            else:
                print(f"[capture] 几何自检发现 {data['count']} 个问题：")
                for item in data["problems"]:
                    print("  - " + json.dumps(item, ensure_ascii=False))
        return 0 if data["ok"] else 1

    # ---------------- 渲染模式
    if not args.file:
        print("[capture] 渲染模式需要 --file <html>", file=sys.stderr)
        return 2
    src = Path(args.file).resolve()
    if not src.is_file():
        print(f"[capture] 文件不存在：{src}", file=sys.stderr)
        return 2
    if not browser:
        print("[capture] 未找到 Edge/Chrome/Chromium。请安装其一，或用 MMW_BROWSER 指定可执行文件路径", file=sys.stderr)
        return 2

    fmt = args.format
    if fmt == "auto":
        out = Path(args.out).resolve() if args.out else src.with_suffix(".pdf")
        fmt = "png" if out.suffix.lower() == ".png" else "pdf"
    else:
        out = (Path(args.out).resolve() if args.out else src.with_suffix("." + fmt))

    with tempfile.TemporaryDirectory() as tmp:
        page = prepare(src, Path(tmp), args.render_math, False, script_dir)
        size = {"w": args.width, "h": args.height} if args.width and args.height else None
        if size is None:
            geo_page = prepare(src, Path(tmp), args.render_math, True, script_dir)
            browser, measured = measure_available(browsers, geo_page, args.timeout)
            if measured:
                size = measured.get("size")
        ok = render_pdf(browser, page, out, size, args.timeout) if fmt == "pdf" \
            else render_png(browser, page, out, size, args.timeout)

    if not ok:
        print(f"[capture] 渲染失败：{out}", file=sys.stderr)
        return 1
    summary = {"ok": True, "out": str(out), "format": fmt, "size": size, "bytes": out.stat().st_size,
               "browser": Path(browser).name}
    if args.json:
        print(json.dumps(summary, ensure_ascii=False))
    elif not args.quiet:
        print(f"[capture] {fmt.upper()} 已生成：{out}（{out.stat().st_size} B，画布 "
              f"{(size or {}).get('w', '?')}x{(size or {}).get('h', '?')}px）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
