# Specialized Chart Types

These are structural references, not mandatory chart choices. Apply [SKILL.md](../SKILL.md)
and the shared print contract to every example. All sample values below are synthetic.
Read real data in generated paper scripts; preserve project colors and scientific meaning.

## Radar / polar comparison

Use only when normalized dimensions and their directions are meaningfully comparable.
Document normalization and bounds; do not silently clip out-of-range observations or
invent missing benchmark limits. For many methods or long labels, a dot plot or heatmap
can be clearer. A radar chart is not required just for visual variety.

This example reserves a real legend row and uses polar tick labels instead of floating
text outside the figure. Radar/polar geometry still needs final visual review.

```python
# layout-regression: polar-legend
import numpy as np
import matplotlib.pyplot as plt
from _utils.plot_utils import setup_style, set_paper_placement, save_fig, PALETTE

def plot_radar(methods, dimensions, normalized_values):
    """Values are (n_dimensions, n_methods), already justified on a [0, 1] scale."""
    values = np.asarray(normalized_values, dtype=float)
    if len(dimensions) < 3 or not methods:
        raise ValueError('Radar requires at least three dimensions and one method')
    if values.shape != (len(dimensions), len(methods)):
        raise ValueError('Radar labels and values must have matching dimensions')
    if not np.isfinite(values).all() or (values < 0).any() or (values > 1).any():
        raise ValueError('Supply finite normalized values in [0, 1]; do not clip measurements')
    fig = plt.figure(figsize=(5.7, 5.6), layout='constrained')
    set_paper_placement(fig)
    gs = fig.add_gridspec(2, 1, height_ratios=[0.16, 1])
    legend_ax = fig.add_subplot(gs[0, 0])
    ax = fig.add_subplot(gs[1, 0], projection='polar')
    angles = np.linspace(0, 2 * np.pi, len(dimensions), endpoint=False)
    closed_angles = np.r_[angles, angles[0]]
    for index, name in enumerate(methods):
        closed_values = np.r_[values[:, index], values[0, index]]
        color = PALETTE[index % len(PALETTE)]
        ax.plot(closed_angles, closed_values, color=color,
                linestyle=['-', '--', ':', '-.'][index % 4], label=name)
    ax.set_theta_zero_location('N')
    ax.set_theta_direction(-1)
    ax.set_ylim(0, 1)
    ax.set_yticks([0.25, 0.5, 1])  # Sparse reference ticks; retain the full [0, 1] scale.
    ax.set_rlabel_position(180)  # This example has a clear lower inner region; recheck real data.
    ax.set_xticks(angles, dimensions)
    ax.tick_params(axis='x', pad=24)
    legend_ax.legend(*ax.get_legend_handles_labels(), loc='center',
                     ncol=min(len(methods), 3), frameon=False)
    legend_ax.set_axis_off()
    return fig, ax

setup_style(palette='nature')
fig, ax = plot_radar(['Method A', 'Method B'],
                    ['Accuracy', 'Speed', 'Stability', 'Efficiency'],
                    [[0.72, 0.64], [0.66, 0.78], [0.85, 0.68], [0.60, 0.73]])
save_fig(fig, 'figures/fig_layout_polar.pdf')
plt.close(fig)
```

## 3D geometry or conceptual illustrations

A geometric illustration may use sparse labels and short formulas; quantitative 3D data
need visible scales, axis names and units. Do not hide every tick by default.
Choose the view to separate relevant objects; a dense projection may need a second view.
Do not annotate every point or place conclusions inside the scene.

```python
# points and vectors are real, aligned (n, 3) arrays.
ax.scatter(points[:, 0], points[:, 1], points[:, 2], color=PALETTE[0])
ax.quiver(points[:, 0], points[:, 1], points[:, 2],
          vectors[:, 0], vectors[:, 1], vectors[:, 2],
          color=PALETTE[1], normalize=False)
# Use physical axis names/units from the model; review the chosen projection.
```

Do not rely on 2D label relocation for 3D geometry; verify the rendered camera view.
For conceptual geometry without numerical results, identify objects with only necessary names/formulas.

## Scatter plots

```python
ax.scatter(x, y, c=series_colors, s=30, alpha=0.65)
ax.set_xlabel(x_name_with_unit)
ax.set_ylabel(y_name_with_unit)
```

Keep a scale or a justified direct encoding. Do not hide axes on measured data merely to resemble an illustration.
For dense clouds, transparency, aggregation or marginal panels may help; do not drop inconvenient points.
A geometric/schematic plate may omit numeric ticks when a scale bar or other context is sufficient.

## Stacked trends

Use cumulative boundaries correctly. Do not draw every component from zero and cover the previous
layer, or erase boundaries with white overpainting.

```python
# x and nonnegative components are read from real data.
components = np.asarray(components, dtype=float)
if components.ndim != 2 or components.shape[1] != len(x):
    raise ValueError('Each component must align with x')
if not np.isfinite(components).all() or (components < 0).any():
    raise ValueError('This stacked-area recipe requires finite nonnegative components')
ax.stackplot(x, components, labels=component_names,
             colors=[PALETTE[i % len(PALETTE)] for i in range(len(components))], alpha=0.65)
# Place the component legend in a reserved lane; use another recipe for signed contributions.
```

## Log-scale values

Use a log scale only for positive data with a meaningful ratio interpretation. If values span
many orders of magnitude, points/intervals often avoid the misleading zero baseline of log bars.
Do not multiply the upper limit by 20 just to make room for annotations.

```python
values = np.asarray(values, dtype=float)
if not np.isfinite(values).all() or (values <= 0).any():
    raise ValueError('Log-scale values must be finite and positive')
ax.plot(np.arange(len(values)), values, 'o', color=PALETTE[0])
ax.set_yscale('log')
ax.set_xticks(np.arange(len(values)), category_names)
# Include real interval endpoints if present; check ticks at final print size.
```

## Asymmetric GridSpec layout

Give the important comparison more room, without fixing every paper to one architecture.

```python
fig = plt.figure(figsize=(6.4, 4.8), layout='constrained')
set_paper_placement(fig)
gs = fig.add_gridspec(3, 2, height_ratios=[0.18, 1, 1.1])
legend_ax = fig.add_subplot(gs[0, :])
left = fig.add_subplot(gs[1, 0])
right = fig.add_subplot(gs[1, 1])
summary = fig.add_subplot(gs[2, :])
legend_ax.set_axis_off()
# Populate every data cell from actual results; legend_ax is not a data cell.
```

## Scientific notation and spines

```python
# Linear numeric axes only; preserve readable scale factors and units.
ax.ticklabel_format(axis='y', style='sci', scilimits=(0, 0))
```

A spine at zero can help signed data, but must not cross numeric labels or hide negative ranges.
Prefer an unobtrusive zero reference line when moving a spine would confuse the reader.

## Related files

- [Skill](../SKILL.md)
- [Shared API](api.md)
- [Common patterns](common-patterns.md)
- [Design theory](design-theory.md)
- [Runnable tutorials](tutorials.md)
