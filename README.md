# Raindrop widget

3D browser views of brain cell atlases for the Krienen Lab website, made with the
[raindrop](https://github.com/NingWang1729/raindrop) viewer. Everything here is static files served by GitHub Pages.

- `raindrop/`: the viewer (three.js, no build step).
- `data/WMB_Yao2023_MERFISH_250k/`: the adult mouse brain MERFISH atlas of Yao et al., Nature (2023), from the
  Allen Brain Cell Atlas release 20231215 (C57BL6J-638850): 250,000 of the 3,739,961 cells with CCF positions,
  with the published cell types and CCF regions, and the published log2 expression (release 20230830) of the 500
  panel genes, stored in one byte per cell (each gene in 254 steps; under 0.04 log2 apart).
- `data/HMBA_marmoset_Xenium_tank_750k/`: one hemisphere of an adult marmoset brain (HMBA Xenium, donor CJ23.56.004,
  "tank") in CCF coordinates (mm): 750,000 of 10,052,198 QC-passing cells, namely every basal ganglia cell (529,929)
  plus a random sample (seed 0) of the other cells (220,071), so cell densities are not uniform: the basal ganglia
  keep all their cells, the rest of the brain is subsampled. With the published MSCA v4 cell types (Class, Group) and
  the HMBA basal ganglia taxonomy's subclasses (Subclass (BG taxonomy); neurons outside the basal ganglia are
  "Adjacent", in grey) in the AIBS colors, a Basal ganglia column (Striatum, GPe, GPi, STN, SN by cell type, only
  inside the AIBS basal ganglia region; other cells NA in grey), and the 300-gene panel as log2(counts per thousand
  + 1), one byte per cell. The widget opens colored by Class with the basal ganglia ticked: their cells large and
  opaque, the other cells at half size and 10% opacity in their own colors.
- `widget.html`: the page to embed: a Mouse | Marmoset toggle above one viewer.
- `index.html`: a demo page embedding the widget.

## Embedding

```html
<iframe src="https://krienenlab.github.io/raindrop-widget/widget.html"
        style="width:100%; height:90vh; border:0" allowfullscreen loading="lazy"></iframe>
```

The Mouse | Marmoset buttons switch datasets and record the choice in the address (`widget.html#mouse`,
`widget.html#marmoset`), so a link can open either; mouse is the default. One dataset alone, without the toggle:
`raindrop/?data=../data/WMB_Yao2023_MERFISH_250k/&embed=1` or
`raindrop/?data=../data/HMBA_marmoset_Xenium_tank_750k/&embed=1`.

`&controls=full` opens with every control shown (default `compact`; the widget's More / Fewer controls button
switches). Type a gene in the box beside the color menu to color by it. Plain scrolling over the widget scrolls the page; Ctrl + scroll (Cmd on a Mac) or a pinch zooms.

## Building the marmoset data

A 750,000-cell AnnData (obs Class, Group, Subclass (BG taxonomy), Basal ganglia with their colors; X log2CPT; obsm
spatial = CCF mm) is converted with raindrop `convert.py --name "Marmoset brain Xenium (HMBA, CJ23.56.004), 750k
cells: all basal ganglia cells, others subsampled" --color Class --filters "Basal ganglia" "Subclass (BG taxonomy)"
Class Group --embedding spatial --axis-labels LR AP DV --ends spatial left right posterior anterior ventral dorsal
--view left --hierarchy Class Group --log-scaled measured log2CPT --one-byte measured --select "Basal ganglia"
Striatum GPe GPi STN SN --start-style shown-size=1 shown-opacity=100 filtered-size=0.5 filtered-opacity=10
keep-colors=on`; the manifest's source then names the public data instead of a local path. Subclass (BG taxonomy)
has no hierarchy: it does not nest inside the MSCA Class or Group.

Data: Yao, Z. et al. A high-resolution transcriptomic and spatial atlas of cell types in the whole mouse brain.
Nature 624, 317-332 (2023); Allen Brain Cell Atlas. Marmoset: Allen Institute for Brain Science, BRAIN Initiative
Human and Mammalian Brain Atlas (HMBA) Xenium data.
