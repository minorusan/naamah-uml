# Naamah

*A diagram is a web. `create()` hands you the loom.*

Turns a class/component diagram into **one self-contained HTML page** you can pan, zoom, drag,
collapse, focus and search. No build step, no dependencies, no network — the output opens from
`file://` and can be emailed as a single file.

Three ways in: render an existing PlantUML diagram, author one directly in JavaScript, or **read the
classes straight out of the source files** — `.cs`, `.ts`, `.py` — and keep them in step with the code.

```bash
naamah weave diagram.puml            # -> diagram.html
naamah weave diagram.svg out.html    # an already-rendered SVG works too
naamah author diagram.mjs            # a page from a script, classes read from source
naamah sync diagram.html             # re-read every bound file; renames come across
naamah totext --path diagram.html    # the whole diagram as text, on stdout
naamah help
```

A `.puml` holding several `@startuml` blocks yields **one page per diagram**, each named after its
own block; `[out.html]` applies only when there is exactly one. Non-class diagrams in the same file
are skipped by name rather than written as blank pages.

Install: `npm link` in this directory puts `naamah` on your PATH as a symlink to the checkout, so
edits are live. Exit codes: `0` ok, `1` bad usage or missing file, `2` cannot render it.
Tests: `npm test` (node only, no dependencies; the PlantUML tests skip themselves if it is absent).

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
| `bin/naamah.mjs` | CLI — `weave`, `author`, `sync`, `totext`, help, version |
| `src/weave.mjs` | diagram in, page(s) out (`weave`); or just the model (`graphsOf`) |
| `src/naamah.js` | the runtime: cards, wires, camera, layout, chrome |
| `src/naamah.css` | the design system (dark + light, every colour a token at the top) |
| `src/extract.mjs` | PlantUML SVG → graph model (`parseSvg(svgText)`) |
| `src/loom.mjs` | the authoring API (`create`), source bindings (`bind`, `syncGraph`) |
| `src/source.mjs` | `.cs` / `.ts` / `.py` → one type's structure (`parseSource`) |
| `src/bind.mjs` | the Node side of a binding: the file reader, `author`, `sync` |
| `src/totext.mjs` | graph → text (`toText`) |
| `src/page.mjs` | graph → page (`renderPage`), and page → graph (`extractGraph`) |
| `test/run.mjs` | every test, no framework — `npm test` |

`loom.mjs` and `source.mjs` are ES modules because Node imports them, and are **inlined into every
page** with their `import`/`export` lines dropped, because `Naamah.create` is documented as working
in a rendered page too. That transform is a place a `SyntaxError` could hide from Node entirely, so
the tests execute the page's own scripts.

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

A card read from a source file also carries its binding, and each row it got from that file is
marked — that mark is how a re-sync knows which rows are the file's to replace and which are the
author's to keep:

```jsonc
"source": { "path": "/abs/Runtime/RewardService.cs", "lang": "cs", "symbol": "RewardService", "index": 0 },
"rows":   [{ "vis": "PRIVATE_FIELD", "kind": "field", "text": "…", "explain": ["…"], "from": "source" }]
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

## Reading a class out of its source file

A card can be **bound to the file that declares it**. Naamah reads the type's name, its kind, its
bases, and its fields, properties and methods — and keeps the comments written above each member as
that row's explanation, folded away until asked for. So the prose lives once, in the code.

```js
const svc = dom.type('RewardService', { fromFile: 'Runtime/RewardService.cs' });

svc.bind('Runtime/RewardService.cs');            // the same thing, said later
svc.bind('Store.ts', { symbol: 'SessionStore' }); // when the file holds several types
svc.sync();                                       // re-read it now

