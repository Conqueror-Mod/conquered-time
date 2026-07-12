// Ambient type declarations for Conquered Time — Phase 1 of the TypeScript
// refactor (docs/refactor-plan.md). Declaration-only: nothing here exists at
// runtime. Renderer pages communicate through globals (no modules under the
// CSP `script-src 'self'` + no-bundler constraint), so the shared surface is
// declared globally for checkJs.

// ═══════════════════════════════════════════════════════════════════════════
//  Core data shapes
// ═══════════════════════════════════════════════════════════════════════════

/** One row of a tracker session, stored inside `rows_json`. */
interface EntryRow {
  label?: string;
  name?: string;
  /** Canonical description field. Some legacy rows used `description` —
   *  always read via `RowUtils.rowDesc()`, never directly (cluster C3). */
  desc?: string;
  /** Legacy alias for `desc` (see above). */
  description?: string;
  /** 24-hour zero-padded HH:MM, or '' when not punched. */
  clock_in?: string;
  clock_out?: string;
  total_mins?: number;
  /** True when added via "+ Manual Entry" (bypasses clock-in requirements). */
  _manual?: boolean;
}

/** Full time entry as returned by entries:all / entries:list / entries:get-active
 *  — rows_json decrypted. `id` is the normalized rowid (gotcha #1). */
interface TimeEntry {
  id: number;
  rid?: number;
  user_id: number;
  company_id: number;
  /** YYYY-MM-DD */
  log_date: string;
  session_label: string;
  /** Decrypted JSON array of EntryRow. Parse with JSON.parse. */
  rows_json: string;
  total_mins: number;
  created_at: number;
  updated_at: number;
  rows_enc?: string | null;
  rows_iv?: string | null;
  rows_tag?: string | null;
}

/** Lightweight entry from entries:summary — plaintext aggregate columns only.
 *  Deliberately has NO rows_json: the summary path never decrypts. Consumers
 *  needing per-row detail must use entries:all (TimeEntry). */
interface EntrySummary {
  id: number;
  rid?: number;
  company_id: number;
  log_date: string;
  session_label: string;
  total_mins: number;
}

/** Decrypted company blob (companies:list / companies:save payload).
 *  All fields except id/name live inside the encrypted data_enc JSON. */
interface Company {
  id: number;
  /** Not actually returned by companies:list (the blob is decrypted JSON) —
   *  declared for the defensive `c.id ?? c.rid` fallbacks. */
  rid?: number;
  name: string;
  job_title?: string;
  work_type?: string;
  location?: string;
  pay_rate?: number;
  date_start?: string;
  date_end?: string;
  hier_company?: string;
  hier_project?: string;
  hier_platform?: string;
  /** Never included in PDF exports — in-session only. */
  nav_id?: string;
  platform_login?: string;
  platform_email?: string;
  platform_url?: string;
  supervisors?: string;
  notes?: string;
  /** Per-company scheduled-report recipient override; falls back to the SMTP default recipient. */
  report_email?: string;
  /** Invoice currency (ISO code) override; blank falls back to the profile's default_currency. */
  currency?: string;
  /** Client address for the invoice "Bill To" block. */
  billing_address?: string;
  /** User-picked identity hue for the Company Web (#rrggbb). Overrides the
   *  auto hash-assigned hue in Identity mode; unset = auto. */
  color?: string;
}

/** Row of task_items (Dispatch tasks + break/lunch), entry_id-scoped. */
interface TaskItem {
  id: number;
  rid?: number;
  user_id: number;
  entry_id: number;
  label: string;
  item_type: 'task' | 'break' | 'lunch' | string;
  /** Unix epoch seconds. */
  started_at: number;
  stopped_at: number | null;
  duration_secs: number;
  created_at: number;
}

/** audit:get-policy response. Infinity thresholds are serialized as null. */
interface AuditPolicy {
  stateCode: string | null;
  stateName: string | null;
  policyLabel: string;
  /** True only when the state has its OWN policy tier (C5/D-007) — default-
   *  tier states must not get "<State> law requires…" copy. */
  hasStatePolicy: boolean;
  breakThresholds: Array<[number | null, number]>;
  lunchThreshMins: number;
  dispatchBreakWarnMins: number | null;
  dispatchLunchWarnMins: number | null;
  /** Break-style preference — 'pomodoro' swaps the LIVE cadence warnings only;
   *  the audit/compliance fields above always reflect the state policy. */
  breakStyle: 'state' | 'pomodoro';
  pomodoroPreset: string;
  pomodoro: PomodoroPresetInfo;
}

