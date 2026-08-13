// Naamah/page — graph -> one self-contained HTML page.
// Shared by the CLI and any edit tooling so a re-render after an edit is structurally identical
// to the original render.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const asset = (f) => readFileSync(resolve(here, f), 'utf8');
const escTitle = (s) => String(s).replace(/[<&]/g, (c) => ({ '<': '&lt;', '&': '&amp;' }[c]));

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
