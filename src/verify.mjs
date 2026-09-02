// Naamah/verify — the design is handed to a real compiler, and the compiler's answer is the answer.
//
// WHY A COMPILER AND NOT A CHECKER. Every rule this needs is a rule TypeScript already enforces
// exactly: a relation that names a type which does not exist is TS2304, and two types sharing a name
// is TS2300. Re-implementing those means writing a second, worse TypeScript whose disagreements with
// the real one are silent — and the whole point of the design being source code is that the
// disagreement cannot happen.
//
// So the contract is: `tsc --noEmit`. If it exits 0 the design is well-formed; if it does not, its
// diagnostics ARE the report, quoted rather than paraphrased.
//
// NOT `--strict`. A design file writes `private ledger: Ledger;` with no initialiser, which strict
// mode demands be written `private ledger!: Ledger`. That `!` is pure ceremony in a document whose
// fields are never assigned because nothing ever runs — and ceremony in the authoring format is
// exactly what this design language exists to remove.

import { existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export class VerifyError extends Error {}

/**
 * The prelude naamah ships, per design language.
 *
 * A design directory is written in ONE language, and the vocabulary has to match it: a `.cs` design
 * handed `naamah.ts` gets decorators it cannot see and a compiler that cannot read the file.
 */
export const PRELUDES = {
  ts: { src: join(here, 'prelude', 'naamah.ts'), name: 'naamah.ts' },
  cs: { src: join(here, 'prelude', 'Naamah.cs'), name: 'Naamah.cs' },
};

/** The language a design directory is written in, from the files actually in it. */
export function designLang(files) {
  const exts = files.map((f) => String(f).toLowerCase());
  if (exts.some((f) => f.endsWith('.cs'))) return 'cs';
  return 'ts';
}

/**
 * Put the matching vocabulary beside the design if it is not already there.
 *
 * The design says `[Owns(typeof(X))]` or `@Owns<X>()`, so something must declare those names or every
 * file fails to compile for a reason that has nothing to do with the design. Writing it is naamah's
 * job, not the author's: an agent should be able to drop one annotated class into an empty directory
 * and have it build.
 *
 * An existing file is never overwritten — the author may have extended the vocabulary.
 */
export function ensurePrelude(dir, lang = 'ts') {
  const spec = PRELUDES[lang] || PRELUDES.ts;
  const dest = join(dir, spec.name);
  if (existsSync(dest)) return { path: dest, written: false, lang };
  mkdirSync(dir, { recursive: true });
  writeFileSync(dest, readFileSync(spec.src, 'utf8'));
  return { path: dest, written: true, lang };
}

/**
 * Find a TypeScript compiler.
 *
 * Walks up from the design looking for a local install first, so a project pins its own compiler;
 * falls back to naamah's own neighbourhood, then to whatever is on PATH. Returns null rather than
 * throwing — a missing compiler is a thing to REPORT, not a crash, and `naamah build` still produces
 * a diagram from a design it could not typecheck.
 */
export function findTsc(from) {
  const bin = process.platform === 'win32' ? 'tsc.cmd' : 'tsc';
  const seen = [];
  let dir = resolve(from);
  for (;;) {
    seen.push(dir);
    const cand = join(dir, 'node_modules', '.bin', bin);
    if (existsSync(cand)) return cand;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  // naamah's own tree — it is a submodule of a TypeScript project, so this usually hits.
  let nd = here;
  for (;;) {
    const cand = join(nd, 'node_modules', '.bin', bin);
    if (existsSync(cand)) return cand;
    const up = dirname(nd);
    if (up === nd) break;
    nd = up;
  }
  const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], { encoding: 'utf8' });
  if (which.status === 0 && which.stdout.trim()) return which.stdout.trim().split('\n')[0];
  return null;
}

/** Find the C# compiler mono ships. */
export function findMcs() {
  for (const bin of ['mcs', 'csc']) {
    const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], { encoding: 'utf8' });
    if (which.status === 0 && which.stdout.trim()) return which.stdout.trim().split('\n')[0];
  }
  return null;
}

/** `file.cs(4,7): error CS0246: …` and tsc's `file.ts(4,7): error TS2304: …` share one shape. */
function parseDiagnostic(line) {
  const m = String(line).match(/^(.*?)\((\d+),(\d+)\):\s*(error|warning)\s+([A-Z]{2}\d+):\s*([\s\S]*)$/);
  if (!m) return null;
  return { file: m[1], line: +m[2], col: +m[3], severity: m[4], code: m[5], message: m[6].trim() };
}

