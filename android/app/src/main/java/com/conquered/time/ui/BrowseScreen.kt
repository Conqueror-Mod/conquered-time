package com.conquered.time.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.Divider
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Search
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.conquered.time.data.Company
import com.conquered.time.data.EntryRow
import com.conquered.time.data.TimeEntry

/**
 * Read-only browsing after unlock. Two tabs — Companies and Global Log — plus a
 * drill-in company detail. All data is already decrypted in the ViewModel; this
 * is pure presentation.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BrowseScreen(
    companies: List<Company>,
    entries: List<TimeEntry>,
    onLock: () -> Unit,
) {
    val companyNames = remember(companies) { companies.associate { it.id to it.name } }
    var tab by remember { mutableStateOf(0) }
    var detail by remember { mutableStateOf<Company?>(null) }

    val current = detail
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(current?.name ?: "Conquered Time") },
                navigationIcon = {
                    if (current != null) {
                        IconButton(onClick = { detail = null }) {
                            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                        }
                    }
                },
                actions = {
                    if (current == null) {
                        IconButton(onClick = onLock) {
                            Icon(Icons.Filled.Lock, contentDescription = "Lock")
                        }
                    }
                },
            )
        },
    ) { pad ->
        Column(Modifier.fillMaxSize().padding(pad)) {
            if (current != null) {
                CompanyDetail(current, entries.filter { it.companyId == current.id })
                return@Column
            }

            TabRow(selectedTabIndex = tab) {
                Tab(selected = tab == 0, onClick = { tab = 0 }, text = { Text("Companies") })
                Tab(selected = tab == 1, onClick = { tab = 1 }, text = { Text("Global Log") })
            }
            when (tab) {
                0 -> CompaniesList(companies, entries) { detail = it }
                else -> GlobalLog(entries, companyNames)
            }
        }
    }
}

@Composable
private fun CompaniesList(
    companies: List<Company>,
    entries: List<TimeEntry>,
    onOpen: (Company) -> Unit,
) {
    if (companies.isEmpty()) {
        EmptyState("No companies in this vault.")
        return
    }
    val minsByCompany = remember(entries) {
        entries.groupBy { it.companyId }.mapValues { (_, es) -> es.sumOf { it.totalMins } }
    }
    LazyColumn(Modifier.fillMaxSize().padding(12.dp)) {
        items(companies, key = { it.id }) { c ->
            Card(
                modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp).clickable { onOpen(c) },
            ) {
                Column(Modifier.padding(16.dp)) {
                    Text(c.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    val sub = listOfNotNull(c.jobTitle, c.location).joinToString(" • ")
                    if (sub.isNotEmpty()) {
                        Text(sub, style = MaterialTheme.typography.bodySmall)
                    }
                    Text(
                        "Total: ${formatMinutes(minsByCompany[c.id] ?: 0)}",
                        style = MaterialTheme.typography.bodySmall,
                        fontFamily = FontFamily.Monospace,
                        modifier = Modifier.padding(top = 4.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun CompanyDetail(company: Company, entries: List<TimeEntry>) {
    LazyColumn(Modifier.fillMaxSize().padding(16.dp)) {
        item {
            FieldRow("Job title", company.jobTitle)
            FieldRow("Work type", company.workType)
            FieldRow("Location", company.location)
            FieldRow("Company", company.hierCompany)
            FieldRow("Project", company.hierProject)
            FieldRow("Platform", company.hierPlatform)
            FieldRow("Navigator ID", company.navId)
            FieldRow("Supervisors", company.supervisors)
            FieldRow("Report email", company.reportEmail)
            if (!company.notes.isNullOrBlank()) {
                Text("Notes", style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(top = 12.dp))
                Text(company.notes, style = MaterialTheme.typography.bodyMedium)
            }
            Divider(Modifier.padding(vertical = 16.dp))
            Text(
                "Sessions (${entries.size}) — ${formatMinutes(entries.sumOf { it.totalMins })}",
                style = MaterialTheme.typography.titleSmall,
                modifier = Modifier.padding(bottom = 8.dp),
            )
        }
        if (entries.isEmpty()) {
            item { Text("No time entries for this company.", style = MaterialTheme.typography.bodySmall) }
        } else {
            items(entries, key = { it.id }) { e -> SessionCard(e, companyName = null) }
        }
    }
}

@Composable
private fun GlobalLog(entries: List<TimeEntry>, companyNames: Map<Int, String>) {
    if (entries.isEmpty()) {
        EmptyState("No time entries in this vault.")
        return
    }

    var query by remember { mutableStateOf("") }
    var from by remember { mutableStateOf("") }
    var to by remember { mutableStateOf("") }

    val filtered = remember(entries, query, from, to) {
        val q = query.trim().lowercase()
        val lo = from.trim()
        val hi = to.trim()
        entries.filter { e ->
            // Date range — log_date is YYYY-MM-DD, so lexical bounds are correct.
            (lo.isEmpty() || e.logDate >= lo) &&
                (hi.isEmpty() || e.logDate <= hi) &&
                // Text — company name, session label, and every row's fields.
                (q.isEmpty() || entryMatches(e, companyNames[e.companyId], q))
        }
    }

    Column(Modifier.fillMaxSize()) {
        FilterBar(
            query = query, onQuery = { query = it },
            from = from, onFrom = { from = it.filter { c -> c.isDigit() || c == '-' } },
            to = to, onTo = { to = it.filter { c -> c.isDigit() || c == '-' } },
        )
        Text(
            "${filtered.size} of ${entries.size} sessions — ${formatMinutes(filtered.sumOf { it.totalMins })}",
            style = MaterialTheme.typography.bodySmall,
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
        )
        if (filtered.isEmpty()) {
            EmptyState("No sessions match the current filter.")
        } else {
            LazyColumn(Modifier.fillMaxSize().padding(horizontal = 12.dp)) {
                items(filtered, key = { it.id }) { e ->
                    SessionCard(e, companyName = companyNames[e.companyId] ?: "Unknown company")
                }
            }
        }
    }
}

private fun entryMatches(e: TimeEntry, companyName: String?, q: String): Boolean {
    if (companyName?.lowercase()?.contains(q) == true) return true
    if (e.sessionLabel.lowercase().contains(q)) return true
    return e.rows.any {
        it.label.lowercase().contains(q) ||
            it.name.lowercase().contains(q) ||
            it.desc.lowercase().contains(q)
    }
}

@Composable
private fun FilterBar(
    query: String, onQuery: (String) -> Unit,
    from: String, onFrom: (String) -> Unit,
    to: String, onTo: (String) -> Unit,
) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp)) {
        OutlinedTextField(
            value = query,
            onValueChange = onQuery,
            label = { Text("Search company, label, or notes") },
            singleLine = true,
            leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
            trailingIcon = {
                if (query.isNotEmpty()) {
                    IconButton(onClick = { onQuery("") }) {
                        Icon(Icons.Filled.Clear, contentDescription = "Clear search")
                    }
                }
            },
            modifier = Modifier.fillMaxWidth(),
        )
        Row(Modifier.fillMaxWidth().padding(top = 8.dp)) {
            OutlinedTextField(
                value = from,
                onValueChange = onFrom,
                label = { Text("From") },
                placeholder = { Text("YYYY-MM-DD") },
                singleLine = true,
                modifier = Modifier.weight(1f),
            )
            Spacer(Modifier.width(8.dp))
            OutlinedTextField(
                value = to,
                onValueChange = onTo,
                label = { Text("To") },
                placeholder = { Text("YYYY-MM-DD") },
                singleLine = true,
                modifier = Modifier.weight(1f),
            )
        }
    }
}

/** One session; tap to expand its punched rows. */
@Composable
private fun SessionCard(entry: TimeEntry, companyName: String?) {
    var expanded by remember { mutableStateOf(false) }
    Card(
        modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp).clickable { expanded = !expanded },
    ) {
        Column(Modifier.padding(16.dp)) {
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Column(Modifier.weight(1f)) {
                    Text(entry.logDate, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodyMedium)
                    if (companyName != null) {
                        Text(companyName, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.SemiBold)
                    }
                    if (entry.sessionLabel.isNotBlank()) {
                        Text(entry.sessionLabel, style = MaterialTheme.typography.bodySmall)
                    }
                }
                Text(
                    formatMinutes(entry.totalMins),
                    fontFamily = FontFamily.Monospace,
                    style = MaterialTheme.typography.titleSmall,
                )
            }
            if (expanded) {
                Divider(Modifier.padding(vertical = 10.dp))
                if (entry.rows.isEmpty()) {
                    Text("No rows.", style = MaterialTheme.typography.bodySmall)
                } else {
                    entry.rows.forEach { RowLine(it) }
                }
            }
        }
    }
}

@Composable
private fun RowLine(row: EntryRow) {
    Column(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            val title = listOf(row.label, row.name).filter { it.isNotBlank() }.joinToString(" — ").ifEmpty { "(untitled)" }
            Text(title, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
            Text(
                formatClockRange(row.clockIn, row.clockOut),
                fontFamily = FontFamily.Monospace,
                style = MaterialTheme.typography.bodySmall,
            )
        }
        if (row.desc.isNotBlank()) {
            Text(row.desc, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun FieldRow(label: String, value: String?) {
    if (value.isNullOrBlank()) return
    Row(Modifier.fillMaxWidth().padding(vertical = 3.dp)) {
        Text(label, style = MaterialTheme.typography.labelMedium, modifier = Modifier.width(120.dp))
        Spacer(Modifier.width(8.dp))
        Text(value, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
    }
}

@Composable
private fun EmptyState(message: String) {
    Column(
        Modifier.fillMaxSize().padding(32.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        Text(message, style = MaterialTheme.typography.bodyMedium)
    }
}
