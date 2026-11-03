#!/usr/bin/env python3
"""Describe images through the independent vision model configured in Settings."""
from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path


def _request(url: str, key: str, payload: dict) -> dict:
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST", headers={
        "Authorization": f"Bearer {key}", "Content-Type": "application/json",
    })
    with urllib.request.urlopen(req, timeout=90) as response:
        return json.loads(response.read().decode("utf-8"))


def _text(response: dict) -> str:
    chunks = []
    for item in response.get("output", []):
        for content in item.get("content", []) if isinstance(item, dict) else []:
            if isinstance(content, dict) and content.get("text"):
                chunks.append(str(content["text"]))
    if chunks:
        return "\n".join(chunks).strip()
    choices = response.get("choices", [])
    if choices:
        content = choices[0].get("message", {}).get("content", "")
        return content if isinstance(content, str) else json.dumps(content, ensure_ascii=False)
    return ""


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", action="append", required=True)
    parser.add_argument("--prompt", default="请描述图片中的结构、文字和关键视觉语义，并指出明显问题。")
    parser.add_argument("--output")
    args = parser.parse_args()
    key = os.environ.get("EDITOR_AI_API_KEY", "").strip()
    base = os.environ.get("EDITOR_AI_BASE_URL", "").strip().rstrip("/")
    model = os.environ.get("EDITOR_AI_MODEL_ID", "").strip()
    if not key or not base or not model:
        print("NO_VISION_API", file=sys.stderr)
        return 2
    content = [{"type": "input_text", "text": args.prompt}]
    for name in args.image:
        path = Path(name)
        data = base64.b64encode(path.read_bytes()).decode("ascii")
        mime = mimetypes.guess_type(path.name)[0] or "image/png"
        content.append({"type": "input_image", "image_url": f"data:{mime};base64,{data}"})
    payload = {"model": model, "input": [{"role": "user", "content": content}]}
    try:
        response = _request(base + "/responses", key, payload)
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, OSError, ValueError):
        chat_content = [{"type": "text", "text": args.prompt}]
        for name in args.image:
            path = Path(name)
            data = base64.b64encode(path.read_bytes()).decode("ascii")
            mime = mimetypes.guess_type(path.name)[0] or "image/png"
            chat_content.append({"type": "image_url", "image_url": {"url": f"data:{mime};base64,{data}"}})
        response = _request(base + "/chat/completions", key, {
            "model": model, "messages": [{"role": "user", "content": chat_content}], "stream": False,
        })
    result = _text(response)
    if not result:
        print("VISION_EMPTY_RESPONSE", file=sys.stderr)
        return 2
    if args.output:
        Path(args.output).write_text(result + "\n", encoding="utf-8")
    print(result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
