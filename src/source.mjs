// Naamah/source — a source file goes in, one type's structure comes out.
//
// This is a STRUCTURAL EXTRACTOR, not a compiler. It reads what a class diagram needs — the type,
// its kind, its bases, and its fields / properties / methods with the comments written above them —
// and nothing else. Bodies are skipped by brace (or indent) depth rather than parsed.
//
// Why comments are first-class here: a diagram row is a name, and a name is not an explanation.
// Every comment sitting above a member becomes that row's `explain`, which the runtime already
// knows how to fold away. So the prose a developer wrote next to the code is the prose the diagram
// shows — nobody writes it twice, and it cannot drift.
//
// Pure: no fs, no globals. `parseSource(text, lang)` is the whole surface, so the same code runs in
// the CLI, in a test, and (given text from somewhere) in a page.

export const EXT_LANG = {
  '.cs': 'cs',
  '.ts': 'ts', '.tsx': 'ts', '.mts': 'ts', '.cts': 'ts', '.js': 'ts', '.mjs': 'ts', '.jsx': 'ts',
  '.py': 'py', '.pyi': 'py',
};

export class SourceError extends Error {}

/** Language of a path, by extension. Throws rather than guessing — a wrong parser reads garbage. */
export function langOf(path) {
  const m = String(path).toLowerCase().match(/(\.[a-z]+)$/);
  const lang = m && EXT_LANG[m[1]];
  if (!lang) {
    throw new SourceError(
      `naamah cannot read ${path} — supported: ${[...new Set(Object.values(EXT_LANG))].join(', ')} ` +
      `(${Object.keys(EXT_LANG).join(' ')})`);
  }
  return lang;
}

/** Every type declared in `text`, in declaration order. */
export function parseSource(text, lang) {
  if (typeof text !== 'string') throw new SourceError('parseSource needs the file text as a string');
  switch (lang) {
    case 'cs': return parseCs(text);
    case 'ts': return parseTs(text);
    case 'py': return parsePy(text);
    default: throw new SourceError(`unknown language "${lang}"`);
  }
}

/**
 * Choose the type a binding means.
 *
 * `symbol` wins; otherwise the type named after the file (the overwhelmingly common case, and the
 * only one that is unambiguous); otherwise the only type in the file. A file holding several types
 * with no name match is ambiguous, and guessing there would silently bind a card to the wrong class.
 */
export function pickType(types, { symbol, stem } = {}) {
  if (!types.length) throw new SourceError('no class, interface, struct or enum found');
  if (symbol) {
    const hit = types.find((t) => bare(t.name) === bare(symbol));
    if (!hit) throw new SourceError(`no type named "${symbol}" — found ${types.map((t) => t.name).join(', ')}`);
    return hit;
  }
  if (stem) {
    // `session-store.ts` holds `SessionStore`, `reward_service.py` holds `RewardService` — the
    // separator conventions differ per language but the identifier is the same word.
    const flat = (s) => String(s).toLowerCase().replace(/[-_.\s]/g, '');
    const hit = types.find((t) => flat(bare(t.name)) === flat(stem));
    if (hit) return hit;
  }
  if (types.length === 1) return types[0];
  throw new SourceError(
    `${types.length} types in this file and none named after it (${types.map((t) => t.name).join(', ')}) ` +
    `— name one with { symbol: '…' }`);
}

/** `Foo<T>` -> `Foo`. Generic arity is part of the display name but never part of matching. */
export const bare = (name) => String(name).replace(/<.*$/, '').trim();

/* ─────────────────────────  shared helpers  ───────────────────────── */

const tidy = (s) => String(s).replace(/\s+/g, ' ').trim();

