// Naamah/daemon — `naamah show <dir>`: the diagram as a live page on the local network.
//
// FOUR MOVING PARTS, AND THE JSON FILE IS THE JOINT BETWEEN THEM ALL:
//
//   the page  --POST /comments-->  naamah.comments.json  --watch-->  the hook  -->  an agent
//        ^                                  ^                                          |
//        |                                  +----------- POST /reply (or the CLI) <-----+
//        +--- SSE "changed" ----------------+
//
// Nothing is held in memory that matters. The page's comment goes to disk before anything else
// happens; the watcher notices the file, not an event it was told about; and an agent's reply is
// another write to the same file, which the page hears about the same way it hears about its own.
// Kill the daemon at any point and the state is on disk, complete.
//
// A DESIGN EDIT IS THE OTHER INPUT. The design's own `.ts`/`.cs` files are watched too, so saving a
// sketch rebuilds the graph and the open page reflows — which is the loop the whole tool exists for:
// change the design, see the diagram, comment on it, have it changed again.
//
// BOUND TO 0.0.0.0 ON PURPOSE, unlike the model gateway. A diagram is meant to be opened from a phone
// or another machine on the LAN; it is read-only architecture drawing with no credentials in it. The
// one mutating route (a comment) is capped and shape-checked below.

import { createServer } from 'node:http';
import { existsSync, watch } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { networkInterfaces } from 'node:os';
import { buildDesign, designFiles } from './build.mjs';
import { renderPage } from './page.mjs';
import { COMMENT_LAYER } from './comment-layer.mjs';
import { addComment, addReply, commentsPath, load as loadComments, pending, resolve as resolveThread } from './comments.mjs';

export class DaemonError extends Error {}

const DEFAULT_PORT = 7781;

/** The LAN address this machine is reachable at, for the URL that gets shared. */
function lanAddress() {
  for (const list of Object.values(networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === 'IPv4' && !ni.internal) return ni.address;
    }
  }
  return '127.0.0.1';
}

const json = (res, code, body) => {
  const text = JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text) });
  res.end(text);
};

