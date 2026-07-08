package com.conquered.time.ui

import android.app.Application
import android.database.sqlite.SQLiteException
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.conquered.time.data.Company
import com.conquered.time.data.Profile
import com.conquered.time.data.TimeEntry
import com.conquered.time.data.VaultRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

/** Where the app sits in the import → unlock → browse flow. */
sealed interface VaultScreen {
    /** No vault imported yet. */
    data object Import : VaultScreen
    /** Vault opened; pick a profile and enter the password. */
    data class Unlock(val profiles: List<Profile>) : VaultScreen
    /** Unlocked — read-only browsing (companies/global log wired in the next milestone). */
    data class Browse(
        val profile: Profile,
        val companies: List<Company>,
        val entries: List<TimeEntry>,
    ) : VaultScreen
}

class VaultViewModel(app: Application) : AndroidViewModel(app) {

    var screen by mutableStateOf<VaultScreen>(VaultScreen.Import)
        private set
    var busy by mutableStateOf(false)
        private set
    var error by mutableStateOf<String?>(null)
        private set

    private var repo: VaultRepository? = null

    /** Copy the picked vault into private storage and open it read-only. */
    fun importVault(uri: Uri) {
        error = null
        busy = true
        viewModelScope.launch {
            try {
                val profiles = withContext(Dispatchers.IO) {
                    val dest = File(getApplication<Application>().filesDir, "imported-vault.db")
                    copyToFile(uri, dest)
                    repo?.close()
                    val r = VaultRepository.open(dest.absolutePath)
                    repo = r
                    r.listProfiles()
                }
                if (profiles.isEmpty()) {
                    error = "No profiles found in that file — is it a Conquered Time vault?"
                    screen = VaultScreen.Import
                } else {
                    screen = VaultScreen.Unlock(profiles)
                }
            } catch (e: SQLiteException) {
                error = "That file isn't a readable Conquered Time vault."
                screen = VaultScreen.Import
            } catch (e: Exception) {
                error = e.message ?: "Could not open the selected file."
                screen = VaultScreen.Import
            } finally {
                busy = false
            }
        }
    }

    /**
     * Derive the key, validate it, and load the read-only data on success.
     * [totpCode] is optional (parity with the desktop's authenticator gate) —
     * when non-blank it must verify against the profile's secret; when blank it
     * is skipped, since for an offline vault the password is the real gate.
     */
    fun unlock(profile: Profile, password: String, totpCode: String) {
        val r = repo ?: run { error = "No vault open."; return }
        val code = totpCode.trim()
        if (code.isNotEmpty() && profile.totpSecret.isNotEmpty() &&
            !com.conquered.time.crypto.Totp.verify(profile.totpSecret, code)
        ) {
            error = "Invalid authenticator code."
            return
        }
        error = null
        busy = true
        viewModelScope.launch {
            try {
                val (companies, entries) = withContext(Dispatchers.IO) {
                    r.unlock(profile, password)
                    r.listCompanies() to r.listEntries()
                }
                screen = VaultScreen.Browse(profile, companies, entries)
            } catch (e: VaultRepository.BadPasswordException) {
                error = "Incorrect password."
            } catch (e: Exception) {
                error = e.message ?: "Could not unlock the vault."
            } finally {
                busy = false
            }
        }
    }

    /** Drop the imported vault and return to the import screen. */
    fun reset() {
        repo?.close()
        repo = null
        error = null
        screen = VaultScreen.Import
    }

    fun clearError() { error = null }

    private fun copyToFile(uri: Uri, dest: File) {
        getApplication<Application>().contentResolver.openInputStream(uri).use { input ->
            requireNotNull(input) { "Could not read the selected file." }
            dest.outputStream().use { input.copyTo(it) }
        }
    }

    override fun onCleared() {
        repo?.close()
        repo = null
    }
}