/** Pomodoro cadence preset (audit:get-policy .pomodoro). */
interface PomodoroPresetInfo {
  label: string;
  focusMins: number;
  breakMins: number;
  longBreakMins: number | null;
  cyclesPerLong: number | null;
}

/** session:get response (null when locked/logged out). */
interface SessionInfo {
  id: number;
  username: string;
  display_name: string | null;
  work_state: string | null;
}

/** Profile card data from profiles:list (manifest-backed, no vault loaded). */
interface Profile {
  username: string;
  display_name?: string | null;
  avatar_thumb_48?: string | null;
  auth_methods?: string[];
  key_derivation_version?: number;
  passkey_credential_id?: string | null;
}

/** Standard mutation result — every IPC.xxx mutation resolves to this. */
interface MutResult {
  ok: boolean;
  error?: string;
  id?: number | null;
}

/** entries:save result — adds optimistic-concurrency signalling.
 *  `stale:true` means a concurrent writer saved a newer version since the client
 *  last read the row; the write was rejected (nothing was overwritten).
 *  `updated_at` is the row's current server timestamp: after a successful save the
 *  client stores it to guard its next save; on a stale reject it reflects the
 *  newer stored value. */
interface EntrySaveResult extends MutResult {
  stale?: boolean;
  updated_at?: number | null;
}

/** Auth-flow result — login/recover/unlock add lockout + recovery flags. */
interface AuthResult extends MutResult {
  locked?: boolean;
  hoursRemaining?: number;
  attemptsLeft?: number;
  /** Secure sign-in (safeStorage) is enrolled for this profile. */
  quickUnlock?: boolean;
  passwordReset?: boolean;
  noKeyPacket?: boolean;
  canceled?: boolean;
}

interface AuditDismissedRow {
  entry_id: number;
  row_idx: number;
  type: string;
  emailed_at?: number | null;
}

