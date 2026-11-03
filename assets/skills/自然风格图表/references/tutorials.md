# Tutorials — publication layout with the real shared helpers

These runnable examples use **synthetic demonstration data**, not evidence for a paper.
Replace it with verified project data. They demonstrate layout, not mandatory chart types.
Prepare `_utils/plot_utils.py` using SKILL.md; missing helpers are a setup error, not permission to bypass guards.
All examples preserve the project's selected palette through `setup_style(palette='nature')`.
Use the default skill's `setup_style()` for the default style. Never combine both in one script.

## 1. Three related metrics, with a separate legend cell

The fourth cell belongs to the legend; it must not overwrite the third metric.
Bar lengths use a zero baseline, and error ranges are included in the limits.
For real data, derive the displayed uncertainty from repeated experiments and describe its meaning in the caption.

```python
import numpy as np
import matplotlib.pyplot as plt
from _utils.plot_utils import setup_style, PALETTE, save_fig, set_paper_placement, dynamic_limits

setup_style(palette='nature')
methods = ['Method A', 'Method B', 'Method C', 'Method D']
metrics = ['Accuracy', 'Recall', 'F1']
means = np.array([[.81, .83, .86, .89], [.63, .67, .71, .74], [.71, .73, .78, .80]])
sd = np.full_like(means, .015)  # synthetic SD, not a claimed confidence interval
fig, axes = plt.subplots(2, 2, figsize=(6.5, 4.8), layout='constrained')
set_paper_placement(fig, width_fraction=.9)
for i, ax in enumerate(axes.flat[:3]):
    bars = ax.bar(np.arange(4), means[i], yerr=sd[i], color=PALETTE[:4],
                  capsize=2, label=methods)
    if i == 0:
        handles, labels = ax.get_legend_handles_labels()
    ax.set_xticks([])
    ax.set_ylabel(metrics[i])
    dynamic_limits(ax, y=np.r_[means[i] - sd[i], means[i] + sd[i]], include_zero=True)
axes.flat[3].set_axis_off()
axes.flat[3].legend(handles, labels, loc='center', frameon=False)
save_fig(fig, 'figures/fig_comparison.pdf')
```

## 2. Ordered component comparison

Do not truncate a bar baseline to magnify a small difference. If differences need emphasis,
use a dot-and-interval chart with an explicitly labelled scale instead.

```python
import numpy as np
import matplotlib.pyplot as plt
from _utils.plot_utils import setup_style, PALETTE, save_fig, set_paper_placement, dynamic_limits

setup_style(palette='nature')
configs = ['Base', '+ A', '+ B', 'Full']
values = np.array([.72, .78, .81, .88])
sd = np.array([.02, .02, .01, .01])  # synthetic SD
fig, ax = plt.subplots(figsize=(6, 3.5), layout='constrained')
set_paper_placement(fig, width_fraction=.9)
ax.barh(configs, values, xerr=sd, color=PALETTE[0], capsize=2)
dynamic_limits(ax, x=np.r_[values - sd, values + sd], include_zero=True)
ax.set_xlabel('Score')
save_fig(fig, 'figures/fig_components.pdf')
```

## 3. Repeated-experiment trajectories

Only two related panels, one separate legend row. The shaded range below is mean ± sample SD;
never invent uncertainty for a single deterministic run. Do not label every time point.

```python
import numpy as np
import matplotlib.pyplot as plt
from _utils.plot_utils import setup_style, PALETTE, save_fig, set_paper_placement, uncertainty_band

setup_style(palette='nature')
rng = np.random.default_rng(7)  # reproducible synthetic demo
x = np.arange(40)
fig = plt.figure(figsize=(6.5, 3.8), layout='constrained')
set_paper_placement(fig, width_fraction=.9)
gs = fig.add_gridspec(2, 2, height_ratios=[1, .16])
axes = [fig.add_subplot(gs[0, i]) for i in range(2)]
for panel, ax in enumerate(axes):
    for i, name in enumerate(['Method A', 'Method B']):
        runs = np.exp(-x[None, :] / (9 + i * 5)) + rng.normal(0, .025, (12, len(x))) + .05 * panel
        mean, sd = runs.mean(0), runs.std(0, ddof=1)
        ax.plot(x, mean, color=PALETTE[i], label=name)
        uncertainty_band(ax, x, mean - sd, mean + sd, color=PALETTE[i])
    ax.set_xlabel('Iteration')
    ax.set_ylabel('Loss')
    ax.set_title(['(a) Training', '(b) Validation'][panel], loc='left')
legend_ax = fig.add_subplot(gs[1, :])
legend_ax.set_axis_off()
legend_ax.legend(*axes[0].get_legend_handles_labels(), loc='center', ncol=2, frameon=False)
save_fig(fig, 'figures/fig_trends.pdf')
```

## 4. Vector heatmap with legible cell text

A single common unit and normalization permits comparisons across cells. For heterogeneous metrics,
use explicitly labelled per-metric scales or separate panels; do not reverse Normalize's vmin/vmax.
Reverse the colormap if necessary. Constant-valued and masked matrices are handled by the helper.
A sequential ramp here is derived from the selected palette, including grayscale.

```python
import numpy as np
import matplotlib.pyplot as plt
from matplotlib.colors import LinearSegmentedColormap
from _utils.plot_utils import setup_style, PALETTE, draw_vector_heatmap, save_fig, set_paper_placement

setup_style(palette='nature')
data = np.array([[.88, .82, .85], [.81, .78, .80], [.75, .72, .74], [.70, .68, .69]])
ramp = LinearSegmentedColormap.from_list('project_ramp', ['#FFFFFF', PALETTE[0]])
fig, ax = plt.subplots(figsize=(6, 3.8), layout='constrained')
set_paper_placement(fig, width_fraction=.9)
draw_vector_heatmap(ax, data, xlabels=['Task 1', 'Task 2', 'Task 3'],
                    ylabels=['A', 'B', 'C', 'D'], cmap=ramp, vmin=0, vmax=1,
                    annot='auto', cbar_label='Score')
save_fig(fig, 'figures/fig_heatmap.pdf')
```

## Related resources

- [SKILL.md](../SKILL.md) — execution and quality contract
- [api.md](api.md) — real helper API
- [common-patterns.md](common-patterns.md) — optional layout choices
