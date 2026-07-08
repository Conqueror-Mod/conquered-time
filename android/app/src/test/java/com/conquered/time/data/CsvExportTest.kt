package com.conquered.time.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Guards the safety-critical CSV rules that mirror the desktop export. */
class CsvExportTest {

    private fun entry(vararg rows: EntryRow) =
        TimeEntry(id = 1, companyId = 7, logDate = "2026-07-08", sessionLabel = "Morning", totalMins = 60, rows = rows.toList())

    private val names = mapOf(7 to "Acme")

    @Test
    fun header_matchesDesktop() {
        val csv = CsvExport.build(emptyList(), names)
        assertEquals(
            "Company,Date,Session,Task Label,Task Name,Description,Clock In,Clock Out,Duration (mins)",
            csv,
        )
    }

    @Test
    fun formulaInjection_isNeutralized() {
        val e = entry(EntryRow(label = "=SUM(A1:A2)", name = "n", clockIn = "08:00", totalMins = 30))
        val line = CsvExport.build(listOf(e), names).lines()[1]
        // Leading = is prefixed with a single quote, whole cell quoted.
        assertTrue(line.contains("\"'=SUM(A1:A2)\""))
    }

    @Test
    fun quotes_areDoubled() {
        val e = entry(EntryRow(name = "O'Brien \"Q\"", clockIn = "08:00"))
        val line = CsvExport.build(listOf(e), names).lines()[1]
        assertTrue(line.contains("\"O'Brien \"\"Q\"\"\""))
    }

    @Test
    fun description_isFlattened() {
        val e = entry(EntryRow(name = "task", desc = "line one\n  line two\ttabbed", clockIn = "08:00"))
        val line = CsvExport.build(listOf(e), names).lines()[1]
        assertTrue(line.contains("\"line one line two tabbed\""))
    }

    @Test
    fun blankRows_areSkipped() {
        val e = entry(
            EntryRow(name = "real", clockIn = "08:00"),
            EntryRow(), // entirely blank → skipped
        )
        val lines = CsvExport.build(listOf(e), names).lines()
        assertEquals(2, lines.size) // header + one row
    }

    @Test
    fun emptyExport_isHeaderOnly() {
        assertFalse(CsvExport.build(emptyList(), names).contains("\n"))
    }
}
