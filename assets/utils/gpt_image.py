#!/usr/bin/env python3
"""GPT Image 2 command-line helper for Codex workflow skills.

用法:
  python _utils/gpt_image.py --check
  python _utils/gpt_image.py --dry-run --prompt "..."          # 只看最终提示词（含固定风格），不调 API
  python _utils/gpt_image.py --prompt "..." --output figures/fig_xxx.png --lang zh
  python _utils/gpt_image.py --prompt "..." --output figures/fig_xxx.png --lang en --aspect-ratio 16:9
  python _utils/gpt_image.py --style mechanism --prompt "..." --output figures/fig_mechanism.png

风格:
  三种固定风格由工具注入，调用方只写内容：
  - scene（默认）：场景图/问题背景图 —— 黑白灰技术插图（纯白底、黑/白/灰、细灰线稿、
    二维/三维扁平矢量、正视图/正交视角、轻阴影、学术论文插图质感）；
  - mechanism：机理图/系统机制示意图 —— 低饱和粉彩学术示意图（白底、pastel 配色、
    圆角矩形模块、细箭头连接、中心节点层次、必要公式与变量、扁平 2D 矢量、论文级排版）；
  - framework：逐问建模框架图/叙事型流程图 —— 低饱和 pastel 卡片式信息图（graphical abstract、
    中间核心模型、四周输入/对比/输出面板、图标与迷你图表、扁平 2D 矢量、论文级排版）。
  你只需要写【场景主题】【场景元素】【构图要求】（scene）、【主题】【内容要求】（mechanism）
  或【主题】【结构要求】（framework），不要自己写颜色/卡通/写实 等风格词。

模型与兜底:
  默认按 gpt-image-2.5-sunburst → gpt-image-2 的顺序尝试；主模型不可用时自动退到兜底模型。
  - 判定"模型用不了"（404 / 报错点名 model 的 400 / 403 / 422）时**立刻切换**，不在原模型上重试，
    避免一个不存在的主模型白等 --max-retries × 240s 超时。
  - 其它瞬时错误（超时 / 429 / 5xx / 网络）先在原模型上重试，重试耗尽后再切兜底。
  - --model 可覆盖模型链（逗号分隔）；只给一个模型则不做兜底。

环境变量:
  GPT_IMAGE_API_KEY  — API Key（必须）
  GPT_IMAGE_BASE_URL — API 地址（默认 https://api.openai.com/v1）

退出码:
  0 = 成功（--check 模式：API Key 已配置；生成模式：图片已保存）
  1 = 失败（未配置 key / 所有模型均失败）

输出 PNG 后自动转 PDF（LaTeX 需要 PDF 格式）。
"""
from __future__ import annotations

import argparse
import base64
import http.client
import json
import os
import re
import socket
import ssl
import sys
import time
import urllib.request
from io import BytesIO
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

# ============================================================
# 提示词模板（集中管理，方便修改替换）
# ============================================================
# 两种固定风格（--style）：
#   scene     —— 场景图 / 问题背景图（Problem Background Illustration）：黑白灰技术插图
#   mechanism —— 机理图 / 系统机制示意图（Scientific mechanism diagram）：低饱和粉彩学术示意图
# 两种都用硬约束 + Avoid 清单；调用方只写内容（主题/元素/构图 或 主题/内容要求），不写风格词。

# ---------- 场景图（scene） ----------
MCM_TASK_ZH = (
    "请绘制一张用于大学生数学建模竞赛论文的场景背景示意图（Problem Background Illustration）。\n"
    "画面内容严格按下方场景描述（【场景主题】【场景元素】【构图要求】）来画；"
    "风格必须严格符合后面的【固定风格】，最终效果应当像国际数学建模竞赛优秀论文里的插图，"
    "而不是商业宣传海报或卡通插画。\n\n"
)

MCM_TASK_EN = (
    "Draw a scene background illustration (Problem Background Illustration) for a mathematical modeling "
    "competition paper. Follow the scene description below, and strictly follow the fixed style block. "
    "The result must look like a figure in an outstanding international mathematical modeling competition "
    "paper, not a commercial poster or cartoon.\n\n"
)

