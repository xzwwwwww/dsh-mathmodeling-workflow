#!/usr/bin/env python3
"""GPT Image 2 command-line helper for Codex workflow skills.

用法:
  python _utils/gpt_image.py --check
  python _utils/gpt_image.py --prompt "..." --output figures/fig_xxx.png --lang zh
  python _utils/gpt_image.py --prompt "..." --output figures/fig_xxx.png --lang en --aspect-ratio 16:9

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

# 中文语言适配前缀（精简版——GPT Image 越简洁效果越好）
ZH_LANG_PREFIX = (
    "生成一张科研级别的学术论文插图。"
    "字体不要出现乱码，确保生成简体中文可适配。"
    "数学变量保持拉丁字母。\n\n"
)

# 英文语言适配前缀
EN_LANG_PREFIX = (
    "Generate a research-grade academic paper illustration. "
    "All text in English, clean sans-serif font.\n\n"
)

# 统一风格后缀（极简——只保留必要约束，让 GPT Image 自由发挥）
UNIFIED_STYLE_SUFFIX = (
    "\n\n图表上方不需要标题。白色背景，无水印无签名无装饰边框。"
    "配色自由搭配，丰富专业。4K分辨率。"
)

# 安全约束后缀（精简）
SAFETY_SUFFIX = (
    "\n不要生成真人面孔或肖像照片，需要人物时用抽象图标代替。"
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


def build_prompt(user_prompt: str, lang: str) -> str:
    """Inject language, style, and safety constraints around the core scene prompt."""
    if lang == "zh":
        prefix = ZH_LANG_PREFIX
    else:
        prefix = EN_LANG_PREFIX
    return prefix + user_prompt + UNIFIED_STYLE_SUFFIX + SAFETY_SUFFIX


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
    args = parser.parse_args()

    api_key, api_base = _resolve_api_config(os.environ, Path.cwd())

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
    full_prompt = build_prompt(args.prompt, args.lang)

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
