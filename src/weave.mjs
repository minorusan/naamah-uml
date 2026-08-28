// Naamah/weave — the one operation: a diagram goes in, a page comes out.
// Kept separate from the CLI so anything else (a tool, a hook, a test) can call it directly.

import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { parseSvg } from './extract.mjs';
import { renderPage } from './page.mjs';

export class WeaveError extends Error {
  constructor(message, code = 2) { super(message); this.code = code; }
}

/**
 * Read `input` (.puml or .svg) into graphs, writing nothing.
 *
 * ONE .puml CAN HOLD MANY DIAGRAMS. Each `@startuml <name>` block produces its own graph, so this
 * never assumes the output is `<stem>.svg` — it renders into a scratch directory and reads every
 * class-shaped diagram it finds.
 *
 * Split out from `weave` so anything that wants the model rather than a page — `naamah totext`, a
 * test, a tool — can have it without a file landing on disk as a side effect.
 *
 * Returns { renderable: [{ name, graph }], skipped: [names] }.
 */
export function graphsOf(input) {
  if (!existsSync(input)) throw new WeaveError(`no such file: ${input}`, 1);

  let svgs = [];   // { name, text }
  let tmp = null;
  if (extname(input).toLowerCase() === '.svg') {
    svgs = [{ name: basename(input, extname(input)), text: readFileSync(input, 'utf8') }];
  } else {
    try {
      tmp = mkdtempSync(join(tmpdir(), 'naamah-'));
      execFileSync('plantuml', ['-tsvg', '-o', tmp, resolve(input)], { stdio: 'pipe' });
      const files = readdirSync(tmp).filter((f) => f.toLowerCase().endsWith('.svg')).sort();
      if (!files.length) throw new WeaveError(`plantuml produced no SVG for ${input}`);
      svgs = files.map((f) => ({ name: basename(f, '.svg'), text: readFileSync(join(tmp, f), 'utf8') }));
    } catch (err) {
      if (err instanceof WeaveError) throw err;
      if (err?.code === 'ENOENT') throw new WeaveError('plantuml is not on PATH (needed for .puml input)');
      throw new WeaveError(`plantuml failed: ${err.message}`);
    } finally {
      if (tmp) rmSync(tmp, { recursive: true, force: true });
    }
  }

  // Naamah reads the semantic hooks PlantUML emits for class-style diagrams. Anything else parses
  // to an empty graph — skip it by name rather than writing a blank page.
  const renderable = [];
  const skipped = [];
  for (const svg of svgs) {
    if (!/class="entity"/.test(svg.text)) { skipped.push(svg.name); continue; }
    const graph = parseSvg(svg.text);
    if (!graph.nodes.length) { skipped.push(svg.name); continue; }
    renderable.push({ name: svg.name, graph });
  }

  if (!renderable.length) {
    throw new WeaveError(svgs.length > 1
      ? `none of the ${svgs.length} diagrams in ${basename(input)} is a class/component diagram`
      : 'this diagram carries no PlantUML entity metadata (class/component diagrams only)');
  }
  return { renderable, skipped };
}

/**
 * Render `input` (.puml or .svg) to self-contained pages.
 *
 * `output` is honoured only when there is exactly one diagram; with several, each page is named
 * after its own diagram, because one explicit filename cannot name four files.
 *
 * Returns { pages: [{ out, graph }], skipped: [names] }.
 * Throws WeaveError with a `code` for the CLI to exit on.
 */
export function weave(input, output) {
  const { renderable, skipped } = graphsOf(input);
  const single = renderable.length === 1;
  const pages = renderable.map(({ name, graph }) => {
    const out = single && output ? output : `${name}.html`;
    writeFileSync(out, renderPage(graph));
    return { out, graph };
  });
  return { pages, skipped };
}
