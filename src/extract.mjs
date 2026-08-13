// Naamah/extract — PlantUML SVG -> graph model. No dependencies, no network.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const STEREOTYPE = {
  '#B4A7E5': 'interface',
  '#ADD1B2': 'class',
  '#EB937F': 'enum',
  '#A9DCDF': 'abstract',
  '#F1F1F1': 'struct',
};

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decode(s) {
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&(\w+);/g, (m, n) => (n in NAMED ? NAMED[n] : m));
}

const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`));
  return m ? m[1] : null;
};
const num = (tag, name) => {
  const v = attr(tag, name);
  return v === null ? null : parseFloat(v);
};

// Walk <g ...> ... </g> honouring nesting depth. Regex alone cannot do this:
// entities contain nested <g data-visibility-modifier> wrappers. Groups that carry
// no class of interest (PlantUML wraps the whole drawing in a bare <g>) are descended
// into rather than skipped.
const WANTED = new Set(['cluster', 'entity', 'link']);

function* groups(svg) {
  const re = /<g\b[^>]*>|<\/g>/g;
  let m, depth = 0, start = -1, openTag = '';
  while ((m = re.exec(svg))) {
    if (m[0] === '</g>') {
      depth--;
      if (depth === 0 && start >= 0) {
        const inner = svg.slice(start, m.index);
        if (WANTED.has(attr(openTag, 'class'))) yield { tag: openTag, inner };
        else yield* groups(inner);
        start = -1;
      }
    } else {
      if (depth === 0) { openTag = m[0]; start = m.index + m[0].length; }
      depth++;
    }
  }
}

// Ordered token stream inside an entity: text rows, visibility bullets, separators.
function* tokens(inner) {
  const re = /<text\b([^>]*)>([\s\S]*?)<\/text>|<g\b([^>]*data-visibility-modifier="([^"]+)"[^>]*)>|<line\b([^>]*)\/?>/g;
  let m;
  while ((m = re.exec(inner))) {
    if (m[1] !== undefined) {
      yield {
        t: 'text', tag: m[1],
        size: parseFloat((m[1].match(/font-size="([\d.]+)"/) || [])[1] || 14),
        body: decode(m[2].replace(/<[^>]*>/g, '')),
      };
    } else if (m[4] !== undefined) {
      yield { t: 'vis', vis: m[4] };
    } else {
      yield { t: 'rule', y: parseFloat((m[5].match(/\by1="([\d.-]+)"/) || [])[1] ?? 0) };
    }
  }
}

// SVG path commands take different parameter layouts, and only some of those parameters are
// coordinates. Pairing raw numbers reads an arc's rx/ry/rotation/flags as points — in
// `A0,0 0 0 0 378,66` that invents a point at (0,0) — which corrupted every note's box and made
// containment inside a domain fail every single time.
const PATH_ARGS = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

function pathPoints(d) {
  const out = [];
  const tok = d.match(/[MmLlHhVvCcSsQqTtAaZz]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || [];
  let i = 0, cmd = null, cx = 0, cy = 0, sx = 0, sy = 0;
  while (i < tok.length) {
    if (/[a-z]/i.test(tok[i])) {
      cmd = tok[i++];
      if (cmd.toUpperCase() === 'Z') { cx = sx; cy = sy; continue; }
    }
    if (!cmd) break;
    const up = cmd.toUpperCase(), rel = cmd !== up, n = PATH_ARGS[up];
    if (n === undefined) { i++; continue; }
    const a = tok.slice(i, i + n).map(Number);
    if (a.length < n) break;
    i += n;
    if (up === 'H') cx = rel ? cx + a[0] : a[0];
    else if (up === 'V') cy = rel ? cy + a[0] : a[0];
    else {
      // The endpoint is always the last pair; control points and arc flags are not vertices.
      cx = rel ? cx + a[n - 2] : a[n - 2];
      cy = rel ? cy + a[n - 1] : a[n - 1];
    }
    if (up === 'M') { sx = cx; sy = cy; }
    out.push([cx, cy]);
    if (up === 'M') cmd = rel ? 'l' : 'L';   // repeated pairs after M are implicit linetos
  }
  return out;
}

const boxOf = (P) => {
  const x = Math.min(...P.map((p) => p[0])), y = Math.min(...P.map((p) => p[1]));
  return { x, y, w: Math.max(...P.map((p) => p[0])) - x, h: Math.max(...P.map((p) => p[1])) - y };
};

/**
 * A note's outline is a rounded rectangle plus, when it annotates something, a speech-bubble TAIL
 * spiking out to its host. That tail is the association PlantUML does not put in its link metadata —
 * so the apex is how a note finds its type, and excluding it is how the note gets an honest box.
 *
 * The apex is the single vertex whose removal materially shrinks the outline's bounds.
 */
function noteShape(inner) {
  const P = (inner.match(/\bd="([^"]*)"/g) || []).flatMap((d) => pathPoints(d));
  if (!P.length) return null;
  const full = boxOf(P);
  let best = null;
  for (let i = 0; i < P.length; i++) {
    const rest = P.filter((_, j) => j !== i);
    if (!rest.length) continue;
    const b = boxOf(rest);
    const shrink = Math.max(b.x - full.x, b.y - full.y,
      (full.x + full.w) - (b.x + b.w), (full.y + full.h) - (b.y + b.h));
    if (shrink > 12 && (!best || shrink > best.shrink)) best = { shrink, apex: P[i], box: b };
  }
  return best ? { ...best.box, tailApex: best.apex } : { ...full, tailApex: null };
}

// "..  wraps GameManager" — PlantUML's comment rows. These are the *explanations*:
// prose that belongs to the row above it, not another member.
const EXPLAIN = /^\.\.\s*/;

function parseEntity(tag, inner) {
  const id = attr(tag, 'id');
  const qname = decode(attr(tag, 'data-qualified-name') || '');
  const rectTag = (inner.match(/<rect\b[^>]*>/) || [])[0];

  if (!rectTag) {
    // No rect -> a PlantUML note (folded-corner path).
    const box = noteShape(inner) || { x: 0, y: 0, w: 320, h: 160, tailApex: null };
    const lines = [...tokens(inner)].filter((t) => t.t === 'text').map((t) => t.body);
    return {
      id, kind: 'note', name: lines[0] || 'Note', qname,
      ...box,
      body: lines.slice(1).filter((l) => l.trim()),
    };
  }

  const box = {
    x: num(rectTag, 'x'), y: num(rectTag, 'y'),
    w: num(rectTag, 'width'), h: num(rectTag, 'height'),
  };
  const badge = (inner.match(/<ellipse\b[^>]*rx="11"[^>]*>/) || [])[0] || '';
  const kind = STEREOTYPE[attr(badge, 'fill')] || 'class';

  const rows = [];
  let name = qname.split('..').pop() || id;
  let stereotype = null;
  let seenTitle = false, section = 0, pendingVis = null;

  for (const tok of tokens(inner)) {
    if (tok.t === 'rule') { section++; continue; }
    if (tok.t === 'vis') { pendingVis = tok.vis; continue; }

    const text = tok.body;
    // A stereotype («ITickable», <<MonoBehaviour>>) rides in the header at a smaller size,
    // ahead of the real name. Keep it, but never let it become the title.
    if (section === 0 && (/^[«<]{1,2}.*[»>]{1,2}$/.test(text.trim()) || tok.size < 14)) {
      stereotype = text.trim().replace(/^[«<]+|[»>]+$/g, '');
      continue;
    }
    if (!seenTitle && section === 0) { name = text; seenTitle = true; continue; }
    if (!text.trim()) continue;

    if (EXPLAIN.test(text)) {
      const prose = text.replace(EXPLAIN, '').trim();
      if (rows.length) rows[rows.length - 1].explain.push(prose);
      else rows.push({ vis: null, kind: 'lede', text: prose, explain: [] });
      continue;
    }

    const isMethod = /\(/.test(text) || (pendingVis || '').includes('METHOD');
    rows.push({
      vis: pendingVis,
      kind: /^event\b/.test(text) ? 'event' : isMethod ? 'method' : 'field',
      text,
      explain: [],
    });
    pendingVis = null;
  }
  return { id, kind, name, stereotype, qname, ...box, rows };
}

function parseCluster(tag, inner) {
  const rectTag = (inner.match(/<rect\b[^>]*>/) || [])[0] || '';
  const label = decode(((inner.match(/<text\b[^>]*>([\s\S]*?)<\/text>/) || [])[1] || '').replace(/<[^>]*>/g, ''));
  return {
    id: attr(tag, 'id'),
    label,
    qname: decode(attr(tag, 'data-qualified-name') || label),
    x: num(rectTag, 'x'), y: num(rectTag, 'y'),
    w: num(rectTag, 'width'), h: num(rectTag, 'height'),
  };
}

const contains = (o, i) =>
  o.x <= i.x && o.y <= i.y && o.x + o.w >= i.x + i.w && o.y + o.h >= i.y + i.h;
const area = (b) => b.w * b.h;

export function parseSvg(svg) {
  const clusters = [], nodes = [], notes = [], edges = [];
  let title = (svg.match(/<g class="title"[^>]*>\s*<text[^>]*>([\s\S]*?)<\/text>/) || [])[1];
  title = title ? decode(title.replace(/<[^>]*>/g, '')) : 'Diagram';

  for (const { tag, inner } of groups(svg)) {
    const cls = attr(tag, 'class');
    if (cls === 'cluster') clusters.push(parseCluster(tag, inner));
    else if (cls === 'entity') {
      const e = parseEntity(tag, inner);
      (e.kind === 'note' ? notes : nodes).push(e);
    } else if (cls === 'link') {
      // PlantUML reports `<|--` (extends) and `<|..` (implements) both as "extension";
      // the only thing telling them apart is whether it drew the line dashed. UML draws
      // realization dashed, so that distinction is worth keeping.
      const stroke = (inner.match(/<path\b[^>]*>/) || [''])[0];
      edges.push({
        id: attr(tag, 'id'),
        from: attr(tag, 'data-entity-1'),
        to: attr(tag, 'data-entity-2'),
        type: attr(tag, 'data-link-type') || 'association',
        dashed: /stroke-dasharray/.test(stroke),
      });
    }
  }

  // Nest clusters, then file every card into the tightest cluster that holds it.
  for (const c of clusters) {
    const parents = clusters.filter((o) => o !== c && contains(o, c));
    c.parent = parents.length ? parents.sort((a, b) => area(a) - area(b))[0].id : null;
  }
  for (const n of [...nodes, ...notes]) {
    const owners = clusters.filter((c) => contains(c, n));
    n.cluster = owners.length ? owners.sort((a, b) => area(a) - area(b))[0].id : null;
  }

  // A note declared inside a package carries the package in its qualified name
  // (`DomainA.GMN3`), which is exact where containment is only a guess — a note drawn overlapping
  // its frame edge, or one whose host sits in a sibling domain, resolves correctly here.
  const clusterByPath = new Map();
  for (const c of clusters) {
    const path = (c.qname || c.label || '').replace(/\s+/g, ' ').trim();
    if (path) clusterByPath.set(path, c.id);
    if (c.label) clusterByPath.set(c.label.replace(/\s+/g, ' ').trim(), c.id);
  }
  for (const note of notes) {
    if (note.cluster) continue;
    const parts = (note.qname || '').split('.');
    if (parts.length < 2) continue;
    const prefix = parts.slice(0, -1).join('.').replace(/\s+/g, ' ').trim();
    const owner = clusterByPath.get(prefix) ?? clusterByPath.get(parts[parts.length - 2].trim());
    if (owner) note.cluster = owner;
  }


  // PlayPerfect > GameModes > Rewards > asmdef is four nested frames drawing one idea.
  // Fold any chain of single-child, node-less groups into the innermost frame and let the
  // label carry the path — one bordered region instead of concentric rings of padding.
  for (let fused = true; fused; ) {
    fused = false;
    for (const c of clusters) {
      const subs = clusters.filter((s) => s.parent === c.id);
      const own = [...nodes, ...notes].some((n) => n.cluster === c.id);
      if (own || subs.length !== 1) continue;
      subs[0].label = `${c.label} › ${subs[0].label}`;
      subs[0].parent = c.parent;
      clusters.splice(clusters.indexOf(c), 1);
      fused = true;
      break;
    }
  }

  // ── attaching notes to what they annotate ─────────────────────────────────────────────
  // PlantUML's link metadata cannot be relied on here: it emits no `class="link"` group for
  // `note ... of X` at all, and none even for an explicit `Note .. X`, so a diagram with fifteen
  // notes can easily expose six note links or zero. Declaring the note inside a package suppresses
  // it entirely.
  //
  // The note's own outline is the honest source. Its speech-bubble tail points at its host, and the
  // apex lands on that host's border — so association comes from the drawing PlantUML actually made
  // rather than from metadata it may or may not have written.
  const byId = new Map([...nodes, ...notes].map((n) => [n.id, n]));
  const kept = [];
  for (const e of edges) {
    const a = byId.get(e.from), b = byId.get(e.to);
    const note = a?.kind === 'note' ? a : b?.kind === 'note' ? b : null;
    const host = note === a ? b : a;
    if (note && host && e.type === 'association') { note.attachedTo = host.id; continue; }
    if (a && b) kept.push(e);
  }

  // Whatever the links did not cover, the tail does.
  const near = (n, x, y, pad = 8) =>
    x >= n.x - pad && x <= n.x + n.w + pad && y >= n.y - pad && y <= n.y + n.h + pad;
  for (const note of notes) {
    if (note.attachedTo || !note.tailApex) continue;
    const [ax, ay] = note.tailApex;
    const hit = nodes.filter((n) => near(n, ax, ay));
    if (hit.length === 1) note.attachedTo = hit[0].id;
    else if (hit.length > 1) {
      // Overlapping candidates: take the nearest border.
      const dist = (n) => Math.hypot(ax - (n.x + n.w / 2), ay - (n.y + n.h / 2));
      note.attachedTo = hit.sort((p, q) => dist(p) - dist(q))[0].id;
    }
  }

  // Now that every note knows its host, a note with no domain of its own inherits the host's — an
  // annotation of a type inside a domain is part of that domain. This has to run AFTER attachment:
  // it previously sat before it and so always read `attachedTo` as unset, which is why notes stayed
  // loose even once they were correctly tethered.
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  for (const note of notes) {
    if (note.cluster || !note.attachedTo) continue;
    const host = nodeById.get(note.attachedTo);
    if (host?.cluster) note.cluster = host.cluster;
  }

  // Normalise to a local origin so the canvas starts flush.
  const all = [...nodes, ...notes, ...clusters];
  const ox = Math.min(...all.map((n) => n.x)) - 60;
  const oy = Math.min(...all.map((n) => n.y)) - 60;
  for (const n of all) { n.x -= ox; n.y -= oy; }

  return { title, clusters, nodes, notes, edges: kept };
}
