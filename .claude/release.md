# Release profile — Conquered Time

Project-specific companion to the global `ship-release` skill. That skill holds
the phase order and the hard rules; this file holds what's true here.

**Current version: 3.25.2** (verify against `package.json` — this line drifts).

---

## Preflight

```bash
npm test
```

Runs `build:main` → `node --test` → `typecheck` (all three tsconfig projects).
All of it must pass.

**Release from the primary checkout — currently `D:\My Projects\conquered-time` —
never from a worktree under `.claude/worktrees/`.** `src/shared/beta-secret.js` is
gitignored, so it exists only in the primary checkout. A worktree build produces
an installer with a dead beta gate. (The old `D:\My Projects\CURRENT-RELEASE\`
path this file used to name no longer exists; verify `src/shared/beta-secret.js`
is present before building — that's the real test of "am I in the right tree".)

## Bump targets

| File | What |
|---|---|
| `package.json` | `version` |
| `src/renderer/components/about.js` | new changelog entry (the module owns its own changelog data) |
| `ROADMAP.md` | move shipped items Planned → Recently shipped |

Sanity check before building:

```bash
grep -rn "<old-version>" package.json src/renderer/components/about.js ROADMAP.md
```

### PINNED — do not touch

**`version.json` stays at 3.17.0.** It is a legacy bridge: pre-3.17 installs still
poll it on GitHub raw to find Check for Updates. It points at `releases/latest`, so
it only needs to nudge stragglers onto the auto-update track — it does **not** get
bumped per release.

Deleting it once broke Check for Updates on every pre-3.17 install (404 → "Invalid
response from update server"). Do not delete it until the whole beta cohort is on
≥3.17. Raw CDN lags ~5 min behind a push.

The bump commit goes straight to master, matching the existing `docs: bump to vX`
pattern.

## Build and publish

```bash
GH_TOKEN=$(gh auth token) npm run release
```

`GH_TOKEN` is usually not set in the environment; sourcing it from `gh auth token`
works (gh is authed as Conqueror-Mod via keyring). The script is
`electron-builder --win --x64 --publish always` — uploads installer, blockmap, and
`latest.yml`.

**Immediately after, restore `package.json`:**

```bash
git restore package.json
```

electron-builder rewrites the root `package.json` **in the working tree**, stripping
`scripts`, `build`, `devDependencies`, and `contributors` down to the minimal packaged
form. HEAD has the complete file (the bump commit only touched the version line).
Verify the restore: `.scripts.release`, `.build`, and `.devDependencies` should all be
back.

**electron-builder creates the GitHub release as a DRAFT.** It is not published until:

```bash
gh release edit v<version> --draft=false --latest --notes-file <scratchpad-path>
```

## Verify

- `releases/latest` resolves to the new version
- `latest.yml` serves the new version (this is the auto-updater feed — if it's stale, nobody updates)
- Installer (~84MB) + blockmap + `latest.yml` attached
- **`beta-secret.js` bundled in the asar** — the gate is inactive without it
- **`seed-dev.js` excluded** — `build.files` whitelists `dist-main`, `src/renderer`, `assets`, `package.json`, so it should be, but confirm

Inspect the packaged bundle with `npx asar extract` when anything looks off — that's
how a phantom "the code didn't ship" bug hunt got closed out once.

## After

The Discord bot auto-announces the release and syncs `#roadmap`.

Record the release in `project-roadmap` memory: version, date, what shipped, what was
verified, anything surprising.

## Known trap

**Stacked PRs.** Merging a PR whose base is another feature branch lands it on that
branch, not master — it then needs a follow-up PR to reach master. Bit this project
twice (#89, #112→#113). Merge stacked PRs bottom-up with retarget, or wait between
merges.
