# Shared plotting API — default and Nature

Use the shipped `_utils.plot_utils` module, not invented inline wrappers.
Call `setup_style(palette='nature')` once before creating figures; this installs the same
save-time layout/contrast guards used by the default style. `save_fig` alone does not initialize styling.

The v0.5.4 bundled runtime declares `PLOT_UTILS_API_VERSION = 1`. Workflow dispatch checks the exports below and upgrades known original workspace copies before serving this prompt. Keep the prepared file; do not replace it with an older parent-directory helper.

## Core exports

- `PALETTE`: mutable **list** of selected series colors, not a semantic-key dictionary.
  Imported references stay current after setup. Do not replace it with tutorial colors.
- `COLORS`: semantic ink colors, contrast-adjusted for readable lines/annotations.
- `PALETTE_LIGHT`: corresponding light fills, not colors for text on white.
- `setup_style(palette='auto')`: default workspace-seeded style; `'nature'` chooses Nature.
  User-selected project palette remains authoritative.
- `set_paper_placement(fig, width_fraction=None, *, textwidth_in=6.5, height_fraction=0.80, textheight_in=9.7, min_font_pt=8.25)`:
  record actual intended paper placement before saving. Match the real template, not a universal journal width.
- `save_fig(fig, path)`: vector PDF export and shared layout/print-font guards; also creates a PNG preview.
- `auto_legend(ax, outside=None, where='auto', **kwargs)`: retain a safe original
  location, measure other inside candidates, then use a compact top/right lane.
  Explicit loc/columns are preferences; they never authorize covering data.
  A large legend in genuinely empty space is not moved solely for its area.
- `shared_legend(fig, axes=None, *, where='auto', ncol=None, title=None, **kwargs)`
  and `consolidate_shared_legends(fig, axes, *, where='auto', min_series=2, **kwargs)`:
  only consolidate identical semantic series. A dedicated GridSpec legend row/column is also valid.
- `uncertainty_band(ax, x, lower, upper, *, color=None, alpha=0.14, **kwargs)`:
  show measured uncertainty; arrays must align with x. This does not estimate statistical intervals.
- `dynamic_limits(ax, *, x=None, y=None, pad=0.06, include_zero=False)`:
  finite-value-aware limits. Set include_zero=True for bar lengths and include error endpoints.
- `declutter_axes(ax, *, grid='auto', grid_axis='y')`: restrained spines, ticks and grid.
- `draw_vector_heatmap(ax, data, *, xlabels=None, ylabels=None, mask=None, annot='auto',
  annot_limit=48, fmt='.2f', cmap='coolwarm', vmin=None, vmax=None, center=None,
  square=False, origin='upper', cbar=True, cbar_label=None, cax=None, cell_linewidth=0.35)`:
  returns (ScalarMappable, colorbar). Use cax for a dedicated GridSpec colorbar lane in multi-panel figures.
  Labels match matrix dimensions; masked/nonfinite cells remain missing,
  not zero. Constant-valued ranges expand safely. A colormap object derived from PALETTE preserves a chosen color family.

For exact signatures of less common functions, read the deployed module. Names such as
`apply_publication_style`, `make_trend` and `finalize_figure` in older reference drafts
are **not** exports of this helper; do not call them.

## Print contract

Normal text must remain at least **8pt at final insertion size** (runtime target 8.25pt).
This is this project's Chinese-paper readability floor, not a claim that Nature mandates 8pt.
Do not force Arial-only fonts, giant canvases, 24–54pt source text, or unguarded save fallbacks.
Font warnings, clipping, real overlaps and illegible contrast need correction. Ambiguous image backgrounds
need visual review, not invented pass/fail claims. See [tutorials.md](tutorials.md) for runnable examples.
