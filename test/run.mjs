#!/usr/bin/env node
/* naamah — the tests. `node test/run.mjs`, no dependencies, no framework.
 *
 * What they are actually for, in order of how much each one has already caught:
 *
 *  1. THE SOURCE READERS. Every language here is read by a hand-written scanner, and the failure
 *     mode is silent: a brace counted in the wrong place does not throw, it truncates the class and
 *     the diagram simply comes out short. So the fixtures are deliberately nasty — collection
 *     initialisers, arrow-function fields, a default argument next to a body brace — and the
 *     assertions are on members near the END of a type, where truncation shows.
 *  2. THE PAGE BUNDLE. page.mjs inlines two ES modules into a classic <script> by dropping their
 *     import/export keywords. That transform can produce a SyntaxError that nothing in Node would
 *     ever notice, because Node never runs the page. So the page's own scripts are evaluated here.
 *  3. THE BINDING. A rename in source is the case the whole feature exists for, and the one that
 *     needs a real file on disk to be renamed to test at all.
 */

import { readFileSync, writeFileSync, mkdtempSync, cpSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

import { parseSource, langOf, pickType, SourceError } from '../src/source.mjs';
import { create, syncGraph } from '../src/loom.mjs';
import { renderPage, extractGraph } from '../src/page.mjs';
import { toText } from '../src/totext.mjs';
import { BindError } from '../src/bind.mjs';   // imported for its side effect too: it installs the reader
import { buildProject, parseAnnotation, ProjectError } from '../src/project.mjs';
import { buildDesign, BuildError } from '../src/build.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (f) => join(here, 'fixtures', f);
const readFixture = (f) => readFileSync(fixture(f), 'utf8');
const cli = join(here, '..', 'bin', 'naamah.mjs');

let pass = 0;
const fails = [];
const test = (name, fn) => {
  try { fn(); pass++; }
  catch (err) { fails.push(`${name}\n    ${err.message.split('\n').join('\n    ')}`); }
};
const ok = (cond, msg) => { if (!cond) throw new Error(msg); };
const eq = (got, want, msg) => ok(got === want, `${msg}\n      got:  ${got}\n      want: ${want}`);
const has = (hay, needle, msg) => ok(String(hay).includes(needle), `${msg}\n      missing: ${needle}`);
const throws = (fn, needle, msg) => {
  try { fn(); } catch (err) { has(err.message, needle, msg); return; }
  throw new Error(`${msg}\n      nothing thrown`);
};

const rowOf = (type, startsWith) => type.rows.find((r) => r.text.startsWith(startsWith));
const named = (types, name) => types.find((t) => t.name === name);

/* ─────────────────────────  1. the source readers  ───────────────────────── */

test('cs — types, kinds and bases', () => {
  const t = parseSource(readFixture('RewardService.cs'), 'cs');
  eq(t.length, 5, 'five types in the file');
  eq(named(t, 'RewardService').kind, 'class', 'sealed class is a class');
  eq(named(t, 'IRewardService').kind, 'interface', 'interface');
  eq(named(t, 'RewardBase').kind, 'abstract', 'abstract class');
  eq(named(t, 'RewardType').kind, 'enum', 'enum');
  eq(named(t, 'Stamp').kind, 'struct', 'readonly struct');
  eq(named(t, 'RewardService').extends.join(), 'MonoBehaviour', 'base class first');
  eq(named(t, 'RewardService').implements.join(), 'IRewardService,ITickable', 'the rest are interfaces');
});

test('cs — fields, properties, methods, events, visibility', () => {
  const svc = named(parseSource(readFixture('RewardService.cs'), 'cs'), 'RewardService');
  eq(rowOf(svc, '_live').vis, 'private', 'a class member with no modifier is private in C#');
  eq(rowOf(svc, '_live').text, '_live : List<RewardEntry>', 'field type');
  eq(rowOf(svc, 'Activated').kind, 'event', 'event');
  eq(rowOf(svc, 'Live').text, 'Live : IReadOnlyList<RewardEntry> { get; }', 'expression-bodied property');
  eq(rowOf(svc, 'Count').text, 'Count : int { get; }', 'accessors are READ, not assumed to be get+set');
  eq(rowOf(svc, 'Activate(').kind, 'method', 'method');
  eq(rowOf(svc, 'Activate(').text, 'Activate(RewardType type, int amount) : int', 'return type trails');
  eq(rowOf(svc, 'Update').vis, 'protected', 'protected override');
  // The last member of the type: if a brace was miscounted anywhere above, this one is gone.
  ok(rowOf(svc, '_clock'), 'the field after a method body survives — braces stayed in sync');
  ok(rowOf(svc, '_slots'), 'a collection initialiser is not a body');
});

test('cs — comments become explanations', () => {
  const svc = named(parseSource(readFixture('RewardService.cs'), 'cs'), 'RewardService');
  eq(rowOf(svc, '_live').explain[0], 'the live set — index is the reward id', 'a // above a field');
  eq(rowOf(svc, '_slots').explain[0], 'initialiser braces are not a body', 'a // after code on the line');
  eq(rowOf(svc, 'Activate(').explain[0],
    'Starts one reward and returns its id. Throws if the type is unknown.',
    'a hard-wrapped /// comment is ONE paragraph, not two rows');
  eq(svc.doc[0], 'Everything that is running right now. One service, no queue.',
    'the class doc comment, with its <summary> tags gone');
});

test('cs — an enum comment belongs to one member', () => {
  const e = named(parseSource(readFixture('RewardService.cs'), 'cs'), 'RewardType');
  eq(e.rows.length, 3, 'three members');
  eq(e.rows[0].explain[0], 'the default', 'the comment above the run');
  eq(e.rows[1].explain.length, 0, 'and NOT copied onto the members after it');
});

test('ts — the class survives an arrow-function field and a defaulted argument', () => {
  const t = parseSource(readFixture('session-store.ts'), 'ts');
  const s = named(t, 'SessionStore');
  eq(s.kind, 'class', 'class');
  eq(s.extends.join(), 'EventEmitter', 'extends');
  eq(s.implements.join(), 'Persistable,Closeable', 'implements');
  // Everything below `onEvicted = (id) => { … };` used to vanish: the `;` inside the arrow body
  // ended the declaration and the closing brace then popped the class off the stack.
  ok(rowOf(s, 'seat('), 'a method declared after an arrow-function field');
  ok(rowOf(s, 'key('), 'the last member of the class');
  eq(rowOf(s, 'onEvicted').kind, 'method', 'a field holding an arrow function is a method');
});

test('ts — constructor parameter properties, accessors, visibility', () => {
  const s = named(parseSource(readFixture('session-store.ts'), 'ts'), 'SessionStore');
  eq(rowOf(s, 'constructor').text, 'constructor(clock: Clock, path: string, limit = SessionStore.MAX)',
    'parameter modifiers are not part of the signature');
  eq(rowOf(s, 'clock').vis, 'private', 'a private constructor parameter is a private field');
  eq(rowOf(s, 'path').vis, 'public', 'and a public one is a public field');
  eq(rowOf(s, 'size').text, 'size : number { get; set }', 'get and set are ONE property');
  eq(rowOf(s, '#dirty').vis, 'private', '#private');
  eq(rowOf(s, 'flush(').vis, 'protected', 'protected');
  eq(rowOf(s, 'key(').vis, 'private', 'private static');
  eq(rowOf(s, 'seat(').text, 'seat(id: string, seat: Seat) : Promise<Seat>', 'async return type');
});

test('ts — jsdoc and line comments become explanations', () => {
  const t = parseSource(readFixture('session-store.ts'), 'ts');
  const s = named(t, 'SessionStore');
  eq(rowOf(s, 'seats').explain[0], 'everything currently seated', 'a /** */ above a field');
  eq(rowOf(s, 'MAX').explain[0], 'hard cap, not a tunable', 'a // after code');
  eq(rowOf(s, 'size').explain[0], 'How many seats are taken right now.', 'the getter carries the comment');
  has(s.doc[0], "One room's worth of players.", 'the class doc');
  eq(named(t, 'Persistable').kind, 'interface', 'interface');
  eq(named(t, 'SeatState').kind, 'enum', 'enum');
});

test('py — kinds come from the bases', () => {
  const t = parseSource(readFixture('reward_service.py'), 'py');
  eq(named(t, 'RewardType').kind, 'enum', 'Enum base');
  eq(named(t, 'Clock').kind, 'interface', 'Protocol base');
  eq(named(t, 'RewardService').kind, 'abstract', 'ABC base');
});

test('py — fields from __init__, properties, methods, docstrings', () => {
  const s = named(parseSource(readFixture('reward_service.py'), 'py'), 'RewardService');
  eq(rowOf(s, 'MAX_SECONDS').text, 'MAX_SECONDS : float', 'an annotated class attribute');
  eq(rowOf(s, '_live').text, '_live : list', 'a self.x assignment in __init__ is a field');
  eq(rowOf(s, '_live').vis, 'protected', '_x is protected');
  eq(rowOf(s, '__secret').vis, 'private', '__x is private');
  eq(rowOf(s, '_live').explain[0], 'the live set — index is the reward id', 'a # comment above it');
  eq(rowOf(s, 'live').text, 'live : list { get }', '@property is a field, not a method');
  eq(rowOf(s, 'live').explain[0], 'The rewards running right now.', 'its docstring');
  eq(rowOf(s, 'activate').text, 'activate(kind: RewardType, amount: int = 1) : int',
    'a signature split over several lines, with self dropped');
  eq(rowOf(s, 'activate').explain.length, 2, 'a two-paragraph docstring is two paragraphs');
  ok(rowOf(s, 'cancel'), '@abstractmethod');
  ok(!rowOf(s, '__repr__'), 'dunder methods are plumbing, not diagram content');
  ok(!rowOf(s, '__init__'), '__init__ is walked for fields but is not a row');
});

test('langOf and pickType refuse to guess', () => {
  eq(langOf('/a/b/Foo.CS'), 'cs', 'case-insensitive extension');
  throws(() => langOf('notes.txt'), 'cannot read', 'an unsupported extension is an error');
  const t = parseSource(readFixture('RewardService.cs'), 'cs');
  eq(pickType(t, { stem: 'RewardService' }).name, 'RewardService', 'the type named after the file');
  eq(pickType(t, { symbol: 'Stamp' }).name, 'Stamp', 'an explicit symbol');
  throws(() => pickType(t, { symbol: 'Nope' }), 'no type named', 'a symbol that is not there');
  throws(() => pickType(t, { stem: 'unrelated' }), 'none named after it', 'ambiguity is an error');
  eq(pickType(parseSource(readFixture('session-store.ts'), 'ts'), { stem: 'session-store' }).name,
    'SessionStore', 'session-store.ts holds SessionStore');
  ok(SourceError, 'the error type is exported');
});

/* ─────────────────────────  2. the loom  ───────────────────────── */

// No reader is installed here on purpose: importing bind.mjs installs the Node one, and these
// tests are also checking that it did.

test('loom — fromFile builds the card from the file', () => {
  const loom = create('t');
  const svc = loom.type('WhateverIWrote', { fromFile: fixture('RewardService.cs') });
  const g = loom.build();
  eq(g.nodes[0].name, 'RewardService', 'the SOURCE names the card, not the caller');
  eq(g.nodes[0].source.lang, 'cs', 'the binding is recorded');
  eq(g.nodes[0].source.symbol, 'RewardService', 'with the name the file actually had');
  eq(typeof g.nodes[0].source.index, 'number', 'and its slot, so a rename can be followed');
  ok(g.nodes[0].rows.every((r) => r.from === 'source'), 'every row came from the file');
  eq(rowOf(g.nodes[0], 'Activate(').vis, 'PUBLIC_METHOD', 'visibility becomes a bullet');
  eq(rowOf(g.nodes[0], '_live').vis, 'PRIVATE_FIELD', 'a private field bullet');
  eq(g.nodes[0].rows[0].kind, 'lede', 'the class doc becomes a lede row');
  eq(svc.source.path, resolve(fixture('RewardService.cs')), 'the handle exposes its binding');
});

test('loom — hand-written rows survive a re-bind', () => {
  const loom = create('t');
  const svc = loom.type('X', { fromFile: fixture('RewardService.cs') });
  svc.field('handWritten : int', { explain: 'not in the file' });
  const before = loom.build().nodes[0].rows.length;
  svc.sync();
  const rows = loom.build().nodes[0].rows;
  eq(rows.length, before, 'the same rows after a sync');
  eq(rows[rows.length - 1].text, 'handWritten : int', 'the hand-written row is kept, and kept last');
  ok(!rows[rows.length - 1].from, 'and is still marked as not from source');
});

test('loom — bind by symbol, and refuse the impossible', () => {
  const loom = create('t');
  const e = loom.type('anything', { fromFile: fixture('RewardService.cs'), symbol: 'RewardType' });
  eq(loom.build().nodes[0].name, 'RewardType', 'an explicit symbol picks the type');
  eq(loom.build().nodes[0].kind, 'enum', 'and its kind');
  throws(() => loom.type('a', { fromFile: fixture('nope.cs') }), 'no such source file', 'a missing file');
  throws(() => loom.type('a', { fromFile: fixture('rewards.puml') }), 'cannot read', 'an unreadable kind of file');
  throws(() => loom.type('a').sync(), 'not bound', 'syncing a card that was never bound');
  ok(e, 'the handle comes back');
});

/* ─────────────────────────  3. the page bundle  ───────────────────────── */

const demoGraph = (() => {
  const loom = create('Demo');
  const dom = loom.domain('Rewards');
  const api = dom.type('IRewardService', { fromFile: fixture('RewardService.cs'), symbol: 'IRewardService' });
  const svc = dom.type('RewardService', { fromFile: fixture('RewardService.cs') });
  const core = loom.domain('Core');
  const store = core.type('SessionStore', { fromFile: fixture('session-store.ts') });
  svc.implements(api);
  svc.has(store);
  svc.note('Parallel by default.', ['No queue, no policy.']);
  return loom.build();
})();

test('page — the graph goes in and comes back out', () => {
  const html = renderPage(demoGraph);
  has(html, '<script id="graph"', 'the graph is in the page');
  const back = extractGraph(html);
  eq(JSON.stringify(back), JSON.stringify(demoGraph), 'byte-identical round trip');
  ok(!/<\/script>/.test(html.split('id="graph"')[1].split('</script>')[0]),
    'nothing in the graph can close its own script tag');
});

test('page — its scripts actually run, and Naamah.create still exists in the page', () => {
  const html = renderPage(demoGraph);
  // Everything except the graph JSON and the mount call: what a browser would execute at load.
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map((m) => m[1])
    .filter((s) => !s.trim().startsWith('Naamah.mount('));
  ok(scripts.length >= 2, 'the runtime and the authoring API are both in the page');

  const window = {};
  // A SyntaxError here means the module-to-script transform in page.mjs is broken — the failure
  // that Node itself can never see, because Node never runs the page.
  new Function('window', scripts.join('\n'))(window);

  const N = window.Naamah;
  ok(N, 'the page exposes Naamah');
  eq(typeof N.mount, 'function', 'mount');
  eq(typeof N.create, 'function', 'create — the documented in-page authoring API');
  eq(typeof N.useReader, 'function', 'useReader');
  eq(typeof N.parseSource, 'function', 'parseSource');

  const loom = N.create('in the page');
  const t = loom.domain('D').type('A', { kind: 'interface' });
  t.field('x : int', { vis: 'private', explain: 'authored in a browser' });
  const g = loom.build();
  eq(g.nodes[0].rows[0].vis, 'PRIVATE_FIELD', 'the loom works with no Node around it');
  eq(g.clusters[0].label, 'D', 'domains too');

  // A page has no filesystem, so this must fail LOUDLY rather than quietly binding to nothing.
  throws(() => N.create('x').type('A', { fromFile: 'anything.cs' }), 'needs a file reader',
    'fromFile in a page with no reader installed');

  eq(N.parseSource('class A { int b; }', 'cs')[0].name, 'A', 'parsing works in the page — only reading does not');
});

/* ─────────────────────────  4. totext  ───────────────────────── */

test('totext — domains, classes, deps, members, comments, connections', () => {
  const txt = toText(demoGraph);
  has(txt, 'naamah — Demo', 'the title');
  has(txt, '2 domains · 3 types · 2 relations · 1 note', 'the tally');
  has(txt, 'DOMAIN Rewards', 'a domain');
  has(txt, 'classes: IRewardService (interface), RewardService', 'its classes, with non-class kinds marked');
  has(txt, 'deps: Core', 'the domains it points at');
  has(txt, 'INTERFACE IRewardService', 'a type header carries its kind');
  has(txt, 'fields:', 'fields');
  has(txt, 'methods:', 'methods');
  has(txt, 'events:', 'events');
  has(txt, '+ Activate(RewardType type, int amount) : int', 'a member with its bullet');
  has(txt, '- _live : List<RewardEntry>', 'a private member');
  has(txt, '» the live set — index is the reward id', 'the comment under the member it explains');
  has(txt, 'connections:', 'connections');
  has(txt, '-> implements IRewardService', 'an outgoing relation, by verb');
  has(txt, '<- RewardService implements this', 'and the same relation from the other end');
  has(txt, 'source: ', 'where the class was read from');
  has(txt, 'Parallel by default.', 'notes');
});

test('totext — --no-comments leaves the skeleton', () => {
  const txt = toText(demoGraph, { comments: false });
  has(txt, '+ Activate(RewardType type, int amount) : int', 'members stay');
  ok(!txt.includes('» the live set'), 'prose goes');
  ok(!txt.includes('about:'), 'and so do the lede rows');
});

/* ─────────────────────────  5. the CLI, end to end  ───────────────────────── */

const tmp = mkdtempSync(join(tmpdir(), 'naamah-test-'));

/**
 * Run the CLI in a scratch copy of the fixtures.
 *
 * Both streams are returned together, on purpose: naamah puts its report on stderr and its DATA on
 * stdout, and a test that watched only one of them would have silently passed on an empty report.
 */
const run = (...args) => {
  const r = spawnSync(process.execPath, [cli, ...args], { cwd: tmp, encoding: 'utf8' });
  return { code: r.status, text: `${r.stdout || ''}${r.stderr || ''}`, stdout: r.stdout || '' };
};
const ran = (...args) => {
  const r = run(...args);
  ok(r.code === 0, `naamah ${args.join(' ')} exited ${r.code}\n      ${r.text.trim()}`);
  return r.text;
};
const failed = (args, needle, msg) => {
  const r = run(...args);
  ok(r.code !== 0, `${msg}\n      expected a non-zero exit, got 0`);
  has(r.text, needle, msg);
};

try {
  cpSync(join(here, 'fixtures'), tmp, { recursive: true });

  test('cli — author writes a page from a script', () => {
    const out = ran('author', 'rewards.diagram.mjs', 'page.html');
    has(out, '5 bound to source', 'it reports the bindings');
    has(readFileSync(join(tmp, 'page.html'), 'utf8'), '<script id="graph"', 'a page landed');
  });

  test('cli — sync follows a rename in the source', () => {
    const cs = join(tmp, 'RewardService.cs');
    writeFileSync(cs, readFileSync(cs, 'utf8')
      .replace('public sealed class RewardService :', 'public sealed class RewardEngine :')
      .replace('public RewardService(IClock', 'public RewardEngine(IClock')
      .replace('// the live set — index is the reward id', '// now keyed by id')
      .replace('private IClock _clock;', 'private IClock _clock;\n        public bool Paused { get; set; }'));

    const out = ran('sync', 'page.html');
    has(out, 'renamed from RewardService', 'the rename is REPORTED, never silent');
    has(out, '12 → 13 members', 'and so is the new member');

    // Every way of spelling it, because a switch that eats the filename reads as "no file given".
    has(ran('totext', '--path=page.html'), 'CLASS RewardEngine', '--path=X');
    has(ran('totext', 'page.html'), 'CLASS RewardEngine', 'a bare path');
    ok(!ran('totext', '--no-comments', 'page.html').includes('»'), '--no-comments before the path');
    ok(!ran('totext', '--path', 'page.html', '--no-comments').includes('»'), '--no-comments after it');

    const txt = ran('totext', '--path', 'page.html');
    has(txt, 'CLASS RewardEngine', 'the card took the new name');
    has(txt, '+ Paused : bool { get; set; }', 'the new member is there');
    has(txt, '» now keyed by id', 'the edited comment came across');
    has(txt, '-> implements IRewardService', 'relations survived the rename');
    has(txt, 'bound to Runtime/RewardService.cs', 'and so did the hand-written row');
    has(txt, 'Parallel by default.', 'and the note');
  });

  test('cli — sync says so when there is nothing bound', () => {
    const bare = create('bare');
    bare.type('A');
    writeFileSync(join(tmp, 'bare.html'), renderPage(bare.build()));
    failed(['sync', 'bare.html'], 'nothing in bare.html is bound', 'an unbound page');
    failed(['sync', 'nope.html'], 'no such file', 'a file that is not there');
    failed(['totext'], 'totext needs a file', 'totext with no path');
    ok(BindError, 'the error type is exported');
  });

  const plantuml = run('weave', 'rewards.puml').code === 0;
  if (!plantuml) console.error('    (skipping the PlantUML tests: plantuml is not on PATH)');

  test('cli — totext reads a .puml as well as a page', () => {
    if (!plantuml) return;
    const out = ran('totext', '--path', 'rewards.puml');
    // Packages are frames drawn as <path> in PlantUML 1.2026: if the extractor cannot read that
    // box, no card is inside any frame, every domain looks empty and gets pruned away.
    has(out, 'DOMAIN Rewards', 'the package became a domain');
    has(out, 'classes: IRewardService (interface), RewardService, RewardType (enum)', 'with its classes');
    has(out, 'deps: Core', 'and what it depends on');
    has(out, 'INTERFACE IRewardService', 'the interface');
    has(out, '-> implements IRewardService', 'the realization arrow');
    has(out, 'read-only view of what is running', 'the prose row PlantUML wrote as a .. comment ..');
  });

  test('cli — weave still works after the refactor', () => {
    if (!plantuml) return;
    const out = ran('weave', 'rewards.puml');
    has(out, 'types ·', 'it reports what it wove');
    const html = readFileSync(join(tmp, 'rewards.html'), 'utf8');
    has(html, '<script id="graph"', 'the page has its graph');
    const g = extractGraph(html);
    ok(g.nodes.length >= 4, 'and the graph has the types');
    eq(g.clusters.length, 2, 'and both packages became domains');
  });

  test('cli — help and version', () => {
    has(ran('help'), 'naamah totext --path', 'totext is documented');
    has(ran('help'), 'naamah sync', 'sync is documented');
    has(ran('help'), 'fromFile', 'fromFile is documented');
    ok(/^\d+\.\d+\.\d+$/.test(ran('version').trim()), 'a version');
    failed(['nonsense'], 'unknown command', 'an unknown command');
  });

  test('graph — a synced graph is still a graph mount can take', () => {
    const g = extractGraph(readFileSync(join(tmp, 'page.html'), 'utf8'));
    for (const n of g.nodes) {
      ok(typeof n.x === 'number' && typeof n.w === 'number', `${n.name} kept its geometry`);
      for (const r of n.rows) ok(Array.isArray(r.explain), `${n.name}: every row has explain[]`);
    }
    eq(syncGraph(g).bound, 5, 'and it can be synced again');
  });
} finally {
  rmSync(tmp, { recursive: true, force: true });
}


/* ─────────────────────  the design directory  ─────────────────────
 *
 * The format's promise is that an agent writes a plain annotated class and the diagram grows. Two
 * things have to hold for that, and both failed silently before they were tested:
 *
 *  - an ANNOTATED type must survive the reader at all. `csType`/`tsType` reject a declaration whose
 *    preamble contains `(` or `)` — a guard against locals and lambdas — and `@Owns<X>()` is
 *    exactly that shape, so every type carrying a relation simply vanished from the diagram.
 *  - a relation must be declarable from EITHER end and still draw ONCE. Keying de-duplication on
 *    the pair PLUS the edge type meant an explicit `@Owns` and an inferred field edge were
 *    different keys, so one card grew two arrows to the same target making contradictory claims.
 */

const design = (files) => buildProject(
  Object.entries(files).map(([path, text]) => ({ path, text })), { title: 'T' });
const edgeOf = (g, from, to) => g.edges.find((e) => e.from === from && e.to === to);

test('design — an annotated type survives the reader', () => {
  const g = design({ 'a.ts': '@Domain("D")\n@Owns<Entry>()\nclass Svc {}\nclass Entry {}' });
  eq(g.nodes.length, 2, 'both types are cards');
  ok(g.nodes.some((n) => n.name === 'Svc'), 'the ANNOTATED one is not dropped');
});

test('design — a relation declared from either end is one edge', () => {
  const near = design({ 'a.ts': '@Uses<Ledger>()\nclass Svc {}\nclass Ledger {}' });
  const far  = design({ 'a.ts': 'class Svc {}\n@UsedBy<Svc>()\nclass Ledger {}' });
  eq(near.edges.length, 1, 'declared from the subject');
  eq(far.edges.length, 1, 'declared from the object');
  eq(edgeOf(near, 'Svc', 'Ledger').type, 'dependency', 'same direction');
  eq(edgeOf(far, 'Svc', 'Ledger').type, 'dependency', 'and the same type, from the far end');
});

test('design — saying it from BOTH ends is agreement, not a second arrow', () => {
  const g = design({
    'a.ts': '@Uses<Ledger>()\nclass Svc {}',
    'b.ts': '@UsedBy<Svc>()\nclass Ledger {}',
  });
  eq(g.edges.length, 1, 'one edge, not two');
});

test('design — an explicit relation beats the field it also holds', () => {
  const g = design({ 'a.ts': '@Owns<Entry>()\nclass Svc { private e: Entry; }\nclass Entry {}' });
  eq(g.edges.length, 1, 'the field does not add a second, contradictory arrow');
  eq(edgeOf(g, 'Svc', 'Entry').type, 'composition', 'and the DECLARED relation is the one kept');
});

test('design — a bare field still implies an edge on its own', () => {
  const g = design({ 'a.ts': 'class Svc { private e: Entry; }\nclass Entry {}' });
  eq(edgeOf(g, 'Svc', 'Entry').type, 'aggregation', 'zero ceremony still draws');
});

test('design — a field naming a type outside the design draws nothing', () => {
  const g = design({ 'a.ts': 'class Svc { private s: string; private n: Promise<number>; }' });
  eq(g.edges.length, 0, 'library types are not cards, so no arrow points at them');
});

test('design — domains nest, and a note keeps its commas', () => {
  const g = design({ 'a.ts': '@Domain("A › B")\n@Note("one, two, three")\nclass Svc {}' });
  eq(g.clusters.length, 2, 'A and B');
  eq(g.clusters[1].parent, g.clusters[0].id, 'B nests inside A');
  eq(g.notes[0].body[0], 'one, two, three', 'the note is not cut at its first comma');
});

test('design — @Kind overrides what the host language could not say', () => {
  const g = design({ 'a.ts': '@Kind("struct")\nclass Money {}' });
  eq(g.nodes[0].kind, 'struct', 'TypeScript has no value types; the design says so anyway');
});

test('design — two types with one name is refused', () => {
  let msg = '';
  try { design({ 'a.ts': 'class X {}', 'b.ts': 'class X {}' }); }
  catch (err) { msg = err.message; }
  ok(/two types named X/.test(msg), `names are the diagram's identity — got: ${msg}`);
});

test('design — annotations parse in both spellings', () => {
  eq(parseAnnotation('@Owns<Entry>()').typeArgs.join(), 'Entry', 'the type form');
  eq(parseAnnotation('@Owns(Entry)').args.join(), 'Entry', 'the value form');
  eq(parseAnnotation('[Owns(typeof(Entry))]').args.join(), 'typeof(Entry)', 'the C# form');
  eq(parseAnnotation('@Note("a, b")').args.length, 1, 'a quoted comma is not an argument separator');
});

{
  const dir = mkdtempSync(join(tmpdir(), 'naamah-design-'));
  try {
    test('design — a module keyword is refused with the REASON, not a compiler cascade', () => {
      writeFileSync(join(dir, 'a.ts'), 'export class Svc {}\n');
      let msg = '';
      try { buildDesign(dir, { verify: false }); }
      catch (err) { msg = err.message; }
      ok(/must be a SCRIPT, not a module/.test(msg), `named at the cause — got: ${msg}`);
      ok(/export on line 1/.test(msg), 'and points at the line');
    });

    test('design — the vocabulary is written beside a design that lacks it', () => {
      // A FRESH directory: the test above already built in `dir`, so the prelude is there and
      // `ensurePrelude` would correctly report it did not write one.
      const fresh = mkdtempSync(join(tmpdir(), 'naamah-fresh-'));
      writeFileSync(join(fresh, 'a.ts'), 'class Svc {}\n');
      const r = buildDesign(fresh, { verify: false });
      ok(r.prelude.written, 'naamah.ts is written on first build');
      ok(readFileSync(r.prelude.path, 'utf8').includes('declare function Owns'),
        'and it declares the vocabulary ambiently, so design files need no import');
      eq(r.graph.nodes.length, 1, 'the prelude itself is never a card');
      rmSync(fresh, { recursive: true, force: true });
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}


/* ───────────────  an inline object type is not a body  ───────────────
 *
 * Found by an agent writing a design and the diagram coming back with a class that had NO members.
 * `private entries: { amount: number }[] = []` puts braces where a body cannot go; counted as a body,
 * the declaration was emitted early and the member itself was LOST — silently, one per inline type.
 * Exactly the truncation this file's header warns about, and it survived 24 tests because no fixture
 * used an inline object type.
 */
const rowsOfFirst = (src, lang = 'ts') => (parseSource(src, lang)[0]?.rows ?? []).map((r) => r.text);

test('ts — an inline object type in a FIELD does not eat the field', () => {
  const r = rowsOfFirst('class A { private e: { a: number } = {}; m(): void {} }');
  eq(r.length, 2, `both members survive — got ${JSON.stringify(r)}`);
  ok(/^e /.test(r[0]), 'the field is first');
});

test('ts — an inline object type in a PARAM does not eat the method', () => {
  const r = rowsOfFirst('class B { m(p: { a: number }): void {} n(): void {} }');
  eq(r.length, 2, `both methods survive — got ${JSON.stringify(r)}`);
});

test('ts — an array of inline objects survives, semicolons and all', () => {
  const r = rowsOfFirst('class C { private e: { a: number; b: string }[] = []; m(): void {} }');
  eq(r.length, 2, `got ${JSON.stringify(r)}`);
  ok(/a: number/.test(r[0]) && /b: string/.test(r[0]), 'the whole inline type is kept, not cut at its `;`');
});

test('ts — a real method body is STILL a body', () => {
  const r = rowsOfFirst('class F { m(): void { const x = { a: 1 }; } n(): void {} }');
  eq(r.length, 2, `a body with an object literal in it is not a member — got ${JSON.stringify(r)}`);
});

test('cs — the same rule holds for C# generics and initialisers', () => {
  const r = rowsOfFirst('public class G { private List<int> xs = new List<int> { 1, 2 }; public void M() { } }', 'cs');
  eq(r.length, 2, `a collection initialiser is not a body — got ${JSON.stringify(r)}`);
});

/* ───────────────────────── */

console.log(`\n${pass} passed${fails.length ? `, ${fails.length} FAILED` : ''}`);
for (const f of fails) console.error(`\n  ✗ ${f}`);
process.exit(fails.length ? 1 : 0);
