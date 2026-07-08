package com.conquered.time.data

/**
 * CSV export matching the desktop Global Log (src/renderer/pages/global-log.ts).
 * Same columns, same safety rules — kept in parity so a phone export is
 * indistinguishable from a desktop one:
 *
 *  - one line per content-bearing row (blank rows skipped, desc-aware);
 *  - every cell quoted, embedded quotes doubled;
 *  - formula-injection guard: a leading =, +, -, @, tab or CR is prefixed with '
 *    so spreadsheet apps don't execute the cell;
 *  - description flattened (whitespace runs collapsed to single spaces) so a
 *    multi-line note can't break the row.
 */
object CsvExport {

    private const val HEADER =
        "Company,Date,Session,Task Label,Task Name,Description,Clock In,Clock Out,Duration (mins)"

    fun build(entries: List<TimeEntry>, companyNames: Map<Int, String>): String {
        val sb = StringBuilder(HEADER)
        for (e in entries) {
            val company = companyNames[e.companyId] ?: ""
            for (r in e.rows) {
                if (!rowHasContent(r)) continue
                sb.append('\n')
                sb.append(
                    listOf(
                        cell(company),
                        cell(e.logDate),
                        cell(e.sessionLabel),
                        cell(r.label),
                        cell(r.name),
                        cell(flatten(r.desc)),
                        cell(r.clockIn),
                        cell(r.clockOut),
                        r.totalMins.toString(),
                    ).joinToString(",")
                )
            }
        }
        return sb.toString()
    }

    private fun rowHasContent(r: EntryRow): Boolean =
        r.label.isNotBlank() || r.name.isNotBlank() || r.desc.isNotBlank() ||
            r.clockIn.isNotBlank() || r.clockOut.isNotBlank()

    private fun cell(value: String): String {
        var s = value
        if (s.isNotEmpty() && s[0] in "=+-@\t\r") s = "'$s"
        return "\"" + s.replace("\"", "\"\"") + "\""
    }

    /** Collapse every run of whitespace (incl. newlines) to a single space. */
    private fun flatten(value: String): String =
        value.replace(Regex("\\s+"), " ").trim()
}
