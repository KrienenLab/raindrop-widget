# Raindrop widget

3D browser views of brain cell atlases for the Krienen Lab website, made with the
[raindrop](https://github.com/NingWang1729/raindrop) viewer. Everything here is static files served by GitHub Pages.

- `raindrop/`: the viewer (three.js, no build step).
- `data/WMB_Yao2023_MERFISH_250k/`: the adult mouse brain MERFISH atlas of Yao et al., Nature (2023), from the
  Allen Brain Cell Atlas release 20231215 (C57BL6J-638850): 250,000 of the 3,739,961 cells with CCF positions,
  with the published cell types and CCF regions, and the published log2 expression (release 20230830) of the 500
  panel genes, stored in one byte per cell (each gene in 254 steps; under 0.04 log2 apart).
- `data/HMBA_marmoset_Xenium_tank_bg/`: the basal ganglia of one hemisphere of an adult marmoset brain (HMBA Xenium,
  donor CJ23.56.004, "tank") in CCF coordinates (mm): the 528,088 QC-passing basal ganglia cells of 10,052,198 that
  the HMBA basal ganglia taxonomy labels (the 1,841 "Adjacent" cells from outside it are left out), with its four levels
  (Neighborhood, Class, Subclass, Group) in the AIBS colors, a Basal ganglia column (Striatum, GPe, GPi, STN, SN), each
  cell's Section (46, named without the shared "CJ23.56.004.CX." prefix), and the 300-gene panel as log2(counts per thousand + 1), one byte per cell. The widget opens colored by Group.
- `widget.html`: the page to embed: a Mouse | Marmoset toggle above one viewer.
- `index.html`: a demo page embedding the widget.

## Embedding

```html
<iframe src="https://krienenlab.github.io/raindrop-widget/widget.html"
        style="width:100%; height:80vh; border:0" allowfullscreen loading="lazy"></iframe>
```

The Mouse | Marmoset buttons switch datasets and record the choice in the address (`widget.html#mouse`,
`widget.html#marmoset`), so a link can open either; mouse is the default. One dataset alone, without the toggle:
`raindrop/?data=../data/WMB_Yao2023_MERFISH_250k/&embed=1` or
`raindrop/?data=../data/HMBA_marmoset_Xenium_tank_bg/&embed=1`.

`widget.html` opens with every control shown (the side panel) when it is at least 700 px wide. In a narrower frame,
as on a phone, where the panel would cover most of the view, it opens with compact controls. `widget.html?controls=full`
or `widget.html?controls=compact` sets the opening controls in the embed code instead, also with a hash
(`widget.html?controls=full#marmoset`). The widget's More / Fewer controls button switches, and the Mouse | Marmoset
buttons keep that choice while the page is open.

On the one-dataset URLs, `&controls=full` opens with every control shown (default `compact`).

Type a gene in the box beside the color menu to color by it. Plain scrolling over the widget scrolls the page; Ctrl +
scroll (Cmd on a Mac) or a pinch zooms.

## Building the marmoset data

The basal ganglia cells (Basal ganglia not NA) of the tank without the Adjacent ones, with obs Basal ganglia, the taxonomy
columns BG_Neighborhood, BG_Class, BG_Subclass and BG_Group renamed Neighborhood, Class, Subclass and Group with their
colors, and Section (section without its prefix, colored blue to yellow in name order) (X log2CPT; obsm
spatial = CCF mm), are converted with raindrop `convert.py --name "Marmoset basal ganglia Xenium (HMBA,
CJ23.56.004), HMBA basal ganglia taxonomy" --color Group --filters "Basal ganglia" Neighborhood Class Subclass Group Section
--embedding spatial --axis-labels LR AP DV --ends spatial left right posterior anterior ventral dorsal --view left
--hierarchy Neighborhood Class --hierarchy Class Subclass --hierarchy Subclass Group --log-scaled measured log2CPT
--one-byte measured --start-style keep-colors=on`; the manifest's source then names the public data instead of a
local path.

Data: Yao, Z. et al. A high-resolution transcriptomic and spatial atlas of cell types in the whole mouse brain.
Nature 624, 317-332 (2023); Allen Brain Cell Atlas. Marmoset: Allen Institute for Brain Science, BRAIN Initiative
Human and Mammalian Brain Atlas (HMBA) Xenium data.
