# Raindrop widget

3D browser views of brain cell atlases for the Krienen Lab website, made with the
[raindrop](https://github.com/NingWang1729/raindrop) viewer. Everything here is static files served by GitHub Pages.

- `raindrop/`: the viewer (three.js, no build step).
- `data/WMB_Yao2023_MERFISH_250k/`: the adult mouse brain MERFISH atlas of Yao et al., Nature (2023), from the
  Allen Brain Cell Atlas release 20231215 (C57BL6J-638850): 250,000 of the 3,739,961 cells with CCF positions,
  with the published cell types and CCF regions, and the published log2 expression (release 20230830) of the 500
  panel genes, stored in one byte per cell (each gene in 254 steps; under 0.04 log2 apart).
- `data/HMBA_marmoset_Xenium_tank_250k/`: one hemisphere of an adult marmoset brain (HMBA Xenium, donor CJ23.56.004,
  "tank") in CCF coordinates (mm): 250,000 of 1,000,000 QC-passing cells (random sample, seed 0), with the published
  MSCA v4 cell types (Class, Group) in the AIBS colors, a Basal ganglia column (Striatum, GPe, GPi, STN, SN by cell
  type, only inside the AIBS basal ganglia region; other cells NA in grey) that the widget opens on, and the 300-gene
  panel as log2(counts per thousand + 1), one byte per cell.
- `index.html`: a demo page embedding the widget.

## Embedding

```html
<iframe src="https://krienenlab.github.io/raindrop-widget/raindrop/?data=../data/WMB_Yao2023_MERFISH_250k/&embed=1"
        style="width:100%; height:90vh; border:0" allowfullscreen loading="lazy"></iframe>
```

For the marmoset, use `?data=../data/HMBA_marmoset_Xenium_tank_250k/&embed=1`.

`&controls=full` opens with every control shown (default `compact`; the widget's More / Fewer controls button
switches). Type a gene in the box beside the color menu to color by it. Plain scrolling over the widget scrolls the page; Ctrl + scroll (Cmd on a Mac) or a pinch zooms.

## Building the marmoset data

A 250,000-cell AnnData (obs Class, Group, Basal ganglia with their colors; X log2CPT; obsm spatial = CCF mm) is
converted with raindrop `convert.py --name "Marmoset brain Xenium (HMBA, CJ23.56.004), 250k cells" --color "Basal ganglia"
--filters "Basal ganglia" Class Group --embedding spatial --axis-labels LR AP DV --ends spatial left right posterior
anterior ventral dorsal --view left --hierarchy Class Group --log-scaled measured log2CPT --one-byte measured`; the
manifest's source then names the public data instead of a local path.

Data: Yao, Z. et al. A high-resolution transcriptomic and spatial atlas of cell types in the whole mouse brain.
Nature 624, 317-332 (2023); Allen Brain Cell Atlas. Marmoset: Allen Institute for Brain Science, BRAIN Initiative
Human and Mammalian Brain Atlas (HMBA) Xenium data.
