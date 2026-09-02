// Naamah/build — the Node side of a design directory: walk it, typecheck it, draw it.
//
// `project.mjs` is pure and knows nothing about disk; this is the half that reads files, runs the
// compiler and writes the page. Split for the same reason `loom.mjs` and `bind.mjs` are: the graph
// logic has to be testable without a filesystem, and inlinable into a page that has none.

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { buildProject, ProjectError } from './project.mjs';
import { designLang, ensurePrelude, verifyDesign } from './verify.mjs';
import { renderPage } from './page.mjs';
import { EXT_LANG } from './source.mjs';

export class BuildError extends Error {}

/** Directories that never hold a design and are expensive to walk. */
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'bin', 'obj', '.next', 'coverage']);

/** Extensions a design file may have. */
const DESIGN_EXT = new Set(['.ts', '.cs', '.py']);

/**
 * The vocabulary file, which compiles WITH the design but is not part of it.
 *
 * COMPARED CASE-INSENSITIVELY. The C# prelude is `Naamah.cs` — C# convention capitalises a file named
 * after its types — and a lowercase-only set did not match it, so the vocabulary's own seventeen
 * attribute classes were read as design types and a five-type design drew twenty-two cards.
 */
const PRELUDE_NAMES = new Set(['naamah.ts', 'naamah.cs', 'naamah.py']);
const isPrelude = (p) => PRELUDE_NAMES.has(basename(p).toLowerCase());

/**
 * The `import` / `export` keywords that would make a design file a module.
 *
 * Line-anchored and comment-aware enough for the job: only a keyword STARTING a line counts, so
 * `// export the ledger` in prose and `exported: boolean` in a member both stay quiet. A false
 * negative here just defers to the compiler; a false positive would refuse a valid design, so this
 * errs toward silence.
 */
function moduleKeywords(text) {
  const hits = [];
  for (const [i, raw] of String(text).split('\n').entries()) {
    const line = raw.trim();
    if (line.startsWith('//') || line.startsWith('*') || line.startsWith('/*')) continue;
    const m = line.match(/^(import|export)\b/);
    if (m) hits.push(`${m[1]} on line ${i + 1}`);
  }
  return hits;
}

/** Every design file under `dir`, depth-first, in a stable order. */
export function designFiles(dir) {
  const root = resolve(dir);
  const out = [];
  const walk = (d) => {
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); }
    catch (err) { throw new BuildError(`cannot read ${d}: ${err.message}`); }
    // Sorted, so a diagram built twice from an unchanged design is byte-identical. Readdir order is
    // filesystem order, which differs between the nuk and a mac and would make every rebuild a diff.
    for (const e of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name.startsWith('.')) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(p); continue; }
      if (!DESIGN_EXT.has(extname(e.name).toLowerCase())) continue;
      if (!EXT_LANG[extname(e.name).toLowerCase()]) continue;
      out.push(p);
    }
  };
  const st = statSync(root, { throwIfNoEntry: false });
  if (!st) throw new BuildError(`no such directory: ${dir}`);
  if (!st.isDirectory()) throw new BuildError(`${dir} is a file — naamah build takes a directory of design files`);
  walk(root);
  return out;
}

/**
 * Build a design directory into a graph, typechecking it on the way.
 *
 * `verify: false` skips the compiler — for a caller that has already run it, or a watch loop
 * rebuilding on every keystroke. The compile result is RETURNED rather than thrown: a design with a
 * dangling relation should still draw, because seeing the half-built diagram is how an author works
 * out what to fix. The caller decides how loud to be.
 */
