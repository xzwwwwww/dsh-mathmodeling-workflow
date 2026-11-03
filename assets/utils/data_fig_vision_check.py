#!/usr/bin/env python3
"""Visual quality check for rendered statistical and scientific data figures."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import drawio_vision_check as checker


checker.PROMPT = """You are reviewing a rendered data figure for an academic competition paper. Check only visible defects:
1. clipped, overlapping, missing, or unreadable title, axis, legend, annotation, or tick text;
2. plotted data hidden by labels, legends, or panel boundaries;
3. inconsistent panel alignment, margins, font sizing, or line weights;
4. misleading visual presentation such as an unexplained truncated axis, unreadable color contrast, or an overcrowded legend;
5. accidental blank panels, rendering failures, or content outside the canvas.

If there is no visible defect, answer exactly: PASS
Otherwise list actionable defects as:
ISSUE 1: [location] [specific visible defect]
ISSUE 2: ...
Judge rendering quality only. Do not challenge numerical results without source data."""


if __name__ == "__main__":
    raise SystemExit(checker.main())
