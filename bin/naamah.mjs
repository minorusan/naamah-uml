#!/usr/bin/env node
/* naamah — a diagram is a web.
 *
 *   naamah weave  <diagram.puml|diagram.svg> [out.html]
 *   naamah author <script.mjs> [out.html]
 *   naamah sync   <page.html>
 *   naamah totext --path <page.html|diagram.puml|diagram.svg>
 *
 * Exit codes: 0 ok · 1 bad usage / missing file · 2 cannot render it.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { weave, graphsOf, WeaveError } from '../src/weave.mjs';
import { author, sync, loadGraph, BindError } from '../src/bind.mjs';
import { toText } from '../src/totext.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const version = () => {
  try { return JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')).version; }
  catch { return '0.0.0'; }
};

const HELP = `naamah ${version()} — a diagram is a web

  naamah weave <file.puml|file.svg> [out.html]
        Weave a diagram into one self-contained HTML page. No server, no network:
        it opens from file:// and can be emailed as a single file. .puml is rendered
        with the plantuml CLI first; .svg is read as-is. Output defaults to
        <name>.html beside where you ran it.

        A .puml holding several @startuml blocks yields one page per diagram, each
        named after its own block; [out.html] applies only when there is just one.

  naamah author <script.mjs> [out.html]
        Build a page from a script instead of from PlantUML. The script's default
        export is a function taking the authoring API, and returns a loom:

          export default ({ create }) => {
            const loom = create('Rewards');
            const dom  = loom.domain('Rewards');
            dom.type('RewardService', { fromFile: 'Runtime/RewardService.cs' });
            return loom;
          };

        { fromFile } reads a .cs / .ts / .py file and takes the class's name, kind,
        fields, properties and methods from it — with the comments above each member
        kept as that row's folded-away explanation.

  naamah sync <page.html>
        Re-read every source file the page is bound to and rewrite it in place.
        Renames, new members, deleted members and edited comments all come across;
        card positions, domains, notes and relations are left alone. A bound file
        that has gone missing is an error, not a shrug.

  naamah totext --path <page.html|file.puml|file.svg>
        Print the whole diagram as text on stdout: every domain with its classes and
        the domains it depends on, then every class with its fields, methods, source
        comments and connections. For grepping, diffing two revisions of the same
        architecture, or handing an agent the design without 60 KB of page.

        --no-comments   the skeleton only, without the prose

  naamah help | --help | -h
  naamah version | --version | -v

Class and component diagrams only — sequence and activity diagrams carry no entity
metadata, and are refused rather than half-rendered.
`;

const [, , cmd, ...rest] = process.argv;

// Switches that never take a value. Without this list, `--no-comments page.html` would swallow the
// filename as the switch's argument and then report that no file was given.
const BOOLS = new Set(['no-comments']);

/** `--path X` / `--path=X`, or the first bare argument. */
function parseArgs(argv) {
  const flags = new Set();
  const named = {};
  const bare = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      if (BOOLS.has(k)) flags.add(k);
      else if (v !== undefined) named[k] = v;
      else if (argv[i + 1] && !argv[i + 1].startsWith('--')) named[k] = argv[++i];
      else flags.add(k);
      continue;
    }
    bare.push(a);
  }
  return { flags, named, bare };
}

const die = (msg, code = 1) => { console.error(`naamah: ${msg}`); process.exit(code); };
const codeOf = (err) => (err instanceof WeaveError || err instanceof BindError ? err.code : 2);

try {
  switch (cmd) {
    case 'weave': {
      const [input, output] = rest;
      if (!input) die('weave needs a file — naamah weave <file.puml|file.svg> [out.html]');
      const { pages, skipped } = weave(input, output);
      for (const { out, graph } of pages) {
        console.error(
          `naamah: ${graph.nodes.length} types · ${graph.edges.length} relations · ` +
          `${graph.notes.length} notes · ${graph.clusters.length} domains → ${out}`
        );
      }
      if (skipped.length) {
        console.error(`naamah: skipped ${skipped.length} non-class diagram(s): ${skipped.join(', ')}`);
      }
      break;
    }

    case 'author': {
      const [script, output] = rest;
      if (!script) die('author needs a script — naamah author <script.mjs> [out.html]');
      const { out, graph } = await author(script, output);
      const bound = graph.nodes.filter((n) => n.source?.path).length;
      console.error(
        `naamah: ${graph.nodes.length} types · ${graph.edges.length} relations · ` +
        `${graph.clusters.length} domains · ${bound} bound to source → ${out}`
      );
      break;
    }

    case 'sync': {
      const [page] = rest;
      if (!page) die('sync needs a page — naamah sync <page.html>');
      const { out, bound, changes } = sync(page);
      for (const c of changes) {
        const bits = [];
        if (c.renamedFrom) bits.push(`renamed from ${c.renamedFrom}`);
        if (c.kindWas) bits.push(`${c.kindWas} → ${c.kind}`);
        if (c.rows !== c.rowsWas) bits.push(`${c.rowsWas} → ${c.rows} members`);
        console.error(`naamah: ${c.name}${bits.length ? ` — ${bits.join(' · ')}` : ' — unchanged'}`);
      }
      console.error(`naamah: synced ${bound} bound type(s) → ${out}`);
      break;
    }

    case 'totext': {
      const { flags, named, bare } = parseArgs(rest);
      const path = named.path || bare[0];
      if (!path) die('totext needs a file — naamah totext --path <page.html|file.puml|file.svg>');
      const graph = /\.(puml|svg)$/i.test(path)
        // A .puml can hold several diagrams; text has no filename to collide with, so print all.
        ? graphsOf(path).renderable
        : [{ name: path, graph: loadGraph(path) }];
      for (const [i, g] of graph.entries()) {
        if (i) process.stdout.write('\n');
        process.stdout.write(toText(g.graph, { comments: !flags.has('no-comments') }));
      }
      break;
    }

    case 'version': case '--version': case '-v':
      console.log(version());
      break;

    case 'help': case '--help': case '-h': case undefined:
      process.stdout.write(HELP);
      break;

    default:
      console.error(`naamah: unknown command "${cmd}"\n`);
      process.stdout.write(HELP);
      process.exit(1);
  }
} catch (err) {
  console.error(`naamah: ${err.message}`);
  process.exit(codeOf(err));
}
