// Color by: the side panel's color menu (any obs column) and gene box (a gene source and a gene typed with
// suggestions), and the per-cell colors of a view.
import { colorCategories, colorValues, geneColors, quantile, sortedFinite } from './colors.js';
import { colorLabel } from './names.js';
import { el } from './ui.js';

// Fraction of the values below the color scale's low end and above its high end: numbers span their middle
// 98%, and the top 1% of expressing cells saturate a gene's scale, so outliers do not wash out the rest
const OUTLIER_FRACTION = 0.01;

export class Coloring {
  // manifest, dataset: the open dataset (data.js); categories: the shared palettes (categories.js);
  // selectedView(): the view the side panel's controls apply to; setStatus(message): the status line;
  // renderLegend(): redraw the legend of the selected view (legend.js)
  constructor({ manifest, dataset, categories, selectedView, setStatus, renderLegend }) {
    this.manifest = manifest;
    this.dataset = dataset;
    this.categories = categories;
    this.selectedView = selectedView;
    this.setStatus = setStatus;
    this.renderLegend = renderLegend;
  }

  // Color by: any obs column, or a gene typed into the gene box; applies to the selected view
  buildColorControls() {
    const select = document.getElementById('color-field');
    // A dataset without genes shows no gene box and no '(gene)' entry (the menu's text while a gene colors the view)
    const hasGenes = this.manifest.gene_sources.some((s) => s.genes.length > 0);
    select.append(el('option', { value: '', textContent: '(gene)', disabled: true, hidden: !hasGenes }));
    document.getElementById('gene-box').hidden = !hasGenes;
    for (const f of this.manifest.fields) select.append(el('option', { value: f.name, textContent: f.name }));
    select.addEventListener('change', () => this.setColor(this.selectedView(), { kind: 'field', name: select.value }));

    // The source menu is shown only when there is a choice; the gene input suggests the chosen source's genes
    const sources = document.getElementById('gene-source');
    for (const s of this.manifest.gene_sources) sources.append(el('option', { value: s.name, textContent: s.name }));
    sources.hidden = this.manifest.gene_sources.length < 2;
    const list = document.getElementById('gene-list');
    const fillGeneList = () => {
      const source = this.manifest.gene_sources.find((s) => s.name === sources.value);
      list.replaceChildren(...source.genes.map((g) => el('option', { value: g })));
    };
    sources.addEventListener('change', fillGeneList);
    fillGeneList();
    // showColorControls refills the list when the selected view's gene comes from another source
    this.fillGeneList = fillGeneList;

    // A typed gene colors the selected view if the chosen source has it; otherwise the status line says so
    const input = document.getElementById('gene');
    input.addEventListener('change', () => {
      const source = this.manifest.gene_sources.find((s) => s.name === sources.value);
      if (source.genes.includes(input.value)) {
        this.setColor(this.selectedView(), { kind: 'gene', source: source.name, name: input.value });
      } else {
        this.setStatus(`${input.value} is not in the ${source.name} genes`);
      }
    });
  }

  // The color controls show what the selected view is colored by
  showColorControls(view) {
    if (!view.color) return;
    document.getElementById('color-field').value = view.color.kind === 'gene' ? '' : view.color.name;
    document.getElementById('gene').value = view.color.kind === 'gene' ? view.color.name : '';
    const sources = document.getElementById('gene-source');
    if (view.color.kind === 'gene' && sources.value !== view.color.source) {
      sources.value = view.color.source;
      this.fillGeneList();
    }
  }

  // Color a view by `color`: { kind: 'field', name } for an obs column, or { kind: 'gene', source, name }; its
  // tile's corner names it (shown with several views). view.cellValues keeps the per-cell values the colors were
  // made from, with their color, for the hover label; both are set together once loaded, so the label never pairs a
  // new color with the old values
  async setColor(view, color) {
    view.color = color;
    this.setStatus(`Loading ${color.name}...`);
    const isGene = color.kind === 'gene';
    const values = await (isGene ? this.dataset.geneValues(color.source, color.name) : this.dataset.fieldValues(color.name));
    const rgb = isGene ? this.geneColors(view, color, values) : this.fieldColors(view, color, values);
    view.scene.setColors(rgb);
    view.cellValues = { color, values };
    view.tileLegend.textContent = colorLabel(color, this.manifest.gene_sources);
    if (view === this.selectedView()) {
      this.showColorControls(view);
      this.renderLegend();
    }
    this.setStatus('');
  }

  // Genes: the scale runs from 0 to the 99th percentile of the expressing (positive) cells, so zero is darkest
  // and the top 1% saturate; counts are colored by log(1 + count) (colors.geneColors), and view.colorRange
  // keeps the values (not their logs) for the legend
  geneColors(view, color, values) {
    const expressed = sortedFinite(values, true);
    view.colorRange = [0, expressed.length ? quantile(expressed, 1 - OUTLIER_FRACTION) : 1];
    const { scale } = this.manifest.gene_sources.find((s) => s.name === color.source);
    return geneColors(values, view.colorRange[1], scale);
  }

  // Categories use the palette; numbers span their middle 98% (view.colorRange), from 0 to 1 when none is finite
  fieldColors(view, color, values) {
    const field = this.dataset.fields.get(color.name);
    if (field.kind === 'category') return colorCategories(values, this.categories.palette(field));
    const finite = sortedFinite(values);
    view.colorRange = finite.length ? [quantile(finite, OUTLIER_FRACTION), quantile(finite, 1 - OUTLIER_FRACTION)] : [0, 1];
    return colorValues(values, ...view.colorRange);
  }
}
