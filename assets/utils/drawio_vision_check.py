#!/usr/bin/env python3
"""Visual quality check for rendered HTML and DrawIO paper figures."""

from __future__ import annotations

import base64
import http.client
import io
import json
import os
import ssl
import sys
from pathlib import Path
from urllib.parse import urlparse


PROMPT = """You are reviewing a rendered diagram for an academic paper. Check only visible defects:
1. clipped, overlapping, missing, or unreadable text;
2. nodes, labels, arrows, or connectors that overlap or cross incorrectly;
3. visibly inconsistent alignment, spacing, node sizing, or margins;
4. excessive empty space, accidental blank regions, or content outside the canvas;
5. distracting colors, weak contrast, or an unprofessional paper-figure appearance.

If there is no visible defect, answer exactly: PASS
Otherwise list actionable defects as:
ISSUE 1: [location] [specific visible defect]
ISSUE 2: ...
Do not invent problems based on the source code or speculate about invisible geometry."""


def _chat_completions_path(base_url: str) -> tuple[str, str, int, str]:
    parsed = urlparse(base_url.strip())
    if not parsed.hostname or parsed.scheme not in {"http", "https"}:
        raise ValueError(f"Bad API base URL: {base_url}")
    path = (parsed.path or "").rstrip("/")
    for suffix in ("/chat/completions", "/responses"):
        if path.endswith(suffix):
            path = path[: -len(suffix)].rstrip("/")
    if path.endswith("/v1"):
        path = f"{path}/chat/completions"
    else:
        path = f"{path}/v1/chat/completions" if path else "/v1/chat/completions"
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    return parsed.scheme, parsed.hostname, port, path


def _extract_vision_text(result: dict) -> str:
    choices = result.get("choices") or []
    if choices:
        message = choices[0].get("message") or {}
        content = message.get("content", "")
        if isinstance(content, list):
            content = "\n".join(
                str(item.get("text", "")) for item in content if isinstance(item, dict)
            )
        return str(content).strip()
    return ""


def _render_input(path: Path) -> tuple[bytes, str]:
    if path.suffix.lower() == ".pdf":
        import fitz

        doc = fitz.open(path)
        try:
            if doc.page_count < 1:
                raise ValueError("PDF has no pages")
            pix = doc[0].get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
            data = pix.tobytes("png")
        finally:
            doc.close()
        return data, "image/png"

    data = path.read_bytes()
    mime = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
    }.get(path.suffix.lower(), "image/png")
    return data, mime


def _compress_image(data: bytes, mime: str) -> tuple[bytes, str]:
    if len(data) <= 3_500_000:
        return data, mime
    try:
        from PIL import Image

        with Image.open(io.BytesIO(data)) as image:
            image = image.convert("RGB")
            image.thumbnail((2200, 2200))
            output = io.BytesIO()
            image.save(output, format="JPEG", quality=82, optimize=True)
            return output.getvalue(), "image/jpeg"
    except Exception:
        return data, mime


def _call_vision(
    base_url: str,
    api_key: str,
    model: str,
    data: bytes,
    mime: str,
    prompt: str | None = None,
) -> str:
    scheme, host, port, path = _chat_completions_path(base_url)
    encoded = base64.b64encode(data).decode("ascii")
    model_name = model or "gpt-4o"
    request = {
        "model": model_name,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt or PROMPT},
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:{mime};base64,{encoded}"},
                    },
                ],
            }
        ],
        # DeepSeek counts reasoning and visible answer in completion tokens.
        # Keep thinking enabled for visual judgement and reserve enough budget
        # for the final PASS/ISSUE verdict.
        "max_tokens": 16384,
        "stream": False,
    }
    # Explicitly select Chat Completions thinking mode for DeepSeek V4.
    if model_name.lower().startswith("deepseek-v4"):
        request["thinking"] = {"type": "enabled"}
    body = json.dumps(request).encode("utf-8")
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Content-Length": str(len(body)),
    }
    connection = None
    try:
        if scheme == "https":
            connection = http.client.HTTPSConnection(
                host, port, timeout=180, context=ssl.create_default_context()
            )
        else:
            connection = http.client.HTTPConnection(host, port, timeout=180)
        connection.request("POST", path, body=body, headers=headers)
        response = connection.getresponse()
        payload = response.read()
        if response.status != 200:
            message = payload.decode("utf-8", errors="replace")[:500]
            raise RuntimeError(f"HTTP {response.status}: {message}")
        result = json.loads(payload.decode("utf-8"))
        content = _extract_vision_text(result)
        if not content:
            raise RuntimeError("Empty message.content in response")
        return str(content).strip()
    finally:
        if connection:
            connection.close()


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: python drawio_vision_check.py <fig.pdf|fig.png>")
        return 2
    path = Path(sys.argv[1])
    if not path.is_file():
        print(f"File not found: {path}")
        return 2

    configs = (
        (
            os.environ.get("EDITOR_AI_API_KEY", ""),
            os.environ.get("EDITOR_AI_BASE_URL", ""),
            os.environ.get("EDITOR_AI_MODEL_ID", "gpt-4o"),
        ),
        (
            os.environ.get("OPENAI_API_KEY", ""),
            os.environ.get("OPENAI_BASE_URL", ""),
            os.environ.get("REVIEWER_MODEL_ID", "gpt-4o"),
        ),
    )
    try:
        data, mime = _compress_image(*_render_input(path))
    except Exception as exc:
        print(f"RENDER_FAIL: {exc}")
        return 2

    errors: list[str] = []
    for api_key, base_url, model in configs:
        if not api_key or not base_url:
            continue
        try:
            result = _call_vision(base_url, api_key, model, data, mime)
            print(result)
            first_line = result.lstrip().splitlines()[0].strip().upper() if result else ""
            return 0 if first_line == "PASS" else 1
        except Exception as exc:
            errors.append(str(exc))

    if errors:
        print(f"Vision API error: {'; '.join(errors)}")
    else:
        print("NO_VISION_API: no vision-capable LLM configured")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
