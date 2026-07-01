# Beta Keys — Operator's Guide

How to mint and distribute Conquered Time beta keys. This is the private
operations manual — the code that verifies keys lives in
`src/main/beta-keys.js`; this folder holds the signing secret.

---

## The one file that matters: `beta-secret.js`

`src/shared/beta-secret.js` is the private signing secret. It is
**gitignored** — it ships inside builds you make, but never appears in the
public repo.

- **BACK IT UP** (password manager or encrypted backup). If it's lost,
  **every key ever issued stops working** and all testers need new keys.
- Copy it to any other machine you build releases from.
- If it's missing at build time, the gate **fails open** (the app runs
  ungated) — a build without the secret never bricks, it just doesn't ask
  for keys.
- First-time setup on a new machine: copy `beta-secret.example.js` to
  `beta-secret.js` and generate a fresh secret per the template — but note
  a NEW secret invalidates all previously issued keys. Restore the backup
  instead whenever possible.

## Minting keys

From the repo root, on the machine that has `beta-secret.js`:

```
node scripts/gen-beta-key.mjs --expires 2026-09-30 --label "Alice"
node scripts/gen-beta-key.mjs --expires 2026-09-30 --count 10 --label "Wave 1"
```

- `--expires YYYY-MM-DD` (required) — the key works through the END of that
  day (UTC). Expiry is baked into the key and cannot be changed later.
- `--count N` — mint a batch.
- `--label` — printed for your records only; NOT embedded in the key.

Keys look like `CONQ-07V51S-3NG3WE-0KSVG6-K0P9TG`.

## Distributing keys — the workflow

1. **Pick the beta window** (the expiry date). All testers can share one
   date, or differ per person.
2. **Mint one key per tester** (see above). Unique key per person — if a
   key leaks, you know whose it was.
3. **Record who got what** in a private ledger (a text file or spreadsheet
   OUTSIDE the repo). The app validates offline and cannot tell you which
   key was redeemed — the ledger is your only map of key → person.

   ```
   CONQ-07V51S-...  Alice   exp 2026-09-30  sent 2026-06-30
   CONQ-059523-...  Bob     exp 2026-09-30  sent 2026-06-30
   ```

4. **Send each tester their key + download link** over a private channel:

   > Here's your Conquered Time beta key: `CONQ-XXXXXX-XXXXXX-XXXXXX-XXXXXX`
   > Download: https://github.com/Conqueror-Mod/conquered-time/releases/latest
   > The installer is unsigned (beta), so Windows will warn
   > "Windows protected your PC" — click **More info → Run anyway**.
   > On first launch, paste the key when asked, then set up your account
   > and **save your recovery code**.

5. **Tester side (automatic):** install → "Private Beta" screen → paste key
   (typos, lowercase, missing dashes are forgiven) → key is stored on their
   machine (`app-prefs.json`) → never asked again, even across updates.

## Rules of the road

- **Gate scope:** NEW installs only. Machines with an existing profile are
  grandfathered and never prompted. Dev runs (`--dev`) are never gated.
- **No revocation:** validation is offline — you cannot kill one key
  mid-beta. Expiry is the only lever. Choose dates accordingly.
- **Not machine-locked:** the same key works on a tester's new PC (and
  could be shared — acceptable for a trusted beta; the ledger tells you
  who leaked if it matters).
- **Not DRM:** like any client-side check it can be bypassed by patching
  the binary. The goal is a polite gate for a free beta, nothing more.
- **Which releases are gated:** only builds made WITH `beta-secret.js`
  present (v3.9.0+). v3.8.0 predates the gate and never asks for a key.
