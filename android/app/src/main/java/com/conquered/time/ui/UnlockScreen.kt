package com.conquered.time.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Button
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.conquered.time.data.Profile

/**
 * Profile picker + password entry. Selecting a profile reveals the password
 * field; submitting derives the key and validates it (wrong password surfaces
 * as an inline error via the ViewModel).
 *
 * TOTP is intentionally not required here: for an offline vault file the
 * totp_secret sits in plaintext beside the data, so it isn't a real gate —
 * the password (key derivation) is. (Optional TOTP parity is a later step.)
 */
@Composable
fun UnlockScreen(
    profiles: List<Profile>,
    busy: Boolean,
    error: String?,
    onUnlock: (Profile, String, String) -> Unit,
    onBack: () -> Unit,
    onPasswordChange: () -> Unit,
) {
    var selected by remember { mutableStateOf<Profile?>(profiles.singleOrNull()) }

    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            if (selected == null) "Choose a profile" else "Unlock",
            style = MaterialTheme.typography.headlineSmall,
            modifier = Modifier.padding(vertical = 16.dp),
        )

        val current = selected
        if (current == null) {
            profiles.forEach { p ->
                ProfileCard(p) { selected = p }
            }
        } else {
            ProfileBanner(current)
            var password by remember(current) { mutableStateOf("") }
            var totp by remember(current) { mutableStateOf("") }
            OutlinedTextField(
                value = password,
                onValueChange = { password = it; onPasswordChange() },
                label = { Text("Password") },
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                modifier = Modifier.fillMaxWidth().padding(top = 16.dp),
            )
            OutlinedTextField(
                value = totp,
                onValueChange = { totp = it.filter(Char::isDigit).take(6); onPasswordChange() },
                label = { Text("Authenticator code (optional)") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
            )
            if (error != null) {
                Text(
                    error,
                    color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.padding(top = 8.dp).fillMaxWidth(),
                )
            }
            Button(
                onClick = { onUnlock(current, password, totp) },
                enabled = !busy && password.isNotEmpty(),
                modifier = Modifier.fillMaxWidth().padding(top = 16.dp),
            ) {
                if (busy) {
                    CircularProgressIndicator(modifier = Modifier.size(20.dp))
                } else {
                    Text("Unlock")
                }
            }
            TextButton(
                onClick = { if (profiles.size > 1) selected = null else onBack() },
                modifier = Modifier.padding(top = 4.dp),
            ) {
                Text(if (profiles.size > 1) "← Choose a different profile" else "← Import a different vault")
            }
        }

        if (current == null) {
            TextButton(onClick = onBack, modifier = Modifier.padding(top = 8.dp)) {
                Text("← Import a different vault")
            }
        }
    }
}

@Composable
private fun ProfileCard(p: Profile, onClick: () -> Unit) {
    Card(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp),
    ) {
        Column(Modifier.padding(16.dp)) {
            Text(p.displayName, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Text("@${p.username}", style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
private fun ProfileBanner(p: Profile) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Surface(
            color = MaterialTheme.colorScheme.primary,
            modifier = Modifier.size(56.dp).clip(CircleShape),
        ) {
            Column(
                Modifier.fillMaxSize(),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(
                    p.displayName.take(1).uppercase(),
                    style = MaterialTheme.typography.titleLarge,
                    color = MaterialTheme.colorScheme.onPrimary,
                )
            }
        }
        Text(
            p.displayName,
            style = MaterialTheme.typography.titleMedium,
            modifier = Modifier.padding(top = 8.dp),
        )
        Text("@${p.username}", style = MaterialTheme.typography.bodySmall)
    }
}
