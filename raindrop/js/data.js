// Loads a dataset folder written by convert.py. Every download goes through this file, so the
// data can later come from a backend instead of static files without changing the rest of the viewer.

// Typed array per manifest dtype. convert.py writes little-endian bytes, and typed arrays use the platform's
// byte order, which is little-endian on all common platforms (x86, ARM)
const ARRAY_TYPES = { uint8: Uint8Array, uint16: Uint16Array, float32: Float32Array };

// One-byte gene code meaning "no value"; codes 0..254 are values (convert.py ONE_BYTE_MISSING, ONE_BYTE_TOP)
const ONE_BYTE_MISSING = 255;

async function fetchArray(url, dtype) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url} (${response.status})`);
  return new ARRAY_TYPES[dtype](await response.arrayBuffer());
}

// One-byte gene values (convert.py --one-byte) back to numbers: value = code * step, where step is the gene's
// top value / 254 (1 for a gene without positive values); code 255 becomes NaN
export function decodeSteps(codes, step) {
  return Float32Array.from(codes, (code) => (code === ONE_BYTE_MISSING ? NaN : code * step));
}

// One dataset: its manifest, and its arrays downloaded on first use. Fields are obs columns; gene sources
// are sets of genes stored one file per gene (path pattern with '{index}' for the gene's position)
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

  // Download once, then reuse: the cache holds the promise, so concurrent requests share one download
  // (a failed download stays cached as a rejected promise)
  cached(key, load) {
    if (!this.cache.has(key)) this.cache.set(key, load());
    return this.cache.get(key);
  }

  // Positions as float32, `dims` numbers per cell, cell-major (x0, y0, x1, y1, ...)
  embedding(name) {
    const entry = this.manifest.embeddings.find((e) => e.name === name);
    return this.cached(`embedding:${name}`, () => fetchArray(new URL(entry.file, this.base), 'float32'));
  }

  // One obs column per cell: category codes (uint8 or uint16) or float32 numbers, as the field's dtype says
  fieldValues(name) {
    const field = this.fields.get(name);
    return this.cached(`field:${name}`, () => fetchArray(new URL(field.file, this.base), field.dtype));
  }

  // One gene's value per cell; throws at once (not as a rejected promise) for a gene not in the source.
  // Sources written with --one-byte have per-gene `steps` and are decoded to float32 here
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
