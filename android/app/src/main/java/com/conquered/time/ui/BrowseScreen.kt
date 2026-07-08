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
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Lock
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
    LazyColumn(Modifier.fillMaxSize().padding(12.dp)) {
        items(entries, key = { it.id }) { e ->
            SessionCard(e, companyName = companyNames[e.companyId] ?: "Unknown company")
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
