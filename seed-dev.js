/**
 * ═══════════════════════════════════════════════════════════════════════
 *  CONQUERED TIME — Stress-Test Dev Seed v4.0
 *  Run:  npm run seed      → seeds ./IGNORE/dev-data/dev-vault.db (never touches real vault)
 *        npm run dev       → launches app using dev-vault.db
 *
 *  v4 turns the seed into a MEASUREMENT INSTRUMENT for the quality campaign:
 *  every fixture is a deliberate probe with a documented target. Canonical
 *  baselines from v3 are preserved (same semantics), stress data is added.
 *
 *  WHAT THIS SEEDS
 *  ───────────────
 *  • 1 dev user (TOTP bypassed, profile pre-filled, work_state TX → default policy)
 *  • 13 companies:
 *      1 Zenith Analytics    canonical clean baseline (all fields)
 *      2 Apex Digital        canonical clean baseline (all fields)
 *      3 Café Müller 東京 🚀  unicode/emoji/accents in every text sink
 *      4 <script>… & "Sons"  XSS canary — if ANY sink executes it, document.title
 *                            becomes 'XSS-FIRED' (machine-detectable)
 *      5 (120-char name)     truncation/overflow probes
 *      6 Solo                minimal — ONLY name populated
 *      7 "  Padded Name  "   leading/trailing whitespace
 *      8 O'Brien & Sons "Quality"  quote handling (SQL/JSON/CSV/HTML)
 *      9 Meridian Ops        HIGH VOLUME — 92 clean entries over ~4 months
 *    9b-d Vertex Alpha/Beta/Gamma — GALAXY TRIO: three rows sharing
 *                            hier_company 'Vertex Group' so the Company
 *                            Galaxy (multi-project grouping, drill-in, the
 *                            grouped list accordion) is exercised out of
 *                            the box (docs/PLAN-company-galaxy.md)
 *     10 Pristine Control Co ZERO entries/tasks — control baseline; inserted
 *                            LAST so run-app verify-cursed-path targets it
 *  • 106 time entries:
 *      – 6 canonical (5 clean + the 6-issue discrepancy session — unchanged)
 *      – 1 edge-probe session (see PROBES below)
 *      – 1 LEGACY PLAINTEXT entry (rows_json set, rows_enc NULL → exercises
 *        the at-login encryption migration)
 *      – 1 future-dated entry (tomorrow)
 *      – 2 same-date entries (one company, one day — ambiguity probe)
 *      – 92 volume entries (company 9; all clean, <210m → no compliance flags)
 *      – 3 galaxy entries (one per Vertex row; clean, <210m, staggered
 *        recency so the galaxy's systems get distinct sizes + fades)
 *  • 12 task_items: entry-1 compliance set (2 break/1 lunch) + Dispatch tasks,
 *    an in-progress BREAK on an old entry, a zero-duration task, a 25-hour
 *    task, an emoji/HTML-label task, and 2 ORPHANS (entry_id → nonexistent).
 *  • 3 backup fixtures (vault-<stamp>.db) so the Backup Library has data.
 *  • App settings under REAL ui_* / win_* keys + ui_onboardingDone=1 so the
 *    first-login tour doesn't block automated sweeps.
 *
 *  AUDIT EXPECTATION = 7  (6 canonical + 1 desc-only probe)
 *  ─────────────────────
 *    6 canonical, all on the "Discrepancy Test Session":
 *      no_clock_in, no_clock_out, zero_duration, over_12h,
 *      missing_break, missing_lunch
 *    +1: the edge session's desc-only row. As of C3 (PR #44) the shared
 *    rowHasContent() predicate includes desc, so a row holding a description
 *    with no punch FLAGS as no_clock_in (it used to be silently unaudited —
 *    that gap was defect D-004).
 *
 *  OTHER PROBES (not audit-flagged; the audit engine detects only the 6 types)
 *    • midnight-crossing row (23:30 → 00:15) — duration math/display
 *    • 00:00 → 23:59 row with stored total ≠ time span — stored-vs-span drift
 *    • custom Task Label not in the fixed <select> list — the inline label
 *      editor builds a fixed option list; a foreign value risks silent loss
 *    • very long multi-line description — clamp/tooltip/export flattening
 *    • orphan task_items — joins/summaries that assume a live parent entry
 *
 *  ⚠  NEVER ships in a production build — dev only (excluded from
 *     electron-builder `files`; dev_mode is gated on IS_DEV in main.js).
 * ═══════════════════════════════════════════════════════════════════════
 */

'use strict';

const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');

// ── Paths ──────────────────────────────────────────────────────────────────
const DATA_DIR   = path.join(__dirname, 'IGNORE', 'dev-data');
const DB_FILE    = path.join(DATA_DIR, 'dev-vault.db');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');

// ── Dev credentials ────────────────────────────────────────────────────────
const DEV_USERNAME = 'devuser';
const DEV_PASSWORD = 'devpass123';
const DEV_RECOVERY = 'SEED-ABCD-1234-EFGH';

// ── Reference data (must mirror the live app) ──────────────────────────────
const VALID_THEMES = ['memoria', 'zanarkand', 'rabanastre', 'treno', 'nibelheim'];
const SEED_THEME   = 'zanarkand';

// ── Designed totals (the self-check asserts these EXACTLY) ─────────────────
const EXPECT = {
  companies:      13,    // 10 v4 probes + the 3-row Vertex Group galaxy trio
  entries:        106,   // 6 canonical + 1 edge + 1 legacy + 1 future + 2 same-date + 92 volume + 3 galaxy
  volumeEntries:  92,
  taskItems:      12,
  breaks:         3,     // 2 on entry 1 + 1 in-progress on the edge entry
  lunches:        1,
  orphanTasks:    2,
  legacyEntries:  1,
  backups:        3,
  discrepancies:  7,     // 6 on Entry 3 + the edge session's desc-only row (flagged since C3 / D-004 fix)
  invoices:       2,     // INV-0001 (paid) + INV-0002 (unpaid) for Zenith
};

// ── Crypto + vault builders (extracted to test/vault-fixture.js so the
//    property tests build arbitrary vaults through the SAME plumbing) ────────
const fixture = require('./test/vault-fixture');
const { encrypt, decrypt, deriveKey, computeExpectedDiscrepancies } = fixture;