MCM_STYLE_BLOCK = (
    "\n\n【固定风格｜MCM Academic Illustration】\n"
    "Academic monochrome technical illustration, minimalist architectural and engineering schematic drawing, "
    "professional academic paper figure style.\n"
    "- Pure white background with generous negative space.\n"
    "- Strict monochromatic grayscale palette: black, white, light gray and medium gray.\n"
    "- Thin, delicate, consistent gray outlines.\n"
    "- Flat 2D/3D vector-style rendering with subtle light-gray shading.\n"
    "- Clean architectural elevation view, orthographic projection, straight-on perspective.\n"
    "- Simplified but structurally accurate buildings, infrastructure, landscapes and environmental elements.\n"
    "- Small human silhouettes and simplified trees for scale and context.\n"
    "- Precise geometric shapes, restrained details and balanced composition.\n"
    "- Minimal visual hierarchy, elegant academic typography and subtle annotation leader lines.\n"
    "- Clean, sophisticated, publication-quality scientific illustration.\n"
    "- Similar to figures in international engineering research papers and mathematical modeling competition papers.\n"
    "\n【Avoid】colorful graphics, cartoon style, photorealistic 3D rendering, photorealism, gradients, heavy shadows, "
    "thick outlines, excessive decoration, complex textures and cluttered backgrounds.\n"
    "\n【构图】横向构图，主体分布合理、空间层次清晰，重点突出场景之间的关系；"
    "使用适当的标注和细引线说明重要元素。\n"
    "\n【输出】High-resolution 4K-quality illustration, horizontal 16:9 composition."
)

# ---------- 机理图（mechanism） ----------
MECH_TASK_ZH = (
    "请绘制一张用于数学建模竞赛论文的学术机理示意图（机制图 / 系统示意图）。\n"
    "画面内容严格按下方【主题】【内容要求】来画；风格必须严格符合后面的【固定风格】。\n\n"
)

MECH_TASK_EN = (
    "Draw an academic mechanism diagram (system schematic) for a mathematical modeling competition paper. "
    "Follow the theme and content requirements below, and strictly follow the fixed style block.\n\n"
)

MECH_STYLE_BLOCK = (
    "\n\n【固定风格｜Scientific Mechanism Diagram】\n"
    "Scientific mechanism diagram, academic system schematic, elegant research-paper figure style.\n"
    "- Clean white background with generous white space.\n"
    "- Soft pastel palette with low saturation: light blue, light green, light beige, light purple and light pink.\n"
    "- Rounded-rectangle modules with soft borders and light fills.\n"
    "- Thin, clear connecting arrows showing flow and causal relationships.\n"
    "- Center-node-based system architecture with clear logical hierarchy.\n"
    "- Concise mathematical symbols, variable labels and equations where necessary.\n"
    "- Small simple icons for environment inputs, data, models, controllers, outputs or physical components.\n"
    "- Flat 2D vector style, precise geometry, tidy alignment, publication-grade layout.\n"
    "- Professional scientific illustration suitable for mathematical modeling papers or engineering journals.\n"
    "- Information-rich yet visually clean and elegant.\n"
    "\n【Avoid】cartoon style, over-decorated graphics, thick outlines, bright saturated colors, cluttered composition, "
    "photorealism, 3D rendering, messy layout, excessive shadows.\n"
    "\n【输出】High-resolution, publication-quality mechanism diagram, suitable for MCM/ICM paper figures."
)

# ---------- 逐问建模框架图（framework） ----------
FRAMEWORK_TASK_ZH = (
    "请绘制一张用于数学建模竞赛论文的可视化建模框架图（graphical abstract / 建模框架总图）。\n"
    "画面内容按下方【主题】【结构要求】组织；风格必须严格符合后面的【固定风格】。\n\n"
)

FRAMEWORK_TASK_EN = (
    "Draw a visual modeling framework diagram (graphical abstract) for a mathematical modeling competition paper. "
    "Follow the theme and structure requirements below, and strictly follow the fixed style block.\n\n"
)

