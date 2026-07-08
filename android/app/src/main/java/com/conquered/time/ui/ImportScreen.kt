package com.conquered.time.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp

/**
 * First screen: pick a vault.db via the Storage Access Framework. The ViewModel
 * copies it into private storage and opens it read-only.
 */
@Composable
fun ImportScreen(
    busy: Boolean,
    error: String?,
    onPick: (android.net.Uri) -> Unit,
) {
    val picker = rememberLauncherForActivityResult(
        // Any MIME — vault.db has no registered type, so we don't over-filter.
        ActivityResultContracts.OpenDocument()
    ) { uri -> uri?.let(onPick) }

    Column(
        modifier = Modifier.fillMaxSize().padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(
            "Conquered Time",
            style = MaterialTheme.typography.headlineMedium,
            color = MaterialTheme.colorScheme.primary,
        )
        Text(
            "Read-only vault viewer",
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.padding(top = 4.dp, bottom = 32.dp),
        )

        if (busy) {
            CircularProgressIndicator(modifier = Modifier.size(40.dp))
        } else {
            Button(onClick = { picker.launch(arrayOf("*/*")) }) {
                Text("Import a vault file")
            }
            Text(
                "Select a Conquered Time vault.db exported from the desktop app.",
                style = MaterialTheme.typography.bodySmall,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 16.dp),
            )
        }

        if (error != null) {
            Text(
                error,
                color = MaterialTheme.colorScheme.error,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 24.dp),
            )
        }
    }
}