// ── Date helpers ───────────────────────────────────────────────────────────
function daysAgo(n) {          // negative n = future
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
function timeStr(h, m = 0) {
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
function unixNow(offsetMins = 0) {
  return Math.floor(Date.now() / 1000) + offsetMins * 60;
}

async function seed() {
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║   CONQUERED TIME — Stress-Test Dev Seed v4.0     ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  // ── Wipe & recreate data directory ────────────────────────────────────────
  if (fs.existsSync(DATA_DIR)) {
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
    console.log('✓ Cleared old database');
  }
  fs.mkdirSync(DATA_DIR,   { recursive: true });
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  console.log('✓ Created data directories');

  // ── Load sql.js ────────────────────────────────────────────────────────────
  let SQL;
  try {
    SQL = await require('sql.js')();
  } catch (e) {
    console.error('✗ sql.js not found. Run `npm install` first.\n', e.message);
    process.exit(1);
  }
  // ── Full schema (test/vault-fixture.js mirrors main.js — keep in sync) ────
  const db = fixture.createVaultSchema(SQL);
  console.log('✓ Schema created');

  // ── Dev user ───────────────────────────────────────────────────────────────
  const bcrypt     = require('bcryptjs');
  const keySalt    = crypto.randomBytes(32).toString('hex');
  const sessionKey = deriveKey(DEV_PASSWORD, keySalt);

  const passwordHash    = bcrypt.hashSync(DEV_PASSWORD, 10);
  const recoveryHash    = bcrypt.hashSync(DEV_RECOVERY, 10);
  const recoveryKeySalt = crypto.randomBytes(32).toString('hex');
  const recoveryEncKey  = deriveKey(DEV_RECOVERY, recoveryKeySalt);
  const recoveryKeyBlob = encrypt(sessionKey.toString('hex'), recoveryEncKey);

  // Dev avatar fixture — optional. Falls back to no avatar (initials render)
  // rather than dying if the asset is missing, so a stripped checkout still
  // seeds a usable vault instead of aborting AFTER wiping dev-data.
  let avatarDataUrl = null;
  try {
    avatarDataUrl = `data:image/png;base64,${fs.readFileSync(path.join(__dirname, 'assets', 'Yuri The Witch Doctor.png')).toString('base64')}`;
  } catch { console.log('  (no assets/Yuri The Witch Doctor.png — seeding without a dev avatar)'); }

  const profileData = {
    full_name:  'Dev Tester',
    email:      'dev@conqueredtime.app',
    phone:      '555-0100',
    job_title:  'QA Engineer',
    work_state: 'TX',           // not in STATE_POLICY → default break/lunch policy
    avatar:     avatarDataUrl,
    // Billing identity (invoice "Bill From") — populated so the seeded Invoices
    // ledger renders a complete demo.
    business_name:        'Dev Tester Consulting',
    business_address:     '742 Evergreen Terrace\nAustin, TX 78701',
    business_email:       'billing@conqueredtime.app',
    tax_id:               'EIN 00-0000000',
    payment_instructions: 'Bank transfer or PayPal to billing@conqueredtime.app. Net terms as stated.',
    default_currency:     'USD',
  };
  const profEnc = encrypt(JSON.stringify(profileData), sessionKey);

  const userId = fixture.insertUser(db, {
    username: DEV_USERNAME, passwordHash, totpSecret: 'DEVMODE_NO_TOTP',
    recoveryHash, keySalt, devMode: 1, displayName: 'Dev Tester',
    profileEnc: profEnc.data, profileIv: profEnc.iv, profileTag: profEnc.tag,
    recoveryKeyEnc: recoveryKeyBlob.data, recoveryKeyIv: recoveryKeyBlob.iv,
    recoveryKeyTag: recoveryKeyBlob.tag, recoveryKeySalt,
  });
  console.log(`✓ Dev user created (id: ${userId}, work_state: TX → default policy)`);

  // ── Company helper (fixture builder, bound to this vault) ────────────────
  const insertCompany = (data) => fixture.insertCompany(db, sessionKey, userId, data);
  const co = (name, extra = {}) => ({
    name, job_title: '', work_type: '', location: '', pay_rate: '',
    date_start: '', date_end: '', hier_company: '', hier_project: '',
    hier_platform: '', nav_id: '', platform_login: '', platform_email: '',
    platform_url: '', supervisors: '', notes: '', ...extra
  });

  // ── 1. Zenith Analytics — canonical baseline A ────────────────────────────
  const companyIdA = insertCompany(co('Zenith Analytics', {
    job_title: 'Data Annotation Specialist', work_type: 'Annotation',
    location: 'Remote — USA', pay_rate: 22.50, date_start: '2025-03-01',
    hier_company: 'Zenith Analytics', hier_project: 'Phoenix', hier_platform: 'ZenDesk Pro',
    nav_id: 'A123456', platform_login: 'dev_tester@zenith.com',
    platform_email: 'dev_tester@zenith.com', platform_url: 'https://platform.zenithanalytics.com',
    supervisors: 'Jane Smith, Robert Chen',
    notes: 'Primary client — annotation and QA cycles. High volume batches on Tuesdays.'
  }));
  console.log(`✓ Co 1: Zenith Analytics (id ${companyIdA}) — canonical baseline`);

  // ── 2. Apex Digital — canonical baseline B ────────────────────────────────
  const companyIdB = insertCompany(co('Apex Digital', {
    job_title: 'Remote QA Tester', work_type: 'Software QA',
    location: 'Remote — USA', pay_rate: 19.00, date_start: '2025-06-01',
    hier_company: 'Apex Digital', hier_project: 'Orion', hier_platform: 'ApexHub',
    nav_id: 'B987654', platform_login: 'dtester_apex',
    platform_email: 'dtester@apexdigital.io', platform_url: 'https://hub.apexdigital.io',
    supervisors: 'Marcus Webb',
    notes: 'Secondary client — bug regression cycles. Pays weekly via direct deposit.'
  }));
  console.log(`✓ Co 2: Apex Digital (id ${companyIdB}) — canonical baseline`);

  // ── 3. Unicode/emoji company ───────────────────────────────────────────────
  const companyIdU = insertCompany(co('Café Müller 東京 🚀', {
    job_title: 'Übersetzer / 翻訳者', work_type: 'Localization',
    location: 'Zürich → 東京', pay_rate: 31.25, date_start: '2025-09-15',
    hier_company: 'Café Müller 東京 🚀', hier_project: 'Proyecto Ñandú',
    hier_platform: 'Πλατφόρμα', nav_id: 'X192847',
    platform_login: 'çağla_üser', platform_email: 'tester+tag@example.co.jp',
    platform_url: 'https://例え.jp/パス?q=値', supervisors: 'François Lefèvre, 田中さん 🎌',
    notes: 'Unicode probe — accents, CJK, RTL follows: שלום عالم. Emoji: 🚀🎌❤️✓— dashes – − ‑.'
  }));
  console.log(`✓ Co 3: Café Müller 東京 🚀 (id ${companyIdU}) — unicode/emoji probe`);

  // ── 4. XSS canary company ──────────────────────────────────────────────────
  // If ANY render sink fails to escape, the onerror fires and sets
  // document.title = 'XSS-FIRED' — machine-detectable during sweeps.
  const companyIdX = insertCompany(co('<script>alert(1)</script> & "Sons"', {
    job_title: '<b>Bold Title</b>', work_type: 'QA & "Testing"',
    location: "O'Fallon, <MO>", pay_rate: 1.00, date_start: '2025-01-01',
    hier_company: '<script>alert(2)</script>', hier_project: '"Quoted" & <Tagged>',
    hier_platform: "It's a <platform>", nav_id: 'X000001',
    platform_login: '<input autofocus>', platform_email: 'x@x.com',
    platform_url: 'javascript:alert(3)',   // URL-scheme probe for link sinks
    supervisors: `<img src=x onerror="document.title='XSS-FIRED'">`,
    notes: `<img src=x onerror="document.title='XSS-FIRED'"> — if the title ever reads XSS-FIRED, a sink is unescaped.`
  }));
  console.log(`✓ Co 4: XSS canary (id ${companyIdX}) — escapeHtml probe at every sink`);

  // ── 5. 120-char name company ───────────────────────────────────────────────
  const LONG_NAME = 'The Extraordinarily Long Corporate Entity Name Meant To Probe Truncation Overflow And Wrapping Behaviour Everywhere Ltd';
  const companyIdL = insertCompany(co(LONG_NAME, {
    job_title: 'Chief Extremely Long Job Title Officer For Testing Header Layout Overflow Behaviour',
    work_type: 'Overflow', location: 'A Very Long Location String, Somewhere Far Away, Behind The Word Mountains',
    pay_rate: 999999.99, date_start: '2025-01-01',
    hier_company: LONG_NAME, hier_project: 'ProjectNameWithoutAnySpacesAtAllToProbeWordBreakBehaviourInNarrowColumns',
    hier_platform: 'PlatformOfUnusualSize', nav_id: 'X555555',
    supervisors: 'Supervisor One, Supervisor Two, Supervisor Three, Supervisor Four, Supervisor Five, Supervisor Six',
    notes: 'Long-string probe. ' + 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(20)
  }));
  console.log(`✓ Co 5: 120-char name (id ${companyIdL}) — overflow probe`);

  // ── 6. Minimal company — ONLY the name ─────────────────────────────────────
  const companyIdM = insertCompany(co('Solo'));
  console.log(`✓ Co 6: Solo (id ${companyIdM}) — empty-fields probe`);

  // ── 7. Whitespace-edges company ────────────────────────────────────────────
  const companyIdW = insertCompany(co('  Padded Name  ', {
    job_title: ' leading space', work_type: 'trailing space ',
    notes: '   Only whitespace matters here.   '
  }));
  console.log(`✓ Co 7: "  Padded Name  " (id ${companyIdW}) — whitespace probe`);

  // ── 8. Quotes company ──────────────────────────────────────────────────────
  const companyIdQ = insertCompany(co(`O'Brien & Sons "Quality"`, {
    job_title: `QA "Lead"`, work_type: `Q&A`, location: `St. John's`,
    pay_rate: 20.00, nav_id: 'X777777',
    supervisors: `D'Angelo O'Neil, "Bob"`,
    notes: `Apostrophes ('), double quotes ("), backticks (\`), commas, and ,,, "CSV,traps",`
  }));
  console.log(`✓ Co 8: O'Brien & Sons "Quality" (id ${companyIdQ}) — quotes probe`);

  // ── 9. Meridian Ops — high-volume company ─────────────────────────────────
  const companyIdV = insertCompany(co('Meridian Ops', {
    job_title: 'Operations Analyst', work_type: 'Operations', location: 'Remote — USA',
    pay_rate: 25.00, date_start: '2025-01-15', hier_company: 'Meridian Ops',
    hier_project: 'Atlas', hier_platform: 'MeridianHub', nav_id: 'X314159',
    supervisors: 'Dana Cruz', notes: 'Volume probe — 92 entries across ~4 months.'
  }));
  console.log(`✓ Co 9: Meridian Ops (id ${companyIdV}) — volume probe (92 entries)`);

  // ── 9b–9d. Vertex Group — GALAXY TRIO (Company Galaxy probe) ──────────────
  // Three rows sharing hier_company 'Vertex Group': the only multi-project
  // galaxy in the seed. Exercises grouping, L0 in-place expand, zoom, the
  // grouped list accordion, and the dashboard pre-zoom handoff.
  const galaxyDefs = [
    { proj: 'Alpha', plat: 'HubA', nav: 'V111111', login: 'vx_alpha' },
    { proj: 'Beta',  plat: 'HubB', nav: 'V222222', login: 'vx_beta'  },
    { proj: 'Gamma', plat: 'HubC', nav: 'V333333', login: 'vx_gamma' },
  ];
  const galaxyIds = galaxyDefs.map(d => insertCompany(co('Vertex ' + d.proj, {
    job_title: 'Multi-Project Contractor', work_type: 'QA',
    location: 'Remote — USA', pay_rate: 21.00, date_start: '2025-10-01',
    hier_company: 'Vertex Group', hier_project: d.proj, hier_platform: d.plat,
    nav_id: d.nav, platform_login: d.login,
    notes: `Galaxy probe — one of three rows under the 'Vertex Group' umbrella.`
  })));
  console.log(`✓ Co 9b–9d: Vertex Group galaxy trio (ids ${galaxyIds.join(', ')}) — multi-project grouping probe`);

  // ── 10. Pristine Control Co — MUST BE LAST (verify-cursed-path target) ─────
  const companyIdP = insertCompany(co('Pristine Control Co', {
    job_title: 'Control Group', work_type: 'Baseline', location: 'Remote',
    pay_rate: 15.00, nav_id: 'X000000',
    notes: 'Control baseline — the seed writes ZERO entries/tasks here. run-app verify-cursed-path uses it.'
  }));
  console.log(`✓ Co 10: Pristine Control Co (id ${companyIdP}) — control baseline (LAST on purpose)`);

  // ── Entry helpers ──────────────────────────────────────────────────────────
  const blank = (n) => Array(n).fill(null).map(() => ({
    label: '', name: '', desc: '', total_mins: 0, clock_in: '', clock_out: ''
  }));
  const insertEntry = (companyId, dayOffset, label, rows, totalMins) =>
    fixture.insertEntry(db, sessionKey, userId, { companyId, logDate: daysAgo(dayOffset), label, rows, totalMins });
  // Legacy shape: PLAINTEXT rows_json, no rows_enc — the app must migrate it
  // to encrypted at first login (migrateTimeEntries). Probe for that path.
  const insertLegacyEntry = (companyId, dayOffset, label, rows, totalMins) =>
    fixture.insertLegacyEntry(db, userId, { companyId, logDate: daysAgo(dayOffset), label, rows, totalMins });

  // ═══════════════════════════════════════════════════════════════════════════
  //  CANONICAL ENTRIES 1–6  (default policy: breaks ≥210m; lunch >300m)
  // ═══════════════════════════════════════════════════════════════════════════

  // ── Entry 1: TODAY — Zenith — CLEAN, long (360m) → compliant via task_items
  const entry1Rows = [
    { label: 'Annotation', name: 'Batch Phoenix-001', desc: 'Text classification — set A', total_mins: 90,  clock_in: timeStr(8, 0),  clock_out: timeStr(9, 30) },
    { label: 'Annotation', name: 'Batch Phoenix-002', desc: 'Text classification — set B', total_mins: 105, clock_in: timeStr(9, 45), clock_out: timeStr(11, 30) },
    { label: 'QA',         name: 'Review pass',        desc: 'Spot-check AM annotations',   total_mins: 60,  clock_in: timeStr(12, 0), clock_out: timeStr(13, 0) },
    { label: 'Annotation', name: 'Batch Phoenix-003', desc: 'Text classification — set C', total_mins: 105, clock_in: timeStr(13, 0), clock_out: timeStr(14, 45) },
    ...blank(11)
  ];
  const entry1Id = insertEntry(companyIdA, 0, 'Morning Annotation Block', entry1Rows, 360);
  console.log('✓ Entry 1: Today — Zenith — CLEAN compliant (6h, breaks+lunch as task_items)');

  // ── Entry 2: YESTERDAY — Apex — CLEAN, short (180m)
  const entry2Rows = [
    { label: 'QA',         name: 'Regression suite A', desc: 'Login + auth edge cases', total_mins: 120, clock_in: timeStr(9, 0),   clock_out: timeStr(11, 0) },
    { label: 'Bug Report', name: 'File BRs',           desc: 'Wrote up 3 P2 bugs',      total_mins: 60,  clock_in: timeStr(11, 15), clock_out: timeStr(12, 15) },
    ...blank(13)
  ];
  insertEntry(companyIdB, 1, 'QA Regression Day', entry2Rows, 180);
  console.log('✓ Entry 2: Yesterday — Apex — CLEAN short (3h)');

  // ── Entry 3: 3 DAYS AGO — Zenith — DISCREPANCY SESSION (exactly 6 issues)
  const entry3Rows = [
    { label: 'Annotation', name: 'Forgot clock-in',  desc: 'Has clock-out, no clock-in', total_mins: 60,  clock_in: '',             clock_out: timeStr(10, 0) },  // no_clock_in
    { label: 'QA',         name: 'Forgot clock-out', desc: 'Has clock-in, no clock-out', total_mins: 0,   clock_in: timeStr(10, 0), clock_out: '' },              // no_clock_out
    { label: 'Admin',      name: 'Zero duration',    desc: 'In+out but 0 minutes',       total_mins: 0,   clock_in: timeStr(11, 0), clock_out: timeStr(11, 30) }, // zero_duration
    { label: 'Annotation', name: 'Marathon block',   desc: 'Over 12h on one row',        total_mins: 780, clock_in: timeStr(0, 0),  clock_out: timeStr(13, 0) },  // over_12h
    ...blank(11)
  ];
  insertEntry(companyIdA, 3, 'Discrepancy Test Session', entry3Rows, 480);   // 480m + no break/lunch → missing_break + missing_lunch
  console.log('✓ Entry 3: 3 days ago — Zenith — DISCREPANCY session (6 canonical issues)');

  // ── Entry 4: 5 DAYS AGO — Apex — CLEAN (150m)
  const entry4Rows = [
    { label: 'QA',         name: 'Smoke test build 42', desc: 'Full smoke test post-deploy',  total_mins: 60, clock_in: timeStr(10, 0),  clock_out: timeStr(11, 0) },
    { label: 'Bug Report', name: 'Critical BR',         desc: 'P1 crash on checkout — filed', total_mins: 30, clock_in: timeStr(11, 0),  clock_out: timeStr(11, 30) },
    { label: 'QA',         name: 'Verify hotfix',       desc: 'Confirmed fix on build 42a',   total_mins: 60, clock_in: timeStr(11, 30), clock_out: timeStr(12, 30) },
    ...blank(12)
  ];
  insertEntry(companyIdB, 5, 'Hotfix Verification', entry4Rows, 150);
  console.log('✓ Entry 4: 5 days ago — Apex — CLEAN (2h 30m)');

  // ── Entry 5: 10 DAYS AGO — Zenith — CLEAN (200m)
  const entry5Rows = [
    { label: 'Training',   name: 'Platform onboarding', desc: 'ZenDesk Pro tutorial modules', total_mins: 120, clock_in: timeStr(9, 0),  clock_out: timeStr(11, 0) },
    { label: 'Annotation', name: 'Trial batch',         desc: 'Trial annotation set',         total_mins: 80,  clock_in: timeStr(11, 0), clock_out: timeStr(12, 20) },
    ...blank(13)
  ];
  insertEntry(companyIdA, 10, 'Onboarding Week', entry5Rows, 200);
  console.log('✓ Entry 5: 10 days ago — Zenith — CLEAN (3h 20m)');

  // ── Entry 6: 14 DAYS AGO — Apex — CLEAN (90m)
  const entry6Rows = [
    { label: 'QA', name: 'Environment setup', desc: 'VPN + tooling setup for Apex', total_mins: 90, clock_in: timeStr(14, 0), clock_out: timeStr(15, 30) },
    ...blank(14)
  ];
  insertEntry(companyIdB, 14, 'Setup Day', entry6Rows, 90);
  console.log('✓ Entry 6: 14 days ago — Apex — CLEAN (1h 30m)');

  // ═══════════════════════════════════════════════════════════════════════════
  //  STRESS ENTRIES
  // ═══════════════════════════════════════════════════════════════════════════

  // ── Edge-probe session: 2 DAYS AGO — Café Müller — stored total 150m (<210 →
  //    no compliance flags). Contains ONE audit-visible probe (desc-only row).
  const LONG_DESC = [
    'Line one of a deliberately long, multi-line description meant to probe the .desc-clamp two-line ellipsis, the full-text tooltip, and export flattening.',
    'Line two continues with unicode — Zürich, 東京, ñandú, שלום — and emoji 🚀🎌.',
    'Line three has "double quotes", \'single quotes\', <angle brackets>, and a trailing run of text long enough to guarantee the clamp actually cuts: ' + 'word '.repeat(60)
  ].join('\n');
  const edgeRows = [
    // AUDIT PROBE (flags no_clock_in since C3): desc-only row — user content
    // with no punch. rowHasContent() includes desc, so the audit sees it.
    { label: '', name: '', desc: 'Desc-only row — probes the desc-aware row predicate (audit flags no_clock_in; visible in log detail + exports).', total_mins: 0, clock_in: '', clock_out: '' },
    // Midnight-crossing: display/duration-math probe (audit ignores; total set already)
    { label: 'Other', name: 'Night shift wrap', desc: 'Crosses midnight — 23:30 → 00:15.', total_mins: 45, clock_in: timeStr(23, 30), clock_out: timeStr(0, 15) },
    // Boundary + stored-vs-span drift: 00:00→23:59 span (1439m) but stored 45m
    { label: 'Review', name: 'Boundary times', desc: 'Span 00:00→23:59 but stored total is 45m — stored-vs-span drift probe.', total_mins: 45, clock_in: timeStr(0, 0), clock_out: timeStr(23, 59) },
    // Custom label NOT in the tracker's fixed <select> list — silent-loss probe
    { label: 'Deep Work 🚀', name: 'Custom-label row', desc: 'Label is not in the fixed select list — does inline editing preserve it?', total_mins: 30, clock_in: timeStr(9, 0), clock_out: timeStr(9, 30) },
    // Long multi-line unicode description
    { label: 'Other', name: 'Übersetzung 完了 🎌', desc: LONG_DESC, total_mins: 30, clock_in: timeStr(10, 0), clock_out: timeStr(10, 30) },
    ...blank(10)
  ];
  const edgeEntryId = insertEntry(companyIdU, 2, 'Edge-Case Probe Session "quoted" <tagged>', edgeRows, 150);
  console.log('✓ Edge entry: 2 days ago — Café Müller — 5 probes (none audit-flagged)');

  // ── Legacy plaintext entry: 8 DAYS AGO — Apex — rows_json set, rows_enc NULL
  const legacyRows = [
    { label: 'QA', name: 'Legacy-format session', desc: 'Stored as plaintext rows_json — must be encrypted by the at-login migration.', total_mins: 120, clock_in: timeStr(9, 0), clock_out: timeStr(11, 0) },
    ...blank(4)
  ];
  insertLegacyEntry(companyIdB, 8, 'Legacy Plaintext Session', legacyRows, 120);
  console.log('✓ Legacy entry: 8 days ago — Apex — PLAINTEXT rows_json (migration probe)');

  // ── Future entry: TOMORROW — Zenith — date-handling probe
  const futureRows = [
    { label: 'Admin', name: 'Scheduled prep', desc: 'Entry dated tomorrow — date filter/sort probe.', total_mins: 60, clock_in: timeStr(9, 0), clock_out: timeStr(10, 0) },
    ...blank(4)
  ];
  insertEntry(companyIdA, -1, 'Future-Dated Session', futureRows, 60);
  console.log('✓ Future entry: TOMORROW — Zenith — date-handling probe');

  // ── Same-date pair: 6 DAYS AGO — Apex — two entries, one company, one day
  insertEntry(companyIdB, 6, 'Split Shift — AM', [
    { label: 'QA', name: 'AM block', desc: 'First of two same-day sessions.', total_mins: 60, clock_in: timeStr(8, 0), clock_out: timeStr(9, 0) },
    ...blank(4)
  ], 60);
  insertEntry(companyIdB, 6, 'Split Shift — PM', [
    { label: 'QA', name: 'PM block', desc: 'Second of two same-day sessions — which one does the tracker load?', total_mins: 90, clock_in: timeStr(13, 0), clock_out: timeStr(14, 30) },
    ...blank(4)
  ], 90);
  console.log('✓ Same-date pair: 6 days ago — Apex — tracker ambiguity probe');

  // ── Volume: 92 CLEAN entries — Meridian Ops — days 15..106
  const VOL_LABELS = ['QA', 'Annotation', 'Review', 'Admin', 'Research'];
  for (let i = 0; i < EXPECT.volumeEntries; i++) {
    const mins  = 60 + (i % 5) * 30;                     // 60..180 (<210 → no flags)
    const startH = 8 + (i % 6);
    const rows = [
      {
        label: VOL_LABELS[i % VOL_LABELS.length],
        name:  `Batch M-${String(i + 1).padStart(3, '0')}`,
        desc:  `Volume fixture ${i + 1} of ${EXPECT.volumeEntries}.`,
        total_mins: mins,
        clock_in:  timeStr(startH, 0),
        clock_out: timeStr(startH + Math.floor(mins / 60), mins % 60),
      },
      ...blank(4)
    ];
    insertEntry(companyIdV, 15 + i, `Meridian Day ${i + 1}`, rows, mins);
  }
  console.log(`✓ Volume: ${EXPECT.volumeEntries} clean entries — Meridian Ops — days 15..${14 + EXPECT.volumeEntries}`);

  // ── Galaxy: 3 CLEAN entries — one per Vertex row, staggered recency ────────
  // Distinct hours → distinct system sizes; staggered last-worked days → the
  // identity-hue recency fade is visible inside the galaxy. All <210m so the
  // audit expectation is untouched.
  const galaxyEntryDefs = [
    { day: 1, mins: 180, name: 'Alpha sprint QA' },   // vivid
    { day: 4, mins: 120, name: 'Beta regression'  },
    { day: 8, mins: 60,  name: 'Gamma triage'     },  // most faded
  ];
  galaxyEntryDefs.forEach((d, i) => {
    const rows = [
      { label: 'QA', name: d.name, desc: `Vertex Group galaxy fixture ${i + 1} of 3.`,
        total_mins: d.mins, clock_in: timeStr(9, 0),
        clock_out: timeStr(9 + Math.floor(d.mins / 60), d.mins % 60) },
      ...blank(4)
    ];
    insertEntry(galaxyIds[i], d.day, `Vertex ${galaxyDefs[i].proj} Session`, rows, d.mins);
  });
  console.log('✓ Galaxy: 3 clean entries — Vertex Alpha/Beta/Gamma — days 1/4/8');

  // ═══════════════════════════════════════════════════════════════════════════
  //  TASK ITEMS
  // ═══════════════════════════════════════════════════════════════════════════
  const now = unixNow();
  const ti = (entryId, label, type, start, stop, dur) =>
    fixture.insertTaskItem(db, userId, { entryId, label, itemType: type, startedAt: start, stoppedAt: stop, durationSecs: dur });

  // Entry 1 compliance + Dispatch set (canonical, unchanged)
  ti(entry1Id, 'Morning break',   'break', now - 7200, now - 6300, 900);
  ti(entry1Id, 'Afternoon break', 'break', now - 3600, now - 2700, 900);
  ti(entry1Id, 'Lunch',           'lunch', now - 5400, now - 3600, 1800);
  ti(entry1Id, 'Review Phoenix guidelines',        'task', now - 7200, now - 6300, 900);
  ti(entry1Id, 'Annotation — set A',               'task', now - 6000, now - 4500, 1500);
  // NOTE (C6/D-012): entry 1 has no open punch, so this "in progress" task is
  // an ORPHAN — the login-time sweep (sweepOrphanTaskItems) stops it at first
  // sign-in. Seed-time counts below are pre-sweep.
  ti(entry1Id, 'Annotation — set B (in progress)', 'task', now - 1800, null, 0);
  console.log('✓ Task items: Entry 1 → 2 break + 1 lunch + 2 done + 1 in-progress (Dispatch)');

  // Edge-entry stress tasks
  ti(edgeEntryId, 'Stale break (never ended)', 'break', now - 200000, null, 0);            // in-progress break on an OLD entry
  ti(edgeEntryId, 'Zero-duration task',        'task',  now - 5000,  now - 5000, 0);       // 0s completed task
  ti(edgeEntryId, 'Marathon task (25h)',       'task',  now - 100000, now - 10000, 90000); // 25h duration
  ti(edgeEntryId, '🚀 <b>Deploy</b> & "review"','task',  now - 4000,  now - 3500, 500);     // emoji/HTML label
  console.log('✓ Task items: Edge entry → stale break, 0s task, 25h task, emoji/HTML label');

  // Orphans — entry_id points at a nonexistent entry (joins/summaries probe)
  ti(999999, 'Orphaned done task',        'task', now - 9000, now - 8000, 1000);
  ti(999999, 'Orphaned in-progress task', 'task', now - 3000, null, 0);
  console.log('✓ Task items: 2 ORPHANS (entry_id 999999 — no such entry)');

  // ═══════════════════════════════════════════════════════════════════════════
  //  APP SETTINGS — real ui_*/win_* keys
  // ═══════════════════════════════════════════════════════════════════════════
  const settings = [
    ['ui_theme',                 SEED_THEME],
    ['ui_scale',                 'normal'],
    ['ui_timeFormat',            '12h'],
    ['ui_reducedMotion',         'false'],
    ['ui_highContrast',          'false'],
    ['ui_colorblind',            'off'],
    ['ui_focusIndicators',       'false'],
    ['ui_autoLockMinutes',       '0'],
    ['ui_autoSaveInterval',      '30'],
    ['ui_onboardingDone',        '1'],     // tour pre-done so modals don't block automated sweeps
    ['win_startMaximized',       'true'],
    ['win_rememberPosition',     'false'],
    ['invoice_prefix',           'INV-'],
    ['invoice_next',             '3'],     // two invoices seeded below (INV-0001/0002)
  ];
  for (const [key, value] of settings) {
    db.run('INSERT INTO app_settings (key, value) VALUES (?,?)', [key, value]);
  }
  console.log(`✓ App settings seeded (theme=${SEED_THEME}, 12h, onboarding tour pre-done)`);

  // ═══════════════════════════════════════════════════════════════════════════
  //  INVOICES — two issued invoices for Zenith so the ledger has demo data.
  //  Frozen InvoiceDoc snapshot (mirrors ipc/invoices.ts buildDoc); per-day
  //  lines rounded so amounts sum to the subtotal.
  // ═══════════════════════════════════════════════════════════════════════════
  const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
  const billFrom = {
    name: profileData.business_name, address: profileData.business_address,
    email: profileData.business_email, taxId: profileData.tax_id,
    paymentInstructions: profileData.payment_instructions,
  };
  const makeInvoiceDoc = ({ number, issueDate, dueDate, terms, from, to, days, rate, taxRate = 0, notes = '' }) => {
    const lineItems = days.map(([date, mins]) => {
      const hours = round2(mins / 60);
      return { date, minutes: mins, hours, rate, amount: round2(hours * rate) };
    });
    const totalMinutes = lineItems.reduce((s, l) => s + l.minutes, 0);
    const subtotal = round2(lineItems.reduce((s, l) => s + l.amount, 0));
    const taxAmount = round2((subtotal * taxRate) / 100);
    return {
      number, issueDate, dueDate, terms, periodFrom: from, periodTo: to,
      currency: 'USD', companyId: companyIdA,
      billFrom, billTo: { name: 'Zenith Analytics', address: '' }, rate,
      lineItems, totalMinutes, totalHours: round2(totalMinutes / 60),
      subtotal, taxRate, taxAmount, total: round2(subtotal + taxAmount), notes,
    };
  };
  const nowSecs = Math.floor(Date.now() / 1000);
  fixture.insertInvoice(db, sessionKey, userId, {
    seq: 1, status: 'paid', paidAt: nowSecs - 5 * 86400, issuedAt: nowSecs - 20 * 86400,
    doc: makeInvoiceDoc({
      number: 'INV-0001', issueDate: daysAgo(20), dueDate: daysAgo(-10), terms: 'Net 30',
      from: daysAgo(50), to: daysAgo(21), rate: 22.50,
      days: [[daysAgo(48), 360], [daysAgo(45), 480], [daysAgo(30), 300]], notes: 'Thank you for your business.',
    }),
  });
  fixture.insertInvoice(db, sessionKey, userId, {
    seq: 2, status: 'unpaid', issuedAt: nowSecs - 2 * 86400,
    doc: makeInvoiceDoc({
      number: 'INV-0002', issueDate: daysAgo(2), dueDate: daysAgo(-28), terms: 'Net 30',
      from: daysAgo(20), to: daysAgo(1), rate: 22.50, taxRate: 8.25,
      days: [[daysAgo(10), 450], [daysAgo(5), 390], [daysAgo(2), 180]],
    }),
  });
  console.log('✓ Invoices: INV-0001 (paid) + INV-0002 (unpaid, taxed) for Zenith; next = INV-0003');

  // ── Persist DB ─────────────────────────────────────────────────────────────
  fs.writeFileSync(DB_FILE, Buffer.from(db.export()));
  console.log(`✓ Database written → ${DB_FILE}`);

  // ── Backup fixtures — 3 dated copies so the Backup Library has data ────────
  const backupStamps = [
    new Date(Date.now() - 3 * 86400000),
    new Date(Date.now() - 1 * 86400000),
    new Date(Date.now() - 3600000),
  ].map(d => d.toISOString().replace(/[:.]/g, '-').slice(0, 19));
  for (const stamp of backupStamps) {
    fs.copyFileSync(DB_FILE, path.join(BACKUP_DIR, `vault-${stamp}.db`));
  }
  console.log(`✓ Backup fixtures: ${backupStamps.length} × vault-<stamp>.db in dev-data/backups`);

  // ── Profile manifest ────────────────────────────────────────────────────────
  const manifest = {
    username: DEV_USERNAME, display_name: 'Dev Tester', avatar_thumb_48: null,
    created_at: Math.floor(Date.now() / 1000),
    auth_methods: ['password+totp'], key_derivation_version: 'pbkdf2-v1',
    passkey_credential_id: null
  };
  fs.writeFileSync(path.join(DATA_DIR, 'profile-manifest.json'), JSON.stringify(manifest, null, 2));
  console.log('✓ Profile manifest written');

  // ═══════════════════════════════════════════════════════════════════════════
  //  SELF-CHECK — automated PASS/FAIL on the data just written
  // ═══════════════════════════════════════════════════════════════════════════
  const one = (sql) => Number(db.exec(sql)[0].values[0][0]);
  const checks = [];
  const expect = (name, expected, actual) =>
    checks.push({ name, expected, actual, pass: String(expected) === String(actual) });

  expect('users.count',            1,                    one('SELECT COUNT(*) FROM users'));
  expect('user.dev_mode',          1,                    one('SELECT dev_mode FROM users'));
  expect('companies.count',        EXPECT.companies,     one('SELECT COUNT(*) FROM companies'));
  expect('time_entries.count',     EXPECT.entries,       one('SELECT COUNT(*) FROM time_entries'));
  expect('entries.volume_co',      EXPECT.volumeEntries, one(`SELECT COUNT(*) FROM time_entries WHERE company_id=${companyIdV}`));
  expect('entries.pristine_co',    0,                    one(`SELECT COUNT(*) FROM time_entries WHERE company_id=${companyIdP}`));
  expect('entries.legacy_plain',   EXPECT.legacyEntries, one('SELECT COUNT(*) FROM time_entries WHERE rows_enc IS NULL'));
  expect('task_items.count',       EXPECT.taskItems,     one('SELECT COUNT(*) FROM task_items'));
  expect('task_items.break',       EXPECT.breaks,        one("SELECT COUNT(*) FROM task_items WHERE item_type='break'"));
  expect('task_items.lunch',       EXPECT.lunches,       one("SELECT COUNT(*) FROM task_items WHERE item_type='lunch'"));
  expect('task_items.orphans',     EXPECT.orphanTasks,   one('SELECT COUNT(*) FROM task_items WHERE entry_id NOT IN (SELECT id FROM time_entries)'));
  expect('app_settings.count',     settings.length,      one('SELECT COUNT(*) FROM app_settings'));
  expect('ui_theme.valid', true, VALID_THEMES.includes(
    db.exec("SELECT value FROM app_settings WHERE key='ui_theme'")[0].values[0][0]));
  expect('no_bare_setting_keys', 0, one(
    "SELECT COUNT(*) FROM app_settings WHERE key NOT LIKE 'ui\\_%' ESCAPE '\\' AND key NOT LIKE 'win\\_%' ESCAPE '\\' AND key NOT LIKE 'invoice\\_%' ESCAPE '\\'"));
  expect('invoices.count', EXPECT.invoices, one('SELECT COUNT(*) FROM invoices'));
  expect('backups.count', EXPECT.backups,
    fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith('vault-') && f.endsWith('.db')).length);
  // Encryption round-trips with the derived session key
  let decOk = false;
  try {
    const r = db.exec('SELECT data_enc,data_iv,data_tag FROM companies LIMIT 1')[0].values[0];
    decOk = JSON.parse(decrypt(r[0], r[1], r[2], sessionKey)).name === 'Zenith Analytics';
  } catch {}
  expect('company.decrypt_roundtrip', true, decOk);
  // Replicate the audit detector to assert the expected count BEFORE the app runs.
  // Breakdown: 6 canonical (Entry 3) + 1 desc-only probe (edge session, no_clock_in) = 7.
  const expectedDiscrepancies = computeExpectedDiscrepancies(db, userId, sessionKey);
  expect('audit.discrepancies', EXPECT.discrepancies, expectedDiscrepancies);

  const failed = checks.filter(c => !c.pass);
  console.log('\n┌─ SELF-CHECK (data tier) ───────────────────────────────────┐');
  for (const c of checks) {
    const tag = c.pass ? 'PASS' : 'FAIL';
    console.log(`│ [${tag}] ${c.name.padEnd(26)} expected=${String(c.expected).padEnd(6)} got=${c.actual}`);
  }
  console.log('└────────────────────────────────────────────────────────────┘');
  if (failed.length) {
    console.log(`\n✗ SELF-CHECK FAILED — ${failed.length} bug(s) in the seed data:`);
    for (const c of failed) console.log(`   • ${c.name}: expected ${c.expected}, got ${c.actual}`);
    process.exitCode = 1;
  } else {
    console.log('\n✓ SELF-CHECK PASSED — all data-tier variables green.');
  }

  printPacket();
}

// computeExpectedDiscrepancies (the mirror of countAuditDiscrepancies) now
// lives in test/vault-fixture.js — the differential oracle imports the SAME
// mirror, so seed-time assertion and the property test can never drift apart.

function printPacket() {
  console.log(`
╔══════════════════════════════════════════════╗
║           DEV LOGIN CREDENTIALS              ║
╠══════════════════════════════════════════════╣
║  Username : devuser                          ║
║  Password : devpass123                       ║
║  TOTP     : (leave blank — bypassed in dev)  ║
║  Recovery : SEED-ABCD-1234-EFGH              ║
╚══════════════════════════════════════════════╝

╔══════════════════════════════════════════════════════════════════╗
║   VERIFICATION PACKET v4 — work top-to-bottom                     ║
║   Run \`npm run dev\`. Mark each line PASS or FAIL.                ║
║                                                                    ║
║   Tier A = AUTOMATED  (state/data; also asserted by run-app)       ║
║   Tier B = MANUAL     (visual/interaction; confirm by eye)         ║
╚══════════════════════════════════════════════════════════════════╝

── 1. LAUNCH & LOGIN ─────────────────────────────────────────────
  A  splash.theme_aware ........ splash shows branded icon/wordmark/progress
  B  login.background ......... animated cell grid + hover glow render
  A  login.auth ............... devuser / devpass123, TOTP blank → Dashboard
  A  login.audit_notice ....... audit notice modal appears (6 discrepancies)
  B  login.view_password ...... eye icon toggles password visibility

── 2. DASHBOARD ──────────────────────────────────────────────────
  A  dash.stat_chips .......... totals populated; companies = 10
  B  dash.mini_spiderweb ...... 10 nodes render legibly (incl. long/unicode names)
  A  dash.recent_activity ..... today's Zenith entry listed
  B  dash.quick_actions ....... buttons navigate correctly

── 3. COMPANIES ──────────────────────────────────────────────────
  A  comp.count ............... all 13 companies present
  B  comp.spiderweb ........... 10-node force graph stays stable/readable
  A  comp.fields_zenith ....... Zenith detail: ALL fields populated
  B  comp.unicode ............. Café Müller 東京 🚀 renders everywhere it appears
  A  comp.xss_canary .......... open the <script> company; document.title must
        NEVER read 'XSS-FIRED' (check after visiting every page that shows it)
  B  comp.long_name ........... 120-char company truncates/wraps sanely
  B  comp.minimal ............. 'Solo' detail pane renders with empty fields
  B  comp.whitespace .......... '  Padded Name  ' — is it trimmed anywhere?
  B  comp.quotes .............. O'Brien & Sons "Quality" renders unmangled
  A  comp.persist ............. edit a field → Save → reopen shows the change
  A  comp.crud ................ add an 11th company, save, delete it

── 4. TIME TRACKER ───────────────────────────────────────────────
  A  trk.company_select ....... pick Zenith; today's entry loads its rows
  A  trk.clock_in_guard ....... Clock In blocked without Task Label + Name
  A  trk.clock_in_out ......... clock in → out → duration computes
  A  trk.manual_entry ......... "+ Manual Entry" adds an editable backfill row
  A  trk.break_lunch .......... Break / Lunch controls add task_items
  B  trk.inline_edit .......... double-click a clock time → edit → recalcs
  B  trk.desc_multiline ....... edge session: long desc clamps to 2 lines + tooltip
  B  trk.custom_label ......... edge session: 'Deep Work 🚀' label survives an
        inline edit of a DIFFERENT field on the same row (silent-loss probe)
  B  trk.midnight_row ......... 23:30 → 00:15 row displays a sane duration
  B  trk.same_date ............ Apex @ 6 days ago: which Split Shift loads? (note it)
  A  trk.no_dupe_save ......... Save Session → no duplicate rows in Global Log

── 5. DISPATCH (Task Timer) ──────────────────────────────────────
  A  disp.seeded_tasks ........ entry-1 tasks visible (3 done — the seeded
        in-progress one is auto-stopped by the login orphan sweep, C6/D-012)
  B  disp.sidebar_timer ....... start a task → sidebar timer ticks
  A  disp.stop_records ........ stop task → duration recorded
  A  disp.prefill ............. timer field pre-fills active session task name
  B  disp.emoji_label ......... 🚀 <b>Deploy</b> & "review" task renders escaped

── 6. GLOBAL LOG ─────────────────────────────────────────────────
  A  log.all_entries .......... 106 entries appear (perf: page stays responsive)
  A  log.filter_company ....... Zenith → 4, Apex → 6, Meridian → 92, Vertex → 1 each, Pristine → 0
  A  log.filter_dates ......... last-7-days filter correct (note: future entry!)
  B  log.future_entry ......... tomorrow-dated session — where does it sort?
  B  log.expand_detail ........ expand edge session → all 5 probe rows visible
  A  log.open_correct_date .... "Open" loads the session's logged date
  A  log.csv_export ........... CSV opens cleanly — quotes/unicode/newlines intact,
        no formula execution from the <script>/= cells
  B  log.pdf_export ........... PDF: NavID absent; long/unicode names don't break layout

── 7. REPORTS & AUDIT ────────────────────────────────────────────
  A  aud.discrepancy_count .... EXACTLY 7 issues: 6 on 'Discrepancy Test
        Session' (no_clock_in, no_clock_out, zero_duration, over_12h,
        missing_break, missing_lunch) + 1 no_clock_in on the edge session's
        desc-only row (desc-aware predicate — C3/D-004 fix)
  A  aud.desc_only_flagged .... the edge session's desc-only row IS flagged
        AND appears in Global Log detail + CSV/PDF exports (probe P1)
  A  aud.clean_sessions ....... volume/canonical clean sessions show NO issues
  A  aud.dismiss .............. Dismiss an issue → count drops to 5
  A  aud.apply_fix ............ Apply Fix on no_clock_out updates the row
  B  aud.wizard ............... Suggest/Acknowledge wizard steps each issue
  B  rep.volume ............... Period Summary / Company Breakdown handle 106
        entries without lag or layout breakage

── 8. SETTINGS  (sidebar gear or Ctrl+,) ─────────────────────────
  A  set.theme_default ........ opens on Zanarkand (seeded ui_theme)
  B  set.themes_all ........... all 5 themes apply live
  B  set.clock_format ......... 12h/24h re-renders on-screen times immediately
  A  set.scale ................ 4 scales; sidebar stays clickable at Large
  B  set.a11y ................. reduced motion / high contrast / colorblind toggle
  A  set.backup_library ....... 3 seeded backups list; preview decrypts counts
  A  set.db_clear_company ..... Single-company clear (Pristine) → 0 rows removed,
        others untouched
  A  set.about_info ........... Version / Electron / Node / Platform populated

── 9. TRAY + PROFILE ─────────────────────────────────────────────
  A  tray.menu ................ Open / Lock Session / Backup Now / Quit work
  A  prof.fields .............. Dev Tester / dev@conqueredtime.app / TX
  A  prof.avatar .............. seeded animated avatar shows in sidebar

── STRESS LEDGER — what each probe measures ──────────────────────
  P1 desc-only row ......... desc-aware predicate (C3/D-004: flags
        no_clock_in; visible in log detail + exports)
  P2 midnight crossing ..... duration math on 23:30→00:15
  P3 stored-vs-span drift .. 00:00→23:59 span vs stored 45m — which shows where?
  P4 custom label .......... fixed <select> vs foreign value — silent data loss?
  P5 long multiline desc ... clamp/tooltip/export flattening
  P6 XSS canary ............ document.title === 'XSS-FIRED' means an unescaped sink
  P7 legacy plaintext ...... at-login migration encrypts it; entry then readable
  P8 orphan task_items ..... dead-parent items; login sweep stops the
        in-progress one (C6/D-012)
  P9 stale open break ...... never-ended break on a punchless entry — login
        sweep stops it at the entry's last clock-out (C6/D-012)
  P10 volume (92) .......... perf of log/reports/dashboard aggregation
  P11 future date .......... sort/filter/aggregation placement
  P12 same-date pair ....... session picker (C6/D-005): picker on load,
        Global Log Open targets the exact session, Switch button
  P13 galaxy trio .......... 3 rows share hier_company 'Vertex Group':
        web shows ONE galaxy (13.5h · 3 projects) that expands, zooms,
        and shows planets; list shows the grouped accordion; dashboard
        click pre-zooms into it

══════════════════════════════════════════════════════════════════
  ⚡ \`npm run seed\` resets to this exact state (expected audit count = 7).
══════════════════════════════════════════════════════════════════
`);
}

seed().catch(e => { console.error('\n✗ Seed failed:', e); process.exit(1); });
