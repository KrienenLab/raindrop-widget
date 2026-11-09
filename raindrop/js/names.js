// Names the viewer shows for what the data holds. Plain functions over manifest entries, so they run in node
// tests too.

// Short label for an axis end: the first letter of an anatomical name (anterior -> A), or a generic name such as
// '-x' unchanged
export function endLabel(name) {
  return /^[-+]/.test(name) ? name : name.charAt(0).toUpperCase();
}

// Axis widget label for an axis end: as endLabel for anatomical names; for generic names ('-UMAP 1', '+UMAP 1')
// the last word of the high end only ('1') and nothing at the low end, so labels stay short in the small widget
export function widgetEndLabel(name) {
  if (!/^[-+]/.test(name)) return endLabel(name);
  return name.startsWith('+') ? name.slice(1).split(' ').pop() : '';
}

// The name with its first letter in upper case (anterior -> Anterior)
export function capitalize(name) {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

// Names of an embedding's axes: its own (convert.embedding_axis_labels, e.g. UMAP 1), or the dataset's axis labels
// for manifests written before embeddings had them. `entry` is one of the manifest's embeddings
export function axisLabels(manifest, entry) {
  return entry.labels ?? manifest.axes.labels;
}

// Axis name on the plot: both ends spelled out in the given order (e.g. Anterior-Posterior), or the axis label
// when the ends are generic ('-x', '+x')
export function axisTitle(label, ends) {
  return ends.some((name) => /^[-+]/.test(name)) ? label : ends.map(capitalize).join('\u2013');
}

// What a view is colored by, as its legends name it: an obs column by its name; a gene with its scale ('log scale'
// when the viewer takes the log, or the source's own, e.g. 'log2'), and for genes of a source other than the first
// (X's measured genes) also the source, e.g. 'Pcp4 (imputed, log scale)'. `sources` is the manifest's gene_sources
export function colorLabel(color, sources) {
  if (color.kind !== 'gene') return color.name;
  const scale = sources.find((s) => s.name === color.source).scale ?? 'log scale';
  return color.source === sources[0].name ? `${color.name} (${scale})` : `${color.name} (${color.source}, ${scale})`;
}
