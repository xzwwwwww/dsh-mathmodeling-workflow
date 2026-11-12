"""Behavioral regressions for workspace helpers. Run with python -m unittest discover -s test."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import textwrap
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "assets" / "utils"))
import paper_data_check as paper
import screenshot_capture as capture


class WorkflowChecks(unittest.TestCase):
    def test_claim_units(self):
        entries = [("results", "problem_1.cost", 12), ("results", "accuracy", .93),
                   ("results", "duration_hours", 6), ("results", "unlabeled", 93)]
        for claim, expected in [
            ("成本为93万元。", False), ("成本为1200万元。", False), ("成本为12万元。", True),
            ("耗时600小时。", False), ("准确率为93%。", True), ("准确率为93。", True),
            ("The cost was 93.", False), ("The accuracy was 93 percent.", True),
        ]:
            with self.subTest(claim=claim):
                [(raw, value, context, decimals, percent, metric)] = paper.extract_numbers(claim)
                self.assertEqual(paper.matches(value, decimals, percent, paper.index_values(entries), metric), expected)

    def test_nested_input_paths(self):
        skill = (ROOT / "assets/skills/编程实现/SKILL.md").read_text(encoding="utf-8")
        snippet = skill.split("摄入完整性断言（基准从 DATA_PROFILE.json")[1]
        code = textwrap.dedent(snippet[snippet.index("   import json"):snippet.index("   " + chr(96) * 3)])
        with tempfile.TemporaryDirectory() as tmp:
            old = os.getcwd()
            os.chdir(tmp)
            try:
                files = {f"{key}/data.csv": {"total_rows": rows, "basename": "data.csv", "n_sheets": 1}
                         for key, rows in [("A", 1), ("B", 3)]}
                Path("DATA_PROFILE.json").write_text(json.dumps({"files": files}), encoding="utf-8")
                for name in ["./user_data/B/data.csv", Path("user_data/B/data.csv"), Path("user_data/B/data.csv").resolve()]:
                    exec(code, {"fname": name, "total_rows": 3})
                for name in ["data.csv", "B/data.csv", "C/data.csv"]:
                    with self.assertRaises(AssertionError):
                        exec(code, {"fname": name, "total_rows": 1})
            finally:
                os.chdir(old)

    def test_renderer_publishes_only_fresh_complete_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "figure.pdf"
            target.write_bytes(b"previous figure")
            source = Path(tmp) / "figure.html"
            source.write_text("<html/>", encoding="utf-8")

            def browser(payload, status):
                def run(_, args, timeout):
                    filename = next(arg.split("=", 1)[1] for arg in args if arg.startswith("--print-to-pdf="))
                    if payload is not None:
                        Path(filename).write_bytes(payload)
                    return subprocess.CompletedProcess(args, status)
                return run

            for payload, status in [(None, 0), (b"%PDF-1.7\npartial", 0), (b"%PDF-1.7\n%%EOF", 1)]:
                with patch.object(capture, "run_browser", browser(payload, status)):
                    self.assertFalse(capture.render_pdf("browser", source, target, None, 0))
                self.assertEqual(target.read_bytes(), b"previous figure")
            fresh = b"%PDF-1.7\nnew figure\n%%EOF\n"
            with patch.object(capture, "run_browser", browser(fresh, 0)):
                self.assertTrue(capture.render_pdf("browser", source, target, None, 0))
            self.assertEqual(target.read_bytes(), fresh)
