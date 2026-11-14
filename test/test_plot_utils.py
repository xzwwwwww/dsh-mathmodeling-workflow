"""Prompt/runtime plotting contract and real Agg rendering regressions."""
import ast
import importlib.util
import inspect
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'assets/utils/plot_utils.py'
REQUIRED = {'setup_style', 'save_fig', 'nature_palette', 'nature_markers', 'set_paper_placement',
            'dynamic_limits', 'draw_vector_heatmap', 'declutter_axes', 'uncertainty_band',
            'auto_legend', 'shared_legend', 'consolidate_shared_legends'}
PLOTTING = bool(importlib.util.find_spec('matplotlib') and importlib.util.find_spec('numpy'))


class PlotContractTests(unittest.TestCase):
    def test_prompt_exports_are_real_module_declarations(self):
        tree = ast.parse(SOURCE.read_text(encoding='utf-8'))
        names = {n.name for n in tree.body if isinstance(n, (ast.FunctionDef, ast.ClassDef))}
        names.update(t.id for n in tree.body if isinstance(n, ast.Assign) for t in n.targets if isinstance(t, ast.Name))
        self.assertFalse(REQUIRED - names)
        api = (ROOT / 'assets/skills/自然风格图表/references/api.md').read_text(encoding='utf-8')
        bullet_exports = set(re.findall(r'^- `([A-Za-z_]\w*)', api, re.M))
        self.assertFalse(bullet_exports - names)
        # No plotting function may mutate the user's Python/OS through an online installer.
        self.assertNotIn("'pip', 'install'", SOURCE.read_text(encoding='utf-8'))
        self.assertNotIn("'apt-get', 'install'", SOURCE.read_text(encoding='utf-8'))


