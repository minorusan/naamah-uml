// Naamah/project — a DIRECTORY of design files goes in, one graph comes out.
//
// This is the door the agent uses. `loom.mjs` is an API with rules to follow — handles to hold,
// order to respect, a script to keep valid. A design directory has none of that: it is ordinary
// TypeScript, so an agent writes a plain annotated class, drops the file in, and the diagram grows.
// Nothing has to be registered, imported into an index, or declared in two places.
//
// THE COMPILER IS THE VALIDATOR. Type names are globally unique because `tsc` says so (TS2300), and
// every relation endpoint exists because `tsc` says so (TS2304). That is why a node's id can simply
// BE its type name, and why this module never has to invent a resolution rule the compiler already
// owns — see verify.mjs.
//
// Pure apart from the injected reader, so the same code runs in the CLI and in a test.

import { parseSource, langOf, bare } from './source.mjs';

/** verb -> [edge type, dashed]. The same table loom.mjs uses, so both doors emit one model. */
const LINKS = {
  extends: ['extension', false],
  implements: ['extension', true],
  owns: ['composition', false],
  has: ['aggregation', false],
  uses: ['dependency', true],
  refers: ['association', false],
};

/**
 * Decorator -> the relation it declares.
 *
 * `reverse` is the whole ergonomic promise: `@Owns(B)` written on A and `@OwnedBy(A)` written on B
 * are the SAME edge. The far-end forms flip subject and object, and the de-duplication below means
 * declaring it from both ends is harmless rather than a double arrow.
 */
const RELATIONS = {
  owns: { verb: 'owns', reverse: false },
  has: { verb: 'has', reverse: false },
  uses: { verb: 'uses', reverse: false },
  refers: { verb: 'refers', reverse: false },
  extends: { verb: 'extends', reverse: false },
  implements: { verb: 'implements', reverse: false },

  ownedby: { verb: 'owns', reverse: true },
  heldby: { verb: 'has', reverse: true },
  usedby: { verb: 'uses', reverse: true },
  referredby: { verb: 'refers', reverse: true },
  extendedby: { verb: 'extends', reverse: true },
  implementedby: { verb: 'implements', reverse: true },
};

const KINDS = new Set(['class', 'interface', 'abstract', 'enum', 'struct']);

export class ProjectError extends Error {}

/**
 * Split one annotation into `{ name, args, typeArgs }`.
 *
 * Accepts both spellings a design can use, because TypeScript forces the choice: a class is a value
 * so `@Owns(Ledger)` works, but an interface is ERASED and has no value, so it must travel as a type
 * argument — `@Uses<IConfig>()`. Both name a type and both are typechecked; naamah reads source text
 * and so is indifferent to which one the author had to reach for.
 *
 * C# `[Owns(typeof(Ledger))]` is read too — the format is a design decision, not a language one, and
 * the prelude exists in both.
 */
export function parseAnnotation(text) {
  const s = String(text).trim().replace(/^\[|\]$/g, '').replace(/^@/, '');
  const m = s.match(/^([A-Za-z_$][\w$.]*)\s*(<[\s\S]*>)?\s*(\([\s\S]*\))?$/);
  if (!m) return null;
  const name = m[1].split('.').pop();
  const typeArgs = m[2] ? splitTop(m[2].slice(1, -1)) : [];
  const args = m[3] ? splitTop(m[3].slice(1, -1)) : [];
  return { name, args, typeArgs };
}

/**
 * Split on top-level commas — a generic argument list may contain its own.
 *
 * QUOTES ARE OPAQUE. `@Note('Grants are idempotent, keyed by playerId.')` is ONE argument, and a
 * splitter that cannot see that returns the note cut off at its first comma — which is worse than
 * losing it, because a half-sentence still looks like the whole one.
 */
function splitTop(s) {
  const out = [];
  let d = 0, cur = '', quote = '';
  const str = String(s);
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (quote) {
      cur += ch;
      if (ch === '\\') { cur += str[++i] ?? ''; continue; }
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; cur += ch; continue; }
    if ('(<['.includes(ch)) d++;
    else if (')>]'.includes(ch)) d--;
    if (ch === ',' && d <= 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur.trim());
  return out.filter(Boolean);
}

