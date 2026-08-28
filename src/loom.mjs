// Naamah/loom — authoring a diagram directly, with no PlantUML anywhere.
//
//   const loom = Naamah.create('Rewards');
//
//   const rewards = loom.domain('Rewards › asmdef');
//   const api = rewards.type('IRewardService', { kind: 'interface' });
//   const svc = rewards.type('RewardService', { fromFile: 'Runtime/RewardService.cs' });
//
//   svc.implements(api);
//   svc.field('_live : List<Entry>', { vis: 'private', explain: 'everything running now' });
//
//   Naamah.mount(loom.build());
//
// build() emits exactly the JSON mount() takes. Positions are NOT part of the model — a caller
// describes structure and the layout engine decides where things go. Declaration order is the only
// spatial hint, and it feeds the same reading-order sort the PlantUML path uses.
//
// This module lives outside naamah.js because it has to run in BOTH places: in Node (where a
// binding can read a file) and in a rendered page (where `Naamah.create` is a documented way to
// author by hand). page.mjs inlines it; the CLI imports it.

import { parseSource, langOf, pickType, bare } from './source.mjs';

/**
 * How the loom reads a source file.
 *
 * Injected rather than imported, because this module is inlined into pages that have no `fs` and no
 * synchronous way to fetch. `fn(path) -> { path, text }`, where the returned `path` is whatever the
 * reader resolved it to — that resolved form is what gets recorded in the binding, so a later
 * `sync` finds the same file from a different working directory.
 */
let reader = null;
export function useReader(fn) { reader = fn; }

