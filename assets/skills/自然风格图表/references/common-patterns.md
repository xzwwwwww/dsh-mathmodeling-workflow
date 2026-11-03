# Common Patterns — Nature Figure Making

Reusable layout and encoding patterns used across publication-grade scripts. All dimensions are starting points, not fixed quotas. Initialize the shared style, record actual paper placement, and verify final font size and geometry; a pattern is not a pass certificate.

---

## Pattern 1: Related metrics with a reserved legend cell

Choose rows and columns for the actual number of metrics, not an ultra-wide fixed canvas.
The legend needs **one extra cell**, never the last data cell.

```python
import math
ncols = 2
nrows = math.ceil((len(metrics) + 1) / ncols)
fig = plt.figure(figsize=(6.5, 2.2 * nrows), layout='constrained')
set_paper_placement(fig, width_fraction=.9)
gs = fig.add_gridspec(nrows, ncols)
for i, metric in enumerate(metrics):
    ax = fig.add_subplot(gs[i // ncols, i % ncols])
    ax.bar(x, values[metric], color=colors, label=methods)
    ax.set_ylabel(metric)
    ax.set_xticks([])
    if i == 0:
        handles, labels = ax.get_legend_handles_labels()
j = len(metrics)
ax_leg = fig.add_subplot(gs[j // ncols, j % ncols])
ax_leg.legend(handles, labels, loc='center', frameon=False)
ax_leg.set_axis_off()
```

For many metrics, split into related figure groups without discarding data. Recheck final print size.

---

## Pattern 2: Dedicated legend panel

When the legend is large, give it its own axis so data panels stay clean.

```python
fig, axes = plt.subplots(1, n_data + 1, figsize=(...), layout='constrained')
set_paper_placement(fig)

for i, ax in enumerate(axes[:-1]):
    bars = ax.bar(...)
    if i == 0:
        handles, labels = ax.get_legend_handles_labels()

# Legend-only panel
axes[-1].legend(handles, labels, loc='center', frameon=False)
axes[-1].set_axis_off()
```

---

## Pattern 3: Categorical bars without x-tick labels

When methods are named in the legend, hide x-ticks entirely.

```python
ax.set_xticks([])        # removes ticks and labels
# Alternatively:
ax.set_xticklabels([])   # keeps tick marks, removes labels
```

---

## Pattern 4: Dynamic y-axis tightening

Use data-driven limits for lines and points. Bar lengths normally start at zero; include error endpoints and handle constant-valued series.

```python
dynamic_limits(ax, y=values, include_zero=False)  # line/point series
# For bars: include_zero=True; pass all values AND uncertainty endpoints.
```

---

## Pattern 5: Alpha-graduated ablation bars (same color, varying opacity)

```python
import numpy as np

from matplotlib.colors import to_rgb
blue_rgb = to_rgb(PALETTE[0])  # preserve the selected color family
n_ablations = len(ablation_configs)
alphas = np.linspace(0.2, 1.0, n_ablations)
colors = [(blue_rgb[0], blue_rgb[1], blue_rgb[2], a) for a in alphas]
# Full method → alpha=1.0, most ablated → alpha=0.2
```

---

## Pattern 6: Hatch encoding for print-safe grayscale

Add hatching so bars remain distinct when printed in black-and-white.

```python
hatches = ['/', '\\\\', '.', 'x', 'o', '+']
for bar_container, hatch in zip(grouped_bars, hatches):
    for patch in bar_container:
        patch.set_hatch(hatch)
        patch.set_edgecolor('black')
        patch.set_linewidth(1.5)
```

---

## Pattern 7: Semantic or family color mapping

Always map colors consistently across all panels in a figure:

```python
method_colors = {name: PALETTE[i % len(PALETTE)] for i, name in enumerate(methods)}
colors = [method_colors[m] for m in methods]
```

Keep series identity stable between panels. Color may be reinforced with line styles,
hatches or marker shapes. A user-selected grayscale palette stays grayscale, including
improvement/degradation cues: use up/down shapes and text instead of introducing red/green.

---

## Pattern 8: In-bar text with luminance-aware color

```python
# Prefer a few necessary values, in the center of sufficiently large bars.
# The shared save guard computes contrast against the actual local fill.
for bar in bars:
    value = bar.get_height()
    ax.text(bar.get_x() + bar.get_width()/2, value/2,
            f'{value:.2f}', ha='center', va='center')
# If a bar is too short for its value, use an external value column or omit
# duplicate values already available in a table; do not shrink the text.
```

---

## Pattern 9: Fill-between trend with hatch (print-safe)

```python
ax.fill_between(x, 0, cumsum_series, color=fill_color, alpha=.2,
                hatch='//', edgecolor=PALETTE[0], linewidth=.5, label=label_name)
# Do not erase boundaries or neighboring data with a white overpainting layer.
```

---

## Pattern 10: Annotate events on trend lines

```python
def mark_events(ax, x_labels, y_cumsum, events_dict, dy_fraction=0.1):
    """Propose labels for a few events; final positions still require review."""
    x_index = {label: i for i, label in enumerate(x_labels)}
    y_lo, y_hi = ax.get_ylim()
    dy = dy_fraction * (y_hi - y_lo)
    for date, label in events_dict.items():
        if date not in x_index:
            continue
        i = x_index[date]
        stars = label.count('*')
        clean_label = label.replace('*', '')
        y_data = y_cumsum[i]
        ax.annotate(
            clean_label,
            xy=(i, y_data),
            xytext=(i, y_data + (1 + 0.8 * stars) * dy),
            ha='center', va='bottom', fontsize=11,
            arrowprops=dict(arrowstyle='-|>', lw=1.3, color='black',
                            shrinkA=0, shrinkB=0, mutation_scale=15)
        )
```

