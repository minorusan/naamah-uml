// Naamah/bind — the Node side of a source binding.
//
// Three things live here: the file reader the loom needs, `author` (a JS script describing a
// diagram becomes a page), and `sync` (a page that was authored from source files is brought back
// in line with them).
//
// Importing this module installs the reader as a side effect, which is deliberate: every Node entry
// that can bind wants it, and nobody should be able to half-configure a loom.

import { readFileSync, writeFileSync, renameSync, rmSync, existsSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { create, syncGraph, useReader } from './loom.mjs';
import { renderPage, extractGraph } from './page.mjs';

export class BindError extends Error {
  constructor(message, code = 2) { super(message); this.code = code; }
}

/**
 * Write, or leave what was there.
 *
 * `sync` REWRITES THE PAGE IT READ: the page carries the only copy of the graph, including every
 * card position and every relation the author placed by hand. A write interrupted halfway — power,
 * a full disk, a kill signal — would leave half a page and destroy all of it. Writing beside it and
 * renaming means the page is either the old one or the new one, never a fragment.
 */
function writeAtomic(path, text) {
  const tmp = `${path}.naamah-${process.pid}.tmp`;
  try {
    writeFileSync(tmp, text);
    renameSync(tmp, path);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

// A relative source path in an authoring script means "next to the script", never "next to
// wherever the terminal happened to be" — the script and the code it describes live together, and
// the cwd is nobody's business. `author` sets this while it runs.
let base = null;

// Absolute paths are what get RECORDED, deliberately: a binding has to survive being read back out
// of a page from a different working directory, and a relative path cannot do that.
useReader((p) => {
  const abs = isAbsolute(p) ? p : resolve(base || process.cwd(), p);
  if (!existsSync(abs)) throw new BindError(`no such source file: ${p}`, 1);
  return { path: abs, text: readFileSync(abs, 'utf8') };
});

/**
 * Run an authoring script and write its page.
 *
 * The script's default export is either a graph, a loom, or a function taking the authoring API:
 *
 *   export default ({ create }) => {
 *     const loom = create('Rewards');
 *     const dom = loom.domain('Rewards');
 *     dom.type('RewardService', { fromFile: 'Runtime/RewardService.cs' });
 *     return loom;
 *   };
 *
 * Passing the API in rather than making the script import it is the point: the script cannot get
 * the module path wrong, and it gets a loom whose reader is already installed.
 */
export async function author(script, out) {
  const abs = resolve(script);
  if (!existsSync(abs)) throw new BindError(`no such file: ${script}`, 1);

  const mod = await import(pathToFileURL(abs).href);
  const entry = mod.default ?? mod.diagram;
  if (!entry) {
    throw new BindError(`${basename(script)} has no default export — export a loom, a graph, or a function`);
  }

  base = dirname(abs);
  let made;
  try {
    made = typeof entry === 'function' ? await entry({ create, syncGraph }) : entry;
  } finally {
    base = null;
  }
  const graph = typeof made?.build === 'function' ? made.build() : made;
  if (!graph?.nodes) throw new BindError(`${basename(script)} produced no graph`);

  const target = out || `${basename(abs, extname(abs))}.html`;
  writeAtomic(target, renderPage(graph));
  return { out: target, graph };
}

/**
 * Re-read every source file a page is bound to, and rewrite the page.
 *
 * The page is its own source — the graph comes back out of it, gets synced, and goes back in — so
 * this is idempotent and needs nothing kept on the side. Positions, domains, notes and relations
 * are the author's, not the file's, and are left exactly as they were.
 */
export function sync(page) {
  const abs = resolve(page);
  if (!existsSync(abs)) throw new BindError(`no such file: ${page}`, 1);

  const html = readFileSync(abs, 'utf8');
  const graph = extractGraph(html);
  if (!graph) throw new BindError(`${basename(page)} is not a page naamah rendered (no graph inside it)`);

  const bound = graph.nodes.filter((n) => n.source?.path);
  if (!bound.length) {
    throw new BindError(
      `nothing in ${basename(page)} is bound to a source file — ` +
      'bind a class with { fromFile: … } or .bind(…) when authoring it', 1);
  }

  const report = syncGraph(graph);
  writeAtomic(abs, renderPage(graph));
  return { out: abs, ...report };
}

/** Read a graph from whatever it is stored in: a page naamah rendered, or a graph JSON file. */
export function loadGraph(path) {
  const abs = resolve(path);
  if (!existsSync(abs)) throw new BindError(`no such file: ${path}`, 1);
  const text = readFileSync(abs, 'utf8');
  if (extname(abs).toLowerCase() === '.json') return JSON.parse(text);
  const graph = extractGraph(text);
  if (!graph) throw new BindError(`${basename(path)} holds no naamah graph`);
  return graph;
}

