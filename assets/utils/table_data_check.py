#!/usr/bin/env python3
"""Verify that numeric values in generated TABLE files are traceable to JSON outputs."""
from __future__ import annotations

import argparse
import json
import math
import re
from pathlib import Path
from typing import Any, Iterable


NUMBER_RE = re.compile(
    r"(?<![A-Za-z_])[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?%?"
)


def _walk_numbers(value: Any) -> Iterable[float]:
    if isinstance(value, bool) or value is None:
        return
    if isinstance(value, (int, float)):
        number = float(value)
        if math.isfinite(number):
            yield number
        return
    if isinstance(value, dict):
        for child in value.values():
            yield from _walk_numbers(child)
        return
    if isinstance(value, list):
        for child in value:
            yield from _walk_numbers(child)


def _data_lines(table_path: Path) -> Iterable[str]:
    in_latex_data = False
    for raw_line in table_path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw_line.strip()
        if "\\midrule" in line:
            in_latex_data = True
            continue
        if "\\bottomrule" in line:
            in_latex_data = False
            continue
        if table_path.suffix.lower() == ".tex":
            if in_latex_data and "&" in line:
                yield line
        elif "|" in line and not re.fullmatch(r"[| :\\-]+", line):
            yield line


def _numbers_from_line(line: str) -> list[tuple[str, float, bool]]:
    values: list[tuple[str, float, bool]] = []
    for match in NUMBER_RE.finditer(line):
        token = match.group(0)
        # LaTeX table writers commonly escape a displayed percentage as
        # ``80.8\\%``. The numeric regex intentionally stops before the
        # backslash, so inspect the suffix as well.
        suffix = line[match.end() :]
        is_percent = token.endswith("%") or suffix.startswith("%") or suffix.startswith(r"\%")
        raw_number = token[:-1] if token.endswith("%") else token
        try:
            values.append((token, float(raw_number), is_percent))
        except ValueError:
            continue
    return values


def _precision_tolerance(token: str) -> float:
    normalized = token.rstrip("%").lower()
    mantissa = normalized.split("e", 1)[0]
    decimals = len(mantissa.split(".", 1)[1]) if "." in mantissa else 0
    exponent = int(normalized.split("e", 1)[1]) if "e" in normalized else 0
    return max(1e-12, 0.51 * 10 ** (exponent - decimals))


def _matches_json(value: float, token: str, is_percent: bool, json_numbers: list[float]) -> bool:
    tolerance = _precision_tolerance(token)
    candidates = [(value, tolerance)]
    if is_percent:
        # Rounding tolerance must use the same scale as the candidate value.
        candidates.extend(((value / 100.0, tolerance / 100.0), (value * 100.0, tolerance * 100.0)))
    for candidate, candidate_tolerance in candidates:
        if any(abs(candidate - source) <= candidate_tolerance for source in json_numbers):
            return True
    return False


def _is_rank_column_value(line: str, token: str) -> bool:
    if not token.isdigit() or "&" not in line:
        return False
    first_cell = line.split("&", 1)[0].strip().lstrip("|").strip()
    return first_cell == token


def check_tables(figures_dir: Path) -> dict[str, Any]:
    json_sources = sorted(
        path
        for path in figures_dir.glob("*.json")
        if not path.name.startswith("TABLE_DATA_CHECK_")
    )
    json_numbers: list[float] = []
    for source in json_sources:
        try:
            json_numbers.extend(_walk_numbers(json.loads(source.read_text(encoding="utf-8"))))
        except (OSError, json.JSONDecodeError):
            continue

    unmatched: list[dict[str, str]] = []
    checked = 0
    table_paths = sorted(path for path in [*figures_dir.glob("TABLE_*.tex"), *figures_dir.glob("TABLE_*.md")]
                         if not path.name.startswith("TABLE_DATA_CHECK_"))
    for table_path in table_paths:
        for line_number, line in enumerate(_data_lines(table_path), start=1):
            for token, value, is_percent in _numbers_from_line(line):
                if _is_rank_column_value(line, token):
                    continue
                checked += 1
                if not _matches_json(value, token, is_percent, json_numbers):
                    unmatched.append(
                        {"table": table_path.name, "line": str(line_number), "value": token}
                    )

    return {
        "ok": bool(table_paths) and bool(json_numbers) and checked > 0 and not unmatched,
        "tables": [path.name for path in table_paths],
        "json_sources": [path.name for path in json_sources],
        "checked_values": checked,
        "unmatched": unmatched,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--figures", default="figures")
    args = parser.parse_args()
    figures_dir = Path(args.figures)
    figures_dir.mkdir(parents=True, exist_ok=True)
    marker_path = figures_dir / "TABLE_DATA_CHECK_PASSED.txt"
    marker_path.unlink(missing_ok=True)
    report_path = figures_dir / "TABLE_DATA_CHECK_LOCAL_REPORT.json"
    report_path.write_text(json.dumps({"ok": False, "status": "unavailable"}), encoding="utf-8")
    try:
        report = check_tables(figures_dir)
    except (OSError, ValueError, RecursionError) as exc:
        report_path.write_text(json.dumps({"ok": False, "status": "unavailable", "reason": str(exc)}), encoding="utf-8")
        print(f"TABLE_DATA_CHECK_FAILED {exc}")
        return 1
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    if report["ok"]:
        marker_path.touch()
        print(
            "TABLE_DATA_CHECK_PASSED "
            f"tables={len(report['tables'])} values={report['checked_values']}"
        )
        return 0
    marker_path.unlink(missing_ok=True)
    print(
        "TABLE_DATA_CHECK_FAILED "
        f"tables={len(report['tables'])} json_sources={len(report['json_sources'])} "
        f"unmatched={len(report['unmatched'])}"
    )
    for item in report["unmatched"][:20]:
        print(f"  {item['table']}:{item['line']} -> {item['value']}")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
