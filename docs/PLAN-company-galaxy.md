# PLAN — Company Galaxy (Company Web 3.0)

**Status:** approved 2026-07-12 · targets **v3.20.0** (hold OTA release until this ships —
users jump from the old radial web straight to the Galaxy; Web v2 was the internal stepping stone)
**Interactive mock:** https://claude.ai/code/artifact/fcc8c22f-4fe4-472b-ada6-eab07bdd2967
(source `docs/mock-galaxy-web.html` — copy in when building starts)
**Prior art:** Web v2 (PRs #133/#134) — `src/renderer/bubble-web.ts` is the base engine;
Galaxy extends it, it does not replace it.

## Concept

Hierarchical nesting like a galaxy. No schema change — company rows already carry
`hier_company › hier_project › hier_platform › nav_id`:

| Level | Visual | Data |
|---|---|---|
| Galaxy | top-level bubble | rows **grouped by `hier_company`**, hours rolled up |
| Solar system | bubble nested in / zoomed from a galaxy | one company row (Project › Platform) |
| Planet | small bubble inside an expanded system | row detail: Platform · Navigator ID · login |

This grouping also answers the long-open **Multi-DBA** roadmap question (several
Navigator IDs under one umbrella company).

**Interaction:** click a multi-project galaxy → in-place expand into its systems
(Archive-expand mechanic). Click a system inside → **zoom**: that galaxy becomes the
canvas, breadcrumb "← All Galaxies › X" backs out. Click a system at full zoom → its
planets fan out. Same harnessed sizing at every level (40% budget of the parent, floor,
whale ceiling). Identity hue lives at galaxy level; systems inherit stepped shades
("the Identity path"); recency fade and the colorblind-safe palette apply as in v2.
NavID renders in-session only — never in exports (standing rule).

## Approved decisions (Chris, 2026-07-12 — all seven approved)

1. **Click semantics:** left-click = navigation (expand / zoom / tracker). Context menu
   moves to right-click at both levels: galaxy → Edit Color, Open/Collapse (no group
   delete); system → existing row menu (Open Tracker / Edit Company / Edit Color / Delete).
   First installment of the "richer right-click menus" roadmap item.
2. **Galaxy color override:** writes the same `color` into every row of the group
   (no schema change; shades derive from it).
3. **Grouped company list panel** *(highly approved)*: the right-side list becomes a
   two-level accordion — galaxy header rows (rolled-up hours) expanding to project rows.
   Biggest hidden cost in the feature; may trail the web PR by one PR but ships in v3.20.0.
4. **One-galaxy vaults:** skip level 0 — land directly on that galaxy's systems, no
   breadcrumb. Single-row vaults behave exactly like today.
5. **Zoom transition:** ~200 ms scale/fade tween from clicked galaxy into the level-1
   canvas; gated on the reduced-motion setting.
6. **Dashboard mini-web** *(highly approved)*: galaxies only, no in-place drill.
   Click multi-project galaxy → navigate to Companies **pre-zoomed into that galaxy**;
   single-project → tracker, as today.
7. **Search:** dimming propagates down — non-matching galaxies dim; inside an opened
   galaxy, matching systems stay lit, non-matching dim.

## Build order (suggested PRs)

1. **Engine:** extend `bubble-web.ts` — grouping model, two view levels, in-place expand
   (stable positions: deterministic base pack + pinned-enlarge + relaxation, as proven in
   the mock), zoom + breadcrumb, planets, tween. Companies page wiring incl. right-click
   menus + pre-zoom entry param (for #6).
2. **Grouped list panel** (companies.html/ts accordion) + search propagation.
3. **Dashboard mini** galaxies + pre-zoom navigation handoff.
4. Seed additions: multi-row umbrella company fixtures so the galaxy path is testable
   (`test/vault-fixture.js` + seed self-check untouched counts — audit not affected).

## Known gotchas to carry over

- Group key is the `hier_company` STRING — renaming one row splits the galaxy (accepted
  for 3.0; rename all rows together).
- The mock's three layout bugs (center-stacking pack fallback, children stacking inside
  parents, full-repack position swaps) are already solved in the mock — port the fixes:
  grid-scan + shrink-retry fallbacks, and expansion = pin + relax, never repack.
- Captions flip below a bubble when clamped at the canvas top.
- Tooltips are bubble-anchored (v2 #134 behavior), never cursor-following.