---

## Pattern 11: Grouped bars across multiple datasets (grouped-within-grouped)

```python
num_methods = len(methods)
xtick_positions = []

for dataset_idx, dataset_name in enumerate(datasets):
    x_start = dataset_idx * (num_methods + 1)   # gap of 1 between groups
    ax.bar(
        np.arange(num_methods) + x_start,
        values[dataset_name],
        color=method_colors,
        label=methods if dataset_idx == 0 else ['_nolegend_'] * num_methods,
    )
    xtick_positions.append(np.mean(np.arange(num_methods)) + x_start)

ax.set_xticks(xtick_positions)
ax.set_xticklabels(datasets)
```

---

## Pattern 12: Schematic hero panel with supporting quant row

Use when one mechanism or fabrication story needs to lead, with 2–4 smaller evidence plots below.

```python
fig = plt.figure(figsize=(6.4, 5.2), layout='constrained')
set_paper_placement(fig)
gs = fig.add_gridspec(2, 4, height_ratios=[2.2, 1.0])

ax_top = fig.add_subplot(gs[0, :])    # hero schematic
ax_b = fig.add_subplot(gs[1, 0])
ax_c = fig.add_subplot(gs[1, 1:3])
ax_d = fig.add_subplot(gs[1, 3])

# top panel should carry the main palette and the main visual narrative
```

Rules:

- Allocate height according to actual content; do not squeeze required evidence into unreadable support panels.
- Reuse softened versions of the same colors in the lower plots.
- Keep support plots quieter than the hero panel.

---

## Pattern 13: Dark image plate with repeated views

Use for microscopy, volume rendering, or fluorescence-heavy panels.

```python
fig = plt.figure(figsize=(6.4, 5.8), layout='constrained')
set_paper_placement(fig)
gs = fig.add_gridspec(3, 5)

for r in range(3):
    for c in range(5):
        ax = fig.add_subplot(gs[r, c])
        ax.set_facecolor('black')
        ax.set_xticks([])
        ax.set_yticks([])
        for spine in ax.spines.values():
            spine.set_visible(False)
```

Rules:

- Use black only within the image plate cells.
- Put channel labels, scale bars and small crop guides directly on the plate.
- Keep crop geometry and scale-bar placement consistent across the grid.

---

## Pattern 14: Clinical triptych

Use for outcome-over-time figures that combine trajectories, effect sizes, and summary proportions.

```python
fig = plt.figure(figsize=(6.4, 6.5), layout='constrained')
set_paper_placement(fig)
gs = fig.add_gridspec(4, 3, height_ratios=[0.18, 1.0, 1.35, 0.8])
legend_ax = fig.add_subplot(gs[0, :]); legend_ax.set_axis_off()
axes_top = [fig.add_subplot(gs[1, i]) for i in range(3)]
axes_mid = [fig.add_subplot(gs[2, i]) for i in range(3)]
axes_bot = [fig.add_subplot(gs[3, i]) for i in range(3)]
# Populate legend_ax only for shared semantic series; split if final cells are too small.
```

Rules:

- Keep the three columns semantically parallel.
- Use a dashed vertical reference line in the forest-plot row.
- Group shading in the forest-plot row should be pale and subordinate.

---

## Pattern 15: Asymmetric hero panel

Use when one panel is conceptually central and should dominate.

```python
fig = plt.figure(figsize=(6.4, 5.2), layout='constrained')
set_paper_placement(fig)
gs = fig.add_gridspec(3, 4)

ax_a = fig.add_subplot(gs[0, :2])
ax_b = fig.add_subplot(gs[0, 2])
ax_c = fig.add_subplot(gs[1, :2])
ax_d = fig.add_subplot(gs[1, 2])
ax_e = fig.add_subplot(gs[:, 3])      # hero panel spans all rows
ax_f = fig.add_subplot(gs[2, :2])
```

Rule: do not normalize every subplot to the same size if the science does not have equal importance.

---

## Pattern 16: Direct labels inside filled regions

Use when the same categorical structure repeats and a legend would become too large.

```python
for x_text, y_text, text in label_specs:
    ax.text(
        x_text, y_text, text,
        color=COLORS['text'],
        ha='center', va='center',
        fontsize=9, fontweight='bold',
    )
```

Rules:

- Keep labels inside stable, visually large regions.
- Check the actual background contrast; if it varies strongly, place a short label in a separate lane. A stroke or opaque box must not hide data.
- Prefer direct labels over a mega-legend for repeated stacked-area or phase diagrams.

---

## Related files

- [skill.md](../SKILL.md) — When to use this skill
- [api.md](api.md) — Helper function signatures and PALETTE
- [design-theory.md](design-theory.md) — Rationale behind every pattern above
- [nature-2026-observations.md](nature-2026-observations.md) — Real Nature page archetypes behind these patterns
- [tutorials.md](tutorials.md) — End-to-end walkthroughs
- [chart-types.md](chart-types.md) — Radar, 3D, scatter patterns
