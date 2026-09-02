#!/usr/bin/env node
/* naamah — a diagram is a web.
 *
 *   naamah weave  <diagram.puml|diagram.svg> [out.html]
 *   naamah author <script.mjs> [out.html]
 *   naamah sync   <page.html>
 *   naamah totext --path <page.html|diagram.puml|diagram.svg>
 *
 * Exit codes: 0 ok · 1 bad usage / missing file · 2 cannot render it.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { weave, graphsOf, WeaveError } from '../src/weave.mjs';
import { author, sync, loadGraph, BindError } from '../src/bind.mjs';
import { toText } from '../src/totext.mjs';
import { buildToPage, summariseCheck, BuildError } from '../src/build.mjs';
import { serve, DaemonError } from '../src/daemon.mjs';
import { addReply, load as loadComments, pending, resolve as resolveThread, threadToText, CommentError } from '../src/comments.mjs';

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

  naamah build <dir> [out.html]
        Build a page from a DIRECTORY of design files — ordinary TypeScript, one
        annotated class per type. This is the door to use when authoring an
        architecture: drop a file in and the diagram grows, with nothing to
        register and no API to keep valid.

          import { Domain, Owns, Uses, UsedBy } from './naamah';

          @Domain('Rewards')
          @Owns(RewardEntry)        // a class: pass the value
          @Uses<IConfig>()          // an interface: pass the TYPE
          export class RewardService {
              private ledger: Ledger;   // a bare field implies an edge too
          }

          @UsedBy(RewardService)    // the SAME edge, from the far end
          export class Ledger {}

        A relation may be declared at EITHER end and is drawn once. The design is
        typechecked with tsc first, so a relation naming a type that does not
        exist is a compile error rather than a silently missing arrow. The
        vocabulary file naamah.ts is written beside the design if absent.

        --no-verify   draw it without typechecking

  naamah show <dir> [--port N]
        Serve the design as a LIVE page on the local network, and keep it in step:
        saving a design file rebuilds the graph and the open page reflows.

        The page carries a comment layer. Click a type card (or a member row) and
        write; the comment is appended to <dir>/naamah.comments.json. The daemon
        watches that file and fires its hook whenever a thread is left waiting on
        an answer, so an agent is woken by the file rather than by a message it
        had to be listening for. The agent replies into the same file, and every
        open page re-reads it. Nothing that matters is held in memory: kill the
        daemon mid-sentence and the thread is still on disk, still unanswered.

        Bound to 0.0.0.0 so a phone on the LAN can open it. Ctrl-C to stop.

  naamah reply <threadId> <commenter> <text...>
        Reply into a thread from the shell — the same door the page and the agent
        use. Marked as an agent reply, which is what stops the hook re-firing for
        that thread.

  naamah comments <dir> [--pending]
        Print the conversation as text. --pending lists only threads still waiting
        on an answer, which is what a hook hands an agent.

  naamah author <script.mjs> [out.html]
        Build a page from a script instead of from PlantUML. The script's default
        export is a function taking the authoring API, and returns a loom:

          export default ({ create }) => {
            const loom = create('Rewards');
            const dom  = loom.domain('Rewards');
            dom.type('RewardService', { fromFile: 'Runtime/RewardService.cs' });
            return loom;
          };

        { fromFile } reads a .cs / .ts / .py file and takes the class's name, kind,
        fields, properties and methods from it — with the comments above each member
        kept as that row's folded-away explanation.

  naamah sync <page.html>
        Re-read every source file the page is bound to and rewrite it in place.
        Renames, new members, deleted members and edited comments all come across;
        card positions, domains, notes and relations are left alone. A bound file
        that has gone missing is an error, not a shrug.

  naamah totext --path <page.html|file.puml|file.svg>
        Print the whole diagram as text on stdout: every domain with its classes and
        the domains it depends on, then every class with its fields, methods, source
        comments and connections. For grepping, diffing two revisions of the same
        architecture, or handing an agent the design without 60 KB of page.

        --no-comments   the skeleton only, without the prose

  naamah help | --help | -h
  naamah version | --version | -v

Class and component diagrams only — sequence and activity diagrams carry no entity
metadata, and are refused rather than half-rendered.
`;

const [, , cmd, ...rest] = process.argv;

// Switches that never take a value. Without this list, `--no-comments page.html` would swallow the
// filename as the switch's argument and then report that no file was given.
const BOOLS = new Set(['no-comments', 'no-verify']);

/** `--path X` / `--path=X`, or the first bare argument. */
function parseArgs(argv) {
  const flags = new Set();
  const named = {};
  const bare = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      if (BOOLS.has(k)) flags.add(k);
      else if (v !== undefined) named[k] = v;
      else if (argv[i + 1] && !argv[i + 1].startsWith('--')) named[k] = argv[++i];
      else flags.add(k);
      continue;
    }
    bare.push(a);
  }
  return { flags, named, bare };
}

const die = (msg, code = 1) => { console.error(`naamah: ${msg}`); process.exit(code); };
const codeOf = (err) => (err instanceof WeaveError || err instanceof BindError ? err.code
  : err instanceof BuildError || err instanceof DaemonError || err instanceof CommentError ? 1 : 2);