// ── Invoicing (Phase 3) ──────────────────────────────────────────────────────
interface InvoiceLineItem { date: string; minutes: number; hours: number; rate: number; amount: number; }
interface InvoiceParty { name?: string; address?: string; email?: string; taxId?: string; paymentInstructions?: string; }
/** The frozen invoice snapshot stored (encrypted) at issue time. */
interface InvoiceDoc {
  number: string; issueDate: string; dueDate?: string; terms?: string;
  periodFrom: string; periodTo: string; currency: string; companyId: number;
  billFrom: InvoiceParty; billTo: InvoiceParty; rate: number;
  lineItems: InvoiceLineItem[]; totalMinutes: number; totalHours: number;
  subtotal: number; taxRate: number; taxAmount: number; total: number; notes?: string;
}
/** One row in the ledger list. */
interface InvoiceListRow {
  id: number; seq: number; status: 'unpaid' | 'paid' | 'void'; paid_at: number | null;
  issued_at: number; number: string; company_name: string;
  period_from: string; period_to: string; due_date: string; total: number; currency: string;
}
interface InvoicePreviewParams {
  companyId: number; fromDate: string; toDate: string;
  taxRate?: number; netDays?: string | number; issueDate?: string; notes?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
//  IPC channel map — single source of truth for both sides of every handler
//  (Phase 2 types the ipcMain.handle side from this same interface).
// ═══════════════════════════════════════════════════════════════════════════

interface IpcInvokeMap {
  // profiles
  'profiles:list': () => Profile[];
  'profiles:select': (payload: { username: string }) => MutResult;
  'profiles:load': (payload: { username: string }) => MutResult;
  'profiles:deselect': () => MutResult;
  'profiles:delete': (payload: { password: string }) => MutResult;
  // auth
  'auth:check-setup': () => { needsSetup: boolean };
  'auth:setup': (payload: {
    username: string; password: string;
    totpSecret: string; totpCode: string; recoveryCode: string;
  }) => AuthResult;
  'auth:login': (payload: { username: string; password: string; totpCode?: string }) => AuthResult;
  'auth:recover': (payload: object) => AuthResult;
  'auth:browse-backup': () => AuthResult;
  'auth:safe-check': () => { available: boolean; enrolled: boolean };
  'auth:safe-setup': (payload: { password: string }) => MutResult;
  'auth:safe-login': (payload?: object) => AuthResult;
  'auth:safe-disable': (payload: { password: string }) => MutResult;
  'auth:quick-unlock': (payload: { password: string }) => AuthResult;
  'auth:change-password': (payload: object) => AuthResult;
  'totp:generate': () => { secret: string; qrUrl: string };
  // session
  'session:get': () => SessionInfo | null;
  'session:heartbeat': () => null;
  // companies
  'companies:list': () => Company[];
  'companies:save': (data: Company | Omit<Company, 'id'>) => MutResult;
  'companies:delete': (id: number) => MutResult;
  // entries
  'entries:list': (companyId: number) => TimeEntry[];
  'entries:save': (entry: Partial<TimeEntry>) => EntrySaveResult;
  'entries:all': () => TimeEntry[];
  'entries:summary': () => EntrySummary[];
  'entries:get-active': () => TimeEntry | null;
  'entries:get': (id: number) => TimeEntry | null;
  // tasks
  'tasks:list': (entryId: number) => TaskItem[];
  'tasks:save': (item: Partial<TaskItem>) => MutResult;
  'tasks:delete': (id: number) => MutResult;
  'tasks:recent-labels': () => string[];
  /** Break/lunch counts keyed by entry_id (handler ignores any argument). */
  'tasks:summary': (entryId?: number) => Record<string, { break_count: number; lunch_count: number }>;
  // settings
  'settings:get': (key: string) => string | null;
  'settings:set': (payload: { key: string; value: string }) => MutResult;
  // app
  'app:notify': (payload: { title?: string; body?: string }) => MutResult;
  'app:get-info': () => {
    version: string; electronVersion: string; nodeVersion: string;
    platform: string; arch: string;
  };
  // auto-updater (electron-updater); status also pushed via 'update:status' event
  'update:check': () => UpdateStatus;
  'update:status': () => UpdateStatus;
  'update:download': () => MutResult;
  'update:install': () => MutResult;
  'update:just-updated': () => { updated: boolean; from?: string; to?: string };
  // db maintenance
  'db:clear-timeclock': () => MutResult;
  'db:clear-timeclock-company': (payload: { companyId: number }) => MutResult;
  'db:clear-companies': () => MutResult;
  'db:clear-full': () => MutResult;
  // profile
  'profile:get': () => {
    display_name: string; full_name: string; email: string;
    phone: string; job_title: string; avatar: string | null;
    /** Stored inside the encrypted profile blob by profile:save. */
    work_state?: string | null;
    /** Break-style prefs (encrypted blob); absent on legacy blobs. */
    break_style?: 'state' | 'pomodoro';
    pomodoro_preset?: string;
    /** Billing identity (encrypted blob) — the invoice "Bill From". Absent on
     *  legacy blobs; drives the invoicing feature. */
    business_name?: string;
    business_address?: string;
    business_email?: string;
    tax_id?: string;
    payment_instructions?: string;
    default_currency?: string;
  } | null;
  'profile:save': (payload: object) => MutResult;
  // audit
  'audit:get-policy': () => AuditPolicy;
  'audit:get-dismissed': () => AuditDismissedRow[];
  'audit:dismiss': (payload: { entry_id: number; row_idx: number; type: string }) => MutResult;
  'audit:undismiss': (payload: { entry_id: number; row_idx: number; type: string }) => MutResult;
  'audit:clear-dismissed': () => MutResult;
  'audit:apply-fix': (payload: object) => MutResult & { stale?: boolean; updated_at?: number | null };
  'audit:open-wizard': (payload?: { mode?: string; theme?: string }) => MutResult;
  'audit:count': () => number;
  'audit:email-notify': (payload: {
    entry_id: number; row_idx: number; type: string;
    subject?: string; message?: string;
  }) => MutResult & { to?: string };
  'audit:list': () => object[];
  // backup
  'backup:list': () => Array<{
    filename: string; timestamp?: string; sizeKB?: number;
  }>;
  'backup:preview': (file: string) => {
    error?: string; username?: string; companyCount?: number;
    entryCount?: number; dateFrom?: string; dateTo?: string;
  };
  'backup:restore': (file: string) => MutResult;
  // email
  'email:save-config': (payload: object) => MutResult;
  'email:get-config': () => {
    host: string; port: string; username: string; fromName: string;
    defaultTo: string; configured: boolean; hasPassword: boolean;
  };
  'email:test-smtp': (payload?: object) => MutResult;
  'email:send-report': (payload: object) => MutResult;
  'email:send-scheduled-now': () => MutResult;
  'email:get-schedule-status': () => {
    freq?: string; lastSent?: string | null;
    lastError?: string | null; nextSend?: string | null;
  };
  'email:trigger-schedule-check': () => MutResult;
  // invoices (Phase 3)
  'invoices:context': () => { ok: boolean; nextNumber?: string; prefix?: string; next?: number; billFrom?: InvoiceParty & { defaultCurrency?: string }; billFromReady?: boolean };
  'invoices:preview': (params: InvoicePreviewParams) => { ok: boolean; doc?: InvoiceDoc; error?: string };
  'invoices:issue': (params: InvoicePreviewParams) => { ok: boolean; id?: number; number?: string; error?: string };
  'invoices:list': () => InvoiceListRow[];
  'invoices:get': (id: number) => { ok: boolean; doc?: InvoiceDoc; status?: string; paid_at?: number | null; error?: string };
  'invoices:set-status': (payload: { id: number; status: string }) => MutResult;
  'invoices:save-pdf': (id: number) => { ok: boolean; path?: string; canceled?: boolean; error?: string };
  'invoices:email': (id: number) => { ok: boolean; to?: string; error?: string };
  'invoices:get-counter': () => { ok: boolean; prefix?: string; pad?: number; next?: number };
  'invoices:set-counter': (payload: { prefix?: string; next?: number }) => { ok: boolean; prefix?: string; next?: number };
  // window / prefs
  'win:get-displays': () => Array<{
    id: number; index: number; isPrimary: boolean; width: number; height: number;
  }>;
  'win:move-to-display': (id: number) => MutResult;
  // resolves the display the window actually sits on: 'primary' or a display id string
  'win:get-current-display': () => string;
  'win:set-launch-at-startup': (on: boolean) => MutResult;
  'win:get-launch-at-startup': () => boolean;
  'win:get-close-to-tray': () => boolean;
  'win:set-close-to-tray': (on: boolean) => MutResult;
  'win:get-start-minimized': () => boolean;
  'win:set-start-minimized': (on: boolean) => MutResult;
  'win:get-punch-hotkey': () => string;
  'win:set-punch-hotkey': (accel: string) => MutResult;
  'win:set-zoom': (factor: number) => MutResult;
  // beta gate
  'beta:status': () => { required: boolean };
  'beta:redeem': (key: string) => MutResult;
}

type IpcSendChannel =
  | 'win:minimize' | 'win:maximize' | 'win:close' | 'navigate'
  | 'session:request-lock' | 'session:confirm-close' | 'session:confirm-lock'
  | 'shell:open-external';

type IpcReceiveChannel =
  | 'menu:export-pdf' | 'menu:export-csv' | 'toast' | 'modal:security-info'
  | 'audit:close-warning' | 'audit:wizard-done' | 'update:status' | 'punch:changed';

/** Auto-updater status pushed from main (src/main/updater.ts). */
interface UpdateStatus {
  state: 'idle' | 'checking' | 'available' | 'not-available' | 'download-progress' | 'downloaded' | 'error' | 'dev';
  version?: string;
  notes?: string;
  percent?: number;
  transferred?: number;
  total?: number;
  bytesPerSecond?: number;
  error?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Renderer globals
// ═══════════════════════════════════════════════════════════════════════════

/** Preload surface (contextBridge). */
interface PreloadApi {
  invoke<C extends keyof IpcInvokeMap>(
    channel: C,
    ...args: Parameters<IpcInvokeMap[C]>
  ): Promise<ReturnType<IpcInvokeMap[C]>>;
  send(channel: IpcSendChannel, ...args: unknown[]): void;
  on(channel: IpcReceiveChannel, callback: (...args: unknown[]) => void): () => void;
}

/** Typed IPC wrapper (src/renderer/ipc.js). Reads resolve null on failure;
 *  mutations always resolve to a MutResult (never throw, never null). */
interface IpcWrapper {
  companies: {
    list(): Promise<Company[] | null>;
    save(data: Company | Omit<Company, 'id'>): Promise<MutResult>;
    delete(id: number): Promise<MutResult>;
  };
  entries: {
    list(compId: number): Promise<TimeEntry[] | null>;
    all(): Promise<TimeEntry[] | null>;
    summary(): Promise<EntrySummary[] | null>;
    save(entry: Partial<TimeEntry>): Promise<EntrySaveResult>;
    active(): Promise<TimeEntry | null>;
  };
  tasks: {
    list(entryId: number): Promise<TaskItem[] | null>;
    summary(entryId?: number): Promise<Record<string, { break_count: number; lunch_count: number }> | null>;
  };
  settings: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<string | null>;
  };
  audit: {
    list(): Promise<object[] | null>;
    getDismissed(): Promise<AuditDismissedRow[] | null>;
    dismiss(id: { entry_id: number; row_idx: number; type: string }): Promise<string | null>;
    applyFix(id: object): Promise<string | null>;
    getPolicy(): Promise<AuditPolicy | null>;
  };
  session: {
    get(): Promise<SessionInfo | null>;
  };
}

/** In-memory data cache with pub/sub invalidation (src/renderer/store.js). */
interface StoreApi {
  getCompanies(): Promise<Company[]>;
  getEntries(): Promise<TimeEntry[]>;
  getEntriesSummary(): Promise<EntrySummary[]>;
  invalidate(key: 'all' | 'companies' | 'entries'): void;
  subscribe(event: 'companies' | 'entries', fn: () => void): void;
  unsubscribe(event: 'companies' | 'entries', fn: () => void): void;
}

interface ValidatorResult { ok: boolean; error?: string; }

interface ValidatorApi {
  validateCompany(data: Partial<Company>): ValidatorResult;
  validateEntry(data: Partial<TimeEntry>): ValidatorResult;
}

interface RowUtilsApi {
  /** True when the row carries ANY user content (punch/label/name/desc). */
  rowHasContent(r: EntryRow | null | undefined): boolean;
  /** Canonical description accessor — handles the desc/description split. */
  rowDesc(r: EntryRow | null | undefined): string;
  /** LOCAL calendar date as YYYY-MM-DD (never use toISOString for log dates). */
  localDateStr(d?: Date): string;
}

/** Branded in-app export builders (src/renderer/export-html.js) — the tracker
 *  and Global Log PDF exports share the emailed-report visual identity. */
interface ExportRow {
  label?: string; name?: string; desc?: string;
  clock_in?: string; clock_out?: string; total_mins?: number;
}
interface ExportSessionInput {
  companyName: string; hier: string; metaLines: string[];
  dateLabel: string; sessionLabel: string;
  rows: ExportRow[]; totalMins: number; fontCss?: string;
}
interface ExportLogInput {
  companyName: string; hier: string; metaLines: string[];
  fromDate: string; toDate: string;
  sessions: Array<{ dateLabel: string; sessionLabel: string; rows: ExportRow[]; totalMins: number }>;
  grandTotalMins: number; fontCss?: string;
}
interface ExportHtmlApi {
  buildSessionExportHTML(input: ExportSessionInput): string;
  buildLogExportHTML(input: ExportLogInput): string;
  labelBreakdown(rows: ExportRow[]): Array<[string, number]>;
  fmtMins(m: number): string;
  escapeHtml(v: unknown): string;
}

/** Insights entry shape — the parsed rows_json is attached as `rows`. */
interface InsightEntry {
  log_date: string; total_mins: number; company_id: number;
  rows: Array<{ clock_in?: string; clock_out?: string; total_mins?: number }>;
}
interface TrendBucket { key: string; label: string; mins: number; }
/** Pure aggregation helpers for the Insights page (src/renderer/insights-compute.js). */
interface InsightsComputeApi {
  parseLocalDate(str: string): Date;
  filterByRange(entries: InsightEntry[], cutoff: string | null): InsightEntry[];
  sumMins(entries: InsightEntry[]): number;
  byCompany(entries: InsightEntry[]): Record<number, number>;
  byDayOfWeek(entries: InsightEntry[]): number[];
  byHourOfDay(entries: InsightEntry[]): number[];
  earningsByCompany(entries: InsightEntry[], rateMap: Record<number, number>): Record<number, number>;
  trendBuckets(entries: InsightEntry[], bucket: 'week' | 'month'): TrendBucket[];
  movingAverage(values: number[], window: number): number[];
  weekKey(d: Date): string;
}

/** Structural on purpose — the unit tests exercise CanvasText with a stub ctx. */
interface MeasuringCtx {
  font: string;
  measureText(s: string): { width: number };
}

interface CanvasTextApi {
  ellipsizeToWidth(ctx: MeasuringCtx, text: unknown, maxWidth: number): string;
  radiusForLabel(ctx: MeasuringCtx, text: unknown, font: string,
                 baseR: number, maxR: number, padding?: number | null): number;
}

/** Company Galaxy packed-bubble engine, Web 3.0 (src/renderer/bubble-web.ts,
 *  docs/PLAN-company-galaxy.md). Galaxy = rows grouped by hier_company. */
interface BubbleGalaxy { key: string; name: string; rows: Company[]; }
interface BubbleWebController {
  update(companies: Company[], entries: EntrySummary[], range: '30' | '90' | 'all'): void;
  setMatcher(fn: ((co: Company) => boolean) | null): void;
  /** Repaint with the current layout (live color preview). */
  redraw(): void;
  /** Jump straight into a galaxy's systems (dashboard pre-zoom handoff). */
  zoomTo(key: string): void;
  destroy(): void;
}
interface BubbleWebApi {
  attach(opts: {
    canvas: HTMLCanvasElement;
    wrap: HTMLElement;
    tooltip: { root: HTMLElement; name: HTMLElement; hier: HTMLElement; detail: HTMLElement };
    breadcrumb?: { root: HTMLElement; name: HTMLElement };
    mini?: boolean;
    onOpenTracker?: (co: Company) => void;
    onGalaxyNavigate?: (galaxy: BubbleGalaxy) => void;
    onGalaxyContext?: (galaxy: BubbleGalaxy, ev: MouseEvent) => void;
    onSystemContext?: (co: Company, ev: MouseEvent) => void;
  }): BubbleWebController;
}

/** hhmm is present exactly when ok is true. */
interface ParseClockResult { ok: boolean; hhmm?: string; }

interface SettingsValues {
  theme: string;
  scale: string;
  timeFormat: '12h' | '24h';
  reducedMotion: boolean;
  highContrast: boolean;
  colorblindSafe: boolean;
  focusIndicators: boolean;
  // Loose on purpose in Phase 1 — settings values are heterogeneous.
  [key: string]: any;
}

/** Settings engine (src/renderer/components/settings.js) — top-level const,
 *  NOT a window property: guard with `typeof Settings !== 'undefined'`. */
interface SettingsApi {
  load(): Promise<void>;
  set(key: string, value: unknown): Promise<void> | void;
  /** `any` on purpose in Phase 1 — values are heterogeneous (string/bool/num). */
  get(key: string): any;
  apply(): void;
  /** Formats a stored 24h HH:MM per the user's 12h/24h display preference. */
  formatTime(hhmm: string): string;
  DEFAULTS: SettingsValues;
  readonly current: SettingsValues;
}

interface ShellApi {
  init(pageName: string): Promise<void>;
  toast(msg: string, type?: 'info' | 'success' | 'error' | string, duration?: number): void;
  showSidebarTimer(startedAtMs: number): void;
  hideSidebarTimer(): void;
  showLiveBadge(startedAtMs: number): void;
  hideLiveBadge(): void;
  setSidebarAvatar(profile: { avatar?: string | null } | null,
                   displayName?: string | null, username?: string | null): void;
}

// Globals exposed on window (classic-script world). `Settings` is a top-level
// const in settings.js, declared here as a bare global for the same reason.
declare const Settings: SettingsApi;

// Shared About module (components/about.js) — mounted + wired by both the
// pre-auth login About and the in-app settings About.
interface AboutApi {
  buildPanel(): string;
  mount(container: HTMLElement | null): void;
  wire(opts: { api: PreloadApi; toast?: (msg: string, type?: string, ms?: number) => void }): Promise<void> | void;
  URLS: Record<string, string>;
  CHANGELOG: Array<{ version: string; items: string[] }>;
}
declare const About: AboutApi;

interface Window {
  api: PreloadApi;
  IPC: IpcWrapper;
  Store: StoreApi;
  Validator: ValidatorApi;
  RowUtils: RowUtilsApi;
  InsightsCompute: InsightsComputeApi;
  ExportHtml: ExportHtmlApi;
  CanvasText: CanvasTextApi;
  BubbleWeb: BubbleWebApi;
  Shell: ShellApi;
  About: AboutApi;
  parseClockInput(raw: unknown): ParseClockResult;
  computeDiffMins(inT: string, outT: string): number;
  escapeHtml(v: unknown): string;
  flattenText(v: unknown): string;
  /** Base64-inlined Inter CSS for the PDF export window (pdf-fonts.js). */
  PDF_FONT_CSS: string;
  /** Cross-page scratch used by settings.js time-format re-render. */
  __timeFormat?: string;
  /** Set by shell.js for the settings modal's profile section. */
  __currentUsername?: string;
  /** One-shot guards so the delegated dispatchers install only once. */
  __shellDelegated?: boolean;
  __loginDelegated?: boolean;
  __tooltipsInstalled?: boolean;
  /** Pomodoro cycle engine (components/pomodoro.js, injected by Shell.init). */
  Pomodoro?: PomodoroEngine;
  /** First-run coach-mark tour (components/onboarding.js, injected by Shell.init). */
  Onboarding?: OnboardingEngine;
  /** Idle forgotten-punch nudge (components/punch-watch.js, injected by Shell.init). */
  PunchWatch?: PunchWatchEngine;
  /** Auto-updater UI surface (components/update-notice.js; login page + Shell.init). */
  UpdateNotice?: { init(): Promise<void> };
  /**
   * Tracker-page hook (pages/tracker.ts) letting punch-watch close the active
   * punch at an explicit ms time on the tracker's own consistent save path.
   * Returns true if a punch was open. Absent off the tracker page.
   */
  __trackerClockOutActive?: (atMs: number) => boolean;
}

/** window.PunchWatch surface (components/punch-watch.js). */
interface PunchWatchEngine {
  /** Begin watching for idle open punches (no-op unless ui_idlePunchMinutes > 0). */
  init(): void;
  /** Whether the reminder is currently enabled. */
  enabled(): boolean;
}

/** window.Onboarding surface (components/onboarding.js). */
interface OnboardingEngine {
  /** Resume an in-flight tour after a page load (no-op otherwise). */
  init(): void;
  /** Start the tour from the first step. */
  begin(): void;
  /** Settings → About replay entry point. */
  replay(): void;
}

/** window.Pomodoro surface (components/pomodoro.js). */
interface PomodoroEngine {
  init(): Promise<void>;
  start(): Promise<void>;
  pause(): void;
  stop(): void;
  skipPhase(): void;
  enabled(): boolean;
}

// Optional per-page hooks: a page defines these top-level functions if it
// supports the corresponding shell-level event (menu exports, autosave
// setting changes). shell.js probes them with `typeof fn === 'function'`.
declare var onExportPDF: (() => void) | undefined;
declare var onExportCSV: (() => void) | undefined;
declare var onAutoSaveSettingChanged: ((seconds: number) => void) | undefined;

// The same globals as seen from classic scripts without the window. prefix.
declare const api: PreloadApi;
declare const IPC: IpcWrapper;
declare const Store: StoreApi;
declare const Validator: ValidatorApi;
declare const RowUtils: RowUtilsApi;
declare const InsightsCompute: InsightsComputeApi;
declare const ExportHtml: ExportHtmlApi;
declare const CanvasText: CanvasTextApi;
declare const BubbleWeb: BubbleWebApi;
declare const Shell: ShellApi;
declare function parseClockInput(raw: unknown): ParseClockResult;
declare function computeDiffMins(inT: string, outT: string): number;
declare function escapeHtml(v: unknown): string;
declare function flattenText(v: unknown): string;
declare const PDF_FONT_CSS: string;