/** Read a capped JSON body. A comment is text, so anything large is a mistake or an attack. */
function readBody(req, limit = 64 * 1024) {
  return new Promise((done, fail) => {
    let n = 0; const chunks = [];
    req.on('data', (c) => {
      n += c.length;
      if (n > limit) { fail(new DaemonError('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { done(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch (err) { fail(new DaemonError(`body is not JSON: ${err.message}`)); }
    });
    req.on('error', fail);
  });
}

/**
 * Debounce a burst of filesystem events into one action.
 *
 * An editor saving a file emits several events (write, truncate, rename-into-place), and a rebuild per
 * event means three compiles and three page reloads for one save. 120ms is long enough to coalesce a
 * save and short enough to feel immediate.
 */
function debounce(fn, ms = 120) {
  let t = null;
  return (...a) => { if (t) clearTimeout(t); t = setTimeout(() => { t = null; fn(...a); }, ms); };
}

/**
 * Start the daemon.
 *
 * `onHook(threads)` is called whenever the comment file changes and leaves threads WAITING on an
 * answer. It is the whole extension point: ayin passes a function that hands them to the agent; the
 * CLI passes one that prints them.
 */
export async function serve(dir, { port = DEFAULT_PORT, onHook, quiet = false } = {}) {
  const root = resolve(dir);
  if (!existsSync(root)) throw new DaemonError(`no such directory: ${dir}`);

  let state = { graph: null, check: null, error: null, builtAt: 0, lang: 'ts' };
  const say = (msg) => { if (!quiet) process.stderr.write(`naamah: ${msg}\n`); };

  /**
   * Rebuild, and NEVER throw — a design mid-edit is usually broken, and a daemon that dies on a
   * syntax error is a daemon that dies every time you type. The error becomes page content instead.
   */
  const rebuild = () => {
    try {
      const r = buildDesign(root, { verify: true });
      state = { graph: r.graph, check: r.check, error: null, builtAt: Date.now(), lang: r.lang };
    } catch (err) {
      state = { ...state, error: err.message, builtAt: Date.now() };
    }
    return state;
  };
  rebuild();

  // ── the live channel ────────────────────────────────────────────────
  const clients = new Set();
  const push = (event, data) => {
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of [...clients]) {
      try { res.write(frame); } catch { clients.delete(res); }
    }
  };

  // ── the hook: the comment file changed ──────────────────────────────
  const fireHook = debounce(() => {
    const open = pending(root);
    push('comments', { threads: loadComments(root).threads.length, pending: open.length });
    if (!open.length) return;
    say(`hook — ${open.length} thread(s) awaiting an answer: ${open.map((t) => t.id).join(', ')}`);
    if (onHook) {
      // A hook that throws must not take the daemon with it.
      try { const r = onHook(open, { dir: root }); if (r && typeof r.catch === 'function') r.catch(() => {}); }
      catch { /* the hook's problem, not the server's */ }
    }
  }, 150);

  // ── the design changed ──────────────────────────────────────────────
  const onDesignChange = debounce(() => {
    rebuild();
    push('design', { builtAt: state.builtAt, error: state.error, ok: state.check?.ok ?? null });
    say(state.error ? `design has an error — ${state.error.split('\n')[0]}` : 'design rebuilt');
  }, 150);

  /**
   * WATCH THE DIRECTORY, NOT THE FILE LIST.
   *
   * A per-file watcher misses the case that matters most — a NEW design file — and an editor that
   * writes via rename detaches a file watcher permanently, so the second save of a file is never
   * seen. One recursive directory watcher survives both.
   */
  const watchers = [];
  try {
    watchers.push(watch(root, { recursive: true }, (_ev, name) => {
      if (!name) return;
      const f = String(name);
      if (f.endsWith('.tmp') || f.includes('.tmp-')) return;         // our own atomic writes
      if (f.endsWith('naamah.comments.json')) { fireHook(); return; }
      if (/\.(ts|cs|py)$/i.test(f)) onDesignChange();
    }));
  } catch (err) {
    // Recursive watch is unsupported on some platforms; fall back to the design dir alone.
    say(`recursive watch unavailable (${err.message}); watching the top level only`);
    watchers.push(watch(root, (_ev, name) => {
      if (!name) return;
      if (String(name).endsWith('naamah.comments.json')) fireHook();
      else if (/\.(ts|cs|py)$/i.test(String(name))) onDesignChange();
    }));
  }

  // ── routes ──────────────────────────────────────────────────────────
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;
    try {
      if (req.method === 'GET' && (path === '/' || path === '/index.html')) {
        // Rendered per request, so a reload always shows the design as it is now.
        const body = state.error
          ? errorPage(root, state.error)
          : withCommentLayer(renderPage(state.graph), { dir: root, lang: state.lang, check: state.check });
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        res.end(body);
        return;
      }

      if (req.method === 'GET' && path === '/graph.json') {
        json(res, 200, { graph: state.graph, error: state.error, check: summary(state.check), builtAt: state.builtAt });
        return;
      }

      if (req.method === 'GET' && path === '/comments.json') {
        json(res, 200, loadComments(root));
        return;
      }

      if (req.method === 'GET' && path === '/events') {
        res.writeHead(200, {
          'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive',
        });
        res.write(': hello\n\n');
        clients.add(res);
        // A proxy or a phone that sleeps will drop a silent stream; a comment keeps it open.
        const beat = setInterval(() => { try { res.write(': beat\n\n'); } catch { /* closed */ } }, 25000);
        req.on('close', () => { clearInterval(beat); clients.delete(res); });
        return;
      }

      if (req.method === 'POST' && path === '/comments') {
        const b = await readBody(req);
        const thread = addComment(root, { by: b.by, text: b.text, target: b.target });
        json(res, 201, { thread });
        return;   // the watcher fires the hook — this route does not, so one path drives it
      }

      if (req.method === 'POST' && path === '/reply') {
        const b = await readBody(req);
        const thread = addReply(root, b.thread || b.id, { by: b.by, text: b.text, agent: Boolean(b.agent) });
        json(res, 201, { thread });
        return;
      }

      if (req.method === 'POST' && path === '/resolve') {
        const b = await readBody(req);
        json(res, 200, { thread: resolveThread(root, b.thread || b.id, b.resolved !== false) });
        return;
      }

      json(res, 404, { error: `no route ${req.method} ${path}` });
    } catch (err) {
      json(res, err instanceof DaemonError ? 400 : 500, { error: err.message });
    }
  });

  const listen = (p) => new Promise((done, fail) => {
    server.once('error', fail);
    server.listen(p, '0.0.0.0', () => { server.removeListener('error', fail); done(p); });
  });

  let bound = null;
  for (let p = port; p < port + 12; p++) {
    try { bound = await listen(p); break; }
    catch (err) { if (err.code !== 'EADDRINUSE') throw err; }
  }
  if (!bound) throw new DaemonError(`no free port in ${port}..${port + 11}`);

  const url = `http://${lanAddress()}:${bound}/`;
  say(`${basename(root)} · ${state.graph?.nodes.length ?? 0} types → ${url}`);
  say(`comments: ${commentsPath(root)}`);
  // A thread left open by a previous run is still open now — fire on start, not only on change.
  fireHook();

  return {
    url, port: bound, dir: root,
    get state() { return state; },
    rebuild,
    stop() {
      for (const w of watchers) { try { w.close(); } catch { /* already gone */ } }
      for (const c of [...clients]) { try { c.end(); } catch { /* gone */ } }
      clients.clear();
      return new Promise((done) => server.close(() => done()));
    },
  };
}

function summary(check) {
  if (!check) return null;
  return { ran: check.ran, ok: check.ok, errors: (check.diagnostics || []).filter((d) => d.severity === 'error').length };
}

/** Inject the comment layer just before </body>, leaving the built page otherwise byte-identical. */
function withCommentLayer(html, meta) {
  const layer = COMMENT_LAYER.replace('/*__NAAMAH_META__*/', JSON.stringify(meta ? { lang: meta.lang } : {}));
  return html.includes('</body>') ? html.replace('</body>', `${layer}\n</body>`) : `${html}\n${layer}`;
}

/** A design that does not build still has to say WHY, on the page, where the author is looking. */
function errorPage(root, message) {
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${esc(basename(root))} · naamah</title>
<style>
:root{color-scheme:dark}
body{margin:0;background:#14161a;color:#e6e8ec;font:14px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace}
main{max-width:900px;margin:8vh auto;padding:0 24px}
h1{font-size:15px;font-weight:650;color:#ff8f6b;margin:0 0 14px}
pre{white-space:pre-wrap;background:#1b1e24;border:1px solid #2b2f38;border-radius:8px;padding:14px;margin:0}
p{color:#9aa3b2}
</style></head><body>
<main>
<h1>This design does not build</h1>
<pre>${esc(message)}</pre>
<p>Fix it and save — the page reloads itself.</p>
</main>
<script>
new EventSource('/events').addEventListener('design', function(){ location.reload(); });
</script>
</body></html>`;
}