/**
 * Compile a design and let the COMPILER's answer be the answer.
 *
 * Returns `{ ran, ok, diagnostics, compiler, output }`. `ran: false` means no compiler was found —
 * distinct from `ok: false`, and a caller must never report an unchecked design as a passing one.
 *
 * NOT `--strict` / warnings off. A design file writes `private Ledger _ledger;` and never assigns it,
 * because nothing here ever runs: strict TS demands a `!`, and C# warns CS0169 on every field. Both
 * are ceremony in a document, and ceremony in the authoring format is what this language removes.
 */
export function verifyDesign(files, { dir, compiler } = {}) {
  const cwd = dir || (files[0] && dirname(files[0])) || process.cwd();
  const cs = files.filter((f) => /\.cs$/i.test(f));
  const ts = files.filter((f) => /\.(ts|tsx|mts|cts|js|mjs|cjs)$/i.test(f));
  return cs.length ? verifyCs(cs, cwd, compiler) : verifyTs(ts, cwd, compiler);
}

/**
 * A `.js` design, typechecked as what it actually is.
 *
 * A design file is DECLARATIONS — `declare class Game { start(): void }` — which is TypeScript syntax
 * whatever the file is called. tsc picks its parser from the EXTENSION, so it reads a `.js` file as
 * JavaScript and rejects the annotations; `--allowJs` does not change that. So a `.js` design compiles
 * through a `.ts` SHADOW in a temp directory, and the diagnostics are mapped back to the name the
 * author actually has open. Nothing is written beside the design, and the shadow goes either way.
 *
 * Why accept `.js` at all: a browser project's source is `.js`, and a design directory whose files
 * cannot share the extension of the code they describe is one more thing to explain to everyone who
 * opens it.
 */
function shadowJs(files) {
  const isJs = (f) => /\.(js|mjs|cjs)$/i.test(f);
  if (!files.some(isJs)) return { files, back: (o) => o, cleanup: () => {} };
  const tmp = mkdtempSync(join(tmpdir(), 'naamah-js-'));
  const map = new Map();
  const shadowed = files.map((f) => {
    if (!isJs(f)) return f;
    const dest = join(tmp, `${basename(f).replace(/\.(js|mjs|cjs)$/i, '')}.ts`);
    writeFileSync(dest, readFileSync(f, 'utf8'));
    map.set(dest, f);
    return dest;
  });
  const back = (out) => {
    let text = out;
    for (const [shadow, real] of map) {
      text = text.split(shadow).join(real).split(basename(shadow)).join(basename(real));
    }
    return text;
  };
  return {
    files: shadowed,
    back,
    cleanup: () => { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* temp only */ } },
  };
}

function verifyTs(files, cwd, compiler) {
  const tsc = compiler || findTsc(cwd);
  if (!tsc) {
    return { ran: false, ok: false, compiler: null, diagnostics: [], output: '', lang: 'ts',
      why: 'no TypeScript compiler found — install one (npm i -D typescript) to typecheck the design' };
  }
  const shadow = shadowJs(files);
  let run;
  try {
    run = spawnSync(tsc, [
      '--noEmit',
      '--experimentalDecorators',       // the decorators ARE the relation syntax
      '--target', 'ES2022',
      '--moduleResolution', 'node',
      ...shadow.files,
    ], { encoding: 'utf8', cwd });
  } finally {
    shadow.cleanup();
  }
  if (run.error) throw new VerifyError(`could not run ${tsc}: ${run.error.message}`);
  return finish(run, tsc, 'ts', shadow.back);
}

function verifyCs(files, cwd, compiler) {
  const mcs = compiler || findMcs();
  if (!mcs) {
    return { ran: false, ok: false, compiler: null, diagnostics: [], output: '', lang: 'cs',
      why: 'no C# compiler found — install mono (apt install mono-mcs, or brew install mono) to compile the design' };
  }
  // mcs cannot write to /dev/null (it seeks), and a design has no output worth keeping, so the
  // assembly goes to a temp file that is deleted immediately.
  const out = join(mkdtempSync(join(tmpdir(), 'naamah-cs-')), 'design.dll');
  const run = spawnSync(mcs, ['-target:library', '-warn:0', `-out:${out}`, ...files], { encoding: 'utf8', cwd });
  try { rmSync(dirname(out), { recursive: true, force: true }); } catch { /* temp only */ }
  if (run.error) throw new VerifyError(`could not run ${mcs}: ${run.error.message}`);
  return finish(run, mcs, 'cs');
}

function finish(run, compiler, lang, back = (o) => o) {
  const output = back(`${run.stdout || ''}${run.stderr || ''}`.trim());
  const diagnostics = output.split('\n').map(parseDiagnostic).filter(Boolean);
  return { ran: true, ok: run.status === 0, compiler, diagnostics, output, lang };
}
