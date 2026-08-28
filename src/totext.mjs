// Naamah/totext — the whole diagram, as text.
//
// A page is for reading with your eyes; this is for everything else — grep, a diff between two
// revisions of the same architecture, a review comment, and pasting into an agent's context window
// without shipping 60 KB of SVG and runtime to do it.
//
// The order is the diagram's own: domains outermost-first with their contents nested, then each
// type with its members, its comments and everything it is wired to. Nothing is summarised away —
// if it is in the graph it is in the text.

const VERB = {
  extension: (dashed) => (dashed ? 'implements' : 'extends'),
  composition: () => 'owns',
  aggregation: () => 'has',
  dependency: () => 'uses',
  association: () => 'refers to',
};
const verbOf = (e) => (VERB[e.type] || (() => e.type))(e.dashed);

const BULLET = { PUBLIC: '+', PRIVATE: '-', PROTECTED: '#', PACKAGE: '~' };
const bulletOf = (vis) => (vis ? BULLET[String(vis).split('_')[0]] || '+' : ' ');

const KIND_WORD = {
  interface: 'INTERFACE', class: 'CLASS', abstract: 'ABSTRACT', enum: 'ENUM', struct: 'STRUCT',
};

// A comment marker that cannot be read as a visibility bullet: `#` is protected in UML.
const MARK = '»';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Render `graph` as text. `opts.comments === false` drops the prose rows and leaves the skeleton.
 */
export function toText(graph, opts = {}) {
  const withComments = opts.comments !== false;
  const out = [];
  const put = (indent, line) => out.push(line ? `${'  '.repeat(indent)}${line}` : '');

  const nodes = graph.nodes || [];
  const notes = graph.notes || [];
  const clusters = graph.clusters || [];
  const edges = (graph.edges || []).filter((e) => e.from && e.to);

  const byId = new Map([...nodes, ...notes].map((n) => [n.id, n]));
  const domainOf = new Map(clusters.map((c) => [c.id, c]));
  const kids = new Map(clusters.map((c) => [c.id, []]));
  const roots = [];
  for (const c of clusters) (c.parent && kids.has(c.parent) ? kids.get(c.parent) : roots).push(c);

  const typesIn = (cid) => nodes.filter((n) => (n.cluster || null) === cid);
  const notesOn = (id) => notes.filter((n) => n.attachedTo === id);

  put(0, `naamah — ${graph.title || 'Diagram'}`);
  put(0, [
    plural(clusters.length, 'domain'), plural(nodes.length, 'type'),
    plural(edges.length, 'relation'), plural(notes.length, 'note'),
  ].join(' · '));

  const renderType = (n, depth) => {
    put(0, '');
    put(depth, `${KIND_WORD[n.kind] || 'CLASS'} ${n.name}${n.stereotype ? ` «${n.stereotype}»` : ''}`);
    if (n.source?.path) put(depth + 1, `source: ${n.source.path} (${n.source.lang})`);

    const rows = n.rows || [];
    const ledes = rows.filter((r) => r.kind === 'lede');
    if (withComments && ledes.length) {
      put(depth + 1, 'about:');
      for (const r of ledes) {
        put(depth + 2, r.text);
        for (const p of r.explain || []) put(depth + 3, `${MARK} ${p}`);
      }
    }

    const group = (label, kind) => {
      const list = rows.filter((r) => r.kind === kind);
      if (!list.length) return;
      put(depth + 1, `${label}:`);
      for (const r of list) {
        put(depth + 2, `${bulletOf(r.vis)} ${r.text}`);
        if (withComments) for (const p of r.explain || []) put(depth + 3, `${MARK} ${p}`);
      }
    };
    group('fields', 'field');
    group('methods', 'method');
    group('events', 'event');

    const out2 = edges.filter((e) => e.from === n.id);
    const in2 = edges.filter((e) => e.to === n.id);
    if (out2.length || in2.length) {
      put(depth + 1, 'connections:');
      for (const e of out2) put(depth + 2, `-> ${verbOf(e)} ${byId.get(e.to)?.name || e.to}`);
      for (const e of in2) put(depth + 2, `<- ${byId.get(e.from)?.name || e.from} ${verbOf(e)} this`);
    }

    const own = notesOn(n.id);
    if (own.length) {
      put(depth + 1, 'notes:');
      for (const k of own) {
        put(depth + 2, k.name);
        if (withComments) for (const line of k.body || []) put(depth + 3, line);
      }
    }
  };

  const renderDomain = (c, depth) => {
    const mine = typesIn(c.id);
    put(0, '');
    put(depth, `DOMAIN ${c.label}`);

    if (mine.length) {
      put(depth + 1, `classes: ${mine.map((n) => `${n.name}${n.kind === 'class' ? '' : ` (${n.kind})`}`).join(', ')}`);
    }

    // A domain's deps are the other domains its types point at — the coupling that matters when
    // reading an architecture, and the one thing a per-class list of relations never shows.
    const deps = new Set();
    for (const e of edges) {
      const a = byId.get(e.from), b = byId.get(e.to);
      if (!a || !b || (a.cluster || null) !== c.id) continue;
      const to = b.cluster ? domainOf.get(b.cluster) : null;
      if (!to) deps.add('(no domain)');
      else if (to.id !== c.id) deps.add(to.label);
    }
    if (deps.size) put(depth + 1, `deps: ${[...deps].join(', ')}`);

    for (const n of mine) renderType(n, depth + 1);
    for (const sub of kids.get(c.id) || []) renderDomain(sub, depth + 1);
  };

  for (const c of roots) renderDomain(c, 0);

  const loose = typesIn(null);
  if (loose.length) {
    put(0, '');
    put(0, 'DOMAIN (none)');
    put(1, `classes: ${loose.map((n) => n.name).join(', ')}`);
    for (const n of loose) renderType(n, 1);
  }

  const floating = notes.filter((k) => !k.attachedTo || !byId.has(k.attachedTo));
  if (floating.length) {
    put(0, '');
    put(0, 'NOTES');
    for (const k of floating) {
      put(1, k.name);
      if (withComments) for (const line of k.body || []) put(2, line);
    }
  }

  return `${out.join('\n')}\n`;
}