try {
  switch (cmd) {
    case 'weave': {
      const [input, output] = rest;
      if (!input) die('weave needs a file — naamah weave <file.puml|file.svg> [out.html]');
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
      break;
    }

    case 'build': {
      const { flags, bare } = parseArgs(rest);
      const [dir, output] = bare;
      if (!dir) die('build needs a directory — naamah build <dir> [out.html]');
      const r = buildToPage(dir, output, { verify: !flags.has('no-verify') });
      if (r.prelude.written) console.error(`naamah: wrote the vocabulary to ${r.prelude.path}`);
      console.error(
        `naamah: ${r.graph.nodes.length} types · ${r.graph.edges.length} relations · ` +
        `${r.graph.notes.length} notes · ${r.graph.clusters.length} domains ` +
        `· ${r.files.length} file(s) → ${r.out}`
      );
      console.error(`naamah: ${summariseCheck(r.check, r.root)}`);
      // A design that does not typecheck has DRAWN, because seeing the half-built diagram is how an
      // author finds the fix — but it must not exit 0 and be mistaken for a good build by a script.
      if (r.check.ran && !r.check.ok) process.exit(2);
      break;
    }

    case 'show': {
      const { named, bare } = parseArgs(rest);
      const [dir] = bare;
      if (!dir) die('show needs a directory — naamah show <dir> [--port N]');
      const port = named.port ? Number(named.port) : undefined;
      if (named.port && !Number.isInteger(port)) die(`--port must be a number, got "${named.port}"`);
      const d = await serve(dir, {
        port,
        // The CLI's hook is to SAY so. ayin passes its own, which hands the threads to the agent.
        onHook: (threads) => {
          for (const t of threads) process.stderr.write(`${threadToText(t)}\n`);
        },
      });
      // Park. The daemon is the process; there is nothing left to return to.
      const bye = async () => { await d.stop(); process.exit(0); };
      process.on('SIGINT', bye);
      process.on('SIGTERM', bye);
      await new Promise(() => {});
      break;
    }

    case 'reply': {
      const [threadId, commenter, ...words] = rest;
      if (!threadId || !words.length) {
        die('reply needs a thread, a commenter and text — naamah reply <threadId> <commenter> <text...>');
      }
      // The design directory is the cwd by default: a reply is about a design you are standing in.
      const { named, bare } = parseArgs([]);
      const dir = process.env.NAAMAH_DIR || process.cwd();
      const t = addReply(dir, threadId, { by: commenter, text: words.join(' '), agent: true });
      console.error(`naamah: replied to ${t.id} (${t.messages.length} message(s)) in ${dir}`);
      break;
    }

    case 'comments': {
      const { flags, bare } = parseArgs(rest);
      const dir = bare[0] || process.cwd();
      const threads = flags.has('pending') ? pending(dir) : loadComments(dir).threads;
      if (!threads.length) {
        console.error(flags.has('pending') ? 'naamah: nothing awaiting an answer' : 'naamah: no comments yet');
        break;
      }
      for (const t of threads) process.stdout.write(`${threadToText(t)}\n\n`);
      break;
    }

    case 'author': {
      const [script, output] = rest;
      if (!script) die('author needs a script — naamah author <script.mjs> [out.html]');
      const { out, graph } = await author(script, output);
      const bound = graph.nodes.filter((n) => n.source?.path).length;
      console.error(
        `naamah: ${graph.nodes.length} types · ${graph.edges.length} relations · ` +
        `${graph.clusters.length} domains · ${bound} bound to source → ${out}`
      );
      break;
    }

    case 'sync': {
      const [page] = rest;
      if (!page) die('sync needs a page — naamah sync <page.html>');
      const { out, bound, changes } = sync(page);
      for (const c of changes) {
        const bits = [];
        if (c.renamedFrom) bits.push(`renamed from ${c.renamedFrom}`);
        if (c.kindWas) bits.push(`${c.kindWas} → ${c.kind}`);
        if (c.rows !== c.rowsWas) bits.push(`${c.rowsWas} → ${c.rows} members`);
        console.error(`naamah: ${c.name}${bits.length ? ` — ${bits.join(' · ')}` : ' — unchanged'}`);
      }
      console.error(`naamah: synced ${bound} bound type(s) → ${out}`);
      break;
    }

    case 'totext': {
      const { flags, named, bare } = parseArgs(rest);
      const path = named.path || bare[0];
      if (!path) die('totext needs a file — naamah totext --path <page.html|file.puml|file.svg>');
      const graph = /\.(puml|svg)$/i.test(path)
        // A .puml can hold several diagrams; text has no filename to collide with, so print all.
        ? graphsOf(path).renderable
        : [{ name: path, graph: loadGraph(path) }];
      for (const [i, g] of graph.entries()) {
        if (i) process.stdout.write('\n');
        process.stdout.write(toText(g.graph, { comments: !flags.has('no-comments') }));
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
} catch (err) {
  console.error(`naamah: ${err.message}`);
  process.exit(codeOf(err));
}
