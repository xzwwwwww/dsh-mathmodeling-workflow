#!/usr/bin/env python3
"""DeepSeek 服务端网页搜索与抓取 —— 给工作流里的 agent 当 Bash 工具用。

Claude Code 自带的 WebFetch 是在**本机**抓页面：受本机网络、代理、反爬、
需登录站点限制，本地/内网地址更是直接失败。DeepSeek 提供了服务端实现，
返回已经抽取好的 Markdown 正文，更适合当 agent 的取网页手段。

用法：
    python deepseek_web.py search "DeepSeek V4 发布" --count 5
    python deepseek_web.py search "site:github.com vllm" --count 3 --content
    python deepseek_web.py search "DeepSeek V4" --count 10 --min-score 1.5
    python deepseek_web.py search "2026 数模 国赛" --count 5 --ori-question "国赛题目什么时候公布"
    python deepseek_web.py search "本地天气" --localization 116.62.12.34
    python deepseek_web.py fetch "https://example.com/article"
    python deepseek_web.py fetch "https://example.com" --out page.md

参考：https://api-docs.deepseek.com/zh-cn/guides/search

API（均为 Bearer 鉴权，按次计费，失败不计费）：
    Search  POST https://api.deepseek.com/v1/tools/search
    Fetch   POST https://api.deepseek.com/v1/tools/fetch

API Key 查找顺序：
    --api-key 参数
    → $DEEPSEEK_API_KEY
    → $DEEPSEEK_TOOL_API_KEY
    → $ANTHROPIC_API_KEY
    → $OPENAI_API_KEY
    → $REVIEWER_API_KEY / $EDITOR_AI_API_KEY

退出码：
    0 成功
    1 参数或环境问题（含缺少 API Key）
    2 接口返回错误（含 402 余额不足 / 403 被安全策略拒绝）
"""

from __future__ import annotations

import argparse
import ipaddress
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.request

_API_ROOT = os.environ.get("DEEPSEEK_API_ROOT", "https://api.deepseek.com").rstrip("/")
_SEARCH_URL = f"{_API_ROOT}/v1/tools/search"
_FETCH_URL = f"{_API_ROOT}/v1/tools/fetch"
_USER_AGENT = "MathModelingWorkflow-DeepSeekWeb/1.0"
_TIMEOUT = 60
_MAX_RETRIES = 3
_RETRY_DELAY = 1.5
# 0 或负数表示不截断
_DEFAULT_MAX_CHARS = 60000
# 单篇搜索结果正文的默认上限：count 最大 50，不截断会把上下文撑爆
_DEFAULT_MAX_CONTENT_CHARS = 8000

_KEY_ENV_ORDER = (
    "DEEPSEEK_API_KEY",
    "DEEPSEEK_TOOL_API_KEY",
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "REVIEWER_API_KEY",
    "EDITOR_AI_API_KEY",
)


def _ssl_context() -> ssl.SSLContext:
    ctx = ssl.create_default_context()
    if os.environ.get("DEEPSEEK_TOOL_INSECURE") == "1":
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    return ctx


_SSL_CTX = _ssl_context()


def resolve_api_key(explicit: str = "") -> str:
    if explicit:
        return explicit.strip()
    for name in _KEY_ENV_ORDER:
        value = (os.environ.get(name) or "").strip()
        if value:
            return value
    return ""


def _post(url: str, payload: dict, api_key: str) -> dict:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(url, data=body, method="POST")
    request.add_header("Authorization", f"Bearer {api_key}")
    request.add_header("Content-Type", "application/json")
    request.add_header("User-Agent", _USER_AGENT)

    last_error: Exception | None = None
    for attempt in range(1, _MAX_RETRIES + 1):
        try:
            with urllib.request.urlopen(request, timeout=_TIMEOUT, context=_SSL_CTX) as response:
                return json.loads(response.read().decode("utf-8", "replace"))
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "replace")[:400]
            # 400/401/402/403/404/413 改请求才有意义，重试无用。
            if exc.code in (408, 429) or exc.code >= 500:
                last_error = RuntimeError(f"HTTP {exc.code}: {detail}")
                if attempt < _MAX_RETRIES:
                    time.sleep(_RETRY_DELAY * attempt)
                    continue
            print(f"[deepseek_web] HTTP {exc.code}: {detail}", file=sys.stderr)
            raise SystemExit(2) from exc
        except Exception as exc:  # 网络层错误，值得重试
            last_error = exc
            if attempt < _MAX_RETRIES:
                time.sleep(_RETRY_DELAY * attempt)
                continue
    print(f"[deepseek_web] 请求失败: {last_error}", file=sys.stderr)
    raise SystemExit(2)


def _truncate(text: str, limit: int, flag: str = "--max-chars") -> str:
    if limit <= 0 or len(text) <= limit:
        return text
    return text[:limit] + f"\n\n...[已截断，原文 {len(text)} 字符，可用 {flag} 0 取消]"