export function buildDesign(dir, { verify = true, title } = {}) {
  const root = resolve(dir);
  // THE LANGUAGE IS READ FROM THE DESIGN BEFORE THE VOCABULARY IS WRITTEN. Writing the prelude first
  // and asking later put `naamah.ts` into a C# design — decorators the files cannot see, checked by a
  // compiler that cannot read them.
  const found = designFiles(root);
  const lang = designLang(found.filter((p) => !isPrelude(p)));
  const prelude = ensurePrelude(root, lang);
  const all = found.includes(prelude.path) ? found : designFiles(root);
  // The prelude compiles with the design — it defines every decorator — but it is vocabulary, not
  // architecture, so its own declarations must never become cards.
  const design = all.filter((p) => !isPrelude(p));
  if (!design.length) {
    throw new BuildError(
      `no design files in ${dir} — add a .ts file with a class in it, or see ${basename(prelude.path)} ` +
      `for the vocabulary`);
  }

  // ONE `export` TURNS A DESIGN FILE INTO A MODULE, and a module has its own scope — so every
  // relation pointing into that file starts failing with "Cannot find name", far from the cause. The
  // compiler reports the symptom N times and never the reason, so it is named HERE, once, in the
  // terms the author can act on.
  const offenders = lang === 'ts'
    ? design.map((p) => ({ path: p, hits: moduleKeywords(readFileSync(p, 'utf8')) })).filter((f) => f.hits.length)
    : [];
  if (offenders.length) {
    const lines = offenders.map((f) => `  ${relative(root, f.path)} — ${f.hits.join(', ')}`);
    throw new BuildError(
      `a design file must be a SCRIPT, not a module: remove the import/export below.\n${lines.join('\n')}\n` +
      `Every design file shares one global scope, which is what lets any type name any other with ` +
      `nothing to wire up. An import or an export closes that scope off.`);
  }

  const check = verify ? verifyDesign(all, { dir: root }) : { ran: false, ok: false, diagnostics: [], why: 'skipped' };

  const files = design.map((p) => ({ path: p, text: readFileSync(p, 'utf8') }));
  let graph;
  try { graph = buildProject(files, { title: title || basename(root) }); }
  catch (err) {
    if (err instanceof ProjectError) throw new BuildError(err.message);
    throw err;
  }
  return { graph, check, prelude, files: design, root, lang };
}

/** Build and write the page. `out` defaults to `<dir>/<name>.html`. */
export function buildToPage(dir, out, opts = {}) {
  const built = buildDesign(dir, opts);
  const target = out || join(resolve(dir), `${basename(resolve(dir))}.html`);
  writeFileSync(target, renderPage(built.graph));
  return { ...built, out: target };
}

/** A one-screen summary of a compile result, for a CLI or a tool result. */
export function summariseCheck(check, root = '') {
  if (!check.ran) return `⊘ not typechecked — ${check.why || 'no compiler'}`;
  if (check.ok) return `✓ typechecks (${basename(check.compiler || 'tsc')})`;
  const errs = check.diagnostics.filter((d) => d.severity === 'error');
  // A COMPILER CAN FAIL WITHOUT EMITTING ONE PARSEABLE DIAGNOSTIC — a bad flag, a file it refuses to
  // open, tsc handed a .cs file. Reporting that as "0 compile error(s)" is a sentence that contradicts
  // its own ✗, and it hides the real output at exactly the moment it is the only useful thing.
  if (!errs.length) {
    return `✗ ${basename(check.compiler || 'the compiler')} failed but reported no diagnostic — its output was:\n` +
      (check.output ? check.output.split('\n').slice(0, 12).map((l) => `  ${l}`).join('\n') : '  (nothing)');
  }
  const shown = errs.slice(0, 20).map((d) => {
    // `relative()` resolves a RELATIVE argument against process.cwd(), not against `root` — and tsc
    // reports relative paths. So `relative(designDir, 'infra.ts')` walked up out of naamah's own
    // directory and printed `../../../../../../home/.../naamah/infra.ts` for a file sitting in the
    // design. Anchor it to `root` first, then relativise.
    const where = root ? relative(root, isAbsolute(d.file) ? d.file : join(root, d.file)) : d.file;
    return `  ${where}:${d.line}:${d.col}  ${d.code}  ${d.message}`;
  });
  const more = errs.length > shown.length ? `\n  … and ${errs.length - shown.length} more` : '';
  return `✗ ${errs.length} compile error(s) — the design names something that does not exist:\n${shown.join('\n')}${more}`;
}
