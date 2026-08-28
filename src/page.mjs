// Naamah/page — graph -> one self-contained HTML page.
// Shared by the CLI and any edit tooling so a re-render after an edit is structurally identical
// to the original render.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const asset = (f) => readFileSync(resolve(here, f), 'utf8');
const escTitle = (s) => String(s).replace(/[<&]/g, (c) => ({ '<': '&lt;', '&': '&amp;' }[c]));

/**
 * An ES module, inlined into a classic `<script>`.
 *
 * The authoring API and the source readers are modules because Node has to import them; a page has
 * no module loader it can use from `file://` without also giving up being one file. Dropping the
 * `import`/`export` keywords is the whole difference — the code inside them is plain JS. The result
 * is wrapped in an IIFE by the caller so nothing leaks into the page's globals.
 */
const inlineModule = (f) => asset(f)
  .replace(/^\s*import\s[\s\S]*?from\s*'[^']*';\s*$/gm, '')
  .replace(/^export\s+/gm, '');

export function renderPage(graph) {
  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>${escTitle(graph.title || 'Diagram')}</title>
<style>
${asset('naamah.css')}
</style>
</head>
<body>
<script id="graph" type="application/json">
${JSON.stringify(graph).replace(/</g, '\\u003c')}
</script>
<script>
${asset('naamah.js')}
</script>
<script>
(() => {
${inlineModule('source.mjs')}
${inlineModule('loom.mjs')}
// Authoring, in the page: Naamah.create as documented. A fromFile binding needs somewhere to
// read from, so a host that has one hands it over with useReader — otherwise binding fails
// loudly rather than pretending it read anything.
Naamah.create = create;
Naamah.useReader = useReader;
Naamah.syncGraph = syncGraph;
Naamah.parseSource = parseSource;
})();
</script>
<script>
Naamah.mount(JSON.parse(document.getElementById('graph').textContent), { theme: 'dark' });
</script>
</body>
</html>
`;
}

/** Pull the graph back out of a page Naamah rendered. The artifact is its own source. */
export function extractGraph(html) {
  const m = html.match(/<script id="graph" type="application\/json">\s*([\s\S]*?)\s*<\/script>/);
  return m ? JSON.parse(m[1].replace(/\\u003c/g, '<')) : null;
}
