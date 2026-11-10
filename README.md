# Raindrop widget

3D browser views of brain cell atlases for the Krienen Lab website, made with the
[raindrop](https://github.com/NingWang1729/raindrop) viewer. Everything here is static files served by GitHub Pages.

- `raindrop/`: the viewer (three.js, no build step).
- `data/WMB_Yao2023_MERFISH_250k/`: the adult mouse brain MERFISH atlas of Yao et al., Nature (2023), from the
  Allen Brain Cell Atlas release 20231215 (C57BL6J-638850): 250,000 of the 3,739,961 cells with CCF positions,
  with the published cell types and CCF regions, and the published log2 expression (release 20230830) of the 500
  panel genes, stored in one byte per cell (each gene in 254 steps; under 0.04 log2 apart).
- `index.html`: a demo page embedding the widget.

## Embedding

```html
<iframe src="https://krienenlab.github.io/raindrop-widget/raindrop/?data=../data/WMB_Yao2023_MERFISH_250k/&embed=1"
        style="width:100%; height:90vh; border:0" allowfullscreen loading="lazy"></iframe>
```

`&controls=full` opens with every control shown (default `compact`; the widget's More / Fewer controls button
switches). Type a gene in the box beside the color menu to color by it. Plain scrolling over the widget scrolls the page; Ctrl + scroll (Cmd on a Mac) or a pinch zooms.

Data: Yao, Z. et al. A high-resolution transcriptomic and spatial atlas of cell types in the whole mouse brain.
Nature 624, 317-332 (2023); Allen Brain Cell Atlas.
