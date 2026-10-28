// Loads a dataset folder written by convert.py. Every download goes through this file, so the
// data can later come from a backend instead of static files without changing the rest of the viewer.

const ARRAY_TYPES = { uint8: Uint8Array, uint16: Uint16Array, float32: Float32Array };

async function fetchArray(url, dtype) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url} (${response.status})`);
  return new ARRAY_TYPES[dtype](await response.arrayBuffer());
}

// One-byte gene values (convert.py --one-byte): each code times the gene's step, code 255 meaning no value
export function decodeSteps(codes, step) {
  return Float32Array.from(codes, (code) => (code === 255 ? NaN : code * step));
}

export class Dataset {
  static async load(url) {
    // Resolve the folder against the page, so relative and absolute URLs both work
    const base = new URL(url.endsWith('/') ? url : url + '/', window.location.href);
    const response = await fetch(new URL('manifest.json', base));
    if (!response.ok) throw new Error(`Could not load ${base}manifest.json (${response.status})`);
    return new Dataset(base, await response.json());
  }

  constructor(base, manifest) {
    this.base = base;
    this.manifest = manifest;
    this.n = manifest.n_cells;
    this.fields = new Map(manifest.fields.map((f) => [f.name, f]));
    this.cache = new Map();
  }

  // Download once, then reuse; concurrent requests share one download
  cached(key, load) {
    if (!this.cache.has(key)) this.cache.set(key, load());
    return this.cache.get(key);
  }

  embedding(name) {
    const entry = this.manifest.embeddings.find((e) => e.name === name);
    return this.cached(`embedding:${name}`, () => fetchArray(new URL(entry.file, this.base), 'float32'));
  }

  fieldValues(name) {
    const field = this.fields.get(name);
    return this.cached(`field:${name}`, () => fetchArray(new URL(field.file, this.base), field.dtype));
  }

  geneValues(sourceName, gene) {
    const source = this.manifest.gene_sources.find((s) => s.name === sourceName);
    const index = source.genes.indexOf(gene);
    if (index < 0) throw new Error(`${gene} is not in gene source ${sourceName}`);
    const path = source.path.replace('{index}', index);
    const load = async () => {
      const values = await fetchArray(new URL(path, this.base), source.dtype);
      return source.steps ? decodeSteps(values, source.steps[index]) : values;
    };
    return this.cached(`gene:${sourceName}:${gene}`, load);
  }
}
