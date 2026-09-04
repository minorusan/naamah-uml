/* Naamah — a small runtime for beautiful, draggable, zoomable, collapsible diagrams.
 *
 * Named for the weaver: a diagram is a web, and `create()` hands you the loom.
 *
 * Cards are real DOM (crisp text, real CSS, real transitions); wires are one SVG layer
 * sharing the same world transform. Everything below is framework-free and offline.
 *
 *   Naamah.mount(graph, { root, theme, level })
 */

const Naamah = (() => {
  'use strict';

  const $ = (sel, el = document) => el.querySelector(sel);
  const svgNS = 'http://www.w3.org/2000/svg';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const el = (tag, cls, html) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  };
  const svg = (tag, attrs = {}) => {
    const n = document.createElementNS(svgNS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const ICON = {
    caret: '<svg class="caret" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l4 4 4-4"/></svg>',
    focus: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="8" cy="8" r="2.2"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2"/></svg>',
    search: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="7" cy="7" r="4.6"/><path d="M10.5 10.5L14 14"/></svg>',
    fit: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4"/></svg>',
    plus: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M8 3v10M3 8h10"/></svg>',
    minus: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 8h10"/></svg>',
    moon: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M13.5 9.5A5.8 5.8 0 016.5 2.5a5.8 5.8 0 107 7z"/></svg>',
    sun: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="8" r="3"/><path d="M8 1v1.6M8 13.4V15M1 8h1.6M13.4 8H15M3.1 3.1l1.1 1.1M11.8 11.8l1.1 1.1M12.9 3.1l-1.1 1.1M4.2 11.8l-1.1 1.1"/></svg>',
    note: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M3 2h7l3 3v9H3z"/><path d="M10 2v3h3"/></svg>',
    comment: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M2.5 3h11v7.5h-6L4 13.5V10.5H2.5z"/></svg>',
    map: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M1.5 4l4-2 5 2 4-2v10l-4 2-5-2-4 2z"/><path d="M5.5 2v10M10.5 4v10"/></svg>',
    help: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="8" cy="8" r="6.2"/><path d="M6.2 6.1a1.9 1.9 0 113.1 1.6c-.7.5-1.3.8-1.3 1.7"/><path d="M8 11.6v.01"/></svg>',
    close: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
    layers: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M8 1.6L14.4 5 8 8.4 1.6 5z"/><path d="M1.6 8.4L8 11.8l6.4-3.4"/></svg>',
    compact: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8h12"/><path d="M6 4.5L8 2.5l2 2"/><path d="M6 11.5L8 13.5l2-2"/></svg>',
    // chevrons apart = expand everything · chevrons together = fold it back down
    unfold: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 6l3-3 3 3"/><path d="M5 10l3 3 3-3"/></svg>',
    fold: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3.5l3 3 3-3"/><path d="M5 12.5l3-3 3 3"/></svg>',
    trash: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 4.5h11"/><path d="M6 4.5V3h4v1.5"/><path d="M4 4.5l.8 9h6.4l.8-9"/></svg>',
    eye: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1.4 8S3.9 3.5 8 3.5 14.6 8 14.6 8 12.1 12.5 8 12.5 1.4 8 1.4 8z"/><circle cx="8" cy="8" r="2"/></svg>',
    eyeoff: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1.4 8S3.9 3.5 8 3.5c1 0 1.9.3 2.7.7M14.6 8s-1 1.8-2.8 3.1M5.6 11.8c.7.4 1.5.7 2.4.7 4.1 0 6.6-4.5 6.6-4.5"/><path d="M2.5 2.5l11 11"/></svg>',
    reset: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 8a5.5 5.5 0 1 0 1.8-4.1"/><path d="M2.2 2.4v3.2h3.2"/></svg>',
  };

  const KIND_LETTER = { interface: 'I', class: 'C', abstract: 'A', enum: 'E', struct: 'S', note: '✎' };
  const KIND_LABEL = { interface: 'Interface', class: 'Class', abstract: 'Abstract', enum: 'Enum', struct: 'Struct/record', note: 'Note' };
  // Where the UML cap sits: A <|-- B / A *-- B / A o-- B decorate A; A ..> B decorates B.
  const CAP_AT_SOURCE = new Set(['extension', 'composition', 'aggregation']);

  /* ─────────────────────────  camera  ───────────────────────── */

  class Camera {
    constructor(world, stage, onChange) {
      this.world = world; this.stage = stage; this.onChange = onChange;
      this.x = 0; this.y = 0; this.k = 1;
      this.min = 0.06; this.max = 3;
    }
    // Pointermove can outrun the display (coalesced trackpad events, 120Hz), so writing
    // the transform per event did the work several times per frame for nothing. Collapse
    // every change into one write on the next frame.
    apply(animate) {
      // An animated commit must also drop any frame already queued, or that frame lands
      // mid-transition and strips the .animate class the tween depends on.
      if (this.#raf) { cancelAnimationFrame(this.#raf); this.#raf = 0; }
      if (animate) { this.#commit(true); return; }
      this.#raf = requestAnimationFrame(() => { this.#raf = 0; this.#commit(false); });
    }
    #raf = 0;
    #commit(animate) {
      this.world.classList.toggle('animate', !!animate);
      this.world.style.transform = `translate(${this.x}px,${this.y}px) scale(${this.k})`;
      this.onChange?.();
    }
    zoomAt(px, py, factor, animate) {
      const k = clamp(this.k * factor, this.min, this.max);
      const r = k / this.k;
      this.x = px - (px - this.x) * r;
      this.y = py - (py - this.y) * r;
      this.k = k;
      this.apply(animate);
    }
    fitTo(box, pad = 90, animate = true) {
      const W = this.stage.clientWidth, H = this.stage.clientHeight;
      const k = clamp(Math.min((W - pad * 2) / box.w, (H - pad * 2 - 40) / box.h), this.min, this.max);
      this.k = k;
      this.x = (W - box.w * k) / 2 - box.x * k;
      this.y = (H - box.h * k) / 2 - box.y * k + 20;
      this.apply(animate);
    }
    toWorld(cx, cy) {
      const r = this.stage.getBoundingClientRect();
      return { x: (cx - r.left - this.x) / this.k, y: (cy - r.top - this.y) / this.k };
    }
  }

  /* ─────────────────────────  geometry  ───────────────────────── */

  const center = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

  // Point where the ray from `box` centre toward `to` leaves the box, inset slightly.
  function border(box, to, inset = 3) {
    const c = center(box);
    let dx = to.x - c.x, dy = to.y - c.y;
    if (!dx && !dy) return { p: c, n: { x: 0, y: 1 } };
    const hw = box.w / 2 + inset, hh = box.h / 2 + inset;
    const sx = dx ? hw / Math.abs(dx) : Infinity;
    const sy = dy ? hh / Math.abs(dy) : Infinity;
    const s = Math.min(sx, sy);
    const n = sx < sy ? { x: Math.sign(dx), y: 0 } : { x: 0, y: Math.sign(dy) };
    return { p: { x: c.x + dx * s, y: c.y + dy * s }, n };
  }

  function wirePath(a, b) {
    const A = border(a, center(b)), B = border(b, center(a));
    const d = Math.hypot(B.p.x - A.p.x, B.p.y - A.p.y);
    const t = clamp(d * 0.38, 26, 190);
    const c1 = { x: A.p.x + A.n.x * t, y: A.p.y + A.n.y * t };
    const c2 = { x: B.p.x + B.n.x * t, y: B.p.y + B.n.y * t };
    return {
      d: `M${A.p.x} ${A.p.y}C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${B.p.x} ${B.p.y}`,
      a: A, b: B,
      mid: { x: (A.p.x + B.p.x) / 2 + (c1.x + c2.x - A.p.x - B.p.x) * .25,
             y: (A.p.y + B.p.y) / 2 + (c1.y + c2.y - A.p.y - B.p.y) * .25 },
    };
  }

  /* UML line ends, drawn the way the notation actually specifies:
   *
   *   generalization (extends)    solid line   ─────▷   hollow closed triangle
   *   realization (implements)    dashed line  ┄┄┄┄▷   hollow closed triangle
   *   composition (owns)          solid line   ─────◆   filled diamond
   *   aggregation (has)           solid line   ─────◇   hollow diamond
   *   dependency (uses)           dashed line  ┄┄┄┄>   open arrow, two strokes, no fill
   *   association                 solid line            no head
   *
   * The two that matter most are the ones that used to be identical: a *closed* head is a
   * type relationship, an *open* head is just usage. Filled vs hollow then separates
   * "owns the lifetime" from "merely holds", and a hollow triangle is never filled in —
   * a filled triangle means nothing in UML.
   */
  const REL = {
    extension:   { head: 'triangle', fill: 'hollow', dash: false, label: 'extends' },
    realization: { head: 'triangle', fill: 'hollow', dash: true,  label: 'implements' },
    composition: { head: 'diamond',  fill: 'solid',  dash: false, label: 'owns' },
    aggregation: { head: 'diamond',  fill: 'hollow', dash: false, label: 'has' },
    dependency:  { head: 'open',     fill: 'none',   dash: true,  label: 'uses' },
    association: { head: 'none',     fill: 'none',   dash: false, label: 'refers to' },
  };

  // PlantUML cannot express the extends/implements split in data-link-type, so recover it
  // from whether it drew the line dashed.
  const relKind = (e) => (e.type === 'extension' && e.dashed ? 'realization' : e.type);

  // Heads point *into* the decorated box, i.e. along -normal.
  function capFor(kind, at) {
    const spec = REL[kind] || REL.association;
    if (spec.head === 'none') return null;
    const { p, n } = at;
    const ax = -n.x, ay = -n.y;           // axis: away from the box
    const px = -ay, py = ax;              // perpendicular
    const P = (f, s) => `${p.x + ax * f + px * s},${p.y + ay * f + py * s}`;

    if (spec.head === 'triangle') {
      return svg('polygon', { class: `cap hollow ${kind}`, points: [P(0, 0), P(15, 8), P(15, -8)].join(' ') });
    }
    if (spec.head === 'diamond') {
      return svg('polygon', {
        class: `cap ${spec.fill === 'hollow' ? 'hollow' : ''} ${kind}`,
        points: [P(0, 0), P(9, 6), P(18, 0), P(9, -6)].join(' '),
      });
    }
    // open arrow: a bare V, never closed and never filled
    return svg('polyline', { class: `cap open ${kind}`, points: [P(12, 7), P(0, 0), P(12, -7)].join(' ') });
  }

  /* ─────────────────────────  runtime  ───────────────────────── */

  function mount(graph, opts = {}) {
    const root = opts.root || document.body;
    root.innerHTML = '';

    const stage = el('div'); stage.id = 'stage';
    const world = el('div'); world.id = 'world';
    const wires = svg('svg', { id: 'wires' });
    world.append(wires);
    stage.append(world);
    root.append(stage);

    const N = new Map();          // id -> node/note record
    const C = new Map();          // id -> cluster record
    const cards = new Map();      // id -> HTMLElement
    const groups = new Map();     // id -> HTMLElement
    const adj = new Map();        // id -> Set(neighbour ids)

    const MAX_W = Number(opts.maxWidth ?? 340);
    // "At least two standard widths apart" — the gap a focused group opens between cards.
    const SPREAD_X = Math.round(MAX_W * Number(opts.spread ?? 2));
    const SPREAD_Y = Math.round(MAX_W * Number(opts.spread ?? 2) * 0.42);

    // What the diagram looked like when it opened. Reset returns to exactly this, so "reset" means
    // one thing however far things have wandered.
    const INITIAL_LEVEL = opts.level ?? (graph.nodes.length > 14 ? 0 : 1);
    const INITIAL_COMPACT = opts.compact !== false;

    const state = {
      // Big diagrams open as titles-only: the shape reads at a glance, detail on demand.
      level: INITIAL_LEVEL,
      // A hand-authored graph has no real geometry to compact — only declaration order.
      // Packing still runs; the scale-down step is what gets skipped.
      autoLayout: graph.layout === 'auto',
      compact: INITIAL_COMPACT,
      focusGroup: null,      // isolate one group and spread its contents out
      showNotes: true,
      focus: null,
      // Selection and focus are different jobs: selecting EMPHASISES (its relations get bold and
      // rise above the rest), focusing ISOLATES (everything else dims). Sharing one field made
      // clicking a card either do nothing visible or dim half the diagram.
      selected: null,
      query: '',
      kinds: new Set(['interface', 'class', 'abstract', 'enum', 'struct']),
      collapsed: new Set(),
      // Domains drawn as empty boxes: the box and every wire into it stay, the text goes.
      muted: new Set(),
      // Deletion is SOFT. A removed card stays in the graph, flagged, so Reset can bring it
      // back — a destructive delete would make "reset" a promise the runtime cannot keep.
      deleted: new Set(),
      hits: new Set(),
    };

    for (const n of graph.nodes) N.set(n.id, { ...n, x0: n.x, y0: n.y });
    for (const n of graph.notes) N.set(n.id, { ...n, kind: 'note', x0: n.x, y0: n.y });
    for (const c of graph.clusters) C.set(c.id, { ...c, x0: c.x, y0: c.y, kids: [], subs: [] });
    for (const c of C.values()) if (c.parent && C.has(c.parent)) C.get(c.parent).subs.push(c.id);
    for (const n of N.values()) if (n.cluster && C.has(n.cluster)) C.get(n.cluster).kids.push(n.id);

    const edges = graph.edges.filter((e) => N.has(e.from) && N.has(e.to));
    for (const e of edges) {
      if (!adj.has(e.from)) adj.set(e.from, new Set());
      if (!adj.has(e.to)) adj.set(e.to, new Set());
      adj.get(e.from).add(e.to);
      adj.get(e.to).add(e.from);
    }

    // A note's tether is a link like any other. `adj` is left as pure relations because the isolate
    // is about type structure; this one includes notes, so selecting a note lights its host, and
    // selecting a type lights the notes hanging off it. Without it a note could be selected and
    // nothing at all would respond — and the tether is the faintest line on the page.
    const linkAdj = new Map();
    const linkAdd = (a, b) => {
      if (!linkAdj.has(a)) linkAdj.set(a, new Set());
      linkAdj.get(a).add(b);
    };
    for (const e of edges) { linkAdd(e.from, e.to); linkAdd(e.to, e.from); }
    for (const n of N.values()) {
      if (n.kind === 'note' && n.attachedTo && N.has(n.attachedTo)) {
        linkAdd(n.id, n.attachedTo); linkAdd(n.attachedTo, n.id);
      }
    }
    const linksOf = (id) => linkAdj.get(id) || new Set();

    /* ── cards ───────────────────────────────────────────────── */

    const visRow = (v) => {
      if (!v) return '';
      const c = v.startsWith('PRIVATE') ? 'priv' : v.startsWith('PROTECTED') ? 'prot' : 'pub';
      const m = v.includes('METHOD') ? ' method filled' : '';
      return `<span class="dot ${c}${m}"></span>`;
    };

    const rich = (s) =>
      esc(s)
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/`(.+?)`/g, '<code>$1</code>');

    function buildCard(n) {
      const card = el('div', `card lvl-${state.level}${n.kind === 'note' ? ' note' : ''}`);
      card.dataset.id = n.id;
      card.dataset.kind = n.kind;
      card.style.left = `${n.x}px`;
      card.style.top = `${n.y}px`;
      // PlantUML sized the box for text alone; our header also carries a badge, a
      // stereotype chip and two buttons, so budget for that or long names ellipsize.
      // The upper cap is deliberately well below PlantUML's widest box: only the title
      // shows when folded, and letting member text wrap when opened buys back a lot of
      // horizontal density now that width is the same at every level.
      card.style.setProperty('--w', `${clamp(n.w + 78, 215, MAX_W)}px`);

      const head = el('div', 'card-head');
      head.append(el('div', 'badge', KIND_LETTER[n.kind] || 'C'));
      const title = el('div', 'card-title');
      title.textContent = n.name;
      title.title = n.qname || n.name;
      head.append(title);
      if (n.stereotype) {
        const st = el('span', 'stereo');
        st.textContent = n.stereotype;
        head.append(st);
      }

      const tools = el('div', 'card-tools');
      const bFocus = el('button', 'tool', ICON.focus);
      bFocus.title = 'Isolate this card and its neighbours';
      bFocus.onclick = (ev) => { ev.stopPropagation(); setFocus(state.focus === n.id ? null : n.id); };
      const bCollapse = el('button', 'tool', ICON.caret);
      bCollapse.title = 'Show everything in this card / put it back';
      bCollapse.onclick = (ev) => { ev.stopPropagation(); cycleCard(card); };
      const bDelete = el('button', 'tool danger', ICON.trash);
      bDelete.title = 'Delete this and every relation touching it (R brings it back)';
      bDelete.onclick = (ev) => { ev.stopPropagation(); deleteCard(n.id); };
      tools.append(bFocus, bCollapse, bDelete);
      head.append(tools);
      card.append(head);

      if (n.kind === 'note') {
        const body = el('div', 'card-body');
        const rows = el('div', 'rows');
        const note = el('div', 'note-body');
        for (const line of n.body || []) {
          if (/^-{3,}$/.test(line.trim())) { note.append(el('p', 'rule')); continue; }
          note.append(el('p', null, rich(line)));
        }
        rows.append(note);
        body.append(rows);
        card.append(body);
      } else {
        const body = el('div', 'card-body');
        const rows = el('div', 'rows');
        for (const r of n.rows || []) {
          if (r.kind === 'lede') {
            rows.append(el('div', 'lede', rich(r.text)));
            continue;
          }
          const row = el('div', `row row-${r.kind}`);
          const main = el('div', 'row-main', `${visRow(r.vis)}<span class="sig">${rich(r.text)}</span>`);
          row.append(main);
          if (r.explain?.length) {
            const ex = el('div', 'explain');
            const inner = el('div');
            for (const p of r.explain) inner.append(el('p', null, rich(p)));
            ex.append(inner);
            row.append(ex);

            // ONE comment, on its own. The detail level is a whole-card switch, which is the wrong
            // instrument when a reader wants the note on a single member and nothing else — and
            // going to level 3 to read one line opens every comment in the diagram at once.
            // `open` and `shut` are separate classes rather than one toggle because the row has to
            // be able to disagree with the card in BOTH directions.
            const bump = el('button', 'row-note', ICON.comment);
            bump.title = 'Show the comment on this member / hide it again';
            bump.onclick = (ev) => {
              ev.stopPropagation();
              const showing = row.classList.contains('open') ||
                (!row.classList.contains('shut') && card.classList.contains('lvl-2'));
              row.classList.toggle('open', !showing);
              row.classList.toggle('shut', showing);
              bump.classList.toggle('on', !showing);
              schedule(false, true);
              relayoutWhenSettled({ seeds: [n.id] });
            };
            main.append(bump);
          }
          rows.append(row);
        }
        const kids = [...N.values()].filter((m) => m.kind === 'note' && m.attachedTo === n.id);
        for (const k of kids) {
          const tab = el('div', 'card-note-tab', `${ICON.note}<span>${esc(k.name)}</span>`);
          tab.onclick = (ev) => { ev.stopPropagation(); flyTo(k.id); };
          rows.append(tab);
        }
        body.append(rows);
        card.append(body);
      }

      card.addEventListener('pointerdown', (ev) => startDragCard(ev, card, n));
      card.addEventListener('click', (ev) => { ev.stopPropagation(); select(n.id); });
      return card;
    }

    function buildGroup(c) {
      const depth = (function d(x) { return x.parent ? 1 + d(C.get(x.parent)) : 0; })(c);
      const g = el('div', `group depth-${Math.min(depth, 2)}`);
      g.dataset.id = c.id;
      g.style.zIndex = String(depth);
      const count = countKids(c.id);
      const tab = el('div', 'group-tab',
        `${ICON.caret}<span>${esc(c.label)}</span><span class="group-count">${count}</span>`);
      tab.onclick = (ev) => { ev.stopPropagation(); toggleGroup(c.id); };

      // Sits next to the group name: takes every card inside straight to fully expanded,
      // or all the way back to titles. The per-card caret cycles one step at a time, which
      // is the wrong tool when you want to read a whole subsystem at once.
      const bAll = el('button', 'tab-btn', ICON.unfold);
      bAll.onclick = (ev) => { ev.stopPropagation(); toggleGroupDetail(c.id); };
      tab.append(bAll);
      g._allBtn = bAll;

      // Isolate this group and give its contents room to breathe. In the packed layout the
      // wires run so close together they are impossible to trace; hiding everything else
      // and spreading what remains is what actually makes the relations readable.
      const bFocus = el('button', 'tab-btn', ICON.focus);
      bFocus.title = `Focus ${c.label} — hide the rest and spread it out`;
      bFocus.onclick = (ev) => { ev.stopPropagation(); toggleGroupFocus(c.id); };
      tab.append(bFocus);
      g._focusBtn = bFocus;

      g.append(tab);
      return g;
    }

    const countKids = (id) => {
      const c = C.get(id);
      return c.kids.length + c.subs.reduce((s, k) => s + countKids(k), 0);
    };

    for (const c of C.values()) { const g = buildGroup(c); groups.set(c.id, g); world.append(g); }
    for (const n of N.values()) { const card = buildCard(n); cards.set(n.id, card); world.append(card); }

    /* ── collapse / visibility ───────────────────────────────── */

    // The visible stand-in for a card: itself, or the outermost collapsed ancestor group.
    function host(id) {
      const n = N.get(id);
      let cur = n.cluster ? C.get(n.cluster) : null, top = null;
      while (cur) {
        if (state.collapsed.has(cur.id)) top = cur;
        cur = cur.parent ? C.get(cur.parent) : null;
      }
      return top ? top.id : id;
    }
    const isHidden = (id) => host(id) !== id;

    function toggleGroup(id) {
      if (state.collapsed.has(id)) state.collapsed.delete(id); else state.collapsed.add(id);
      applyVisibility();
      schedule(true);
    }

    // Card heights animate, so geometry read during a level change is mid-transition and
    // packing against it leaves cards overlapping once they finish growing. Rather than
    // guess the animation's duration, this is debounced off the ResizeObserver: every frame
    // of the transition pushes the deadline out, and the real layout runs once the cards
    // have actually stopped changing size.
    // Card heights animate, so geometry read during a level change is mid-transition and
    // settling against it leaves cards overlapping once they finish growing. This is
    // debounced off the ResizeObserver rather than a guessed animation duration: every
    // frame of the transition pushes the deadline out, and the settle runs once sizes stop.
    //
    // `full` means repack from scratch (mount, global detail change, spacing toggle);
    // otherwise the settle is local and only what actually collides is allowed to move.
    let settleTimer = 0, settleAfter = null, settleFull = false;
    const settleSeeds = new Set();

    function relayoutWhenSettled({ seeds, full, after } = {}) {
      // All three have to survive rescheduling. The ResizeObserver calls this on every
      // frame of the expand transition with no arguments, so replacing state each time
      // threw away the anchor — and would now throw away the seeds too.
      if (after) settleAfter = after;
      if (full) settleFull = true;
      if (seeds) for (const s of seeds) settleSeeds.add(s);
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        const done = settleAfter, isFull = settleFull, seedList = [...settleSeeds];
        settleAfter = null; settleFull = false; settleSeeds.clear();
        if (isFull) layoutNow(true); else settleLocal();
        void seedList;
        done?.();
      }, 180);
    }

    // Expanding a group repacks the whole diagram, which slides the frame — and the button
    // you just pressed — out from under the pointer. Pin the group's top-left to the screen
    // position it had before, so the control stays put and you can click it again.
    function anchorTo(cid) {
      const b = boxes.get(cid);
      if (!b) return null;
      const screen = { x: b.x * cam.k + cam.x, y: b.y * cam.k + cam.y };
      return () => {
        const now = boxes.get(cid);
        if (!now) return;
        cam.x = screen.x - now.x * cam.k;
        cam.y = screen.y - now.y * cam.k;
        cam.apply(true);
      };
    }

    // Every card in the group and in any group nested inside it.
    const groupCards = (cid) => descendants(cid).map((id) => cards.get(id)).filter(Boolean);

    // A focused group shows its own cards plus any note pinned to one of them — a note is
    // an explanation of the thing you are focusing on, not unrelated scenery.
    let focusMembers = null;
    function computeFocusMembers() {
      if (!state.focusGroup) { focusMembers = null; return; }
      const own = new Set(descendants(state.focusGroup));
      for (const n of N.values()) if (n.kind === 'note' && own.has(n.attachedTo)) own.add(n.id);
      focusMembers = own;
    }
    const inFocusGroup = (cid) => {
      let cur = C.get(cid);
      while (cur) { if (cur.id === state.focusGroup) return true; cur = cur.parent ? C.get(cur.parent) : null; }
      return false;
    };

    function toggleGroupFocus(cid) {
      const leaving = state.focusGroup === cid;
      state.focusGroup = leaving ? null : cid;
      computeFocusMembers();
      setFocus(null);
      applyVisibility();
      refreshFocusButtons();
      layoutNow(true);
      // Fit everything still visible, not just the group's own frame: focus keeps the notes
      // pinned to these cards, and those live outside the frame — framing the frame alone
      // left them hanging off the bottom of the screen.
      cam.fitTo(contentBox());
      toastMsg(leaving ? 'Focus cleared' : `Focused ${C.get(cid).label} — Esc to exit`);
    }

    function refreshFocusButtons() {
      for (const [id, g] of groups) g._focusBtn?.classList.toggle('on', state.focusGroup === id);
      for (const [cid, row] of domRows) row.classList.toggle('on', state.focusGroup === cid);
      $('#topbar')?.classList.toggle('focused', !!state.focusGroup);
    }

    function toggleGroupDetail(cid) {
      const list = groupCards(cid);
      if (!list.length) return;
      // Expanding a collapsed group has to reveal it first, or nothing visible changes.
      if (state.collapsed.has(cid)) { state.collapsed.delete(cid); applyVisibility(); }
      const allFull = list.every((c) => c.classList.contains('lvl-2'));
      const lvl = allFull ? 0 : 2;
      const hold = anchorTo(cid);
      for (const c of list) c.className = c.className.replace(/lvl-\d/, `lvl-${lvl}`);
      refreshGroupButtons();
      schedule(false, true);
      relayoutWhenSettled({ seeds: list.map((c) => c.dataset.id), after: hold });
      toastMsg(`${C.get(cid).label} — ${allFull ? 'collapsed' : 'expanded'}`);
    }

    function refreshAllButton() {
      const btn = $('#btn-all');
      if (!btn) return;
      const all = [...cards.values()];
      const full = all.length > 0 && all.every((c) => c.classList.contains('lvl-2'));
      btn.innerHTML = `${full ? ICON.fold : ICON.unfold}<span>${full ? 'Collapse all' : 'Expand all'}</span>`;
    }

    function refreshGroupButtons() {
      for (const [id, g] of groups) {
        if (!g._allBtn) continue;
        const list = groupCards(id);
        const full = list.length > 0 && list.every((c) => c.classList.contains('lvl-2'));
        g._allBtn.innerHTML = full ? ICON.fold : ICON.unfold;
        g._allBtn.title = full
          ? `Collapse every card in ${C.get(id).label} back to titles`
          : `Expand every card in ${C.get(id).label} in full`;
      }
      refreshAllButton();
    }

    /**
     * Delete a card and everything that pointed at it.
     *
     * Soft by design: the id goes into `state.deleted`, which hides the card, drops every relation
     * with it at either end, and cuts the tethers of any note pinned to it. Reset clears the set,
     * so this is always recoverable — which is the only reason it is safe to put a delete button
     * on a card at all.
     */
    function deleteCard(id) {
      const n = N.get(id);
      if (!n || state.deleted.has(id)) return;
      const rel = edges.filter((e) => e.from === id || e.to === id).length;
      const notes = [...N.values()].filter((m) => m.kind === 'note' && m.attachedTo === id).length;

      state.deleted.add(id);
      if (state.focus === id) setFocus(null);
      closeInspector();
      applyVisibility();
      refreshGroupButtons();
      layoutNow(true);
      toastMsg(`Deleted ${n.name}` +
        (rel ? ` · ${rel} relation${rel > 1 ? 's' : ''} with it` : '') +
        (notes ? ` · ${notes} note${notes > 1 ? 's' : ''} detached` : '') +
        ' — R to bring it back');
    }

    function cycleCard(card) {
      // One press shows the whole card, one press puts it back. It used to step
      // 0 → 1 → 2, which meant pressing twice to actually read anything.
      // "Back" means the level the rest of the diagram is on, so a card returns to
      // matching its neighbours rather than always slamming shut.
      const cur = card.classList.contains('lvl-0') ? 0 : card.classList.contains('lvl-1') ? 1 : 2;
      const lvl = cur === 2 ? (state.level === 2 ? 0 : state.level) : 2;
      card.className = card.className.replace(/lvl-\d/, `lvl-${lvl}`);
      refreshGroupButtons();
      schedule(false, true);
      relayoutWhenSettled({ seeds: [card.dataset.id] });
    }

    function setLevel(l) {
      state.level = l;
      for (const c of cards.values()) c.className = c.className.replace(/lvl-\d/, `lvl-${l}`);
      refreshAllButton();
      refreshGroupButtons();
      schedule(true);
      relayoutWhenSettled({ full: true });
    }

    function applyVisibility() {
      for (const [id, card] of cards) {
        const n = N.get(id);
        const hiddenByGroup = isHidden(id);
        const hiddenByKind = n.kind === 'note' ? !state.showNotes : !state.kinds.has(n.kind);
        const outOfFocus = focusMembers ? !focusMembers.has(id) : false;
        const gone = state.deleted.has(id);
        const off = gone || hiddenByGroup || hiddenByKind || outOfFocus;
        card.style.display = off ? 'none' : '';
        // An emptied card is still a card: it holds its place in the layout and its wires still
        // land on it. The name moves to the tooltip, and the inspector still reads it in full.
        const ghost = !off && isMuted(id);
        card.classList.toggle('ghost', ghost);
        if (ghost) card.title = n.qname || n.name; else card.removeAttribute('title');
      }
      for (const [id, g] of groups) {
        const collapsed = state.collapsed.has(id);
        g.classList.toggle('collapsed', collapsed);
        const outOfFocus = state.focusGroup && !inFocusGroup(id);
        g.style.display = isHiddenGroup(id) || outOfFocus ? 'none' : '';
      }
      $('#btn-notes')?.classList.toggle('off', !state.showNotes);
    }
    function isHiddenGroup(id) {
      let cur = C.get(id).parent ? C.get(C.get(id).parent) : null;
      while (cur) { if (state.collapsed.has(cur.id)) return true; cur = cur.parent ? C.get(cur.parent) : null; }
      return false;
    }

    /* ── layout: measure, de-overlap, fit groups ─────────────── */

    const boxes = new Map();   // id -> {x,y,w,h} in world space (cards and collapsed groups)

    function measure() {
      boxes.clear();
      for (const [id, card] of cards) {
        if (card.style.display === 'none') continue;
        const n = N.get(id);
        boxes.set(id, { x: n.x, y: n.y, w: card.offsetWidth, h: card.offsetHeight });
      }
    }

    // PlantUML sized every box for its *fully expanded* text. Our cards are far smaller,
    // especially with prose folded away, so the source coordinates leave the diagram
    // swimming in dead space. Squeeze the whole coordinate field by how much smaller the
    // cards actually are — PlantUML's layering and edge-crossing work is preserved, only
    // the air is removed. Recomputed from the pristine coordinates on every detail change,
    // so expanding a level makes the diagram breathe out instead of drifting.
    function compact() {
      const live = [...cards].filter(([, c]) => c.style.display !== 'none');
      if (!live.length) return;
      const rx = [], ry = [];
      for (const [id, card] of live) {
        const n = N.get(id);
        if (n.w > 0) rx.push(card.offsetWidth / n.w);
        if (n.h > 0) ry.push(card.offsetHeight / n.h);
      }
      const pick = (arr, q) => arr.sort((a, b) => a - b)[Math.floor((arr.length - 1) * q)] || 1;
      // The widest card sets the horizontal floor so scaling can never cause a collision;
      // vertically the median is enough, since relax() sweeps up whatever still touches.
      const kx = clamp(pick(rx, 1), 0.22, 1);
      const ky = clamp(pick(ry, 0.5) * 1.05, 0.18, 1);
      for (const n of N.values()) {
        if (n.pinned) continue;
        n.x = n.x0 * kx;
        n.y = n.y0 * ky;
        const card = cards.get(n.id);
        card.style.left = `${n.x}px`;
        card.style.top = `${n.y}px`;
      }
    }


    /* Hierarchical packing.
     *
     * A single global sweep would happily slide a card left until it landed in the middle
     * of a neighbouring group — grouping is the one thing the source diagram gets right and
     * the one thing we must not lose. So pack bottom-up: settle each group's own contents
     * first, then treat that whole group as one rigid unit among its siblings. Cards move
     * only within their own frame; frames move only among their peers.
     *
     * Within a level the rule is order-preserving left-packing: sorted by position, each
     * unit slides back until it touches the nearest already-placed unit that overlaps it on
     * the other axis. Reading order survives, overlaps are impossible by construction. */

    const descendants = (cid, out = []) => {
      const c = C.get(cid);
      out.push(...c.kids);
      for (const s of c.subs) descendants(s, out);
      return out;
    };

    const unitBox = (u) => boxes.get(u.id);

    // Headroom reserved under a unit so that opening it lands in space that is already
    // empty. Only ONE step of growth is reserved, not the fully-expanded height: budgeting
    // for everything at once tripled the folded diagram's height and made it unreadable at
    // fit-zoom. Tightly capped — past the cap a card is simply expected to push.
    const ROW_PX = 20, EXPLAIN_PX = 18;
    const SLACK_CAP = Number(opts.slack ?? 46);
    function slackOf(u) {
      if (u.type === 'c') {
        const c = C.get(u.id);
        return c.kids.reduce((m, k) => Math.max(m, slackOf({ type: 'n', id: k })), 0);
      }
      const n = N.get(u.id);
      if (!n || state.level >= 2) return 0;
      const explains = (n.rows || []).reduce((t, r) => t + (r.explain?.length || 0), 0);
      const grow = n.kind === 'note'
        ? (state.level === 0 ? (n.body?.length || 0) * EXPLAIN_PX : 0)
        : (state.level === 0 ? (n.rows?.length || 0) * ROW_PX : explains * EXPLAIN_PX);
      return clamp(grow, 0, SLACK_CAP);
    }
    // Reading order comes from the *pristine* source coordinates, never the live ones —
    // otherwise each relayout would re-sort against its own last output and drift.
    const originOf = (u) => (u.type === 'n' ? N.get(u.id) : C.get(u.id)).x0 != null
      ? { x: (u.type === 'n' ? N.get(u.id) : C.get(u.id)).x0, y: (u.type === 'n' ? N.get(u.id) : C.get(u.id)).y0 }
      : { x: 0, y: 0 };

    function translate(u, dx, dy) {
      if (!dx && !dy) return;
      const ids = u.type === 'n' ? [u.id] : descendants(u.id);
      for (const id of ids) {
        const n = N.get(id), b = boxes.get(id);
        if (!n) continue;
        n.x += dx; n.y += dy;
        if (b) { b.x += dx; b.y += dy; }
      }
      const b = boxes.get(u.id);
      if (b && u.type === 'c') { b.x += dx; b.y += dy; }
      if (u.type === 'c') {
        const c = C.get(u.id);
        if (c.lastX != null) { c.lastX += dx; c.lastY += dy; }
      }
    }

    // Wrapped flow. Units keep the source diagram's reading order (its y is the rank it
    // solved for, its x the order within that rank), but rows wrap at a width chosen to
    // land near a screen aspect — so a 6000px strip becomes a block you can actually read
    // at fit-zoom. Rows are baseline-aligned and left-packed; nothing can overlap.
    function flow(items, gx, gy, aspect = 1.9) {
      const ordered = [...items].sort((p, q) => (p.oy - q.oy) || (p.ox - q.ox));
      // Reserve headroom under each row proportional to how far its cards can grow, so the
      // common case — opening one card by one level — lands in space that is already empty
      // and pushes nothing. Capped, or a card with twelve members would leave a crater.
      for (const it of ordered) it.slack = slackOf(it.u);
      const area = ordered.reduce((s, i) => s + (i.b.w + gx) * (i.b.h + i.slack + gy), 0);
      const widest = Math.max(...ordered.map((i) => i.b.w));
      const target = Math.max(widest, Math.sqrt(area * aspect));

      const x0 = Math.min(...ordered.map((i) => i.b.x));
      const y0 = Math.min(...ordered.map((i) => i.b.y));
      let x = x0, y = y0, rowH = 0, rowStart = 0;

      const rows = [[]];
      for (const it of ordered) {
        if (rows.at(-1).length && x - x0 + it.b.w > target) { rows.push([]); x = x0; }
        rows.at(-1).push(it);
        x += it.b.w + gx;
      }
      for (const row of rows) {
        x = x0;
        rowH = Math.max(...row.map((i) => i.b.h + (i.slack || 0)));
        for (const it of row) {
          translate(it.u, x - it.b.x, y - it.b.y);
          x += it.b.w + gx;
        }
        y += rowH + gy;
      }
      void rowStart;
    }

    function packTree(cid, gx, gy) {
      const kids = cid ? C.get(cid).kids : [...N.keys()].filter((id) => !N.get(id).cluster);
      const subs = cid
        ? C.get(cid).subs
        : [...C.values()].filter((c) => !c.parent).map((c) => c.id);

      // Gutters are absolute, not scaled by depth: a card needs the same breathing room
      // wherever it sits, and only frames need the wider aisle between them. Under focus
      // they open right up — two card-widths of clear space is enough for the wires
      // between two cards to separate instead of running as one thick smear.
      const [igx, igy] = state.focusGroup ? [SPREAD_X, SPREAD_Y] : [34, 26];
      for (const s of subs) if (!state.collapsed.has(s)) packTree(s, igx, igy);

      const units = [
        ...subs.filter((s) => boxes.has(s)).map((id) => ({ type: 'c', id })),
        ...kids.filter((k) => boxes.has(k)).map((id) => ({ type: 'n', id })),
      ];
      const items = units
        .map((u) => ({ u, b: unitBox(u), ox: originOf(u).x, oy: originOf(u).y }))
        .filter((i) => i.b);
      if (items.length >= 2) flow(items, gx, gy, cid ? 2.1 : 1.7);
      if (cid && !state.collapsed.has(cid)) refitBox(cid);
    }

    const GROUP_PAD = 30, GROUP_TOP = 26;

    // A frame is only as big as what it holds — recompute before the parent packs it,
    // or the parent would reserve space for a size the group no longer occupies.
    function refitBox(cid) {
      const c = C.get(cid);
      const kids = [...c.kids, ...c.subs].map((k) => boxes.get(k)).filter(Boolean);
      if (!kids.length) { boxes.delete(cid); return; }
      const slack = c.kids.reduce((m, k) => Math.max(m, slackOf({ type: 'n', id: k })), 0);
      const x = Math.min(...kids.map((b) => b.x)) - GROUP_PAD;
      const y = Math.min(...kids.map((b) => b.y)) - GROUP_TOP;
      boxes.set(cid, {
        x, y,
        w: Math.max(...kids.map((b) => b.x + b.w)) + GROUP_PAD - x,
        h: Math.max(...kids.map((b) => b.y + b.h)) + GROUP_PAD + slack - y,
      });
    }

    function flushPositions() {
      for (const [id, card] of cards) {
        const n = N.get(id);
        card.style.left = `${n.x}px`;
        card.style.top = `${n.y}px`;
      }
    }

    /* Local settle.
     *
     * Expanding a card used to trigger the same full repack as a fresh layout, so the whole
     * diagram resettled even when the card had empty space to grow into. Cards only ever
     * grow downward now (width is level-independent), so the correct response is a minimal
     * cascade: push down only what the growth actually collides with, and leave everything
     * else exactly where it is. If there is room below, nothing moves at all. */

    const PUSH_GAP = 18, X_SLACK = 10;

    // Every full repack records where each card belongs. The settle always starts from
    // there, which is what makes the whole thing reversible: a one-way "push down what I
    // collide with" cascade could open a card, but closing it again left the gaps behind
    // and the group frame stretched around nothing.
    function rememberHome() {
      for (const n of N.values()) { n.hx = n.x; n.hy = n.y; }
    }

    // Reset to home, then sweep top-to-bottom giving each card the highest position at or
    // below its home that clears everything already placed. Deterministic, so the same
    // detail state always produces the same layout; a card that fits at home does not move
    // at all, and shrinking a card hands its space straight back.
    function settleFromHome() {
      for (const n of N.values()) {
        if (n.pinned) continue;
        if (n.hx != null) { n.x = n.hx; n.y = n.hy; }
      }
      flushPositions();
      measure();

      const items = [...boxes.entries()]
        .filter(([id]) => !C.has(id))
        .map(([id, b]) => ({ id, b }))
        .sort((p, q) => (p.b.y - q.b.y) || (p.b.x - q.b.x));

      const placed = [];
      for (const it of items) {
        if (!N.get(it.id)?.pinned) {
          let y = it.b.y;
          for (const p of placed) {
            if (it.b.x + it.b.w + X_SLACK <= p.b.x || p.b.x + p.b.w + X_SLACK <= it.b.x) continue;
            y = Math.max(y, p.b.y + p.b.h + PUSH_GAP);
          }
          if (y !== it.b.y) { it.b.y = y; N.get(it.id).y = y; }
        }
        placed.push(it);
      }
      flushPositions();
      measure();
    }

    // A frame that grew can end up overlapping the sibling below it. Same minimal rule:
    // slide the lower sibling's whole contents down, never the one that grew.
    function separateGroups() {
      for (let pass = 0; pass < 6; pass++) {
        let moved = false;
        const parents = new Set([...C.values()].map((c) => c.parent));
        for (const parent of parents) {
          const sibs = [...C.values()]
            .filter((c) => c.parent === parent && boxes.has(c.id))
            .sort((p, q) => boxes.get(p.id).y - boxes.get(q.id).y);
          for (let i = 0; i < sibs.length; i++) {
            for (let j = i + 1; j < sibs.length; j++) {
              const a = boxes.get(sibs[i].id), b = boxes.get(sibs[j].id);
              if (a.x + a.w <= b.x || b.x + b.w <= a.x) continue;
              const dy = a.y + a.h + PUSH_GAP - b.y;
              if (dy <= 0) continue;
              translate({ type: 'c', id: sibs[j].id }, 0, dy);
              moved = true;
            }
          }
        }
        if (!moved) break;
        flushPositions();
        measure();
        fitGroups();
      }
    }

    function settleLocal() {
      settleFromHome();
      fitGroups();
      separateGroups();
      drawWires();
      sizeCanvas();
      buildMinimap();
    }

    function fitGroups() {
      const order = [...C.values()].sort((a, b) => depthOf(b) - depthOf(a));
      const PAD = GROUP_PAD, TOP = GROUP_TOP;
      for (const c of order) {
        const g = groups.get(c.id);
        if (g.style.display === 'none') continue;
        if (state.collapsed.has(c.id)) {
          const tab = g.firstElementChild;
          const px = c.lastX ?? c.x, py = c.lastY ?? c.y;
          g.style.left = `${px}px`; g.style.top = `${py}px`;
          g.style.width = `${Math.max(tab.offsetWidth + 36, 190)}px`;
          g.style.height = '58px';
          boxes.set(c.id, { x: px, y: py, w: g.offsetWidth, h: 58 });
          continue;
        }
        const kids = [
          ...c.kids.map((k) => boxes.get(k)).filter(Boolean),
          ...c.subs.map((s) => boxes.get(s)).filter(Boolean),
        ];
        if (!kids.length) { g.style.display = 'none'; continue; }
        const x = Math.min(...kids.map((b) => b.x)) - PAD;
        const y = Math.min(...kids.map((b) => b.y)) - TOP;
        const w = Math.max(...kids.map((b) => b.x + b.w)) + PAD - x;
        const h = Math.max(...kids.map((b) => b.y + b.h)) + PAD - y;
        Object.assign(g.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
        boxes.set(c.id, { x, y, w, h });
        c.lastX = x; c.lastY = y;
      }
    }
    const depthOf = (c) => (c.parent ? 1 + depthOf(C.get(c.parent)) : 0);

    /* ── wires ───────────────────────────────────────────────── */

    let wireEls = [];
    function drawWires() {
      wires.textContent = '';
      wireEls = [];

      // note tethers first, so they sit under the real relations
      for (const n of N.values()) {
        if (n.kind !== 'note' || !n.attachedTo) continue;
        if (state.deleted.has(n.id) || state.deleted.has(n.attachedTo)) continue;
        const a = boxes.get(host(n.id)), b = boxes.get(host(n.attachedTo));
        if (!a || !b || host(n.id) === host(n.attachedTo)) continue;
        const p = wirePath(a, b);
        const path = svg('path', { class: 'tether', d: p.d });
        wires.append(path);
        wireEls.push({ e: { from: n.id, to: n.attachedTo, type: 'note' }, path, caps: [], label: null });
      }

      for (const e of edges) {
        // A relation cannot outlive either of its ends.
        if (state.deleted.has(e.from) || state.deleted.has(e.to)) continue;
        const ha = host(e.from), hb = host(e.to);
        if (ha === hb) continue;
        const a = boxes.get(ha), b = boxes.get(hb);
        if (!a || !b) continue;
        const kind = relKind(e);
        const p = wirePath(a, b);
        const path = svg('path', { class: `wire ${kind}`, d: p.d });
        const hit = svg('path', { class: 'wire-hit', d: p.d });
        const at = CAP_AT_SOURCE.has(e.type) ? p.a : p.b;
        const cap = capFor(kind, at);
        const label = svg('text', { class: 'wire-label', x: p.mid.x, y: p.mid.y, 'text-anchor': 'middle' });
        label.textContent = (REL[kind] || {}).label || kind;
        wires.append(path, label, hit);
        if (cap) wires.append(cap);
        const rec = { e, path, caps: cap ? [cap] : [], label };
        hit.addEventListener('pointerenter', () => hoverWire(rec, true));
        hit.addEventListener('pointerleave', () => hoverWire(rec, false));
        wireEls.push(rec);
      }
      paintEmphasis();
    }

    function hoverWire(rec, on) {
      rec.path.classList.toggle('hot', on);
      rec.caps.forEach((c) => c.classList.toggle('hot', on));
      rec.label?.classList.toggle('show', on);
      cards.get(rec.e.from)?.classList.toggle('selected', on && !isHidden(rec.e.from));
      cards.get(rec.e.to)?.classList.toggle('selected', on && !isHidden(rec.e.to));
    }

    /* ── emphasis: focus + search ────────────────────────────── */

    function paintEmphasis() {
      const f = state.focus;
      const sel = state.selected;
      const near = f ? new Set([f, ...(adj.get(f) || [])]) : null;
      if (f) for (const n of N.values()) if (n.kind === 'note' && n.attachedTo === f) near.add(n.id);

      // Two rings of emphasis, and no third. One ring answers "what does this touch"; two answers
      // "what does that reach in turn", which is usually the question behind the first. Three rings
      // on a connected diagram is just the whole diagram again, so the walk stops here.
      const ring1 = new Set(), ring2 = new Set();
      if (sel) {
        for (const id of linksOf(sel)) ring1.add(id);
        ring1.delete(sel);
        for (const a of ring1) for (const b of linksOf(a)) if (b !== sel && !ring1.has(b)) ring2.add(b);
        ring2.delete(sel);
      }

      for (const [id, card] of cards) {
        const dim = (near && !near.has(id)) || (state.query && !state.hits.has(id));
        card.classList.toggle('dimmed', !!dim);
        card.classList.toggle('hit', state.query ? state.hits.has(id) : false);
        card.classList.toggle('selected', id === sel || id === f);
        // The things on the other end of a bold wire deserve to be findable too — strongly for the
        // first ring, faintly for the second.
        card.classList.toggle('linked', !!sel && id !== sel && ring1.has(id));
        card.classList.toggle('linked2', !!sel && id !== sel && !ring1.has(id) && ring2.has(id));
      }

      const rise1 = [], rise2 = [];
      for (const rec of wireEls) {
        const { from, to } = rec.e;
        const shown = !near || (near.has(from) && near.has(to));
        const live = !!sel && (from === sel || to === sel);
        // Second ring: anything hanging off a first-ring node, including first-ring to first-ring.
        const live2 = !live && !!sel && (ring1.has(from) || ring1.has(to));
        rec.path.classList.toggle('faded', !shown);
        rec.path.classList.toggle('live', live);
        rec.path.classList.toggle('live2', live2);
        rec.caps.forEach((c) => {
          c.classList.toggle('faded', !shown);
          c.classList.toggle('live', live);
          c.classList.toggle('live2', live2);
        });
        // Only the first ring is named. Labelling both rings puts more text on screen than wire.
        rec.label?.classList.toggle('show', live);
        if (live) rise1.push(rec); else if (live2) rise2.push(rec);
      }
      // Second ring above the pale wires, first ring above everything.
      for (const rec of [...rise2, ...rise1]) {
        wires.appendChild(rec.path);
        rec.caps.forEach((c) => wires.appendChild(c));
        if (rec.label) wires.appendChild(rec.label);
      }
      buildMinimap();
    }

    function setFocus(id) {
      state.focus = id;
      if (id) state.selected = id;

      paintEmphasis();
      if (id) openInspector(id); else closeInspector();
    }

    function select(id) {
      if (state.focus && state.focus !== id) { setFocus(id); return; }
      // Clicking the same card again clears it, so there is always a way back to the plain view.
      state.selected = state.selected === id ? null : id;
      if (state.selected) openInspector(id); else closeInspector();
      paintEmphasis();
    }

    function search(q) {
      state.query = q.trim().toLowerCase();
      state.hits.clear();
      if (state.query) {
        for (const n of N.values()) {
          const hay = [n.name, ...(n.rows || []).flatMap((r) => [r.text, ...r.explain]), ...(n.body || [])]
            .join(' ').toLowerCase();
          if (hay.includes(state.query)) state.hits.add(n.id);
        }
      }
      $('#hitcount').textContent = state.query ? `${state.hits.size}` : '';
      paintEmphasis();
    }

    /* ── inspector ───────────────────────────────────────────── */

    function openInspector(id) {
      const n = N.get(id);
      const box = $('#inspector');
      const rel = edges
        .filter((e) => e.from === id || e.to === id)
        .map((e) => {
          const other = e.from === id ? e.to : e.from;
          return { id: other, name: N.get(other)?.name || other, type: e.type, dir: e.from === id ? '→' : '←' };
        });
      const notes = [...N.values()].filter((m) => m.kind === 'note' && m.attachedTo === id);
      box.innerHTML =
        `<button class="iconbtn close">${ICON.close}</button>` +
        `<h3>${esc(n.name)}</h3>` +
        `<div class="path">${esc(KIND_LABEL[n.kind] || n.kind)}${n.cluster ? ' · ' + esc(C.get(n.cluster).label) : ''}</div>` +
        (rel.length ? `<div class="sec">Relations · ${rel.length}</div>` + rel.map((r) =>
          `<div class="rel" data-goto="${r.id}"><span class="tag">${r.type}</span>${r.dir} ${esc(r.name)}</div>`).join('') : '') +
        (notes.length ? `<div class="sec">Notes · ${notes.length}</div>` + notes.map((m) =>
          `<div class="rel" data-goto="${m.id}"><span class="tag">note</span>${esc(m.name)}</div>`).join('') : '');
      box.classList.add('open');
      box.querySelector('.close').onclick = () => { setFocus(null); };
      box.querySelectorAll('[data-goto]').forEach((r) => (r.onclick = () => flyTo(r.dataset.goto)));
      $('#minimap').classList.add('hide');
    }
    function closeInspector() {
      $('#inspector').classList.remove('open');
      $('#minimap')?.classList.remove('hide');
    }

    function flyTo(id) {
      // Reveal the card if a collapsed ancestor is hiding it.
      let cur = N.get(id).cluster ? C.get(N.get(id).cluster) : null;
      let changed = false;
      while (cur) { if (state.collapsed.delete(cur.id)) changed = true; cur = cur.parent ? C.get(cur.parent) : null; }
      if (N.get(id).kind === 'note' && !state.showNotes) { state.showNotes = true; changed = true; }
      if (changed) { applyVisibility(); layoutNow(); }
      const b = boxes.get(id);
      if (b) {
        cam.fitTo({ x: b.x - 90, y: b.y - 90, w: b.w + 180, h: b.h + 180 }, 60, true);
        // Framing one small card would otherwise slam the camera to several hundred percent.
        if (cam.k > 1.15) cam.zoomAt(stage.clientWidth / 2, stage.clientHeight / 2, 1.15 / cam.k, true);
      }
      setFocus(id);
      const card = cards.get(id);
      card?.animate(
        [{ boxShadow: '0 0 0 0 var(--wire-hot)' }, { boxShadow: '0 0 0 14px transparent' }],
        { duration: 700, easing: 'ease-out' }
      );
    }

    /* ── dragging ────────────────────────────────────────────── */

    function startDragCard(ev, card, n) {
      if (ev.button !== 0) return;
      // Always stop here, even for a button press. Letting the event reach the stage made
      // it start a pan and call setPointerCapture, which retargets the pointerup — so the
      // browser fired `click` on the stage instead of the button and every card tool was
      // a silent no-op. Bubbling must be cut before the early return, not after.
      ev.stopPropagation();
      if (ev.target.closest('.tool')) return;
      const start = cam.toWorld(ev.clientX, ev.clientY);
      const ox = n.x, oy = n.y;
      let moved = false;
      card.setPointerCapture(ev.pointerId);
      card.classList.add('dragging');

      const move = (e) => {
        const p = cam.toWorld(e.clientX, e.clientY);
        n.x = ox + (p.x - start.x);
        n.y = oy + (p.y - start.y);
        card.style.left = `${n.x}px`;
        card.style.top = `${n.y}px`;
        if (Math.abs(p.x - start.x) + Math.abs(p.y - start.y) > 3) moved = true;
        n.pinned = true;
        schedule(false, true);
      };
      const up = () => {
        card.classList.remove('dragging');
        card.removeEventListener('pointermove', move);
        card.removeEventListener('pointerup', up);
        if (moved) { n.hx = n.x; n.hy = n.y; schedule(); }
      };
      card.addEventListener('pointermove', move);
      card.addEventListener('pointerup', up);
    }

    // Groups drag their whole contents.
    for (const [id, g] of groups) {
      g.addEventListener('pointerdown', (ev) => {
        if (ev.button !== 0) return;
        // Same trap as the cards: a press on the group tab must not reach the stage, or
        // the stage captures the pointer and swallows the tab's click.
        if (ev.target !== g) { if (ev.target.closest('.group-tab')) ev.stopPropagation(); return; }
        const c = C.get(id);
        const members = [];
        (function collect(cid) {
          const cc = C.get(cid);
          for (const k of cc.kids) members.push(N.get(k));
          for (const s of cc.subs) collect(s);
        })(id);
        if (!members.length) return;
        ev.stopPropagation();
        const start = cam.toWorld(ev.clientX, ev.clientY);
        const origin = members.map((m) => ({ m, x: m.x, y: m.y }));
        g.setPointerCapture(ev.pointerId);
        const move = (e) => {
          const p = cam.toWorld(e.clientX, e.clientY);
          for (const o of origin) {
            o.m.x = o.x + (p.x - start.x);
            o.m.y = o.y + (p.y - start.y);
            o.m.pinned = true;
            const card = cards.get(o.m.id);
            card.style.left = `${o.m.x}px`;
            card.style.top = `${o.m.y}px`;
          }
          if (state.collapsed.has(id)) { c.x = origin[0].m.x; c.y = origin[0].m.y; }
          schedule(false, true);
        };
        const up = () => { g.removeEventListener('pointermove', move); g.removeEventListener('pointerup', up); schedule(); };
        g.addEventListener('pointermove', move);
        g.addEventListener('pointerup', up);
      });
    }

    /* ── stage: pan / zoom ───────────────────────────────────── */

    const cam = new Camera(world, stage, () => {
      updateMinimapView();
      $('#zoomval').textContent = `${Math.round(cam.k * 100)}%`;
    });

    stage.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0 && ev.button !== 1) return;
      const sx = ev.clientX, sy = ev.clientY, ox = cam.x, oy = cam.y;
      let moved = false;
      stage.setPointerCapture(ev.pointerId);
      stage.classList.add('panning');
      const move = (e) => {
        cam.x = ox + (e.clientX - sx);
        cam.y = oy + (e.clientY - sy);
        if (Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) > 3) moved = true;
        cam.apply();
      };
      const up = () => {
        stage.classList.remove('panning');
        stage.removeEventListener('pointermove', move);
        stage.removeEventListener('pointerup', up);
        if (!moved) { state.selected = null; setFocus(null); closeInspector(); }
      };
      stage.addEventListener('pointermove', move);
      stage.addEventListener('pointerup', up);
    });

    stage.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      const r = stage.getBoundingClientRect();
      const px = ev.clientX - r.left, py = ev.clientY - r.top;
      if (ev.ctrlKey || ev.metaKey || !ev.shiftKey) {
        // pinch (ctrl+wheel) and plain wheel both zoom about the cursor
        const f = Math.exp(-ev.deltaY * (ev.ctrlKey ? 0.01 : 0.0022));
        cam.zoomAt(px, py, f);
      } else {
        cam.x -= ev.deltaY; cam.apply();
      }
    }, { passive: false });

    stage.addEventListener('dblclick', (ev) => {
      const r = stage.getBoundingClientRect();
      cam.zoomAt(ev.clientX - r.left, ev.clientY - r.top, ev.altKey ? 1 / 1.8 : 1.8, true);
    });

    /* ── scheduling ──────────────────────────────────────────── */

    let pending = 0, wantRelax = false, wiresOnly = false;
    function schedule(doRelax = false, onlyWires = false) {
      wantRelax = wantRelax || doRelax;
      wiresOnly = pending ? wiresOnly && onlyWires : onlyWires;
      if (pending) return;
      pending = requestAnimationFrame(() => {
        pending = 0;
        const r = wantRelax, w = wiresOnly;
        wantRelax = false; wiresOnly = false;
        layoutNow(r, w);
      });
    }
    function layoutNow(doRelax = false, onlyWires = false) {
      measure();
      if (doRelax && (state.compact || state.autoLayout)) {
        if (!state.autoLayout) { compact(); measure(); }
        fitGroups();
        packTree(null, state.focusGroup ? SPREAD_X : 120, state.focusGroup ? SPREAD_Y : 90);
        flushPositions();
        measure();
      }
      // fitGroups always runs: measure() owns the card boxes and drops the group boxes with
      // them, so skipping it here would leave every cross-group wire without an anchor.
      // It is O(groups) — the expensive part is the compact/pack pass above.
      fitGroups();
      if (doRelax && !onlyWires) rememberHome();
      drawWires();
      sizeCanvas();
    }
    function sizeCanvas() {
      let w = 0, h = 0;
      for (const b of boxes.values()) { w = Math.max(w, b.x + b.w); h = Math.max(h, b.y + b.h); }
      wires.setAttribute('width', w + 200);
      wires.setAttribute('height', h + 200);
      world.style.width = `${w + 200}px`;
      world.style.height = `${h + 200}px`;
    }
    const contentBox = () => {
      const bs = [...boxes.values()];
      if (!bs.length) return { x: 0, y: 0, w: 1000, h: 800 };
      const x = Math.min(...bs.map((b) => b.x)), y = Math.min(...bs.map((b) => b.y));
      return { x, y, w: Math.max(...bs.map((b) => b.x + b.w)) - x, h: Math.max(...bs.map((b) => b.y + b.h)) - y };
    };

    // Card geometry changes on collapse: keep wires glued during the animation, and let the
    // debounced full relayout fire once the sizes settle.
    const ro = new ResizeObserver(() => { schedule(false, true); relayoutWhenSettled(); });
    for (const c of cards.values()) ro.observe(c);

    /* ── minimap ─────────────────────────────────────────────── */

    // The minimap is split in two on purpose. Its contents only change when the layout
    // changes, but the viewport rectangle moves on every pan frame — rebuilding 40 nodes
    // of innerHTML per frame put DOM parsing and style invalidation straight in the hot
    // path. Build once; then only move one rect.
    let miniView = null;

    function buildMinimap() {
      const map = $('#minimap');
      if (!map || map.classList.contains('hide')) return;
      const box = contentBox();
      const W = map.clientWidth, H = map.clientHeight;
      if (!W || !H) return;
      const s = Math.min(W / (box.w + 120), H / (box.h + 120));
      const dx = (W - box.w * s) / 2 - box.x * s, dy = (H - box.h * s) / 2 - box.y * s;

      const frag = svg('svg', { viewBox: `0 0 ${W} ${H}` });
      for (const c of C.values()) {
        const b = boxes.get(c.id);
        if (!b || groups.get(c.id).style.display === 'none') continue;
        frag.append(svg('rect', {
          class: 'mini-group', rx: 4,
          x: b.x * s + dx, y: b.y * s + dy, width: b.w * s, height: b.h * s,
        }));
      }
      for (const [id, b] of boxes) {
        if (C.has(id)) continue;
        frag.append(svg('rect', {
          class: `mini-node${N.get(id).kind === 'note' ? ' note' : ''}`, rx: 1.5,
          x: b.x * s + dx, y: b.y * s + dy,
          width: Math.max(2, b.w * s), height: Math.max(2, b.h * s),
        }));
      }
      miniView = svg('rect', { class: 'mini-view', rx: 3 });
      frag.append(miniView);
      map.textContent = '';
      map.append(frag);
      map._proj = { s, dx, dy };
      updateMinimapView();
    }

    function updateMinimapView() {
      const map = $('#minimap');
      if (!miniView || !map?._proj || map.classList.contains('hide')) return;
      const { s, dx, dy } = map._proj;
      miniView.setAttribute('x', -cam.x / cam.k * s + dx);
      miniView.setAttribute('y', -cam.y / cam.k * s + dy);
      miniView.setAttribute('width', stage.clientWidth / cam.k * s);
      miniView.setAttribute('height', stage.clientHeight / cam.k * s);
    }

    /* ── chrome ──────────────────────────────────────────────── */

    /* ── domains ────────────────────────────────────────────── */

    // Emptying a domain is NOT hiding it. Hiding takes the relations with it, and the wires into a
    // domain are the reason it is still on screen at all — so the box stays, at a fixed small size,
    // and only the text inside it goes. The diagram keeps its shape and loses its noise.
    const NO_DOMAIN = '';
    const mutedCluster = (cid) => {
      if (!cid || !C.has(cid)) return state.muted.has(NO_DOMAIN);
      let cur = C.get(cid);
      while (cur) { if (state.muted.has(cur.id)) return true; cur = cur.parent ? C.get(cur.parent) : null; }
      return false;
    };
    const isMuted = (id) => mutedCluster(N.get(id).cluster);

    const domRows = new Map();    // cluster id (or NO_DOMAIN) -> its row
    const domItems = new Map();   // node id -> its row

    function toggleMuted(cid) {
      if (state.muted.has(cid)) state.muted.delete(cid); else state.muted.add(cid);
      const label = cid === NO_DOMAIN ? '(no domain)' : C.get(cid).label;
      applyVisibility();
      refreshDomainPanel();
      schedule(true);
      relayoutWhenSettled({ full: true });
      toastMsg(`${label} — ${state.muted.has(cid) ? 'emptied' : 'drawn'}`);
    }

    function buildDomainPanel() {
      const panel = el('div', 'hud'); panel.id = 'domains';
      const list = el('div', 'panel-list');
      const loose = [...N.values()].filter((n) => n.kind !== 'note' && (!n.cluster || !C.has(n.cluster)));

      const domainRow = (cid, label, kids, depth) => {
        const row = el('div', 'dom-row');
        row.style.setProperty('--d', String(depth));
        const eye = el('button', 'dom-eye', ICON.eye);
        eye.title = `Empty every box in ${label} — the boxes and their wires stay`;
        eye.onclick = (ev) => { ev.stopPropagation(); toggleMuted(cid); };
        const name = el('div', 'dom-name', esc(label));
        row.append(eye, name, el('div', 'dom-count', String(kids)));
        if (cid !== NO_DOMAIN) row.onclick = () => toggleGroupFocus(cid);
        domRows.set(cid, row);
        list.append(row);
      };
      const typeRow = (n, depth) => {
        const row = el('div', 'dom-item',
          `<span class="dom-badge">${KIND_LETTER[n.kind] || 'C'}</span><span>${esc(n.name)}</span>`);
        row.style.setProperty('--d', String(depth));
        row.dataset.kind = n.kind;
        row.onclick = () => flyTo(n.id);
        domItems.set(n.id, row);
        list.append(row);
      };
      const walk = (c, depth) => {
        domainRow(c.id, c.label, countKids(c.id), depth);
        for (const id of c.kids) { const n = N.get(id); if (n && n.kind !== 'note') typeRow(n, depth + 1); }
        for (const s of c.subs) walk(C.get(s), depth + 1);
      };
      for (const c of C.values()) if (!c.parent || !C.has(c.parent)) walk(c, 0);
      if (loose.length) {
        domainRow(NO_DOMAIN, '(no domain)', loose.length, 0);
        for (const n of loose) typeRow(n, 1);
      }

      panel.append(
        el('div', 'panel-head', `${ICON.layers}<span>Domains</span><span class="panel-count">${domRows.size}</span>`),
        list);
      if (graph.notes.length) {
        const foot = el('div', 'panel-foot');
        const btn = el('button', 'dom-toggle', `${ICON.note}<span>Notes</span>`);
        btn.id = 'btn-notes';
        btn.title = 'Show or hide every note (N)';
        foot.append(btn);
        panel.append(foot);
      }
      return panel;
    }

    function refreshDomainPanel() {
      for (const [cid, row] of domRows) {
        const off = mutedCluster(cid);
        row.classList.toggle('off', off);
        row.querySelector('.dom-eye').innerHTML = off ? ICON.eyeoff : ICON.eye;
      }
      for (const [id, row] of domItems) row.classList.toggle('off', isMuted(id));
    }

    function buildChrome() {
      const bar = el('div', 'hud'); bar.id = 'topbar';
      bar.innerHTML = `
        <div class="brand">
          <div class="brand-mark">SV</div>
          <div class="brand-text">
            <div class="brand-title">${esc(graph.title)}</div>
            <div class="brand-sub">${graph.nodes.length} types · ${edges.length} relations · ${graph.notes.length} notes</div>
          </div>
        </div>
        <div class="spacer"></div>
        <label class="hud-field">${ICON.search}
          <input id="q" type="search" placeholder="Search types, members, prose…" spellcheck="false">
          <span class="hitcount" id="hitcount"></span><kbd>/</kbd>
        </label>
        <button class="textbtn" id="btn-all">${ICON.unfold}<span>Expand all</span></button>
        <button class="iconbtn" id="btn-reset" title="Reset — undo every move, collapse, focus and filter (R)">${ICON.reset}</button>`;

      // Everything the bar used to carry lives on a key now; the sheet is one press away
      // from the zoom cluster so the bar itself stays down to three things.
      const zoom = el('div', 'hud'); zoom.id = 'zoombar';
      zoom.innerHTML = `
        <button class="iconbtn" id="btn-in" title="Zoom in">${ICON.plus}</button>
        <div id="zoomval" title="Fit to screen (F)">100%</div>
        <button class="iconbtn" id="btn-out" title="Zoom out">${ICON.minus}</button>
        <button class="iconbtn" id="btn-help" title="Shortcuts (?)">${ICON.help}</button>`;

      const legend = el('div', 'hud'); legend.id = 'legend';
      const kindRow = ['interface', 'class', 'abstract', 'enum', 'struct']
        .map((k) => `<span class="legend-item" data-kind="${k}"><i class="legend-swatch" style="--c:var(--k-${k})"></i>${KIND_LABEL[k]}</span>`).join('');
      // Samples are drawn from the same REL table as the wires, so the key cannot drift
      // from the diagram, and only the relations this diagram actually uses are listed.
      const relSample = (kind) => {
        const spec = REL[kind];
        const head =
          spec.head === 'triangle' ? '<polygon class="cap hollow" points="34,6 20,11.5 20,0.5"/>'
          : spec.head === 'diamond' ? `<polygon class="cap ${spec.fill === 'hollow' ? 'hollow' : ''}" points="34,6 26,10 18,6 26,2"/>`
          : spec.head === 'open' ? '<polyline class="cap open" points="23,11 34,6 23,1"/>'
          : '';
        const stop = spec.head === 'none' ? 34 : spec.head === 'diamond' ? 18 : 20;
        return `<svg class="rel-sample" viewBox="0 0 34 12"><line class="wire ${kind}" x1="0" y1="6" x2="${stop}" y2="6"/>${head}</svg>`;
      };
      const present = new Set(edges.map(relKind));
      const relRow = ['extension', 'realization', 'composition', 'aggregation', 'dependency', 'association']
        .filter((k) => present.has(k))
        .map((k) => `<span class="legend-item">${relSample(k)}${REL[k].label}</span>`)
        .join('');
      legend.innerHTML = `
        <div class="legend-row">${kindRow}</div>
        <div class="legend-sep"></div>
        <div class="legend-row">${relRow}</div>`;

      const map = el('div', 'hud'); map.id = 'minimap';
      const insp = el('div', 'hud'); insp.id = 'inspector';
      const toast = el('div', 'hud'); toast.id = 'toast';
      const help = el('div', 'hud'); help.id = 'help';
      help.innerHTML = `<div class="sheet">
        <h2>Getting around</h2>
        <dl>
          <dt><kbd>drag</kbd></dt><dd>Pan the canvas — or drag a card / a group frame to move it</dd>
          <dt><kbd>wheel</kbd></dt><dd>Zoom at the cursor (pinch works too)</dd>
          <dt><kbd>⇧ wheel</kbd></dt><dd>Pan horizontally</dd>
          <dt><kbd>dbl-click</kbd></dt><dd>Zoom in · <kbd>⌥</kbd> to zoom out</dd>
          <dt><kbd>click</kbd></dt><dd>Inspect a card; ⌄ opens it in full, ◎ isolates it and its neighbours</dd>
          <dt><kbd>◎</kbd> on a group</dt><dd>Focus it: hide the rest, spread it out, zoom to it — <kbd>Esc</kbd> to leave</dd>
          <dt><kbd>E</kbd></dt><dd>Expand everything / collapse everything</dd>
          <dt><kbd>R</kbd></dt><dd>Reset — undo every move, collapse, focus, filter, search and deletion</dd>
          <dt><kbd>⌫</kbd></dt><dd>Delete the selected card and every relation touching it</dd>
          <dt><kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd></dt><dd>Detail: titles · members · full prose</dd>
          <dt><kbd>/</kbd></dt><dd>Search everything, including the explanations</dd>
          <dt><kbd>F</kbd></dt><dd>Fit to screen · <kbd>Esc</kbd> clears focus</dd>
          <dt><kbd>N</kbd> <kbd>M</kbd></dt><dd>Toggle notes · toggle the minimap</dd>
          <dt><kbd>T</kbd> <kbd>S</kbd></dt><dd>Light/dark · compact vs original spacing</dd>
        </dl></div>`;

      document.body.append(bar, zoom, legend, map, insp, toast, help, buildDomainPanel());

      // Every action is a named function so the key and the button (where one still
      // exists) drive the same code path — the bar can lose a button without losing a
      // feature. Lookups are optional-chained for the buttons that are now keys only.
      const act = {
        allDetail: () => {
          const all = [...cards.values()];
          const full = all.length > 0 && all.every((c) => c.classList.contains('lvl-2'));
          setLevel(full ? 0 : 2);
          toastMsg(full ? 'Collapsed everything' : 'Expanded everything');
        },
        fit: () => cam.fitTo(contentBox()),

        // Put everything back. Cards you dragged, domains you collapsed, a focus you left on, a
        // filter you switched off, a search still narrowing things, per-card detail — all of it.
        // Unpinning matters most: a dragged card is exempt from layout forever, so a diagram full
        // of hand-moved cards can never tidy itself again until they are released.
        reset: () => {
          state.focusGroup = null;
          computeFocusMembers();
          state.collapsed.clear();
          state.deleted.clear();
          state.muted.clear();
          state.selected = null;
          state.showNotes = true;
          state.compact = INITIAL_COMPACT;
          state.kinds = new Set(['interface', 'class', 'abstract', 'enum', 'struct']);
          legend.querySelectorAll('[data-kind]').forEach((it) => it.classList.remove('off'));

          const q = $('#q');
          if (q) q.value = '';
          search('');

          for (const n of N.values()) {
            delete n.pinned;
            if (n.x0 != null) { n.x = n.x0; n.y = n.y0; }
            delete n.hx; delete n.hy;
          }
          for (const c of C.values()) { delete c.lastX; delete c.lastY; }

          setFocus(null);
          closeInspector();
          applyVisibility();
          refreshFocusButtons();
          refreshDomainPanel();
          setLevel(INITIAL_LEVEL);          // also refreshes the group + bar buttons
          layoutNow(true);
          cam.fitTo(contentBox());
          toastMsg('Reset');
        },
        notes: () => {
          state.showNotes = !state.showNotes;
          applyVisibility(); schedule(true);
          toastMsg(state.showNotes ? 'Notes shown' : 'Notes hidden');
        },
        map: () => { map.classList.toggle('hide'); buildMinimap(); },
        theme: () => {
          const light = document.documentElement.getAttribute('data-theme') === 'light';
          document.documentElement.setAttribute('data-theme', light ? 'dark' : 'light');
        },
        spacing: () => {
          if (state.autoLayout) { toastMsg('This diagram has no source spacing to restore'); return; }
          state.compact = !state.compact;
          if (!state.compact) for (const n of N.values()) {
            if (n.pinned) continue;
            n.x = n.x0; n.y = n.y0;
            cards.get(n.id).style.left = `${n.x}px`;
            cards.get(n.id).style.top = `${n.y}px`;
          }
          schedule(true);
          setTimeout(() => cam.fitTo(contentBox()), 60);
          toastMsg(state.compact ? 'Compact spacing' : 'Original PlantUML spacing');
        },
        help: () => help.classList.toggle('open'),
      };

      $('#q').addEventListener('input', (e) => search(e.target.value));
      $('#btn-all').onclick = act.allDetail;
      $('#btn-reset').onclick = act.reset;
      $('#btn-in').onclick = () => cam.zoomAt(stage.clientWidth / 2, stage.clientHeight / 2, 1.35, true);
      $('#btn-out').onclick = () => cam.zoomAt(stage.clientWidth / 2, stage.clientHeight / 2, 1 / 1.35, true);
      $('#zoomval').onclick = act.fit;
      $('#btn-help').onclick = act.help;
      const notesBtn = $('#btn-notes');
      if (notesBtn) notesBtn.onclick = act.notes;
      help.onclick = (e) => { if (e.target === help) help.classList.remove('open'); };

      legend.querySelectorAll('[data-kind]').forEach((it) => {
        it.onclick = () => {
          const k = it.dataset.kind;
          if (state.kinds.has(k)) state.kinds.delete(k); else state.kinds.add(k);
          it.classList.toggle('off', !state.kinds.has(k));
          applyVisibility(); schedule(true);
        };
      });
      map.addEventListener('pointerdown', function jump(ev) {
        const p = map._proj; if (!p) return;
        const r = map.getBoundingClientRect();
        const wx = (ev.clientX - r.left - p.dx) / p.s, wy = (ev.clientY - r.top - p.dy) / p.s;
        cam.x = stage.clientWidth / 2 - wx * cam.k;
        cam.y = stage.clientHeight / 2 - wy * cam.k;
        cam.apply(true);
      });

      addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT') { if (e.key === 'Escape') { e.target.value = ''; search(''); e.target.blur(); } return; }
        const k = e.key;
        if (k === '/') { e.preventDefault(); $('#q').focus(); }
        else if (k === 'Escape') {
          if (state.focusGroup) toggleGroupFocus(state.focusGroup);
          else { state.selected = null; setFocus(null); closeInspector(); help.classList.remove('open'); }
        }
        else if (k === 'f' || k === 'F') act.fit();
        else if (k === 'e' || k === 'E') act.allDetail();
        else if (k === 'r' || k === 'R') act.reset();
        else if ((k === 'Delete' || k === 'Backspace') && state.focus) { e.preventDefault(); deleteCard(state.focus); }
        else if (k === 'n' || k === 'N') act.notes();
        else if (k === 'm' || k === 'M') act.map();
        else if (k === 't' || k === 'T') act.theme();
        else if (k === 's' || k === 'S') act.spacing();
        else if (k === '?') act.help();
        else if ('123'.includes(k)) setLevel(+k - 1);
      });
      addEventListener('resize', () => { cam.apply(); buildMinimap(); });
    }

    function toastMsg(msg) {
      const t = $('#toast'); t.textContent = msg; t.classList.add('show');
      clearTimeout(toastMsg._t); toastMsg._t = setTimeout(() => t.classList.remove('show'), 1800);
    }

    /* ── go ──────────────────────────────────────────────────── */

    document.documentElement.setAttribute('data-theme', opts.theme || 'dark');
    buildChrome();
    refreshGroupButtons();
    applyVisibility();
    layoutNow(true);
    requestAnimationFrame(() => { layoutNow(true); cam.fitTo(contentBox(), 90, false); });

    return {
      state, cam, flyTo, setLevel, setFocus, toast: toastMsg,
      relayout: () => layoutNow(true),
      // Exposed so a host page can drive or inspect the diagram.
      nodes: N, groups: C, edges, boxes, host, cards, search,
    };
  }

  // The authoring API (`create`) lives in loom.mjs and is attached by whoever builds the page: it
  // has to run in Node too, where a `fromFile` binding can actually read a file.
  return { mount };
})();

if (typeof window !== 'undefined') window.Naamah = Naamah;
