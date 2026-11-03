# Nature Figure Design Theory

This reference explains the shared contract in [SKILL.md](../SKILL.md). It is a design aid,
not a claim that every Nature journal mandates one layout, palette, or font size.

## Typography and placement

Initialize with `setup_style(palette='nature')`; preserve the shared Chinese fallback fonts.
Do not replace the font list with Arial-only settings or enable external LaTeX solely for styling.
Use `set_paper_placement` with the real PDF/Word insertion constraints.

Normal text must remain at least 8pt at final size (runtime target 8.25pt).
Choose source canvas and font tiers together; do not use 28–45 inch canvases or huge source fonts
as a template. Dense figures need a reserved legend/colorbar lane, more height or related groups.
After changing height, recalculate placement because a page-height cap can also reduce width.

## Axes and meaningful scales

Left/bottom spines and restrained grids suit many line/bar/scatter plots.
Use the frame and scale appropriate for heatmaps, polar plots or geometric illustrations.
A legend-only cell has no numeric axes; a data panel still needs scale, meaning and applicable units.
Direct labels can replace a legend only when they unambiguously identify every series.

Line/point limits may follow the data, including uncertainty endpoints.
Bars normally retain a zero baseline; never tighten their axis to exaggerate a small difference.
Log axes need positive data and clearly identified units; do not add arbitrary headroom for paragraphs.

## Color semantics

Explicit user choices are authoritative, including black-and-white.
Nature's default hues are a fallback, not mandatory blue/green/red roles.
Keep each method's color consistent across panels, reinforced by line styles or hatches where useful.
Use `COLORS['text']` for ordinary text, not pastel series fills.
Contrast is assessed against the actual composited background, at least 4.5:1 for normal text.

Transparency can encode ordered variants or measured uncertainty, but must not erase distinctions.
Do not fabricate error bands; state whether the interval is SD, SE or CI in the appropriate caption/body.
Colorful labels and white strokes are not a repair for text covering data.

## Layout

Choose rows, columns or asymmetric panels from the scientific relationship, not a fixed recipe.
Comparable experiments should keep consistent encodings; novelty is not a quality criterion.
Panel labels are short and clear, usually left-aligned titles.
Give legends, colorbars and dense value columns real space instead of out-of-canvas anchors.

Use one layout system. For multi-panel figures, prefer constrained layout plus GridSpec.
Do not call `tight_layout` or `subplots_adjust` on a constrained/compressed figure.
For deliberately manual positioning set `fig._mmw_manual_layout=True` and verify the whole canvas.
Shared legend helpers reserve their own space; do not subsequently reset those margins.

`bar_label`, `adjustText`, `auto_legend` and `loc='best'` offer candidate positions,
not a guarantee. Final-size checks must include adjacent panels, titles, error bars, markers and boundaries.
Use an independent zoom panel when an inset would hide required evidence.

## Export and verification

Use `save_fig` through the initialized shared runtime: PDF for LaTeX, required high-resolution PNG
for Word-only projects. SVG may be an additional editable source, not a compulsory duplicate deliverable.
Vector text is not improved by higher DPI; DPI matters for raster layers.
Do not override export with `bbox_inches='tight'` to conceal misplaced content.

Run the common code/output checks and review the final rendering.
A confirmed overlap or clipping is not a stylistic warning. An ambiguous complex background needs
review, not a fabricated pass/fail. Optional paid review remains opt-in and snapshot-cached.
Close figures after saving.

## Checklist

- [ ] Shared setup and actual placement recorded; chosen project palette retained
- [ ] Necessary scales, units, methods and uncertainty definitions remain available
- [ ] Layout fits the content; no chart-type or arbitrary canvas-size quota
- [ ] Labels keep their correct data/category associations
- [ ] Legend, colorbar and value lanes fit within the canvas and do not overlap data
- [ ] Final fonts, contrast and boundaries verified after layout settles
- [ ] Failed output is repaired within the bounded retry policy, not certified by an API name