FRAMEWORK_STYLE_BLOCK = (
    "\n\n【固定风格｜Visual Modeling Framework Diagram】\n"
    "Visual modeling framework diagram, graphical abstract style, elegant academic infographic for a mathematical modeling paper.\n"
    "- Clean white background with generous whitespace.\n"
    "- Soft pastel color palette with low saturation, including pale blue, pale green, beige, and light pink.\n"
    "- Multi-panel card-based layout with rounded rectangles and subtle borders.\n"
    "- Integrate visual elements such as small illustrations, icons, mini line charts, maps, equations, and arrows.\n"
    "- Highlight the central model or core function block in the middle.\n"
    "- Use arrows and directional connectors to show data flow, causality, comparison, and transformation.\n"
    "- Include \"before vs after\", \"input vs output\", or \"multi-scenario comparison\" panels when appropriate.\n"
    "- Flat 2D vector style, clean geometry, publication-quality academic layout.\n"
    "- Information-rich but visually clear and balanced.\n"
    "- Similar to a high-quality graphical abstract or framework figure in an international scientific paper.\n"
    "\n【Avoid】bright saturated colors, cartoon exaggeration, messy layout, thick borders, overly decorative elements, "
    "3D rendering, photorealism, cluttered backgrounds.\n"
    "\n【布局】中间突出核心模型/核心函数模块，周围放置输入场景、影响因素、参数变化、对比案例与输出结果；"
    "圆角卡片式布局，细箭头连接，层次清晰。\n"
    "\n【输出】high-resolution, publication-quality infographic flowchart suitable for MCM/ICM papers, horizontal 16:9 composition."
)

# 兼容旧变量名（build_prompt 之外若有脚本引用）
ZH_LANG_PREFIX = MCM_TASK_ZH
EN_LANG_PREFIX = MCM_TASK_EN
UNIFIED_STYLE_SUFFIX = MCM_STYLE_BLOCK

# 安全约束后缀（精简）
SAFETY_SUFFIX = (
    "\n不要生成真人面孔或肖像照片，需要人物时用抽象剪影/图标代替；"
    "不要出现水印、签名、装饰边框；图内不要标题。"
)

DEFAULT_API_BASE = "https://api.openai.com/v1"

# 默认模型链：前面的模型不可用时按顺序兜底（image2.5 用不了就退到 image2）
DEFAULT_IMAGE_MODELS = ("gpt-image-2.5-sunburst", "gpt-image-2")

# 命中即判定"这个模型本身用不了" → 立刻切兜底模型，而不是在原模型上重试到超时
_MODEL_LEVEL_MARKERS = (
    "model_not_found",
    "model not found",
    "model does not exist",
    "model not exist",
    "no such model",
    "unknown model",
    "unsupported model",
    "unsupported_model",
    "invalid model",
    "model_not_available",
    "not a valid model",
    "model is not supported",
    "no available channel",
)


def _resolve_model_chain(raw: Optional[str]) -> list:
    """解析 --model（逗号分隔）；缺省用默认模型链，只给一个模型时不做兜底。"""
    if raw and raw.strip():
        chain = [item.strip() for item in raw.split(",") if item.strip()]
        if chain:
            return chain
    return list(DEFAULT_IMAGE_MODELS)


def _is_model_level_error(message: str) -> bool:
    """错误是否属于"这个模型用不了"（应立刻换兜底模型）。

    区分两类失败：
      - 模型级：模型不存在 / 无权限 / 无可用渠道 → 换模型有意义，立刻切。
      - 瞬时级：超时 / 429 / 5xx / DNS → 换模型没意义，先在原模型上重试。
    400 只在报文点到 model 时才算模型级，避免把内容审核拒绝误判成模型不可用。
    """
    low = (message or "").lower()
    if any(marker in low for marker in _MODEL_LEVEL_MARKERS):
        return True
    match = re.search(r"http\s+(\d{3})", low)
    if not match:
        return False
    code = int(match.group(1))
    if code in (403, 404, 422):
        return True
    return code == 400 and "model" in low


