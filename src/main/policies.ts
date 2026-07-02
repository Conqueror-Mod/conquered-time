'use strict';

// ════════════════════════════════════════════════════════════════════════════
//  policies.ts — break/lunch policy tiers (Phase 2 extraction from main.ts).
//
//  Pure data + lookups, no Electron, no DB. C5 (D-007) note: a state appearing
//  in STATE_NAMES but NOT in STATE_POLICY uses the default tier and must never
//  get "<State> law requires…" copy — hasStatePolicy in audit:get-policy keys
//  off STATE_POLICY membership, not STATE_NAMES.
// ════════════════════════════════════════════════════════════════════════════

interface BreakPolicy {
  label: string;
  /** [thresholdMins, requiredBreakCount] pairs, ascending; Infinity caps. */
  breakThresholds: Array<[number, number]>;
  lunchThreshMins: number;
  dispatchBreakWarnMins: number;
  dispatchLunchWarnMins: number;
}

const BREAK_POLICIES: Record<string, BreakPolicy> = {
  default: {
    label: 'General recommendation',
    breakThresholds: [[210, 0], [360, 1], [600, 2], [Infinity, 3]],
    lunchThreshMins: 300,
    dispatchBreakWarnMins: 150,
    dispatchLunchWarnMins: 270,
  },
  strict_breaks: {
    label: 'Strict rest breaks (per 4h)',
    breakThresholds: [[120, 0], [360, 1], [600, 2], [Infinity, 3]],
    lunchThreshMins: 300,
    dispatchBreakWarnMins: 90,
    dispatchLunchWarnMins: 270,
  },
  meal_only: {
    label: 'Meal break required (no rest break mandate)',
    breakThresholds: [[Infinity, 0]],
    lunchThreshMins: 360,
    dispatchBreakWarnMins: Infinity,
    dispatchLunchWarnMins: 300,
  },
};

const STATE_POLICY: Record<string, string> = {
  CA:'strict_breaks', CO:'strict_breaks', IL:'strict_breaks', KY:'strict_breaks',
  ME:'strict_breaks', MN:'strict_breaks', NE:'strict_breaks', NV:'strict_breaks',
  NH:'strict_breaks', ND:'strict_breaks', OR:'strict_breaks', VT:'strict_breaks',
  WA:'strict_breaks', WV:'strict_breaks',
  CT:'meal_only', DE:'meal_only', MA:'meal_only', NM:'meal_only',
  NY:'meal_only', RI:'meal_only', TN:'meal_only',
};

const STATE_NAMES: Record<string, string> = {
  AL:'Alabama', AK:'Alaska', AZ:'Arizona', AR:'Arkansas', CA:'California',
  CO:'Colorado', CT:'Connecticut', DE:'Delaware', DC:'Washington D.C.', FL:'Florida',
  GA:'Georgia', HI:'Hawaii', ID:'Idaho', IL:'Illinois', IN:'Indiana',
  IA:'Iowa', KS:'Kansas', KY:'Kentucky', LA:'Louisiana', ME:'Maine',
  MD:'Maryland', MA:'Massachusetts', MI:'Michigan', MN:'Minnesota', MS:'Mississippi',
  MO:'Missouri', MT:'Montana', NE:'Nebraska', NV:'Nevada', NH:'New Hampshire',
  NJ:'New Jersey', NM:'New Mexico', NY:'New York', NC:'North Carolina', ND:'North Dakota',
  OH:'Ohio', OK:'Oklahoma', OR:'Oregon', PA:'Pennsylvania', RI:'Rhode Island',
  SC:'South Carolina', SD:'South Dakota', TN:'Tennessee', TX:'Texas', UT:'Utah',
  VT:'Vermont', VA:'Virginia', WA:'Washington', WV:'West Virginia', WI:'Wisconsin',
  WY:'Wyoming',
};

function getPolicy(workState: string | null | undefined): BreakPolicy {
  const key = workState ? (STATE_POLICY[workState] || 'default') : 'default';
  return BREAK_POLICIES[key];
}

function requiredBreaks(totalMins: number, policy?: BreakPolicy | null): number {
  const thresholds = (policy || BREAK_POLICIES.default).breakThresholds;
  for (const [threshold, count] of thresholds) {
    if (totalMins < threshold) return count;
  }
  return 0;
}

module.exports = { BREAK_POLICIES, STATE_POLICY, STATE_NAMES, getPolicy, requiredBreaks };