svc.field('handWritten : int');   // hand-written rows sit after the file's, and survive every sync
```

Supported: `.cs` · `.ts` `.tsx` `.mts` `.js` `.mjs` `.jsx` · `.py` `.pyi`. A relative path in a
script run by `naamah author` is resolved **next to the script**, never against the shell's cwd; what
gets recorded in the page is the absolute path, so a sync works from anywhere.

Which type in the file: `{ symbol }` if given, else the one named after the file
(`session-store.ts` → `SessionStore`, `reward_service.py` → `RewardService`), else the only one.
Several types and no name match is an error, not a guess.

**The source is the authority.** Its name becomes the card's name, so renaming the class in code
renames the card on the next `naamah sync`:

```
$ naamah sync page.html
naamah: RewardEngine — renamed from RewardService · 12 → 13 members
naamah: synced 5 bound type(s) → page.html
```

A rename is followed by recording both the name and the type's **position** in the file, and trying
them in that order — a name alone cannot survive being changed. The rename is always reported;
positions, domains, notes and relations are the author's and are never touched. A bound file that
has gone missing is an error, because a binding that quietly keeps stale rows is worse than none.

What it does **not** do: infer relations. `implements`/`extends` are read out of the source but are
not turned into arrows, because only the author knows which of the types in a codebase belong on
*this* diagram.

Per language, briefly: C# properties keep the accessors they actually declare (`{ get; }` is not
`{ get; set; }`), `///` doc comments lose their XML tags, and a hard-wrapped comment is one
paragraph rather than six rows. TypeScript merges `get x`/`set x` into one property and turns a
constructor's parameter properties into fields. Python takes fields from `self.x = …` in `__init__`,
reads `@property` as a field, drops `self`, keeps docstrings, and derives the kind from the bases
(`Enum` → enum, `Protocol` → interface, `ABC` → abstract).

These are hand-written scanners, not compilers, and their failure mode is silence — a brace counted
in the wrong place truncates a class rather than raising anything. That is what `test/run.mjs` is
mostly for, and why its fixtures are full of collection initialisers, arrow-function fields and
default arguments sitting next to body braces.

## The diagram as text

```bash
naamah totext --path page.html          # or a .puml / .svg / graph .json
naamah totext --path page.html --no-comments
```

Every domain with its classes and the domains it depends on, then every class with its fields,
methods, events, source comments and connections — for grepping, for diffing two revisions of the
same architecture, and for handing an agent a design without 60 KB of page.

```
DOMAIN Rewards › runtime
  classes: IRewardService (interface), RewardService, RewardType (enum)
  deps: Server › node

  CLASS RewardService
    source: /home/…/RewardService.cs (cs)
    about:
      Everything that is running right now. One service, no queue.
    fields:
      - _live : List<RewardEntry>
        » the live set — index is the reward id
    methods:
      + Activate(RewardType type, int amount) : int
        » Starts one reward and returns its id.
    connections:
      -> implements IRewardService
      <- RewardFactory uses this
```

## Interaction

| | |
| --- | --- |
| drag background / card / domain frame | pan · move a card · move a whole domain |
| wheel | zoom at the cursor (pinch too) · `⇧`+wheel pans |
| `⌄` on a card | one press opens it in full, one press puts it back |
| the comment marker on a row | show **that** member's comment, or hide it again — see below |
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

## Comments, one at a time

Comments — written under a member in PlantUML, or read off the member in a source file — are visible
but **collapsible**, and collapsible at the granularity of one row.

Detail level is a whole-card switch, which is the wrong instrument when a reader wants the note on a
single member: going to level 3 to read one line opens every comment in the diagram at once. So a row
that has a comment gets a marker, and pressing it toggles that comment alone.

A row can disagree with its card in **both** directions — `open` shows this comment while the rest of
the card stays folded, `shut` hides this one while the rest of the card is fully expanded — which is
why they are two classes rather than one toggle: "collapsed" has two different defaults to override.
Opening one runs the same local settle a card expansion does, so nothing else on the page moves.

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
- A binding follows a class that was renamed, but not one that **moved to another file**: the path is
  half of its identity. Re-bind it.
- The source readers are scanners. Nested generic constraints, `#if` blocks and a brace inside a
  default argument value are the shapes most likely to read short — and reading short is silent, so
  compare `naamah totext` against the file when a class looks thin.
- A relation is never inferred from source. `implements`/`extends` are read, but drawing them would
  mean deciding which types belong on this diagram, which is the author's call.