def build_prompt(user_prompt: str, lang: str, style: str = "scene") -> str:
    """把内容描述包成完整提示词：任务说明 + 内容 + 固定风格 + 安全约束。

    style:
      - scene（默认）：场景图/问题背景图，黑白灰技术插图；
      - mechanism：机理图/系统机制示意图，低饱和粉彩学术示意图；
      - framework：逐问建模框架图/叙事型流程图，低饱和 pastel 卡片式信息图。
    内容由调用方（图表生成技能）组织：scene 用【场景主题】【场景元素】【构图要求】，
    mechanism 用【主题】【内容要求】，framework 用【主题】【结构要求】；风格由本函数统一注入。
    """
    if style == "mechanism":
        prefix = MECH_TASK_ZH if lang == "zh" else MECH_TASK_EN
        block = MECH_STYLE_BLOCK
    elif style == "framework":
        prefix = FRAMEWORK_TASK_ZH if lang == "zh" else FRAMEWORK_TASK_EN
        block = FRAMEWORK_STYLE_BLOCK
    else:
        prefix = MCM_TASK_ZH if lang == "zh" else MCM_TASK_EN
        block = MCM_STYLE_BLOCK
    text_rule = (
        "【标注文字】图内标注使用简体中文，字体清晰、无乱码；数学变量保持拉丁字母。"
        if lang == "zh"
        else "【Label text】Use English labels with a clean sans-serif font; keep math variables in Latin letters."
    )
    return prefix + user_prompt.strip() + block + "\n" + text_rule + SAFETY_SUFFIX



def _resolve_api_config(env: dict, cwd: Path) -> tuple[str, str]:
    """Resolve environment values first, then fill gaps from workspace config."""
    api_key = str(env.get("GPT_IMAGE_API_KEY") or "").strip()
    api_base = str(env.get("GPT_IMAGE_BASE_URL") or "").strip()
    for cfg_path in (
        cwd / "_utils" / "_gpt_image_config.json",
        cwd.parent / "_utils" / "_gpt_image_config.json",
    ):
        if api_key and api_base:
            break
        if not cfg_path.is_file():
            continue
        try:
            config = json.loads(cfg_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError, TypeError):
            continue
        if not api_key:
            api_key = str(config.get("api_key") or "").strip()
        if not api_base:
            api_base = str(config.get("base_url") or "").strip()
    return api_key, api_base or DEFAULT_API_BASE


# ============================================================
# GPT Image API 调用（基于用户提供的 GPTImage2ChatProvider 代码）
# ============================================================

def _download_image_bytes(url: str) -> bytes:
    """用原生 urllib 下载图片，返回 bytes。"""
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.read()
    except Exception as e:
        raise Exception(f"图片下载失败 {url}: {e}")


def _aspect_to_size(aspect_ratio: str) -> str:
    """把 skill 传入的宽高比映射成 OpenAI images API 的标准 size。
    gpt-image 系列支持 1024x1024 / 1024x1536(竖) / 1536x1024(横)。"""
    m = {
        "1:1": "1024x1024",
        "16:9": "1536x1024", "3:2": "1536x1024", "4:3": "1536x1024",
        "9:16": "1024x1536", "2:3": "1024x1536", "3:4": "1024x1536",
    }
    return m.get((aspect_ratio or "").strip(), "1024x1024")


