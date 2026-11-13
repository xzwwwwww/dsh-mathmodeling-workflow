"""Run the actual stdlib helpers against small, isolated audit regression workspaces."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
UTILS = ROOT / "assets" / "utils"
sys.path.insert(0, str(UTILS))
import logic_audit as logic
import paper_data_check as paper
import table_data_check as table


def put(workspace, name, text):
    path = workspace / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


def run_helper(name, workspace, *args):
    return subprocess.run([sys.executable, str(UTILS / name), *args], cwd=workspace,
                          text=True, encoding="utf-8", capture_output=True, timeout=30)


def simple_paper(workspace, body="The cost was 12.", mode="pdf"):
    put(workspace, "results.json", json.dumps({"cost": 12, "accuracy": .93}))
    if mode == "docx":
        return put(workspace, "paper/main.md", body)
    return put(workspace, "paper/main.tex", "\\documentclass{article}\n\\begin{document}\n" + body + "\n\\end{document}\n")


def run_paper(workspace, mode="pdf"):
    return run_helper("paper_data_check.py", workspace, "--mode", mode, "--quiet")


def certificate(workspace):
    return json.loads((workspace / paper.RESULT_NAME).read_text(encoding="utf-8"))


class PaperAuditTests(unittest.TestCase):
    def test_math_results_cannot_hide_behind_a_matching_prose_number(self):
        for claim in [r"$99.9\%$", r"\(99.9\%\)", r"\[99.9\%\]",
                      r"$$99.9\%$$", r"\begin{equation}accuracy=99.9\%\end{equation}",
                      r"$0.999$", r"$accuracy=0.999$", r"$.999$", r"$9.99e-1$"]:
            with self.subTest(claim=claim), tempfile.TemporaryDirectory() as tmp:
                workspace = Path(tmp)
                main = simple_paper(workspace, "The cost was 12. The accuracy was " + claim + ".")
                result = run_paper(workspace)
                self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
                self.assertEqual(certificate(workspace)["status"], "failed")
                self.assertNotIn("DATA_CHECK_PASSED", main.read_text(encoding="utf-8"))

    def test_valid_math_results_and_symbolic_formulas(self):
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            simple_paper(workspace, r"""
\section{Model 17 and results}
The cost was $12$. The accuracy was $93\%$.
The accuracy was \(accuracy=0.93\).
Symbolic definitions: $y=2x+1$, $x_1+x_2$, $x_i=0$, $b=1$.
Coefficients: $p=0.5$ and $\lambda=0.25$.
\begin{equation}z=\frac{1}{n}\sum_{i=1}^{n}x_i^2\tag{88}\end{equation}
See Figure 3, Table~2, Eq.(5), Section 4, and \eqref{eq:2026}.
There are 3 models and 5 figures. In 2025 we chose the model.
\includegraphics[width=0.42\textwidth]{../figures/fig_999.pdf}
% cost 99999, accuracy 99.9\% and \input{missing}
\begin{lstlisting}constant = 98765\end{lstlisting}
""")
            result = run_paper(workspace)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertEqual(certificate(workspace)["status"], "passed")
            self.assertGreaterEqual(certificate(workspace)["checked_values"], 3)

    def test_external_table_reached_through_nested_inputs_is_checked(self):
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            simple_paper(workspace, r"\input{sections/1_body}")
            put(workspace, "paper/sections/1_body.tex", "The cost was 12.\n" + r"\include{nested/table_wrapper}")
            put(workspace, "paper/nested/table_wrapper.tex", r"\input{../figures/nested/TABLE_accuracy.tex}")
            target = put(workspace, "figures/nested/TABLE_accuracy.tex", r"\begin{tabular}{lr}Method & accuracy \\ \midrule A & $99.9\%$ \\ \bottomrule\end{tabular}")
            result = run_paper(workspace)
            self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
            self.assertIn("figures/nested/TABLE_accuracy.tex", (workspace / paper.REPORT_NAME).read_text(encoding="utf-8"))
            target.write_text(r"\begin{tabular}{lr}Method & accuracy \\ \midrule A & $93\%$ \\ \bottomrule\end{tabular}", encoding="utf-8")
            result = run_paper(workspace)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_real_main_ignores_unreferenced_drafts_but_checks_inline_body(self):
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            main = simple_paper(workspace)
            put(workspace, "paper/sections/unused.tex", "The cost was 99999.")
            self.assertEqual(run_paper(workspace).returncode, 0)
            main.write_text(r"\begin{document}The cost was 99999.\end{document}", encoding="utf-8")
            self.assertEqual(run_paper(workspace).returncode, 1)
            self.assertEqual(certificate(workspace)["status"], "failed")

    def test_body_with_letter_prefix_is_not_mistaken_for_appendix(self):
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            simple_paper(workspace, r"The cost was 12. \input{sections/A_analysis}\input{appendix/full_table}")
            body = put(workspace, "paper/sections/A_analysis.tex", "The cost was 99999.")
            put(workspace, "paper/appendix/full_table.tex", "The cost was 98765.")
            self.assertEqual(run_paper(workspace).returncode, 1)
            body.write_text("The cost was 12.", encoding="utf-8")
            self.assertEqual(run_paper(workspace).returncode, 0)

    def test_legacy_sections_without_usable_main_still_expand_inputs(self):
        for main_text in (None, "% placeholder only\n"):
            with self.subTest(main=main_text), tempfile.TemporaryDirectory() as tmp:
                workspace = Path(tmp)
                put(workspace, "results.json", '{"cost":12}')
                if main_text is not None:
                    put(workspace, "paper/main.tex", main_text)
                put(workspace, "paper/sections/1_body.tex", r"The cost was 12. \input{../figures/TABLE_bad}")
                put(workspace, "figures/TABLE_bad.tex", "The cost was 99999.")
                self.assertEqual(run_paper(workspace).returncode, 1)

    def test_comments_code_appendix_references_and_ai_are_excluded(self):
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            simple_paper(workspace, r"""
\input{sections/1_body}
% \input{sections/unused}
\input{sections/A_code}
\input{sections/Z_ai_disclosure}
\input{sections/references}
\appendix
\input{sections/unused}
""")
            put(workspace, "paper/sections/1_body.tex", r"The accuracy was 93\%. % \input{missing} cost 99999" + "\nThe cost was 12.")
            for name in ("A_code", "Z_ai_disclosure", "references", "unused"):
                put(workspace, f"paper/sections/{name}.tex", "The cost was 99999.")
            put(workspace, "paper/sections/A_code.tex", r"\begin{lstlisting}cost = 98765; \input{missing}\end{lstlisting}")
            result = run_paper(workspace)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            main = workspace / "paper/main.tex"
            main.write_text(r"\begin{document}The cost was 12. \begin{thebibliography}{99} \bibitem{x} 98765 \end{thebibliography}\end{document}", encoding="utf-8")
            self.assertEqual(run_paper(workspace).returncode, 0)
            main.write_text(r"\begin{document}The cost was 12. \section*{AI Usage Disclosure}98765\end{document}", encoding="utf-8")
            self.assertEqual(run_paper(workspace).returncode, 0)

    def test_includeonly_filters_include_but_not_input(self):
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            simple_paper(workspace)
            main = put(workspace, "paper/main.tex", r"\includeonly{sections/a}\begin{document}\include{sections/a}\include{sections/b}\input{sections/c}\end{document}")
            put(workspace, "paper/sections/a.tex", "The cost was 12.")
            put(workspace, "paper/sections/b.tex", "The cost was 99999.")
            c = put(workspace, "paper/sections/c.tex", "The cost was 12.")
            self.assertEqual(run_paper(workspace).returncode, 0)
            self.assertNotIn(workspace / "paper/sections/b.tex", paper.tex_input_paths(workspace))
            c.write_text("The cost was 99999.", encoding="utf-8")
            self.assertEqual(run_paper(workspace).returncode, 1)

    def test_literal_regions_cannot_open_inputs_comments_or_document_boundaries(self):
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            snippets = [r"\verb|\input{missing} 98765 % \end{document}|",
                        r"\verb*+\input{missing} \appendix+",
                        r"\lstinline[language=TeX]!\input{missing} 98765!",
                        r"\lstinline{\input{missing} 98765}"]
            for env in ("verbatim", "verbatim*", "lstlisting", "minted"):
                snippets.append("\\begin{" + env + "}\n%\\input{missing}\n98765 \\appendix \\end{document}\n\\end{" + env + "}")
            body = "% \\begin{verbatim}\nThe cost was 12.\n" + "\n".join(snippets) + "\nThe accuracy was 93\\%."
            simple_paper(workspace, body)
            result = run_paper(workspace)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertEqual(certificate(workspace)["checked_values"], 2)
            self.assertEqual(set(paper.tex_input_paths(workspace)), {workspace / "paper/main.tex"})

    def test_input_resolution_never_falls_back_to_the_current_section_directory(self):
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            simple_paper(workspace, r"\input{sections/body}")
            put(workspace, "paper/sections/body.tex", r"The cost was 12. \input{missing}")
            put(workspace, "paper/sections/missing.tex", "The cost was 12.")
            self.assertEqual(run_paper(workspace).returncode, 2)
            self.assertEqual(certificate(workspace)["status"], "unavailable")

    def test_snapshot_binds_reachable_inputs_outside_candidate_directories(self):
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            simple_paper(workspace, r"The cost was 12. \input{../data/result.dat}\appendix\input{../extras/appendix.tex}")
            data = put(workspace, "data/result.dat", "The cost was 12.")
            appendix = put(workspace, "extras/appendix.tex", "Appendix constant 98765.")
            self.assertEqual(run_paper(workspace).returncode, 0)
            rows = {row["path"]: row["sha256"] for row in certificate(workspace)["inputs"]}
            for name in ("data/result.dat", "extras/appendix.tex"):
                self.assertEqual(rows[name], hashlib.sha256((workspace / name).read_bytes()).hexdigest())
            data.write_text("The cost was 99999.", encoding="utf-8")
            self.assertNotEqual(rows["data/result.dat"], hashlib.sha256(data.read_bytes()).hexdigest())
            self.assertEqual(run_paper(workspace).returncode, 1)

    def test_cyclic_inputs_cannot_be_certified(self):
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            simple_paper(workspace, r"The cost was 12.\input{sections/cycle}")
            put(workspace, "paper/sections/cycle.tex", r"\input{sections/cycle}")
            self.assertEqual(run_paper(workspace).returncode, 2)
            self.assertNotEqual(certificate(workspace)["status"], "passed")

    def test_every_rerun_failure_revokes_success_and_replaces_reports(self):
        mutations = {
            "empty_json": lambda w, m: put(w, "results.json", "{}"),
            "bad_json": lambda w, m: put(w, "results.json", "{"),
            "missing_paper": lambda w, m: m.unlink(),
            "missing_input": lambda w, m: m.write_text(r"\begin{document}The cost was 12.\input{missing}\end{document}", encoding="utf-8"),
            "no_numbers": lambda w, m: m.write_text(r"\begin{document}No measured results.\end{document}", encoding="utf-8"),
            "wrong_number": lambda w, m: m.write_text(r"\begin{document}The cost was 99999.\end{document}", encoding="utf-8"),
            "bad_encoding": lambda w, m: m.write_bytes(b"\\begin{document}cost 12\xff\n% DATA_CHECK_PASSED"),
        }
        for name, mutate in mutations.items():
            with self.subTest(reason=name), tempfile.TemporaryDirectory() as tmp:
                workspace = Path(tmp)
                main = simple_paper(workspace)
                initial = run_paper(workspace)
                self.assertEqual(initial.returncode, 0, initial.stdout + initial.stderr)
                self.assertEqual(certificate(workspace)["status"], "passed")
                mutate(workspace, main)
                failed = run_paper(workspace)
                self.assertIn(failed.returncode, (1, 2), failed.stdout + failed.stderr)
                self.assertNotEqual(certificate(workspace)["status"], "passed")
                for report in (paper.REPORT_NAME, paper.CHECKLIST_NAME):
                    self.assertTrue((workspace / report).is_file())
                    self.assertNotIn("通过：论文里的", (workspace / report).read_text(encoding="utf-8"))
                if main.exists():
                    self.assertNotIn(b"DATA_CHECK_PASSED", main.read_bytes())

    def test_docx_failure_also_revokes_markdown_marker(self):
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            main = simple_paper(workspace, mode="docx")
            self.assertEqual(run_paper(workspace, "docx").returncode, 0)
            self.assertIn(paper.PASS_MARKER_MD, main.read_text(encoding="utf-8"))
            put(workspace, "results.json", "{}")
            self.assertEqual(run_paper(workspace, "docx").returncode, 2)
            self.assertNotIn("DATA_CHECK_PASSED", main.read_text(encoding="utf-8"))
            self.assertEqual(certificate(workspace)["status"], "unavailable")

    def test_snapshot_contract_hashes_all_and_only_candidate_raw_bytes_after_stamp(self):
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            main = simple_paper(workspace)
            included = ["paper/main.tex", "results.json", "all_results.json", "paper/main.md",
                        "paper/sections/draft.tex", "figures/nested/data.json",
                        "figures/nested/TABLE_1.tex", "figures/nested/TABLE_1.md",
                        "paper/sections/🦄.tex", "paper/sections/\ue000.tex"]
            for path in included[2:]:
                put(workspace, path, "{}" if path.endswith(".json") else "Unused draft 98765.\n")
            for path in ("paper/draft.md", "figures/other.csv", "figures/nested/TABLE_DATA_CHECK_bad.json",
                         "figures/nested/TABLE_DATA_CHECK_note.md", "figures/TABLE_DATA_CHECK_bad.tex", "other.json",
                         "paper/sections/uppercase.TEX", "figures/uppercase.JSON"):
                put(workspace, path, "{}")
            result = run_paper(workspace)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            report = certificate(workspace)
            self.assertEqual(report["version"], 1)
            self.assertEqual(report["mode"], "pdf")
            expected = [{"path": name, "sha256": hashlib.sha256((workspace / name).read_bytes()).hexdigest()}
                        for name in sorted(included, key=lambda name: name.encode("utf-16-be"))]
            self.assertEqual(report["inputs"], expected)
            self.assertIn(paper.PASS_MARKER_TEX, main.read_text(encoding="utf-8"))
            self.assertNotIn(paper.RESULT_NAME, [row["path"] for row in report["inputs"]])

    def test_diagnostic_json_does_not_supply_paper_truth(self):
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            simple_paper(workspace, "The cost was 99999.")
            put(workspace, "figures/nested/TABLE_DATA_CHECK_LOCAL_REPORT.json", '{"cost":99999}')
            self.assertEqual(run_paper(workspace).returncode, 1)
            put(workspace, "figures/nested/genuine.json", '{"cost":99999}')
            self.assertEqual(run_paper(workspace).returncode, 0)

    def test_tex_comment_parity_and_escaped_percent_before_comment(self):
        text = "cost 12 " + r"93\% % bad 999" + "\n" + r"row \\% ignored 987" + "\n"
        self.assertEqual(paper.strip_tex_comments(text), "cost 12 93\\% \nrow \\\\\n")


class LogicAuditTests(unittest.TestCase):
    def test_bounds_probe_claim_is_checked_against_contract_before_direction(self):
        contract = {"bounds": [{"quantity": "eta", "is": "upper"}]}
        for claim, sign, expected_fail in [("lower", 1, True), ("upper", 1, True),
                                            ("upper", -1, False), ("lower", 0, True)]:
            with self.subTest(claim=claim, sign=sign):
                fails, _ = logic.audit_direction(contract, {"logic_probes": {"bounds": [
                    {"quantity": "eta", "claim": claim, "probe_delta_sign": sign}]}})
                self.assertEqual(bool(fails), expected_fail)

    def test_bounds_canonical_legacy_zero_missing_and_duplicate_probes(self):
        contract = {"bounds": [{"quantity": "eta", "is": "upper"}]}
        def check(probes):
            return logic.audit_direction(contract, {"logic_probes": {"bounds": probes}})
        self.assertTrue(check([{"quantity": "eta", "observed_sign": 1}])[0])
        self.assertTrue(check([{"quantity": "eta", "observed_sign": 1}])[1])
        self.assertTrue(check([{"quantity": "eta", "probe_delta_sign": None, "observed_sign": -1}])[0])
        for invalid in (True, False, "-1", None, [], {}):
            with self.subTest(invalid=invalid):
                self.assertTrue(check([{"quantity": "eta", "probe_delta_sign": invalid}])[0])
        self.assertTrue(check([{"quantity": "eta"}])[0])
        self.assertFalse(check([{"quantity": "eta", "probe_delta_sign": -1}])[0])
        self.assertFalse(check([{"quantity": "eta", "probe_delta_sign": 0}])[0])
        self.assertFalse(check([])[0])
        self.assertTrue(check([{"quantity": "eta", "probe_delta_sign": 1},
                               {"quantity": "eta", "probe_delta_sign": -1}])[0])
        self.assertTrue(check([{"quantity": "eta", "claim": "", "probe_delta_sign": -1}])[0])

    def test_monotonic_contract_direction_and_sign_cannot_be_overridden(self):
        contract = {"monotonic": [{"more": "resource", "then": "cost", "dir": "better", "expect_sign": -1}]}
        for probe, expected_fail in [
            ({"observed_sign": -1, "expect_sign": -1, "expect_dir": "better"}, False),
            ({"observed_sign": 1, "expect_sign": 1, "expect_dir": "worse"}, True),
            ({"observed_sign": -1, "expect_dir": "worse"}, True),
            ({"observed_sign": 1}, True), ({"observed_sign": 0}, False),
            ({"observed_sign": -1, "expect_sign": -2}, False),
            ({"observed_sign": True}, True), ({"observed_sign": "-1"}, True),
            ({"observed_sign": -1, "expect_sign": "-1"}, True),
            ({"observed_sign": -1, "expect_dir": ""}, True), ({}, True)]:
            with self.subTest(probe=probe):
                row = {"more": "resource", "then": "cost", **probe}
                fails, _ = logic.audit_direction(contract, {"logic_probes": {"monotonic": [row]}})
                self.assertEqual(bool(fails), expected_fail)
        # 'better' does not itself imply a positive or negative numerical direction.
        fails, warns = logic.audit_direction({"monotonic": [{"more": "r", "then": "y", "dir": "better"}]},
                                             {"logic_probes": {"monotonic": [{"more": "r", "then": "y", "observed_sign": 1}]}})
        self.assertFalse(fails)
        self.assertTrue(warns)

    def test_double_count_ast_distinguishes_subtraction_bias_and_real_addition(self):
        contract = {"no_double_count": [{"aggregate": "total", "contains": "component"}]}
        examples = [
            ("remaining = total - component + 1", False),
            ("remaining = total + 1 - component", False),
            ("remaining = total - (component + 1)", False),
            ("remaining = total + component - component", False),
            ("remaining = total - -component", True),
            ("remaining = total + component + 1", True),
            ("remaining = total + (component - 1)", True),
            ("remaining = (total\n + component)", True),
            ("a = total; b = component + 1", False),
            ("remaining = total - component # + component", False),
            ('text = "total + component"', False),
            ("remaining = total2 + component", False),
            ("remaining = total * (component + 1)", False),
            ("broken syntax total + component !", False),
        ]
        for code, expected_fail in examples:
            with self.subTest(code=code):
                self.assertEqual(bool(logic.audit_double_count(contract, code)), expected_fail)

    def test_conflicting_duplicate_contracts_are_not_silently_overwritten(self):
        raw = {"logic_probes": {"bounds": [{"quantity": "eta", "claim": "lower", "probe_delta_sign": 1}]}}
        fails, _ = logic.audit_direction({"bounds": [{"quantity": "eta", "is": "upper"},
                                                       {"quantity": "eta", "is": "lower"}]}, raw)
        self.assertTrue(any("合同冲突" in failure for failure in fails))
        no_probes, _ = logic.audit_direction({"bounds": [{"quantity": "eta", "is": "upper"},
                                                           {"quantity": "eta", "is": "lower"}]}, {})
        self.assertTrue(any("合同冲突" in failure for failure in no_probes))
        fails, _ = logic.audit_direction({"bounds": [{"quantity": "eta"},
                                                       {"quantity": "eta", "is": "upper"}]}, raw)
        self.assertTrue(fails)
        fails, _ = logic.audit_direction({"monotonic": [
            {"more": "r", "then": "y", "dir": "better", "expect_sign": 1},
            {"more": "r", "then": "y", "dir": "worse", "expect_sign": -1}]},
            {"logic_probes": {"monotonic": [{"more": "r", "then": "y", "observed_sign": -1}]}})
        self.assertTrue(any("合同冲突" in failure for failure in fails))

    def test_logic_cli_rejects_probe_contract_collision_and_accepts_legal_subtraction(self):
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            put(workspace, "LOGIC_CONTRACT.json", json.dumps({"bounds": [{"quantity": "eta", "is": "upper"}],
                 "no_double_count": [{"aggregate": "total", "contains": "component"}]}))
            put(workspace, "code/main.py", "total=10\ncomponent=2\nremaining=total-component+1\n")
            probe = {"quantity": "eta", "claim": "lower", "probe_delta_sign": 1}
            target = put(workspace, "figures/all_results.json", json.dumps({"logic_probes": {"bounds": [probe]}}))
            failed = run_helper("logic_audit.py", workspace)
            self.assertEqual(failed.returncode, 1, failed.stdout + failed.stderr)
            self.assertIn("探针/合同冲突", failed.stdout)
            probe.update(claim="upper", probe_delta_sign=-1)
            target.write_text(json.dumps({"logic_probes": {"bounds": [probe]}}), encoding="utf-8")
            passed = run_helper("logic_audit.py", workspace)
            self.assertEqual(passed.returncode, 0, passed.stdout + passed.stderr)


class TableAuditTests(unittest.TestCase):
    def test_plain_and_escaped_percent_tokens_keep_every_digit(self):
        for token, expected in [("93%", 93), (r"93\%", 93), (r"9\%", 9),
                                 (r"93.25\%", 93.25), (r"0.9\%", .9)]:
            with self.subTest(token=token):
                values = table._numbers_from_line("A & " + token + r" \\")
                self.assertEqual(len(values), 1)
                self.assertEqual(values[0][1:], (expected, True))

    def test_real_table_cli_accepts_percentages_and_rejects_incorrect_ones(self):
        for display, source in [(r"93\%", .93), ("93%", .93), (r"9\%", .09),
                                (r"93.25\%", .9325), (r"0.9\%", .009)]:
            with self.subTest(display=display), tempfile.TemporaryDirectory() as tmp:
                workspace = Path(tmp)
                put(workspace, "figures/results.json", json.dumps({"accuracy": source}))
                path = put(workspace, "figures/TABLE_accuracy.tex", "\\begin{tabular}{lr}\nMethod & accuracy \\\\\n\\midrule\nA & " + display + " \\\\\n\\bottomrule\n\\end{tabular}\n")
                passed = run_helper("table_data_check.py", workspace)
                self.assertEqual(passed.returncode, 0, passed.stdout + passed.stderr)
                marker = workspace / "figures/TABLE_DATA_CHECK_PASSED.txt"
                self.assertTrue(marker.is_file())
                path.write_text("\\midrule\nA & 77\\% \\\\\n\\bottomrule\n", encoding="utf-8")
                failed = run_helper("table_data_check.py", workspace)
                self.assertEqual(failed.returncode, 1, failed.stdout + failed.stderr)
                self.assertFalse(marker.exists())

    def test_table_diagnostic_json_and_markdown_do_not_pollute_truth(self):
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            put(workspace, "figures/results.json", '{"accuracy":0.93}')
            put(workspace, "figures/TABLE_DATA_CHECK_LOCAL_REPORT.json", '{"value":77}')
            put(workspace, "figures/TABLE_DATA_CHECK_note.md", "| diagnostic | 99999 |")
            put(workspace, "figures/TABLE_accuracy.tex", "\\midrule\nA & 77\\% \\\\\n\\bottomrule\n")
            result = table.check_tables(workspace / "figures")
            self.assertFalse(result["ok"])
            self.assertEqual(result["checked_values"], 1)
            self.assertEqual(result["tables"], ["TABLE_accuracy.tex"])
            self.assertEqual(result["json_sources"], ["results.json"])

    def test_table_exception_cannot_leave_old_marker(self):
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            figures = workspace / "figures"
            put(workspace, "figures/TABLE_DATA_CHECK_PASSED.txt", "old")
            with patch.object(sys, "argv", ["table_data_check.py", "--figures", str(figures)]), \
                 patch.object(table, "check_tables", side_effect=OSError("read failure")):
                self.assertEqual(table.main(), 1)
            self.assertFalse((figures / "TABLE_DATA_CHECK_PASSED.txt").exists())
            self.assertFalse(json.loads((figures / "TABLE_DATA_CHECK_LOCAL_REPORT.json").read_text())["ok"])


if __name__ == "__main__":
    unittest.main()