/** The type an annotation argument names: `typeof(X)` -> X, `'text'` -> null, `X` -> X. */
function argType(raw) {
  const s = String(raw).trim();
  if (/^['"`]/.test(s)) return null;                        // a string literal is a label, not a type
  const m = s.match(/^typeof\s*\(\s*([\s\S]+?)\s*\)$/) || s.match(/^([A-Za-z_$][\w$.<>,\s\[\]]*)$/);
  return m ? bare(m[1].trim()).split('.').pop() : null;
}

/** The string a `@Domain('x')` / `@Note('x')` carries, unquoted. */
function argText(raw) {
  const s = String(raw).trim();
  const m = s.match(/^(['"`])([\s\S]*)\1$/);
  return m ? m[2] : s;
}

/**
 * Every identifier in a type expression, so `Map<string, Ledger>` offers up `Ledger`.
 *
 * Field inference is deliberately generous about WHERE it looks and strict about WHAT it keeps: an
 * identifier only becomes an edge if it names a type this design actually declares. `string`,
 * `number` and every library type simply fail that test, so no exclusion list has to be maintained.
 */
function identsIn(typeExpr) {
  return String(typeExpr).match(/[A-Za-z_$][\w$]*/g) || [];
}

/** The declared type of a member row: `ledger : Ledger` -> `Ledger`, `grant(x: string) : void` -> `void`. */
function rowType(text) {
  const s = String(text);
  const cut = s.lastIndexOf(':');
  return cut < 0 ? '' : s.slice(cut + 1).trim();
}

/**
 * Build one graph from a set of already-read design files.
 *
 * `files` is `[{ path, text }]` — reading is the caller's business so this stays pure and testable.
 */
export function buildProject(files, { title = 'Design' } = {}) {
  const nodes = [], notes = [], edges = [], clusters = [];
  const byName = new Map();
  const domains = new Map();
  let seq = 0;
  const id = (p) => `${p}${++seq}`;

  /** cluster id -> its FULL nested label, e.g. 'Rewards › Core'. */
  const domainPath = new Map();

  /** A domain path `'A › B'` becomes nested clusters, created once and reused. */
  const domainId = (label) => {
    const parts = String(label).split(/\s*[›>\/]\s*/).map((s) => s.trim()).filter(Boolean);
    let parent = null, key = '';
    for (const part of parts) {
      key = key ? `${key} › ${part}` : part;
      if (!domains.has(key)) {
        const c = { id: id('dom'), label: part, parent };
        clusters.push(c);
        domains.set(key, c.id);
        domainPath.set(c.id, key);
      }
      parent = domains.get(key);
    }
    return parent;
  };

  // ── pass 1: every type becomes a card ────────────────────────────────
  // Two passes, because a relation may name a type declared in a file not yet read — which is the
  // normal case the moment a design is more than one file.
  const pending = [];
  for (const file of files) {
    let types;
    try { types = parseSource(file.text, langOf(file.path)); }
    catch (err) { throw new ProjectError(`${file.path}: ${err.message}`); }

    for (const [index, t] of types.entries()) {
      const name = bare(t.name);
      const prior = byName.get(name);
      if (prior) {
        // The compiler calls this TS2300 and refuses to build. Said plainly here too, because a
        // design read WITHOUT a compile check must not silently keep one of the two.
        throw new ProjectError(
          `two types named ${name} — ${prior.source.path} and ${file.path}. ` +
          `Type names are the diagram's identity, so they must be unique across the design.`);
      }
      const node = {
        id: name,
        name: t.name,
        kind: t.kind,
        stereotype: t.stereotype || null,
        cluster: null,
        rows: rowsOf(t),
        source: { path: file.path, lang: langOf(file.path), symbol: t.name, index },
      };
      nodes.push(node);
      byName.set(name, node);
      pending.push({ node, type: t });
    }
  }

  // ── pass 2: annotations and inheritance become edges ─────────────────
  const seen = new Set();
  const link = (fromName, toName, verb) => {
    const from = byName.get(bare(fromName)), to = byName.get(bare(toName));
    // An endpoint outside the design is not an error here — `tsc` is what refuses a name that
    // exists nowhere. A name that resolves to a library type is simply not a card, and drawing an
    // arrow to a type the diagram does not show would be worse than drawing none.
    if (!from || !to || from === to) return;
    const [type, dashed] = LINKS[verb] || LINKS.refers;
    // ONE EDGE PER PAIR, however many ends and however many ways declared it. This is what makes
    // "declare from whichever side you are looking at" safe: saying it twice is agreement, not a
    // second arrow.
    //
    // KEYED ON THE PAIR, NOT THE PAIR PLUS TYPE. With the type in the key, `@Owns(RewardEntry)` and
    // the field holding a RewardEntry were different keys, so one card grew BOTH a composition and
    // an aggregation arrow to the same target — two arrows making contradictory claims about a
    // single relationship. First declaration wins, and since field inference runs last (pass 3), an
    // explicit decorator always beats an inferred one.
    const key = `${from.id} -> ${to.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ id: id('lnk'), from: from.id, to: to.id, type, dashed });
  };

  for (const { node, type } of pending) {
    for (const base of type.extends || []) link(node.id, base, 'extends');
    for (const iface of type.implements || []) link(node.id, iface, 'implements');

    for (const raw of type.annotations || []) {
      const a = parseAnnotation(raw);
      if (!a) continue;
      const key = a.name.toLowerCase();

      if (key === 'domain') {
        node.cluster = domainId(argText(a.args[0] ?? ''));
        // `qname` IS THE DOMAIN, downstream. `entangle` reads a designed type's domain out of
        // `qname` (`<domain>.<Type>`) — a node carrying only `cluster`, which is an opaque id, is
        // read as belonging to no domain at all, so `entangle --working-in <domain>` matches nothing
        // and the implementation brief cannot be scoped to one assembly.
        node.qname = `${domainPath.get(node.cluster) || ''}.${bare(node.name)}`;
        continue;
      }
      if (key === 'stereotype') { node.stereotype = argText(a.args[0] ?? ''); continue; }
      if (key === 'kind') {
        const k = argText(a.args[0] ?? '').toLowerCase();
        if (KINDS.has(k)) node.kind = k;
        continue;
      }
      if (key === 'note' || key === 'remark') {
        notes.push({
          id: id('note'), kind: 'note', name: node.name,
          body: [argText(a.args[0] ?? '')], attachedTo: node.id, cluster: null,
        });
        continue;
      }

      const rel = RELATIONS[key];
      if (!rel) continue;
      // The target may be a value argument or a type argument — an interface has only the latter.
      const target = [...a.args, ...a.typeArgs].map(argType).find(Boolean);
      if (!target) continue;
      if (rel.reverse) link(target, node.id, rel.verb);
      else link(node.id, target, rel.verb);
    }
  }

  // ── pass 3: a bare field implies a relation ──────────────────────────
  // Runs LAST and through the same de-duplicator, so an explicit decorator always wins: if the
  // author said `@Owns(Ledger)`, the field that holds a Ledger does not downgrade it to `has`.
  for (const { node, type } of pending) {
    for (const row of type.rows) {
      if (row.kind !== 'field' && row.kind !== 'property') continue;
      for (const ident of identsIn(rowType(row.text))) link(node.id, ident, 'has');
    }
  }

  return { title, layout: 'auto', clusters, nodes, notes, edges };
}

/** A parsed type's members, in naamah's row shape. Mirrors what loom.mjs's applySource writes. */
function rowsOf(t) {
  const VIS = { public: 'PUBLIC', private: 'PRIVATE', protected: 'PROTECTED', package: 'PACKAGE' };
  const rows = [];
  for (const p of t.doc || []) rows.push({ vis: null, kind: 'lede', text: p, explain: [], from: 'source' });
  for (const r of t.rows) {
    const method = r.kind === 'method' || (r.kind === 'event' && /\(/.test(String(r.text)));
    rows.push({
      vis: r.vis && r.vis !== 'none' ? `${VIS[r.vis] || 'PUBLIC'}_${method ? 'METHOD' : 'FIELD'}` : null,
      kind: r.kind,
      text: r.text,
      explain: r.explain || [],
      from: 'source',
    });
  }
  return rows;
}