def _call_gpt_image_api(
    api_base: str,
    api_key: str,
    prompt: str,
    aspect_ratio: str = "16:9",
    timeout: int = 180,
    model: str = DEFAULT_IMAGE_MODELS[0],
) -> bytes:
    """调用 GPT Image API，返回图片 bytes。"""
    parsed = urlparse(api_base)
    host = parsed.hostname
    if not host:
        raise ValueError(f"API Base URL 格式错误: {api_base}")
    port = parsed.port or (443 if parsed.scheme == "https" else 80)

    # 强制路由到画图端点
    path = (parsed.path or "").rstrip("/")
    if not path.endswith("/v1/images/generations"):
        if path.endswith("/v1"):
            path = path + "/images/generations"
        else:
            path = "/v1/images/generations"

    # ⛔ OpenAI images API 的标准参数是 size（不是 aspect_ratio）；gpt-image 系列不支持
    #    response_format（传了会报 unknown parameter）。把宽高比映射成标准 size。
    payload_dict = {
        "model": model,
        "prompt": prompt,
        "n": 1,
        "size": _aspect_to_size(aspect_ratio),
    }
    payload_bytes = json.dumps(payload_dict).encode("utf-8")

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Content-Length": str(len(payload_bytes)),
    }

    conn = None
    try:
        if parsed.scheme == "https":
            # 默认 CERT_REQUIRED + check_hostname，防 MITM（端点已锁定且持有效证书）
            ctx = ssl.create_default_context()
            conn = http.client.HTTPSConnection(host, port, timeout=timeout, context=ctx)
        else:
            conn = http.client.HTTPConnection(host, port, timeout=timeout)

        conn.request("POST", path, payload_bytes, headers)
        res = conn.getresponse()
        data = res.read()

        if res.status != 200:
            error_text = data.decode("utf-8", errors="replace")[:500]
            raise Exception(f"HTTP {res.status}: {error_text}")

        response_json = json.loads(data.decode("utf-8"))
        data_list = response_json.get("data", [])
        if not data_list:
            raise ValueError(f"响应中无图片数据: {data.decode('utf-8')[:300]}")

        item = data_list[0]

        # 优先 base64
        if item.get("b64_json"):
            return base64.b64decode(item["b64_json"])

        # URL 下载（兼容 data URL：某些 API 返回 data:image/png;base64,... 而非 HTTP 链接）
        if item.get("url"):
            url_val = item["url"]
            if url_val.startswith("data:"):
                # data URL：直接解码 base64 部分
                b64_data = url_val.split(",", 1)[1]
                return base64.b64decode(b64_data)
            return _download_image_bytes(url_val)

        raise ValueError("响应中既无 b64_json 也无 url")

    except socket.timeout:
        raise Exception(f"请求超时（{timeout}秒），图片生成可能需要更长时间")
    except socket.gaierror:
        raise Exception("无法解析域名，请检查 GPT_IMAGE_BASE_URL")
    except ConnectionRefusedError:
        raise Exception("连接被拒绝，请检查 API 地址和端口")
    finally:
        if conn:
            conn.close()


# ============================================================
# PNG → PDF 转换
# ============================================================

def _png_to_pdf(png_path: str) -> str:
    """将 PNG 转为 PDF（LaTeX 需要），返回 PDF 路径。"""
    pdf_path = png_path.rsplit(".", 1)[0] + ".pdf"
    try:
        from PIL import Image
        img = Image.open(png_path)
        if img.mode == "RGBA":
            # PDF 不支持透明通道，合成白色背景
            bg = Image.new("RGB", img.size, (255, 255, 255))
            bg.paste(img, mask=img.split()[3])
            img = bg
        elif img.mode != "RGB":
            img = img.convert("RGB")
        img.save(pdf_path, "PDF", resolution=300)
        return pdf_path
    except ImportError:
        # PIL 不可用，直接用 PNG（LaTeX 也能用，只是不如 PDF）
        print("WARNING: PIL not available, skipping PNG→PDF conversion")
        return png_path


def _save_image(img_bytes: bytes, out_path: Path) -> None:
    """把返回的图片字节落盘为 PNG（统一成 RGB；PIL 不可用时直写原始字节）。"""
    try:
        from PIL import Image as _PILImage
        _img = _PILImage.open(BytesIO(img_bytes))
        if _img.mode == "RGBA":
            _bg = _PILImage.new("RGB", _img.size, (255, 255, 255))
            _bg.paste(_img, mask=_img.split()[3])
            _img = _bg
        elif _img.mode != "RGB":
            _img = _img.convert("RGB")
        _img.save(str(out_path), "PNG")
    except ImportError:
        # PIL 不可用，直接写原始 bytes
        out_path.write_bytes(img_bytes)


# ============================================================
# 主函数
# ============================================================

