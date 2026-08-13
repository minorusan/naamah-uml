#!/usr/bin/env node
/* naamah — a diagram is a web.
 *
 *   naamah weave <diagram.puml|diagram.svg> [out.html]
 *
 * Exit codes: 0 ok · 1 bad usage / missing file · 2 cannot render it.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { weave, WeaveError } from '../src/weave.mjs';

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

  naamah help | --help | -h
  naamah version | --version | -v

Class and component diagrams only — sequence and activity diagrams carry no entity
metadata, and are refused rather than half-rendered.
`;

const [, , cmd, ...rest] = process.argv;

switch (cmd) {
  case 'weave': {
    const [input, output] = rest;
    if (!input) {
      console.error('naamah: weave needs a file — naamah weave <file.puml|file.svg> [out.html]');
      process.exit(1);
    }
    try {
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
    } catch (err) {
      console.error(`naamah: ${err.message}`);
      process.exit(err instanceof WeaveError ? err.code : 2);
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
