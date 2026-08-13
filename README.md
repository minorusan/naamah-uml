# Naamah

*A diagram is a web. `create()` hands you the loom.*

Turns a class/component diagram into **one self-contained HTML page** you can pan, zoom, drag,
collapse, focus and search. No build step, no dependencies, no network — the output opens from
`file://` and can be emailed as a single file.

Two ways in: render an existing PlantUML diagram, or author one directly in JavaScript.

```bash
naamah weave diagram.puml            # -> diagram.html
naamah weave diagram.svg out.html    # an already-rendered SVG works too
naamah help
```

A `.puml` holding several `@startuml` blocks yields **one page per diagram**, each named after its
own block; `[out.html]` applies only when there is exactly one. Non-class diagrams in the same file
are skipped by name rather than written as blank pages.

Install: `npm link` in this directory puts `naamah` on your PATH as a symlink to the checkout, so
edits are live. Exit codes: `0` ok, `1` bad usage or missing file, `2` cannot render it.

```js
const loom = Naamah.create('Rewards');

const rewards = loom.domain('Rewards › asmdef');
const api = rewards.type('IRewardService', { kind: 'interface' });
const svc = rewards.type('RewardService');

svc.implements(api);
svc.owns(entry);
svc.uses(cfg);

Naamah.mount(loom.build());
```

## Files

| file | role |
| --- | --- |
| `bin/naamah.mjs` | CLI — `naamah weave`, help, version |
| `src/weave.mjs` | the one operation: diagram in, page(s) out (`weave(input, out)`) |
| `src/naamah.js` | the runtime: cards, wires, camera, layout, chrome, **and the authoring API** |
| `src/naamah.css` | the design system (dark + light, every colour a token at the top) |
| `src/extract.mjs` | PlantUML SVG → graph model (`parseSvg(svgText)`) |
| `src/page.mjs` | graph → page (`renderPage`), and page → graph (`extractGraph`) |

## Why it can read a PlantUML SVG

PlantUML already emits the semantics, so nothing is guessed from pixels:

| PlantUML markup | becomes |
| --- | --- |
| `<g class="entity" data-qualified-name=…>` | a card (type, name, stereotype, members) |
| `<g class="link" data-entity-1/-2 data-link-type>` | a typed relation |
| a link drawn with `stroke-dasharray` | `<\|..` implements vs `<\|--` extends |
| `<g class="cluster">` | a domain frame, nested by geometric containment |
| `<g data-visibility-modifier="PUBLIC_METHOD">` | the `+ / - / #` bullet on a row |
| a `..` comment row | the **explanation** attached to the row above it |
| a `#FEFFDD` note shape | a note card, tethered to the type it annotates |

That last row is the point of the whole thing: prose written under a member is treated as
first-class content, folded away by default and expanded on demand.

## Graph model

`parseSvg()` and `loom.build()` both produce the same plain JSON, which is all `mount()` needs.

```jsonc
{
  "title": "…",
  "layout": "auto",                // present on authored graphs: no source geometry to compact
  "clusters": [{ "id", "label", "parent", "x", "y", "w", "h" }],
  "nodes": [{
    "id", "name", "kind",          // interface | class | abstract | enum | struct
    "stereotype",                  // «ITickable» -> "ITickable", or null
    "cluster",
    "rows": [{ "vis", "kind", "text", "explain": ["…"] }]
  }],
  "notes": [{ "id", "name", "body": ["…"], "attachedTo" }],
  "edges": [{ "from", "to", "type", "dashed" }]
}
```

## Authoring API

`Naamah.create(title)` returns a loom. Positions are **not** part of the model — you describe
structure, the layout engine decides where things go. Declaration order is the only spatial hint.

```js
const loom = Naamah.create('My service');

const dom  = loom.domain('Rewards');            // .domain() nests
const inner = dom.domain('SolitaireStreak');

const svc = dom.type('RewardService', { kind: 'class', stereotype: 'MonoBehaviour' });
svc.field('_live : List<Entry>', { vis: 'private', explain: 'everything running right now' });
svc.method('Update(float dt)');
svc.event('event Activated(RewardType, int id)');
svc.lede('prose row, no bullet');
svc.note('Parallel by default.', ['No queue, no policy.']);

svc.extends(base);  svc.implements(api);  svc.owns(entry);
svc.has(cfg);       svc.uses(clock);      svc.refers(other);

const graph = loom.build();   // throws on a link to an unknown node
```

`kind`: `class` (default) · `interface` · `abstract` · `enum` · `struct`.
`vis`: `public` (default) · `private` · `protected` · `none` (no bullet — for continuation lines).

## Interaction