def main():
    parser = argparse.ArgumentParser(description="GPT Image 生成工具（内置模型兜底）")
    parser.add_argument("--check", action="store_true", help="仅检查 API Key 是否配置")
    parser.add_argument("--prompt", type=str, help="生成提示词（核心内容，语言/风格自动注入）")
    parser.add_argument("--output", type=str, help="输出路径（.png），自动生成同名 .pdf")
    parser.add_argument("--lang", type=str, default="zh", choices=["zh", "en"], help="语言：zh 中文（默认）/ en 英文")
    parser.add_argument("--aspect-ratio", type=str, default="16:9", help="宽高比（默认 16:9）")
    parser.add_argument(
        "--model",
        type=str,
        default="",
        help="覆盖模型链，逗号分隔（默认 %s；只给一个则不做兜底）" % ",".join(DEFAULT_IMAGE_MODELS),
    )
    parser.add_argument("--max-retries", type=int, default=3, help="每个模型的最大重试次数（默认 3）")
    parser.add_argument("--style", choices=["scene", "mechanism", "framework"], default="scene", help="固定风格：scene=场景图（黑白灰技术插图，默认）；mechanism=机理图（低饱和粉彩机制示意图）；framework=逐问建模框架图（graphical abstract，低饱和卡片式信息图）")
    parser.add_argument("--dry-run", action="store_true", help="只打印最终提示词（含固定风格），不调用 API")
    args = parser.parse_args()

    api_key, api_base = _resolve_api_config(os.environ, Path.cwd())

    # --dry-run 模式：先看最终提示词，不要求配置 key
    if args.dry_run:
        if not args.prompt:
            print("ERROR: --prompt is required")
            sys.exit(1)
        print(build_prompt(args.prompt, args.lang, args.style))
        sys.exit(0)

    # --check 模式
    if args.check:
        if api_key:
            print("GPT_IMAGE_AVAILABLE=YES")
            sys.exit(0)
        else:
            print("GPT_IMAGE_AVAILABLE=NO (GPT_IMAGE_API_KEY not set)")
            sys.exit(1)

    # 生成模式：参数校验
    if not args.prompt:
        print("ERROR: --prompt is required")
        sys.exit(1)
    if not args.output:
        print("ERROR: --output is required")
        sys.exit(1)
    if not api_key:
        print("GPT_IMAGE_NOT_CONFIGURED: Set GPT_IMAGE_API_KEY in settings")
        sys.exit(1)

    # 构建完整 prompt（注入语言/风格/安全约束）
    full_prompt = build_prompt(args.prompt, args.lang, args.style)

    # 确保输出目录存在
    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    # 模型链：默认 gpt-image-2.5-sunburst → gpt-image-2 兜底
    model_chain = _resolve_model_chain(args.model)
    last_error = None

    for index, model in enumerate(model_chain):
        fallback = model_chain[index + 1] if index + 1 < len(model_chain) else None

        for attempt in range(1, args.max_retries + 1):
            try:
                print(f"[GPT Image] Attempt {attempt}/{args.max_retries} model={model} ...")
                img_bytes = _call_gpt_image_api(
                    api_base, api_key, full_prompt,
                    aspect_ratio=args.aspect_ratio,
                    timeout=240,
                    model=model,
                )

                _save_image(img_bytes, out_path)
                print(f"[GPT Image] PNG saved: {out_path} ({out_path.stat().st_size} bytes) model={model}")

                # 转 PDF
                pdf_path = _png_to_pdf(str(out_path))
                print(f"[GPT Image] PDF saved: {pdf_path}")
                print(f"OK {pdf_path} model={model}")
                sys.exit(0)

            except Exception as e:
                last_error = str(e)
                print(f"[GPT Image] Attempt {attempt} failed (model={model}): {last_error}")

                if fallback and _is_model_level_error(last_error):
                    # 模型本身用不了 → 不在原模型上耗重试，立刻切兜底
                    print(f"[GPT Image] model {model} 不可用 → 立即切换兜底模型 {fallback}")
                    break

                if fallback and attempt == args.max_retries:
                    print(f"[GPT Image] model {model} 重试 {args.max_retries} 次仍失败 → 切换兜底模型 {fallback}")

                if attempt < args.max_retries:
                    wait = 3 * attempt  # 3s, 6s, 9s
                    print(f"[GPT Image] Retrying in {wait}s ...")
                    time.sleep(wait)

    # 模型链全部失败
    print(f"FAILED after models={','.join(model_chain)} x {args.max_retries} attempt(s): {last_error}")
    sys.exit(1)


if __name__ == "__main__":
    main()
