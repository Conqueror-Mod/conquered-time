'use strict';

// Clock-input parser for the tracker's inline time editor (defect cluster C1,
// D-002). Accepts BOTH raw 24-hour "HH:MM" and 12-hour "h:mm am/pm" input and
// normalizes to the stored 24-hour zero-padded format (gotcha #8: storage is
// ALWAYS 24h — this only widens what the user may type).
//
// UMD-ish: classic <script> for the renderer (window.parseClockInput) AND
// require()-able for the unit tests in test/time-parse.test.js.
(function (root) {

  // parseClockInput('2:30 PM') → { ok:true, hhmm:'14:30' }
  // parseClockInput('14:30')   → { ok:true, hhmm:'14:30' }
  // parseClockInput('25:00')   → { ok:false }
  /**
   * @param {unknown} raw
   * @returns {ParseClockResult}
   */
  function parseClockInput(raw) {
    const m = String(raw || '').trim().match(/^(\d{1,2}):([0-5]\d)\s*([AaPp])\.?[Mm]?\.?$|^(\d{1,2}):([0-5]\d)$/);
    if (!m) return { ok: false };

    let h, min;
    if (m[3] !== undefined) {
      // 12-hour form with meridiem: hour must be 1–12
      h = parseInt(m[1], 10); min = m[2];
      if (h < 1 || h > 12) return { ok: false };
      const pm = m[3].toLowerCase() === 'p';
      if (h === 12) h = pm ? 12 : 0;       // 12 AM → 00, 12 PM → 12
      else if (pm) h += 12;
    } else {
      // 24-hour form: hour 0–23
      h = parseInt(m[4], 10); min = m[5];
      if (h > 23) return { ok: false };
    }
    return { ok: true, hhmm: `${String(h).padStart(2, '0')}:${min}` };
  }

  // Minutes between two 24-hour HH:MM punches. A negative raw diff means the
  // span crossed midnight (23:30 → 00:15 = 45), so wrap by a full day.
  /**
   * @param {string} inT zero-padded 24-hour HH:MM
   * @param {string} outT zero-padded 24-hour HH:MM
   * @returns {number}
   */
  function computeDiffMins(inT, outT) {
    const [ih, im] = inT.split(':').map(Number);
    const [oh, om] = outT.split(':').map(Number);
    let diff = (oh * 60 + om) - (ih * 60 + im);
    if (diff < 0) diff += 1440;
    return diff;
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { parseClockInput, computeDiffMins };
  else { root.parseClockInput = parseClockInput; root.computeDiffMins = computeDiffMins; }
})(this);