const VIS = {
  public: 'PUBLIC', private: 'PRIVATE', protected: 'PROTECTED', package: 'PACKAGE',
  '+': 'PUBLIC', '-': 'PRIVATE', '#': 'PROTECTED', '~': 'PACKAGE',
};
const LINKS = {
  extends: ['extension', false],
  implements: ['extension', true],      // realization: UML draws it dashed
  owns: ['composition', false],
  has: ['aggregation', false],
  uses: ['dependency', true],
  refers: ['association', false],
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Rough text width for a monospace card at the runtime's own font size. Only a starting guess:
// the real width is measured from the DOM on the first layout pass.
const guessWidth = (strings) =>
  clamp(Math.max(0, ...strings.map((s) => String(s).length)) * 7.3 + 40, 180, 520);

/** `a/b/session-store.ts` -> `session-store`. Pure, so this module needs no `path`. */
const stemOf = (p) => String(p).split(/[\\/]/).pop().replace(/\.[^.]*$/, '');

/** The bullet a row gets: follows the SIGNATURE, not the keyword. */
const visTag = (vis, kind, text) => {
  if (!vis || vis === 'none') return null;
  const method = kind === 'method' || (kind === 'event' && /\(/.test(String(text)));
  return `${VIS[vis] || 'PUBLIC'}_${method ? 'METHOD' : 'FIELD'}`;
};

/**
 * Which of a file's types this binding means — and it has to survive a RENAME, because following
 * one is the whole reason a binding exists.
 *
 * A name alone cannot do that: rename the class and the name is gone. So a binding records both the
 * name it resolved to AND that type's position in the file, and a sync tries them in that order.
 * Renaming a class does not reorder the file, so the slot still holds it; the caller compares names
 * afterwards and reports the rename, so this follows the code without ever doing it silently.
 *
 * An explicitly passed `symbol` is a promise by the author and is matched exactly — but only on the
 * first bind, because after that the recorded name is what the file last actually said.
 */
function locate(types, { symbol, was, index, stem }) {
  if (symbol) {
    const type = pickType(types, { symbol });
    return { type, index: types.indexOf(type) };
  }
  if (was) {
    const i = types.findIndex((t) => bare(t.name) === bare(was));
    if (i >= 0) return { type: types[i], index: i };
    if (index != null && types[index]) return { type: types[index], index };
    throw new Error(
      `"${was}" is gone from this file and slot ${index} with it — found ` +
      `${types.map((t) => t.name).join(', ') || 'no types'}`);
  }
  const type = pickType(types, { stem });
  return { type, index: types.indexOf(type) };
}

/** Read one type out of a source file, through whatever reader is installed. */
function readType(path, opts = {}) {
  if (!reader) {
    throw new Error(
      'naamah: fromFile needs a file reader — the CLI installs one; a page must call ' +
      'Naamah.useReader(path => ({ path, text }))');
  }
  const got = reader(path);
  const resolved = got.path || path;
  const lang = opts.lang || langOf(resolved);
  const types = parseSource(got.text, lang);
  const { type, index } = locate(types, { ...opts, stem: stemOf(resolved) });
  // The recorded symbol is what the file SAYS, not what the author typed — that is what makes the
  // next sync able to notice it changed.
  return { type, source: { path: resolved, lang, symbol: type.name, index } };
}

/**
 * Write a parsed type onto a node — the whole of what "bound" means.
 *
 * The SOURCE IS THE AUTHORITY: the name, the kind and the members all come from the file, so
 * renaming the class in code renames the card. Rows the caller wrote by hand survive, because they
 * are the ones the source cannot know about; they are kept after the source's own rows and are
 * recognised by NOT carrying `from: 'source'`.
 *
 * Comments become each row's `explain`, which the runtime folds away by default — that is the whole
 * point of reading them: the prose is in the diagram, without being in the way.
 */
function applySource(node, type, source) {
  node.name = type.name;
  node.kind = type.kind;
  if (type.stereotype) node.stereotype = type.stereotype;

  const rows = [];
  // The class's own doc comment has no member to hang off, so it becomes a lede — a prose row with
  // no bullet, which is exactly what a lede is for.
  for (const p of type.doc || []) rows.push({ vis: null, kind: 'lede', text: p, explain: [], from: 'source' });
  for (const r of type.rows) {
    rows.push({
      vis: visTag(r.vis, r.kind, r.text),
      kind: r.kind,
      text: r.text,
      explain: r.explain || [],
      from: 'source',
    });
  }

  node.rows = [...rows, ...node.rows.filter((r) => r.from !== 'source')];
  node.source = source;
  node.w = guessWidth([node.name, ...node.rows.map((r) => r.text)]);
  return node;
}

export function create(title = 'Diagram') {
  let seq = 0;
  const id = (p) => `${p}${++seq}`;
  const clusters = [], nodes = [], notes = [], edges = [];

  const ref = (v) => (v == null ? null : typeof v === 'string' ? v : v._id ?? v.id ?? null);

  const domainHandle = (c) => ({
    _id: c.id, _kind: 'domain',
    get id() { return c.id; },
    domain: (label, opts = {}) => makeDomain(label, { ...opts, in: c.id }),
    type: (name, opts = {}) => makeType(name, { ...opts, in: c.id }),
  });

  function makeDomain(label, opts = {}) {
    const c = { id: opts.id || id('dom'), label: String(label), parent: ref(opts.in) };
    clusters.push(c);
    return domainHandle(c);
  }

  function makeType(name, opts = {}) {
    const n = {
      id: opts.id || id('t'),
      name: String(name),
      kind: opts.kind || 'class',
      stereotype: opts.stereotype || null,
      cluster: ref(opts.in),
      rows: [],
    };
    nodes.push(n);

    const row = (kind, text, o = {}) => {
      // vis: 'none' (or null) suppresses the bullet — needed for continuation lines of a wrapped
      // member, which are rows visually but not members in their own right.
      const explain = o.explain == null ? [] : Array.isArray(o.explain) ? o.explain : [o.explain];
      n.rows.push({ vis: visTag(o.vis, kind, text), kind, text: String(text), explain: explain.map(String) });
      return handle;
    };

    const link = (verb) => (other, o = {}) => {
      const [type, dashed] = LINKS[verb];
      edges.push({
        id: id('lnk'),
        from: ref(o.reverse ? other : handle),
        to: ref(o.reverse ? handle : other),
        type, dashed,
      });
      return handle;
    };

    const handle = {
      _id: n.id, _kind: 'type',
      get id() { return n.id; },
      get name() { return n.name; },
      field: (t, o) => row('field', t, { vis: 'public', ...o }),
      method: (t, o) => row('method', t, { vis: 'public', ...o }),
      event: (t, o) => row('event', t, { vis: 'public', ...o }),
      // A lede is a prose row with no bullet — but it can still carry explanations under it, so it
      // must accept the same options as any other row.
      lede: (t, o) => row('lede', t, { vis: 'none', ...o }),
      note: (title2, body) => makeNote(title2, body, { on: n.id }),
      // UML verbs read from the subject: svc.implements(api), svc.owns(entry)
      extends: link('extends'),
      implements: link('implements'),
      owns: link('owns'),
      has: link('has'),
      uses: link('uses'),
      refers: link('refers'),

      /**
       * Bind this card to a source file and take its structure from it, now and on every later
       * `sync`. `{ symbol }` names the type when the file holds several and none is named after
       * the file; `{ lang }` overrides the extension.
       */
      bind(path, o = {}) {
        const { type, source } = readType(path, o);
        applySource(n, type, source);
        return handle;
      },
      /** Re-read the bound file. Throws if this card was never bound — there is nothing to sync. */
      sync() {
        if (!n.source) throw new Error(`naamah: ${n.name} is not bound to a file`);
        const { type, source } = readType(n.source.path, {
          was: n.source.symbol, index: n.source.index, lang: n.source.lang,
        });
        applySource(n, type, source);
        return handle;
      },
      get source() { return n.source || null; },
    };

    if (opts.fromFile) handle.bind(opts.fromFile, { symbol: opts.symbol, lang: opts.lang });
    return handle;
  }

  function makeNote(title2, body = [], opts = {}) {
    const note = {
      id: opts.id || id('note'),
      kind: 'note',
      name: String(title2),
      body: (Array.isArray(body) ? body : [body]).map(String),
      attachedTo: ref(opts.on),
      cluster: null,
    };
    notes.push(note);
    return { _id: note.id, _kind: 'note', get id() { return note.id; } };
  }

  return {
    domain: (label, opts) => makeDomain(label, opts),
    type: (name, opts) => makeType(name, opts),
    note: (t, body, opts) => makeNote(t, body, opts),
    link: (from, to, verb = 'refers') => {
      const [type, dashed] = LINKS[verb] || LINKS.refers;
      edges.push({ id: id('lnk'), from: ref(from), to: ref(to), type, dashed });
    },

    build() {
      // Declaration order is the only spatial input. Everything gets a nominal column so the
      // reading-order sort has something to work with; the layout does the rest.
      const known = new Set([...nodes, ...notes].map((n) => n.id));
      for (const e of edges) {
        if (!known.has(e.from) || !known.has(e.to)) {
          throw new Error(`link references an unknown node: ${e.from} -> ${e.to}`);
        }
      }
      const cid = new Set(clusters.map((c) => c.id));
      for (const c of clusters) {
        if (c.parent && !cid.has(c.parent)) throw new Error(`domain "${c.label}" has an unknown parent`);
      }

      let row = 0;
      const place = (n, strings) => {
        n.x = 0; n.y = row++ * 120;
        n.w = guessWidth(strings); n.h = 60;
      };
      for (const n of nodes) place(n, [n.name, ...n.rows.map((r) => r.text)]);
      for (const n of notes) place(n, [n.name, ...n.body]);
      for (const c of clusters) { c.x = 0; c.y = 0; c.w = 0; c.h = 0; }

      return { title, layout: 'auto', clusters, nodes, notes, edges };
    },
  };
}

/**
 * Re-read every bound file in a finished graph.
 *
 * This is what makes a binding worth having: the diagram is an artifact on disk, the code moves on,
 * and one pass brings the artifact back in line — names, kinds, members and comments. Card
 * positions, domains, notes and every relation are untouched, because none of them is the file's
 * business.
 *
 * Returns what changed, per node, so a caller can print it. A missing file THROWS: a binding that
 * silently keeps stale rows is worse than no binding at all.
 */
export function syncGraph(graph) {
  const bound = graph.nodes.filter((n) => n.source?.path);
  const changes = [];
  for (const n of bound) {
    const was = { name: n.name, kind: n.kind, rows: n.rows.filter((r) => r.from === 'source').length };
    let type, source;
    try {
      ({ type, source } = readType(n.source.path, {
        was: n.source.symbol, index: n.source.index, lang: n.source.lang,
      }));
    } catch (err) {
      throw new Error(`${n.name} <- ${n.source.path}: ${err.message}`);
    }
    applySource(n, type, source);
    changes.push({
      id: n.id,
      name: n.name,
      kind: n.kind,
      renamedFrom: was.name === n.name ? null : was.name,
      kindWas: was.kind === n.kind ? null : was.kind,
      rows: n.rows.filter((r) => r.from === 'source').length,
      rowsWas: was.rows,
      path: n.source.path,
    });
  }
  return { bound: bound.length, changes };
}