@unittest.skipUnless(PLOTTING, 'real plotting tests require installed matplotlib and numpy')
class PlotBehaviorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import matplotlib
        matplotlib.use('Agg')
        import matplotlib.pyplot as plt
        import numpy as np
        cls.plt, cls.np = plt, np
        cls.runtime = tempfile.TemporaryDirectory(prefix='mmw-plot-runtime-')
        directory = Path(cls.runtime.name) / '_utils'
        directory.mkdir()
        (directory / '__init__.py').write_text('', encoding='utf-8')
        shutil.copyfile(SOURCE, directory / 'plot_utils.py')
        sys.path.insert(0, cls.runtime.name)
        import _utils.plot_utils as plot
        cls.plot = plot

    @classmethod
    def tearDownClass(cls):
        cls.plt.close('all')
        sys.path.remove(cls.runtime.name)
        sys.modules.pop('_utils.plot_utils', None)
        sys.modules.pop('_utils', None)
        cls.runtime.cleanup()

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='mmw-plot-case-')
        self.cwd = os.getcwd()
        os.chdir(self.tmp.name)
        self.plot.setup_style('nature')

    def tearDown(self):
        self.plt.close('all')
        os.chdir(self.cwd)
        self.tmp.cleanup()

    def test_every_new_api_is_callable_and_has_the_documented_parameters(self):
        for name in REQUIRED:
            self.assertTrue(callable(getattr(self.plot, name)), name)
        self.assertEqual(self.plot.PLOT_UTILS_API_VERSION, 1)
        self.assertIn('width_fraction', inspect.signature(self.plot.set_paper_placement).parameters)
        self.assertIn('origin', inspect.signature(self.plot.draw_vector_heatmap).parameters)
        self.assertIn('outside', inspect.signature(self.plot.auto_legend).parameters)

    def test_palette_imports_stay_live_and_project_gray_or_custom_palette_wins(self):
        palette, light = self.plot.PALETTE, self.plot.PALETTE_LIGHT
        Path('CLAUDE.md').write_text('MMW_DATA_FIG_PALETTE=grayscale\nMMW_DIAGRAM_STYLE=modern', encoding='utf-8')
        self.plot.setup_style('nature')
        self.assertIs(palette, self.plot.PALETTE)
        self.assertIs(light, self.plot.PALETTE_LIGHT)
        from matplotlib.colors import to_rgb
        for color in palette + list(self.plot.nature_palette().values()):
            r, g, b = to_rgb(color)
            self.assertAlmostEqual(r, g)
            self.assertAlmostEqual(g, b)
        Path('CLAUDE.md').write_text('MMW_DATA_FIG_PALETTE=custom\nMMW_DATA_FIG_COLORS=#226699,#884422', encoding='utf-8')
        self.plot.setup_style('nature')
        self.assertEqual([c.lower() for c in palette], ['#226699', '#884422'])
        Path('CLAUDE.md').write_text('MMW_DIAGRAM_STYLE=mono', encoding='utf-8')
        self.plot.setup_style('nature')
        self.assertTrue(any(len(set(to_rgb(c))) > 1 for c in palette))

    def test_placement_preserves_gridspec_and_enforces_final_font_floor(self):
        from matplotlib.text import Text
        fig = self.plt.figure(figsize=(10, 4), layout='constrained')
        engine = fig.get_layout_engine()
        self.plot.set_paper_placement(fig, width_fraction=.5)
        gs = fig.add_gridspec(1, 2, width_ratios=[1, .15])
        ax = fig.add_subplot(gs[0, 0])
        leg_ax = fig.add_subplot(gs[0, 1])
        ax.plot([0, 1], [0, 1], label='Model')
        ax.set_xlabel('Input')
        leg_ax.set_axis_off()
        leg_ax.legend(*ax.get_legend_handles_labels(), loc='center', fontsize=1)
        self.plot.save_fig(fig, 'figures/placement.pdf')
        self.assertIs(fig.get_layout_engine(), engine)
        self.assertEqual(ax.get_subplotspec().colspan.start, 0)
        self.assertEqual(leg_ax.get_subplotspec().colspan.start, 1)
        scale = self.plot._paper_scale(fig)
        for text in fig.findobj(match=Text):
            if text.get_visible() and text.get_text():
                self.assertGreaterEqual(text.get_fontsize() * scale, 8.25 - 1e-5)
        self.assertTrue(Path('figures/placement.pdf').read_bytes().startswith(b'%PDF-'))
        self.assertTrue(Path('figures/placement.png').is_file())

    def test_manual_layout_is_not_rewritten_and_outside_text_cannot_bypass_guard(self):
        fig = self.plt.figure(figsize=(6, 4))
        fig._mmw_manual_layout = True
        ax = fig.add_axes([.2, .2, .6, .6])
        self.plot.set_paper_placement(fig)
        before = ax.get_position().bounds
        ax.plot([0, 1], [0, 1])
        self.plot.save_fig(fig, 'manual.pdf')
        self.assertEqual(ax.get_position().bounds, before)
        fig2, ax2 = self.plt.subplots(layout='constrained')
        self.plot.set_paper_placement(fig2)
        fig2.text(1.2, .5, 'Outside canvas')
        with self.assertRaisesRegex(ValueError, 'outside'):
            self.plot.save_fig(fig2, 'invalid.pdf')
        self.assertFalse(Path('invalid.pdf').exists())
        with self.assertRaisesRegex(ValueError, 'fixed canvas'):
            fig2.savefig('bypass.pdf', bbox_inches='tight')

    def test_dynamic_limits_missing_constant_zero_log_and_inverted_axes(self):
        np = self.np
        fig, ax = self.plt.subplots()
        result = self.plot.dynamic_limits(ax, y=[2, np.nan, 2, np.inf])
        self.assertLess(result['y'][0], 2)
        self.assertGreater(result['y'][1], 2)
        self.plot.dynamic_limits(ax, x=[2, 4], include_zero=True)
        self.assertEqual(ax.get_xlim()[0], 0)
        self.assertGreater(ax.get_xlim()[1], 4)
        prior = ax.get_ylim()
        self.plot.dynamic_limits(ax, y=[np.nan, np.inf])
        self.assertEqual(ax.get_ylim(), prior)
        ax.invert_yaxis()
        self.plot.dynamic_limits(ax, y=[1, 3])
        self.assertGreater(*ax.get_ylim())
        ax.set_xscale('log')
        self.plot.dynamic_limits(ax, x=[-1, 0, 1, 100], include_zero=True)
        self.assertGreater(ax.get_xlim()[0], 0)
        self.assertGreater(ax.get_xlim()[1], 100)
        with self.assertRaises(ValueError):
            self.plot.dynamic_limits(ax, y=[1], pad=-1)

    def test_uncertainty_uses_supplied_values_and_rejects_wrong_shapes_or_reversed_bounds(self):
        np = self.np
        fig, ax = self.plt.subplots()
        ax.plot([0, 1, 2], [1, 2, 3])
        band = self.plot.uncertainty_band(ax, [0, 1, 2], [.8, np.nan, 2.8], [1.2, np.nan, 3.2])
        self.assertEqual(band.get_alpha(), .14)
        self.assertTrue(band.get_paths())
        with self.assertRaises(ValueError):
            self.plot.uncertainty_band(ax, [0, 1], [1], [2, 3])
        with self.assertRaises(ValueError):
            self.plot.uncertainty_band(ax, [0, 1], [3, 1], [2, 2])

    def test_vector_heatmap_keeps_mask_origin_and_contrasting_annotations(self):
        np = self.np
        from matplotlib.colors import ListedColormap
        fig, ax = self.plt.subplots(figsize=(5, 4), layout='constrained')
        self.plot.set_paper_placement(fig)
        matrix = np.array([[0, 1], [np.nan, np.inf]])
        mesh, bar = self.plot.draw_vector_heatmap(ax, matrix, cmap=ListedColormap(['black', 'white']),
                        xlabels=['A', 'B'], ylabels=['C', 'D'], vmin=0, vmax=1, cbar_label='Value')
        self.assertFalse(mesh.get_rasterized())
        self.assertIsNotNone(bar)
        self.assertEqual(ax.get_ylim(), (2., 0.))
        self.assertEqual(self.np.ma.getmaskarray(mesh.get_array()).sum(), 2)
        self.assertEqual([text.get_color() for text in ax.texts], ['white', 'black'])
        self.plot.save_fig(fig, 'vector.svg')
        svg = Path('vector.svg').read_text(encoding='utf-8')
        self.assertNotIn('<image', svg)
        self.assertIn('<text', svg)
        self.assertTrue(Path('vector.png').is_file())

    def test_heatmap_constant_all_missing_density_cax_and_invalid_arguments(self):
        np = self.np
        fig = self.plt.figure(layout='constrained')
        gs = fig.add_gridspec(1, 2, width_ratios=[1, .1])
        ax, cax = fig.add_subplot(gs[0, 0]), fig.add_subplot(gs[0, 1])
        mesh, bar = self.plot.draw_vector_heatmap(ax, np.ones((3, 2)), cax=cax, square=True)
        self.assertIs(bar.ax, cax)
        self.assertLess(mesh.norm.vmin, 1)
        self.assertGreater(mesh.norm.vmax, 1)
        fig2, ax2 = self.plt.subplots()
        missing, _ = self.plot.draw_vector_heatmap(ax2, np.full((2, 2), np.nan), cbar=False)
        self.assertEqual(np.ma.getmaskarray(missing.get_array()).sum(), 4)
        self.assertEqual(len(ax2.texts), 0)
        fig3, ax3 = self.plt.subplots()
        self.plot.draw_vector_heatmap(ax3, np.zeros((10, 10)), cbar=False)
        self.assertEqual(len(ax3.texts), 0)
        for kwargs in [dict(xlabels=['bad']), dict(mask=np.ones((1, 1))), dict(vmin=2, vmax=1), dict(center=5, vmin=0, vmax=1)]:
            with self.assertRaises(ValueError):
                self.plot.draw_vector_heatmap(ax3, np.zeros((2, 2)), **kwargs)

    def test_shared_legends_preserve_data_panels_and_decline_different_series(self):
        fig, axes = self.plt.subplots(1, 2, figsize=(7, 3), layout='constrained')
        self.plot.set_paper_placement(fig)
        for ax in axes:
            ax.plot([0, 1], [0, 1], color=self.plot.PALETTE[0], label='A')
            ax.plot([0, 1], [1, 0], color=self.plot.PALETTE[1], label='B')
            ax.legend()
        shared = self.plot.consolidate_shared_legends(fig, axes, where='top')
        self.assertIsNotNone(shared)
        self.assertEqual(len(fig.axes), 2)
        self.assertTrue(all(len(ax.lines) == 2 and ax.get_legend() is None for ax in axes))
        self.plot.save_fig(fig, 'shared.pdf')
        fig2, axes2 = self.plt.subplots(1, 2, layout='constrained')
        for i, ax in enumerate(axes2):
            ax.plot([0, 1], [0, 1], color=['red', 'blue'][i], label='Same label')
            ax.legend()
        original = [ax.get_legend() for ax in axes2]
        self.assertIsNone(self.plot.consolidate_shared_legends(fig2, axes2, min_series=1))
        self.assertEqual([ax.get_legend() for ax in axes2], original)

    def test_auto_legend_preserves_safe_location_and_uses_measured_outside_lane(self):
        fig, ax = self.plt.subplots(figsize=(6, 3), layout='constrained')
        ax.plot([0, 1], [0, 0], label='Safe series')
        original = ax.legend(loc='upper center')
        self.assertIs(self.plot.auto_legend(ax), original)
        fig2, ax2 = self.plt.subplots(figsize=(6, 3), layout='constrained')
        self.plot.set_paper_placement(fig2)
        ax2.fill_between([0, 1], [0, 0], [1, 1], label='Dense coverage')
        ax2.set_xlim(0, 1); ax2.set_ylim(0, 1)
        legend = self.plot.auto_legend(ax2)
        self.assertIn(legend, fig2.legends)
        self.assertFalse(legend.get_window_extent().overlaps(ax2.get_window_extent()))
        self.plot.save_fig(fig2, 'outside.pdf')

    def test_four_shipped_tutorials_execute_without_missing_apis_and_create_pdf_png(self):
        doc = (ROOT / 'assets/skills/自然风格图表/references/tutorials.md').read_text(encoding='utf-8')
        examples = re.findall(r'```python\n(.*?)```', doc, re.S)
        self.assertEqual(len(examples), 4)
        for code in examples:
            exec(compile(code, 'shipped-tutorial', 'exec'), {'__name__': '__main__'})
        pdfs = sorted(Path('figures').glob('*.pdf'))
        self.assertEqual(len(pdfs), 4)
        for pdf in pdfs:
            self.assertTrue(pdf.read_bytes().startswith(b'%PDF-'))
            self.assertTrue(pdf.with_suffix('.png').is_file())

    def test_legacy_export_keyword_and_high_level_heatmap_remain_usable(self):
        fig, ax = self.plt.subplots(figsize=(6, 4))
        ax.plot([0, 1], [1, 2])
        self.plot.save_fig(fig, output='legacy-keyword.pdf')
        self.plot.heatmap(self.np.eye(3), labels=['A', 'B', 'C'], output='legacy-heatmap.pdf')
        for name in ['legacy-keyword', 'legacy-heatmap']:
            self.assertTrue(Path(name + '.pdf').read_bytes().startswith(b'%PDF-'))
            self.assertTrue(Path(name + '.png').is_file())

    def test_optional_style_or_label_packages_are_never_installed_while_plotting(self):
        original_import = __import__
        def offline_import(name, *args, **kwargs):
            if name in ('scienceplots', 'adjustText'):
                raise ImportError(name)
            return original_import(name, *args, **kwargs)
        with patch('builtins.__import__', side_effect=offline_import), patch('subprocess.check_call', side_effect=AssertionError('installer invoked')), patch('subprocess.run', side_effect=AssertionError('OS installer invoked')):
            self.plot.setup_style('nature')
            self.assertIsNone(self.plot._ensure_adjustText())


if __name__ == '__main__':
    unittest.main()
