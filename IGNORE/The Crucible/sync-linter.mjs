#!/usr/bin/env node
// Sync probe-layout.js FROM the canonical local Crucible checkout INTO this
// app's consumer copy.
//
// The Crucible is its own repo (github.com/Conqueror-Mod/Crucible), checked out
// locally at CRUCIBLE_HOME — that checkout is the source of truth. This app
// consumes ONLY the linter: its run-app driver injects probe-layout.js for the
// `lint`/`sweep` commands. The full sideloader lives in the Crucible checkout
// and is run from there (point it at this app with --app), not mirrored here.
//
//   node "IGNORE/The Crucible/sync-linter.mjs"           # sync
//   node "IGNORE/The Crucible/sync-linter.mjs" --check   # report drift only, exit 1 if stale (CI)
//   CRUCIBLE_HOME="D:\path\Crucible" node ... --sync     # override source location
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';

const argv = process.argv.slice(2);
const checkOnly = argv.includes('--check');
const fromArg = (() => { const i = argv.indexOf('--from'); return i >= 0 ? argv[i + 1] : null; })();

// Canonical checkout: --from wins, then $CRUCIBLE_HOME, then the default sibling.
const HOME = fromArg || process.env.CRUCIBLE_HOME || 'D:\\My Projects\\Crucible';
const SRC = path.join(HOME, 'probe-layout.js');
const LOCAL = path.join(path.dirname(url.fileURLToPath(import.meta.url)), 'probe-layout.js');

if (!fs.existsSync(SRC)) {
  console.error(`[sync-linter] canonical linter not found at:\n  ${SRC}`);
  console.error('  Clone Conqueror-Mod/Crucible to that path, set $CRUCIBLE_HOME, or pass --from <dir>.');
  process.exit(2);
}

const norm = s => s.replace(/\r\n/g, '\n');
const canonical = fs.readFileSync(SRC, 'utf8');
const local = fs.existsSync(LOCAL) ? fs.readFileSync(LOCAL, 'utf8') : '';

if (norm(local) === norm(canonical)) {
  console.log(`[sync-linter] up to date — probe-layout.js matches ${SRC}`);
  process.exit(0);
}
if (checkOnly) {
  console.error(`[sync-linter] DRIFT: probe-layout.js differs from ${SRC}. Run without --check to update.`);
  process.exit(1);
}
fs.writeFileSync(LOCAL, canonical);
console.log(`[sync-linter] updated probe-layout.js from ${SRC} (${canonical.length} bytes).`);