/** Strip the decoration off a comment line so the diagram shows prose, not syntax. */
function cleanComment(line) {
  return String(line)
    // The scanner already ate the opening `//`; a `///` doc comment leaves one slash behind.
    .replace(/^\s*\/+!?/, '')
    .replace(/^\s*\*(?!\/)/, '')           // the leading * of a /** … */ block
    .replace(/^\s*#/, '')                  // python
    .replace(/<\/?(summary|remarks|para|returns|value|inheritdoc|example|typeparam[^>]*|param[^>]*)>/g, '')
    .replace(/<see cref="[^"]*?([\w.]+)"\s*\/>/g, '$1')
    .trim();
}

/**
 * Fold a run of comment lines into paragraphs.
 *
 * A blank comment line is a paragraph break; everything else joins with a space, because a comment
 * hard-wrapped at 100 columns is one sentence, not six rows of prose. Empty runs vanish.
 */
function paragraphs(lines) {
  const out = [];
  let cur = [];
  const flush = () => { if (cur.length) out.push(cur.join(' ')); cur = []; };
  for (const raw of lines || []) {
    const t = cleanComment(raw);
    if (!t) { flush(); continue; }
    cur.push(t);
  }
  flush();
  return out;
}

const VIS_WORD = { public: 'public', private: 'private', protected: 'protected', internal: 'package' };

/* ─────────────────────────  brace languages  ─────────────────────────
 *
 * C# and TypeScript share a grammar as far as this reader cares: declarations end at `;`, `{` or
 * `}`, and depth is brace depth. So both run over one declaration stream.
 *
 * A declaration is `{ code, depth, term, comments }`. `term` is what ended it: `;`, `{` (it opened
 * a body — a type, a method, or a property with accessors) or `}` (the last thing before a body
 * closed, which is how an enum's member list arrives).
 *
 * The one subtlety is `=`. `int[] a = new[] { 1, 2 };` and `onDone = (x) => { … };` have braces
 * that are an INITIALISER, not a body — reading them as a body loses the field AND desynchronises
 * depth for the rest of the type, which silently truncates the class. So a declaration that has
 * crossed a top-level `=` swallows its braces into the text, and only a `;` outside them ends it.
 *
 * "Top-level" means at paren depth 0, which is the whole trick: `constructor(limit = MAX) { … }`
 * has an `=` but it is a DEFAULT ARGUMENT, and that `{` really is a body.
 */
/**
 * Does the text so far end where a TYPE is expected, rather than after a complete signature?
 *
 * Read right-to-left over trailing whitespace. `=>` is checked before the single characters so a
 * function type (`cb: () => { a: number }`) is not mistaken for a body.
 */
function typeBraceAhead(buf) {
  const t = String(buf).replace(/\s+$/, '');
  if (!t) return false;
  if (t.endsWith('=>')) return true;
  return ':|&<,('.includes(t[t.length - 1]);
}

function declStream(text) {
  const decls = [];
  const src = text;
  let buf = '', depth = 0, pending = [], initDepth = 0, lastLine = -1, line = 1;
  let parens = 0, valueSide = false;
  let i = 0;

  const emit = (term) => {
    const code = tidy(buf);
    buf = '';
    parens = 0;
    valueSide = false;
    if (!code) return;
    decls.push({ code, depth, term, line, comments: pending });
    pending = [];
    lastLine = line;
  };

  while (i < src.length) {
    const ch = src[i];

    if (ch === '\n') { line++; i++; continue; }

    if (ch === '/' && src[i + 1] === '/') {
      const end = src.indexOf('\n', i);
      const body = src.slice(i + 2, end < 0 ? src.length : end);
      // A comment after code on the same line explains the declaration just emitted; one on its
      // own line explains the declaration about to come.
      if (tidy(buf) === '' && lastLine === line && decls.length) decls[decls.length - 1].comments.push(body);
      else pending.push(body);
      i = end < 0 ? src.length : end;
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const body = src.slice(i + 2, end < 0 ? src.length : end);
      for (const l of body.split('\n')) pending.push(l);
      line += body.split('\n').length - 1;
      i = end < 0 ? src.length : end + 2;
      continue;
    }

    // strings — a brace or paren inside one must not count
    if (ch === '"' || ch === "'" || ch === '`') {
      const verbatim = src[i - 1] === '@';
      let j = i + 1;
      while (j < src.length) {
        if (!verbatim && src[j] === '\\') { j += 2; continue; }
        if (src[j] === '\n') { line++; if (ch !== '`') break; }
        if (src[j] === ch) { j++; break; }
        j++;
      }
      // THE TEXT IS KEPT, not blanked to `""`. Depth safety comes from having CONSUMED the literal
      // in the loop above — its braces and parens were never counted — so there is nothing left for
      // blanking to protect against, and blanking destroys the one thing an annotation carries:
      // `@Domain('Rewards')` arrived as `@Domain("")`, so every domain in a design was named "".
      buf += src.slice(i, j);
      i = j;
      continue;
    }

    if (ch === '{') {
      if (valueSide || initDepth) { initDepth++; buf += ' { '; i++; continue; }
      // A `{` IN A TYPE POSITION IS AN INLINE OBJECT TYPE, NOT A BODY.
      //
      // `private entries: { amount: number }[] = [];` and `append(e: { amount: number }): void {}`
      // both put braces where a body cannot go. Counted as a body, the declaration was emitted early
      // and the MEMBER ITSELF WAS LOST — silently, one member per inline type, so a class read as
      // having no members at all while its neighbours parsed fine.
      //
      // The discriminator is what sits immediately before the brace. A type brace follows the syntax
      // that introduces a type — `:` `|` `&` `<` `,` `(` or an arrow — whereas a body brace follows a
      // COMPLETE signature or name: `m(): void {`, `class X {`. Cheap, and it cannot confuse the two.
      if (typeBraceAhead(buf)) { initDepth++; buf += ' { '; i++; continue; }
      emit('{'); depth++; i++; continue;
    }
    if (ch === '}') {
      if (initDepth) { initDepth--; buf += ' } '; i++; continue; }
      emit('}'); depth = Math.max(0, depth - 1); i++; continue;
    }
    if (ch === ';') {
      // A `;` inside an initialiser is a statement in a function body, not the end of the member.
      if (initDepth) { buf += '; '; i++; continue; }
      emit(';'); i++; continue;
    }

    if (ch === '(' || ch === '[') parens++;
    else if (ch === ')' || ch === ']') parens = Math.max(0, parens - 1);
    else if (ch === '=' && parens === 0 && src[i + 1] !== '=' && !'=!<>+-*/%&|^:'.includes(src[i - 1])) {
      valueSide = true;
    }

    buf += ch; i++;
  }
  return decls;
}

/**
 * Peel leading ANNOTATIONS off a declaration — C# `[Attr(…)]`, TS/Python `@Name(…)` — and KEEP them.
 *
 * KEEPING THEM IS THE WHOLE POINT. A type's annotations are where a diagram's RELATIONS are
 * declared, so discarding them here discards the edges.
 *
 * Balanced scanning, not a regex. The `\[[^\]]*\]` this replaces stopped at the FIRST `]`, which
 * lands mid-attribute in `[Owns(typeof(Entry[]))]`; `@Uses<Map<string, IConfig>>()` nests the same
 * way. A half-eaten annotation leaves a fragment that then fails every match downstream.
 */
function peelAnnotations(code) {
  let s = String(code).trim();
  const annotations = [];
  /** Index just past the balanced group opening at `from`, or -1 if it never closes. */
  const scan = (open, close, from) => {
    let d = 0;
    for (let i = from; i < s.length; i++) {
      const c = s[i];
      if (c === open) d++;
      else if (c === close && --d === 0) return i + 1;
    }
    return -1;
  };
  for (;;) {
    if (s.startsWith('[')) {
      const end = scan('[', ']', 0);
      if (end < 0) break;                    // unbalanced — not ours to interpret
      annotations.push(s.slice(0, end));
      s = s.slice(end).trim();
      continue;
    }
    const at = s.match(/^@[\w$.]+/);
    if (!at) break;
    let end = at[0].length;
    // `@Uses<IConfig>()` — a type-argument list can precede the call, and for an INTERFACE it is the
    // only form that survives: TS erases interfaces, so `@Uses(IConfig)` is not a value.
    if (s[end] === '<') { const e = scan('<', '>', end); if (e < 0) break; end = e; }
    if (s[end] === '(') { const e = scan('(', ')', end); if (e < 0) break; end = e; }
    annotations.push(s.slice(0, end));
    s = s.slice(end).trim();
  }
  return { annotations, rest: s };
}

/** Peel modifier keywords (and annotations) off the front of a declaration. */
function peel(code, words) {
  const { annotations, rest } = peelAnnotations(code);
  let s = rest;
  const mods = [];
  for (;;) {
    const m = s.match(/^([A-Za-z_#]\w*)\b\s*/);
    if (!m || !words.has(m[1])) break;
    mods.push(m[1]);
    s = s.slice(m[0].length);
  }
  return { mods, rest: s.trim(), annotations };
}

/** The index of the `)` matching the first `(`, or -1. */
function closingParen(s) {
  const open = s.indexOf('(');
  if (open < 0) return -1;
  let d = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '(') d++;
    else if (s[i] === ')' && --d === 0) return i;
  }
  return -1;
}

/** Split on commas that are not inside (), <> or []. */
function topSplit(s, sep = ',') {
  const out = [];
  let d = 0, cur = '';
  for (const ch of String(s)) {
    if ('(<['.includes(ch)) d++;
    else if (')>]'.includes(ch)) d--;
    if (ch === sep && d <= 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map(tidy).filter(Boolean);
}

const mkType = (name, kind, over = {}) => ({
  name, kind, stereotype: null, extends: [], implements: [], annotations: [], doc: [], rows: [], ...over,
});

const mkRow = (kind, text, vis, comments) => ({
  kind, text: tidy(text), vis, explain: paragraphs(comments),
});

/* ─────────────────────────  C#  ───────────────────────── */

const CS_MODS = new Set([
  'public', 'private', 'protected', 'internal', 'static', 'virtual', 'override', 'abstract',
  'sealed', 'async', 'extern', 'unsafe', 'new', 'partial', 'readonly', 'const', 'volatile',
  'required', 'file', 'event', 'delegate', 'fixed',
]);
const CS_KINDS = { class: 'class', interface: 'interface', struct: 'struct', enum: 'enum' };

function csVis(mods, ownerKind) {
  for (const w of ['private', 'protected', 'public', 'internal']) if (mods.includes(w)) return VIS_WORD[w];
  // C# defaults: an interface member is public, a class member is private.
  return ownerKind === 'interface' ? 'public' : 'private';
}

function parseCs(text) {
  const types = [];
  const open = [];   // { type, bodyDepth }

  // A property's accessors are declarations one level down — `{ get; }` and `{ get; set; }` are
  // the difference between a read-only view and a settable one, so they are read rather than
  // assumed. Nothing inside a property body is ever a member.
  let prop = null;   // { row, bodyDepth, accs }
  const closeProp = () => {
    if (!prop) return;
    const accs = prop.accs.length ? `${prop.accs.join('; ')};` : '…';
    prop.row.text = prop.row.text.replace(/\{[^}]*\}$/, `{ ${accs} }`);
    prop = null;
  };

  for (const d of declStream(text)) {
    if (prop) {
      if (d.depth >= prop.bodyDepth) {
        const a = d.depth === prop.bodyDepth && d.code.match(/^(?:\w+\s+)*?(get|set|init)\b/);
        if (a && !prop.accs.includes(a[1])) prop.accs.push(a[1]);
        continue;
      }
      closeProp();
    }

    while (open.length && d.depth < open[open.length - 1].bodyDepth) open.pop();
    const cur = open.length ? open[open.length - 1] : null;

    // A type can be declared at any depth — namespace, or nested inside another type.
    const head = d.term === '{' ? csType(d) : null;
    if (head) {
      const t = mkType(head.name, head.kind, {
        extends: head.extends, implements: head.implements, annotations: head.annotations || [],
        doc: paragraphs(d.comments),
      });
      types.push(t);
      open.push({ type: t, bodyDepth: d.depth + 1 });
      continue;
    }

    if (!cur || d.depth !== cur.bodyDepth) continue;
    const row = csMember(d, cur.type);
    if (row && d.term === '{') prop = { row, bodyDepth: d.depth + 1, accs: [] };
  }
  closeProp();
  return types;
}

function csType(d) {
  // `record struct` / `record class` are those kinds; a bare `record` is a class.
  const raw = d.code.replace(/\brecord\s+(struct|class)\b/, '$1').replace(/\brecord\b/, 'class');
  // ANNOTATIONS COME OFF FIRST, and this is not a tidy-up — it is the difference between a type
  // existing and not. The `[=)]` guard below rejects any preamble containing `)`, and
  // `[Owns(typeof(Entry))]` is exactly that, so every annotated class was silently dropped: the
  // diagram simply lost it, with nothing logged and no error raised.
  const { annotations, rest: code } = peelAnnotations(raw);
  const m = code.match(/\b(class|interface|struct|enum)\s+([A-Za-z_]\w*)\s*(<[^>{]*>)?\s*(?::\s*([\s\S]*))?$/);
  if (!m) return null;
  const before = code.slice(0, m.index);
  if (/[=)]/.test(before)) return null;          // not a declaration — a local, a cast, a lambda
  const kind = /\babstract\b/.test(before) && m[1] === 'class' ? 'abstract' : CS_KINDS[m[1]];
  const bases = topSplit((m[4] || '').replace(/\bwhere\b[\s\S]*$/, ''));
  const ex = [], im = [];
  for (const [i, b] of bases.entries()) {
    // C# lists the base class first, if there is one. Everything else is an interface — and so is
    // the first entry when it looks like one, which by convention means `IName`.
    if (i === 0 && !/^I[A-Z]/.test(bare(b)) && kind !== 'interface') ex.push(b);
    else im.push(b);
  }
  return { name: m[2] + (m[3] ? tidy(m[3]) : ''), kind, extends: ex, implements: im, annotations };
}

function csMember(d, type) {
  if (type.kind === 'enum') {
    // An enum's members arrive as one declaration, ended by the closing brace. The comment above
    // that run belongs to the FIRST member only — copying it onto all of them is a lie.
    for (const [i, e] of topSplit(d.code).entries()) {
      const m = e.match(/^([A-Za-z_]\w*)\s*(=\s*[\s\S]+)?$/);
      if (m) type.rows.push(mkRow('field', m[1] + (m[2] ? ` ${tidy(m[2])}` : ''), 'public', i ? [] : d.comments));
    }
    return null;
  }

  const { mods, rest } = peel(d.code, CS_MODS);
  if (!rest || /^(?:get|set|init|add|remove|where|return|base|this)\b/.test(rest)) return null;
  const vis = csVis(mods, type.kind);
  const isEvent = mods.includes('event');

  // method / constructor / operator — the shape is `head(args) tail`
  const close = closingParen(rest);
  if (close >= 0) {
    const head = rest.slice(0, rest.indexOf('('));
    const args = rest.slice(rest.indexOf('(') + 1, close);
    const tail = rest.slice(close + 1).trim();
    const hm = head.match(/^(?:([\w.<>[\],?\s]+?)\s+)?(~?[A-Za-z_]\w*)\s*(<[^(]*>)?\s*$/);
    const bodyish = d.term === '{' || /^(=>|;|where\b|:\s*(base|this)\b)/.test(tail) || tail === '';
    if (hm && bodyish && !head.includes('=')) {
      const ret = tidy(hm[1] || '');
      const sig = `${hm[2]}${hm[3] ? tidy(hm[3]) : ''}(${tidy(args)})`;
      type.rows.push(mkRow('method', ret && ret !== 'void' ? `${sig} : ${ret}` : sig, vis, d.comments));
      return null;
    }
  }

  // property — `Type Name { get; set; }` or `Type Name => expr`
  const pm = rest.match(/^([\w.<>[\],?\s]+?)\s+([A-Za-z_]\w*)\s*(=>|$)/);
  if (pm && (d.term === '{' || pm[3] === '=>')) {
    // The braces here are a placeholder: parseCs fills in the accessors it actually finds.
    const acc = d.term === '{' ? '{ … }' : '{ get; }';
    const row = mkRow(isEvent ? 'event' : 'field', `${pm[2]} : ${tidy(pm[1])} ${acc}`, vis, d.comments);
    type.rows.push(row);
    return row;
  }

  // field — `Type a, b = 3;`
  const fm = rest.match(/^([\w.<>[\],?*\s]+?)\s+([A-Za-z_]\w*(?:\s*=[\s\S]*)?(?:,[\s\S]*)?)$/);
  if (fm && d.term === ';') {
    const t = tidy(fm[1]);
    for (const one of topSplit(fm[2])) {
      const n = one.match(/^([A-Za-z_]\w*)/);
      if (n) type.rows.push(mkRow(isEvent ? 'event' : 'field', `${n[1]} : ${t}`, vis, d.comments));
    }
  }
  return null;
}

/* ─────────────────────────  TypeScript  ───────────────────────── */

const TS_MODS = new Set([
  'export', 'default', 'declare', 'abstract', 'public', 'private', 'protected', 'readonly',
  'static', 'async', 'override', 'accessor',
]);
const TS_KINDS = { class: 'class', interface: 'interface', enum: 'enum' };

function tsVis(mods, name) {
  for (const w of ['private', 'protected', 'public']) if (mods.includes(w)) return VIS_WORD[w];
  return name.startsWith('#') || name.startsWith('_') ? 'private' : 'public';
}

function parseTs(text) {
  const types = [];
  const open = [];
  for (const d of declStream(text)) {
    while (open.length && d.depth < open[open.length - 1].bodyDepth) open.pop();
    const cur = open.length ? open[open.length - 1] : null;

    const head = d.term === '{' ? tsType(d) : null;
    if (head) {
      const t = mkType(head.name, head.kind, {
        extends: head.extends, implements: head.implements, annotations: head.annotations || [],
        doc: paragraphs(d.comments),
      });
      types.push(t);
      open.push({ type: t, bodyDepth: d.depth + 1 });
      continue;
    }
    if (!cur || d.depth !== cur.bodyDepth) continue;
    tsMember(d, cur.type);
  }
  return types;
}

function tsType(d) {
  // Decorators off first — same reason as `csType`: the `[=(]` guard below treats `@Owns(Entry)` as
  // proof this is not a declaration, and drops the class entirely.
  const { annotations, rest: code } = peelAnnotations(d.code);
  const m = code.match(
    /\b(class|interface|enum)\s+([A-Za-z_$][\w$]*)\s*(<[^{]*?>)?\s*((?:extends|implements)[\s\S]*)?$/);
  if (!m) return null;
  const before = code.slice(0, m.index);
  if (/[=(]/.test(before)) return null;
  const kind = /\babstract\b/.test(before) && m[1] === 'class' ? 'abstract' : TS_KINDS[m[1]];
  const tail = m[4] || '';
  const grab = (word) => {
    const g = tail.match(new RegExp(`\\b${word}\\s+([\\s\\S]*?)(?=\\bimplements\\b|\\bextends\\b|$)`));
    return g ? topSplit(g[1]) : [];
  };
  // A TS interface `extends` other interfaces. UML has one arrow for "an interface refines an
  // interface" — generalization — so that is where it goes.
  return {
    name: m[2] + (m[3] ? tidy(m[3]) : ''), kind,
    extends: grab('extends'), implements: grab('implements'), annotations,
  };
}

function tsMember(d, type) {
  if (type.kind === 'enum') {
    for (const [i, e] of topSplit(d.code).entries()) {
      const m = e.match(/^([A-Za-z_$][\w$]*)\s*(=\s*[\s\S]+)?$/);
      if (m) type.rows.push(mkRow('field', m[1] + (m[2] ? ` ${tidy(m[2])}` : ''), 'public', i ? [] : d.comments));
    }
    return;
  }

  const { mods, rest } = peel(d.code, TS_MODS);
  if (!rest || /^(return|if|for|while|switch|do|try|throw)\b/.test(rest)) return;

  const close = closingParen(rest);
  if (close >= 0) {
    const head = rest.slice(0, rest.indexOf('('));
    const args = rest.slice(rest.indexOf('(') + 1, close);
    const tail = rest.slice(close + 1).trim();
    const hm = head.match(/^(?:(get|set)\s+)?([A-Za-z_$#][\w$]*)\s*(<[^(]*>)?\??\s*$/);
    // `name = (a) => …` is how a TS class most often spells a method; the `=` lands in `head`.
    const am = head.match(/^([A-Za-z_$#][\w$]*)\s*(?::[^=]*)?=\s*(?:async\s*)?$/);
    if (hm || am) {
      const name = hm ? hm[2] : am[1];
      const ret = tidy(tail.replace(/^:\s*/, '').replace(/\s*(=>|\{|;)[\s\S]*$/, ''));
      const vis = tsVis(mods, name);
      if (hm && hm[1]) {
        tsAccessor(type, name, ret, hm[1], vis, d.comments);
      } else {
        // Parameter modifiers are a declaration detail, not part of the signature a reader wants.
        const shown = topSplit(args).map((a) => peel(a, TS_MODS).rest).join(', ');
        const sig = `${name}${hm && hm[3] ? tidy(hm[3]) : ''}(${shown})`;
        type.rows.push(mkRow('method', ret ? `${sig} : ${ret}` : sig, vis, d.comments));
        // A constructor parameter with a modifier IS a field in TypeScript, and it is the one
        // place a reader of the diagram would otherwise never see it declared.
        if (name === 'constructor') {
          for (const a of topSplit(args)) {
            const p = peel(a, TS_MODS);
            if (!p.mods.length) continue;
            const fm = p.rest.match(/^([A-Za-z_$][\w$]*)\??\s*(?::\s*([\s\S]+?))?(?:=[\s\S]*)?$/);
            if (fm) {
              type.rows.push(mkRow('field', `${fm[1]}${fm[2] ? ` : ${tidy(fm[2])}` : ''}`,
                tsVis(p.mods, fm[1]), []));
            }
          }
        }
      }
      return;
    }
  }

  const fm = rest.match(/^([A-Za-z_$#][\w$]*)\s*[?!]?\s*(?::\s*([\s\S]+?))?\s*(?:=[\s\S]*)?$/);
  if (fm && (d.term === ';' || d.term === '}')) {
    type.rows.push(mkRow('field', `${fm[1]}${fm[2] ? ` : ${tidy(fm[2])}` : ''}`, tsVis(mods, fm[1]), d.comments));
  }
}

/**
 * `get x()` and `set x()` are ONE property, not two rows.
 *
 * They also carry the type unevenly — the getter declares it, the setter takes it as an argument —
 * so the accessors merge into the row that already exists and the annotated half wins.
 */
function tsAccessor(type, name, ret, acc, vis, comments) {
  const prev = type.rows.find((r) =>
    r.kind === 'field' && /\{[^}]*\}$/.test(r.text) && (r.text.match(/^([A-Za-z_$#][\w$]*)/) || [])[1] === name);
  if (!prev) {
    type.rows.push(mkRow('field', `${name} : ${ret || 'any'} { ${acc} }`, vis, comments));
    return;
  }
  const m = prev.text.match(/^([\s\S]*?)\s*\{([^}]*)\}$/);
  const accs = new Set(m[2].split(/[;\s]+/).filter(Boolean));
  accs.add(acc);
  const head = ret && / : any$/.test(m[1]) ? `${name} : ${ret}` : m[1];
  prev.text = `${head} { ${[...accs].join('; ')} }`;
  if (comments.length && !prev.explain.length) prev.explain = paragraphs(comments);
}

/* ─────────────────────────  Python  ─────────────────────────
 *
 * Indentation, not braces, so this one walks lines. Docstrings matter as much as `#` comments —
 * they are where Python puts the prose the diagram wants.
 */

const PY_ENUMS = new Set(['Enum', 'IntEnum', 'StrEnum', 'Flag', 'IntFlag']);
const PY_KEYWORDS = new Set([
  'return', 'pass', 'raise', 'import', 'from', 'if', 'else', 'elif', 'for', 'while', 'with', 'try',
  'except', 'finally', 'del', 'global', 'nonlocal', 'assert', 'yield', 'break', 'continue',
  'lambda', 'print', 'match', 'case', 'async', 'await', 'class', 'def',
]);

function pyVis(name) {
  if (name.startsWith('__') && !name.endsWith('__')) return 'private';
  if (name.startsWith('_')) return 'protected';
  return 'public';
}

function parsePy(text) {
  // Join bracket continuations so a multi-line `def` or `class` header reads as one line.
  const raw = text.split(/\r?\n/);
  const lines = [];
  for (let i = 0; i < raw.length; i++) {
    let s = raw[i];
    while (bracketDepth(s) > 0 && i + 1 < raw.length) s += ' ' + raw[++i].trim();
    lines.push(s);
  }

  const types = [];
  const stack = [];        // { type, indent }
  let pending = [];        // comment lines waiting for the next declaration
  let decorators = [];
  let docFor = null;       // sink for the docstring of whatever was just declared
  let inDoc = null;        // { quote, lines, sink }
  let ctor = null;         // { type, indent, seen } — collecting self.x inside __init__

  const indentOf = (l) => l.replace(/\t/g, '    ').match(/^ */)[0].length;

  for (const line of lines) {
    if (inDoc) {
      const end = line.indexOf(inDoc.quote);
      if (end < 0) { inDoc.lines.push(line); continue; }
      inDoc.lines.push(line.slice(0, end));
      inDoc.sink(paragraphs(inDoc.lines));
      inDoc = null;
      continue;
    }

    const body = line.trim();
    if (!body) continue;
    const indent = indentOf(line);

    // A docstring is only a docstring immediately after the thing it documents.
    const q = body.match(/^[rbuf]{0,2}("""|''')/);
    if (q && docFor) {
      const sink = docFor;
      docFor = null;
      const rest = body.slice(body.indexOf(q[1]) + 3);
      const end = rest.indexOf(q[1]);
      if (end >= 0) sink(paragraphs([rest.slice(0, end)]));
      else inDoc = { quote: q[1], lines: [rest], sink };
      continue;
    }
    docFor = null;

    if (body.startsWith('#')) { pending.push(body); continue; }
    if (body.startsWith('@')) { decorators.push(body); continue; }

    while (stack.length && indent <= stack[stack.length - 1].indent) stack.pop();
    if (ctor && indent <= ctor.indent) ctor = null;
    const cur = stack.length ? stack[stack.length - 1] : null;

    const cm = body.match(/^class\s+([A-Za-z_]\w*)\s*(?:\(([\s\S]*)\))?\s*:/);
    if (cm) {
      const bases = topSplit(cm[2] || '').filter((b) => !/^\w+\s*=/.test(b));
      const kind =
        bases.some((b) => PY_ENUMS.has(bare(b))) ? 'enum'
          : bases.some((b) => /^Protocol\b/.test(bare(b))) ? 'interface'
            : bases.some((b) => /^ABC(Meta)?$/.test(bare(b))) ? 'abstract'
              : 'class';
      const t = mkType(cm[1], kind, {
        extends: bases.filter((b) => !PY_ENUMS.has(bare(b))), doc: paragraphs(pending),
      });
      types.push(t);
      stack.push({ type: t, indent });
      docFor = (paras) => { if (!t.doc.length) t.doc = paras; };
      pending = []; decorators = [];
      continue;
    }

    // self.x = … inside __init__ — where Python actually declares its fields
    if (ctor && body.startsWith('self.')) {
      const sm = body.match(/^self\.([A-Za-z_]\w*)\s*(?::\s*([^=]+?))?\s*=[^=]/);
      if (sm && !ctor.seen.has(sm[1])) {
        ctor.seen.add(sm[1]);
        ctor.type.rows.push(mkRow('field', `${sm[1]}${sm[2] ? ` : ${tidy(sm[2])}` : ''}`, pyVis(sm[1]), pending));
      }
      pending = [];
      continue;
    }

    if (!cur || indent <= cur.indent) { pending = []; decorators = []; continue; }

    const dm = body.match(/^(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(([\s\S]*)\)\s*(?:->\s*([\s\S]+?))?\s*:/);
    if (dm) {
      const args = topSplit(dm[2]).filter((a, i) => !(i === 0 && /^(self|cls)\b/.test(a)));
      const prop = decorators.some((x) => /^@(property|cached_property|[\w.]+\.setter)\b/.test(x));
      const name = dm[1];
      const row = prop
        ? mkRow('field', `${name}${dm[3] ? ` : ${tidy(dm[3])}` : ''} { get }`, pyVis(name), pending)
        : mkRow('method', `${name}(${args.join(', ')})${dm[3] ? ` : ${tidy(dm[3])}` : ''}`, pyVis(name), pending);
      // Dunder methods other than __init__ are protocol plumbing, not diagram content — but
      // __init__ is where the fields are, so it is walked even though its own row is dropped.
      if (!/^__\w+__$/.test(name)) cur.type.rows.push(row);
      docFor = (paras) => { if (!row.explain.length) row.explain = paras; };
      if (name === '__init__') ctor = { type: cur.type, indent, seen: new Set() };
      pending = []; decorators = [];
      continue;
    }

    const fm = body.match(/^([A-Za-z_]\w*)\s*(?::\s*([^=]+?))?\s*(?:=[\s\S]*)?$/);
    if (fm && !PY_KEYWORDS.has(fm[1])) {
      const text2 = cur.type.kind === 'enum' && !fm[2] ? tidy(body) : `${fm[1]}${fm[2] ? ` : ${tidy(fm[2])}` : ''}`;
      cur.type.rows.push(mkRow('field', text2, pyVis(fm[1]), pending));
    }
    pending = []; decorators = [];
  }
  return types;
}

/** Net bracket depth of a line, ignoring quotes and `#` comments. */
function bracketDepth(line) {
  let d = 0, q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    if (c === '#') break;
    if ('([{'.includes(c)) d++;
    else if (')]}'.includes(c)) d--;
  }
  return d;
}