| | |
| --- | --- |
| drag background / card / domain frame | pan · move a card · move a whole domain |
| wheel | zoom at the cursor (pinch too) · `⇧`+wheel pans |
| `⌄` on a card | one press opens it in full, one press puts it back |
| `⌄⌃` on a domain tab | open every card in that domain, or fold them all back |
| `◎` on a domain tab | **focus** it — see below |
| domain tab | collapse the domain to a puck; crossing wires re-anchor to it |
| `Expand all` / `E` | everything open ↔ everything folded |
| `/` | search names, members **and** explanations |
| `1` `2` `3` | detail: titles · members · full prose |
| `F` `N` `M` `T` `S` `?` | fit · notes · minimap · theme · spacing · shortcuts |
| `Esc` | leave focus / clear selection |

## Focus

The packed layout is dense enough that wires run together and cannot be traced. `◎` on a domain tab
hides everything outside it, re-lays the contents with **two card widths** of clear space, and fits
the camera to what is left. Notes pinned to focused cards come along. `spread` sets the gap in
card-widths (default 2).

## Layout

Source coordinates are a starting point, not the answer. PlantUML sizes every box for its
fully-expanded text, so its spacing leaves smaller cards swimming. On each detail change the runtime
scales the coordinate field by how much smaller the cards really are, **packs hierarchically** (a
domain's contents settle first, then the domain moves as one rigid unit among its siblings, so
nothing crosses a boundary), then **flows** each level into wrapped rows targeting a screen aspect.

**Opening a card must not move the diagram.** Three things make that true:

- Card width is identical at every detail level. A folded card sized to `max-content` grew *wider*
  when opened and shoved its row neighbours sideways.
- Opening a card runs a **local settle**, not a repack. Every full repack records each card's home
  position; the settle resets to home and sweeps top-to-bottom, giving each card the highest spot at
  or below home that clears everything placed. That makes it reversible — a one-way "push down what
  I collide with" cascade could open a card but left the gaps behind when it closed, so domain frames
  stayed stretched around nothing. It is also deterministic: the same detail state always yields the
  same layout.
- Each row reserves headroom for **one** step of growth, so the common case lands in space that is
  already empty and nothing moves at all.

Tunable per diagram: `Naamah.mount(graph, { slack: 46, maxWidth: 340, spread: 2, theme: 'dark' })`.
They trade density against stillness — measured on a 26-type diagram, headroom 0 → 46 costs 3 points
of fit-zoom and cuts cards-disturbed from 15 to 7 over three expansions.

## Relation glyphs

Drawn as UML specifies, from one `REL` table that both the wires and the legend read, so the key
cannot drift from the diagram. Only the relations a diagram actually uses are listed in its legend.

| | line | head | means |
| --- | --- | --- | --- |
| extends | solid | hollow closed triangle | generalization |
| implements | dashed | hollow closed triangle | realization |
| owns | solid | filled diamond | composition |
| has | solid | hollow diamond | aggregation |
| uses | dashed | open arrow, two strokes | dependency |

A **closed** head is a type relationship, an **open** head is only usage; filled vs hollow then
separates "owns the lifetime" from "merely holds". A filled triangle means nothing in UML, so
generalization is never painted solid. Hollow heads are filled with the page background rather than
left transparent, so a wire passing behind one cannot show through and read as filled.

PlantUML reports `<|--` and `<|..` both as `extension`; the split is recovered from whether it drew
the line dashed.

## Performance rules

Panning must not re-do work.

- **No `backdrop-filter`.** Frosted panels re-blur the whole moving canvas every frame.
- **Never animate a paint or layout property on many elements.** `background-position`,
  `background-size` and `mask-image` repaint; `left`/`top` re-layout. A background grid driven by
  `background-position` measured as the single most expensive thing in the frame (26 ms → 14 ms pan,
  28 ms → 2 ms zoom when removed) — it is gone. Card positions snap rather than tween.
- **Build once, move one thing.** The minimap rebuilt ~40 SVG rects per frame; now only the viewport
  rectangle moves.
- Camera writes coalesce into one `requestAnimationFrame`, so a 120 Hz trackpad cannot drive the
  transform several times per frame.

**Measure, don't guess.** Headless Chrome freezes `performance.now()` under
`--virtual-time-budget`, so any benchmark run that way reports `0.00 ms` for everything. Drive a real
Chrome over the DevTools protocol with vsync disabled, pair every variant against a baseline taken
immediately before it, and include a no-op control — an uncontrolled harness once reported a no-op as
"38% faster". Treat anything under ~±25% as noise.

## Theming

Every colour is a token at the top of `naamah.css`; `:root` is dark, `[data-theme="light"]`
overrides. To rebrand, change the tokens — nothing else names a literal colour. Per-kind accents are
`--k-interface`, `--k-class`, `--k-abstract`, `--k-enum`, `--k-struct`, `--k-note`.

## Known gaps

- Class/component-style diagrams only. Sequence and activity diagrams carry no `class="entity"`
  metadata and are refused rather than half-rendered.
- Relation labels and cardinalities from the source are not carried over; the relation *name* shows
  on hover.
- Card positions are not persisted between reloads.
- Notes are laid out at the top level, so under focus they sit below the frame rather than beside
  their host, which pulls the fit wider than it needs to be.