def cmd_search(args: argparse.Namespace, api_key: str) -> int:
    payload = {
        "query": args.query,
        "count": max(1, min(50, args.count)),
        "need_content": bool(args.content),
    }
    # 文档字段：触发搜索的原始问题，帮助搜索服务理解意图
    if args.ori_question:
        payload["ori_question"] = args.ori_question
    # 文档字段：用于优先返回本地化搜索结果的 IP 地址（服务端会校验，这里先拦）
    if args.localization:
        try:
            ipaddress.ip_address(args.localization.strip())
        except ValueError:
            print(
                f"[deepseek_web] --localization 需要合法 IP 地址，收到 {args.localization!r}",
                file=sys.stderr,
            )
            return 1
        payload["localization"] = args.localization.strip()

    data = _post(_SEARCH_URL, payload, api_key)
    results = data.get("results") or []
    total = len(results)
    if not results:
        print(json.dumps({"query": args.query, "results": [], "note": "搜索无结果"},
                         ensure_ascii=False, indent=2))
        return 0

    # 文档：rerank_score 0-3 分，>=1.5 为优质结果
    if args.min_score is not None:
        results = [
            item for item in results
            if isinstance(item.get("rerank_score"), (int, float))
            and item["rerank_score"] >= args.min_score
        ]

    for item in results:
        if not args.content:
            item.pop("content", None)
        else:
            body = item.get("content") or ""
            if body:
                item["content"] = _truncate(
                    body, args.max_content_chars, "--max-content-chars"
                )

    print(json.dumps({
        "query": args.query,
        "count_raw": total,
        "count_returned": len(results),
        "results": results,
    }, ensure_ascii=False, indent=2))
    return 0


def cmd_fetch(args: argparse.Namespace, api_key: str) -> int:
    data = _post(_FETCH_URL, {"url": args.url}, api_key)
    title = data.get("title") or ""
    content = _truncate(data.get("content") or "", args.max_chars)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as handle:
            if title:
                handle.write(f"# {title}\n\n")
            handle.write(content)
        print(f"[deepseek_web] 已写入 {args.out}（{len(content)} 字符）")
        print(f"[deepseek_web] 标题: {title}")
        return 0
    if title:
        print(f"# {title}\n")
    print(content)
    return 0


def build_parser() -> argparse.ArgumentParser:
    # `--api-key` 挂在每个子命令上，而不是顶层：argparse 不认子命令之后的顶层选项，
    # 而 `... fetch URL --api-key X` 这种写在最后的用法最常见。
    parser = argparse.ArgumentParser(
        description="DeepSeek 服务端网页搜索与抓取（返回 Markdown 正文）",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "示例:\n"
            '  python deepseek_web.py search "DeepSeek V4 发布" --count 5\n'
            '  python deepseek_web.py search "vllm site:github.com" --count 3 --content\n'
            '  python deepseek_web.py fetch "https://example.com"\n'
            '  python deepseek_web.py fetch "https://example.com" --out _utils/page.md\n'
        ),
    )
    sub = parser.add_subparsers(dest="command", required=True)

    search = sub.add_parser("search", help="搜索网页，返回结构化结果")
    search.add_argument("query", help="搜索词，支持 site:  lang:  after:  before:  -排除 等语法")
    search.add_argument("--count", type=int, default=10, help="返回条数 1-50（默认 10）")
    search.add_argument("--content", action="store_true", help="额外返回网页正文")
    search.add_argument("--ori-question", default="", help="触发搜索的原始问题，帮助理解搜索意图")
    search.add_argument("--localization", default="",
                        help="用于优先返回本地化搜索结果的 IPv4 地址（如 116.62.12.34）")
    search.add_argument("--min-score", type=float, default=None,
                        help="只保留 rerank_score >= 该值的结果（文档称 >=1.5 为优质）")
    search.add_argument("--max-content-chars", type=int, default=_DEFAULT_MAX_CONTENT_CHARS,
                        help=f"每篇 content 的上限（默认 {_DEFAULT_MAX_CONTENT_CHARS}，0 表示不截断）")
    search.add_argument("--api-key", default="", help="显式指定 key（默认从环境变量推断）")
    search.set_defaults(func=cmd_search)

    fetch = sub.add_parser("fetch", help="抓取单个网页，返回 Markdown 正文")
    fetch.add_argument("url", help="要抓取的 HTTP/HTTPS 地址")
    fetch.add_argument("--out", default="", help="写入文件而不是打印到 stdout")
    fetch.add_argument("--max-chars", type=int, default=_DEFAULT_MAX_CHARS,
                       help=f"stdout 输出上限（默认 {_DEFAULT_MAX_CHARS}，0 表示不截断）")
    fetch.add_argument("--api-key", default="", help="显式指定 key（默认从环境变量推断）")
    fetch.set_defaults(func=cmd_fetch)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    api_key = resolve_api_key(args.api_key)
    if not api_key:
        print(
            "[deepseek_web] 找不到 API Key。请设置 DEEPSEEK_API_KEY，"
            "或用 --api-key 指定一个 DeepSeek 官方 key。",
            file=sys.stderr,
        )
        return 1
    return args.func(args, api_key)


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass
    sys.exit(main())
