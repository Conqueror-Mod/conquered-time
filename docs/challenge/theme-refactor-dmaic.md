# Challenge: Theme Refactor — Zanarkand Premium Redesign (DMAIC)

Exploratory work on `challenge/theme-refactor`. Goal: take the strongest of the
five Final Fantasy themes and redesign it into a genuinely premium, sleek,
professional showcase — glow, depth, and defined 3D permitted — while staying
inside the existing theme-token structure and touching **only** that one theme.

Direction locked with the owner: **Zanarkand**, "bold *and* cohesive" (a hero
statement theme that still reads professional, not a gamer-HUD flashback),
**theme-scoped changes only**, built live for a go/no-go from the running app.

---

## Define

**Problem.** The five themes are competent but visually *flat and restrained* by
design — the project deliberately matured away from its original glowing-HUD
look toward a safe, professional baseline. That safety is now a ceiling: nothing
in the app reads as *premium*. Competing trackers increasingly win on feel, not
just features.

**Opportunity.** Prove a premium visual tier using one theme as the hero,
without regressing the legibility/usability the restrained system guarantees,
and without disturbing the other four themes.

**Success criteria.**
1. Reads as premium/expensive at a glance (peer to Linear / Timely / Rize).
2. Delivers on Zanarkand's own stated concept ("bioluminescent, everything
   glows, everything reflected") — the current build does not.
3. No legibility regression — body text contrast ≥ current, ideally higher.
4. Zero blast radius: the other four themes render byte-identical.
5. Reversible: one theme block + theme-scoped rules on a throwaway branch.

---

## Measure — current-state baseline

The token contract (per theme, in `themes.css`): ~40 CSS variables — a 4-step
surface ramp (`--surface-0..3`), two borders, a primary/secondary accent each
with `-dim`/`-glow`, semantic colors, a 5-step text ramp, and a 3-tier shadow
system (`--shadow-1/2/3`) + `--shadow-inset`.

Zanarkand as shipped:

| Aspect | Current value | Reading |
|---|---|---|
| Base ramp | `#080e18 → #1a2640` | Narrow; elevation steps are subtle, surfaces read as one plane |
| Accent | `#00b8cc` aqua + `#7868d0` violet | Good palette, but used as flat fill/text only |
| **Glow** | `--accent-glow` token exists (`rgba(0,184,204,.35)`) | **Defined but never applied to components** — the "glow" is aspirational only |
| Shadows | `rgba(0,8,24,.65–.85)` pure dark drop | Standard dark-theme depth; no colored light, no top highlight |
| Inset | `inset 0 1px 0 rgba(0,184,204,.10)` | Faint aqua top-edge — the one real nod to the concept |
| Body text | `--text #8ab0c8` on `#080e18` | ~5.6:1 — passes AA but feels dim; `--text-muted #6898b8` is borderline |

**Diagnosis:** Zanarkand is a well-paletted but conventional dark theme wearing
a bioluminescent *description*. The concept-to-execution gap is the whole
project.

---

## Analyze — competitive benchmark

Benchmarked our design language against successful and failed time-tracker /
productivity UIs.

**Premium references (the target tier):**
- **Linear** (adjacent, the gold standard for pro dark UI): near-black layered
  base, *one* restrained accent used as a light source, hairline borders that
  catch light, subtle glow only on focal/interactive elements, crisp high
  contrast. Depth without gaudiness. → *the model to emulate.*
- **Timely:** glassy translucent cards, soft colored glows, generous depth,
  memory-timeline; feels expensive. → *depth + glass, but watch legibility.*
- **Rize:** dark-first, minimal, focused, tasteful subtle gradients. → *proof a
  dark tracker can feel sleek and calm at once.*

**Mass-market references (competent but not premium):**
- **Toggl Track:** bright, playful pink/purple, high clarity — but reads
  toy-like, flat, not "pro."
- **Harvest:** corporate muted greens/grays; trustworthy but forgettable/dated.
- **Clockify:** functional Material blue; dense and clear but generic,
  free-tool feel.
- **RescueTime:** data-dashboard utilitarian; information-rich but cluttered,
  never sleek.

**Failure modes to avoid (learned from the bad examples + our own history):**
1. **Neon gamer-HUD** — glow on *everything* → unprofessional. (The exact trap
   this project fled. Glow must be a *scarce, directed* resource.)
2. **Low-contrast dark** — dim text on dark → eye strain, cheap feel.
3. **Flat elevation** — every surface on one plane → no hierarchy, reads cheap.
4. **Gradient overload** — dated web-2.0 look.
5. **Pure-black OLED void** — no depth, no light source, no hierarchy.

**Synthesis — the premium-dark formula:**
> A near-black-but-*layered* base with clear elevation steps; ONE accent treated
> as a **light source**; colored glow applied *only* to focal & interactive
> elements; glass/translucency + backdrop-blur on the highest surfaces; crisp
> hairline borders with a faint top-lit edge; **high** text contrast; depth via
> layered drop-shadow **+ inset top-highlight** (the "top-lit glass" bevel).

Zanarkand's aqua-on-ocean palette is *ideal* for this — aqua reads as
bioluminescence, i.e. a literal light source. We just have to actually light it.

---

## Improve — redesign strategy (what will change)

All changes are (a) inside the `[data-theme="zanarkand"]` variable block, or
(b) `[data-theme="zanarkand"] <selector>` theme-scoped rules — so the other
four themes are untouched.

1. **Widen & deepen the surface ramp** for unmistakable elevation
   (`#060b14` base → lifted, cooler-lit upper surfaces).
2. **Raise text contrast** — brighter `--text`/`--text-bright`, lift
   `--text-muted` off the borderline. Legibility is non-negotiable.
3. **Introduce a true glow system** as new theme-scoped shadow layers that
   combine: dark drop shadow (mass) **+** aqua ambient glow (the light) **+**
   inset top highlight (the bevel). Applied deliberately to cards, panels,
   modals, the sidebar, and the titlebar — *not* every element.
4. **Accent as light source** — aqua glow on: focused inputs, primary buttons,
   the active nav item, the live-session badge, stat-chip top borders, hover
   states. Directed, scarce, meaningful.
5. **Glass on the top layer** — translucent elevated surfaces + `backdrop-filter`
   blur on modals/sidebar/titlebar where it reads premium and stays legible.
6. **Top-lit hairline borders** — borders gain a faint aqua-lit upper edge so
   panels look like lit glass, not flat rectangles.

Non-goals: no gradients-as-fills, no glow on body text or on every surface, no
motion beyond the existing transition tokens, no legibility trade for style.

---

## Control — how we keep it safe & reversible

- **Isolation:** every rule is theme-scoped; a visual diff of the other four
  themes must show *no change* (screenshot check).
- **Legibility gate:** body/muted text contrast measured ≥ baseline.
- **Full-surface check:** screenshot every page (dashboard, companies, tracker,
  reports, global-log, profile, dispatch, settings modal, login) under the new
  Zanarkand before presenting.
- **Reversibility:** single branch, single theme block + scoped rules; abandon =
  delete branch. Merge is a separate, later decision.
- **Documentation:** this file records the rationale so the redesign is
  maintainable and the decision is auditable — same discipline as the code
  refactor's defect register.
