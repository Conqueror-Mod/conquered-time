package com.conquered.time.data

import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import com.conquered.time.crypto.VaultCrypto
import org.json.JSONArray
import org.json.JSONObject
import java.io.Closeable
import javax.crypto.AEADBadTagException

/**
 * Read-only access to a Conquered Time vault (see docs/VAULT-FORMAT.md).
 *
 * The vault is a standard SQLite file, opened READONLY. Callers first pick a
 * [Profile] with [listProfiles], then [unlock] with the password. Unlock derives
 * the AES key and proves it by decrypting a real blob — a wrong password throws
 * [AEADBadTagException], surfaced as [BadPasswordException]. After a successful
 * unlock the key is held for the session; [listCompanies] / [listEntries]
 * decrypt on demand.
 *
 * Rowid discipline (gotcha #1): every read is `SELECT rowid AS rid, *` and uses
 * `rid`, never the `id` column.
 */
class VaultRepository private constructor(
    private val db: SQLiteDatabase,
) : Closeable {

    class BadPasswordException : Exception("Incorrect password — vault could not be decrypted.")

    private var sessionKey: ByteArray? = null
    private var currentUserId: Int? = null

    companion object {
        /** Open a copied-in vault file read-only. The caller owns the file lifecycle. */
        fun open(path: String): VaultRepository {
            val db = SQLiteDatabase.openDatabase(
                path, null, SQLiteDatabase.OPEN_READONLY
            )
            return VaultRepository(db)
        }
    }

    /** Read one app_settings value (plaintext), or null. e.g. "ui_theme". */
    fun getSetting(key: String): String? {
        db.rawQuery("SELECT value FROM app_settings WHERE key=?", arrayOf(key)).use { c ->
            return if (c.moveToNext()) c.str("value") else null
        }
    }

    /** All unlockable profiles in the vault. */
    fun listProfiles(): List<Profile> {
        val out = ArrayList<Profile>()
        db.rawQuery(
            "SELECT rowid AS rid, username, display_name, totp_secret, key_salt FROM users",
            null
        ).use { c ->
            while (c.moveToNext()) {
                val username = c.str("username") ?: continue
                out += Profile(
                    id = c.getInt(c.getColumnIndexOrThrow("rid")),
                    username = username,
                    displayName = c.str("display_name") ?: username,
                    totpSecret = c.str("totp_secret") ?: "",
                    keySalt = c.str("key_salt") ?: "",
                )
            }
        }
        return out
    }

    /**
     * Derive the key for [profile] from [password] and validate it. On success
     * the key is retained for subsequent reads. Throws [BadPasswordException]
     * when the password is wrong.
     */
    fun unlock(profile: Profile, password: String) {
        // Empty key_salt falls back to the totp_secret string (legacy vaults).
        val salt = profile.keySalt.ifEmpty { profile.totpSecret }
        val key = VaultCrypto.deriveKey(password, salt)
        validateKey(profile.id, key)
        sessionKey = key
        currentUserId = profile.id
    }

    /** True once a successful [unlock] has run. */
    fun isUnlocked(): Boolean = sessionKey != null

    /**
     * Prove the key by decrypting one real blob. Tries a company blob, then the
     * profile blob. A vault with neither can't be cryptographically validated —
     * we accept the key (nothing to read) rather than reject a valid password.
     */
    private fun validateKey(userId: Int, key: ByteArray) {
        firstEncBlob(userId)?.let { blob ->
            try {
                VaultCrypto.decrypt(blob, key)
            } catch (e: AEADBadTagException) {
                throw BadPasswordException()
            }
        }
    }

    private fun firstEncBlob(userId: Int): VaultCrypto.EncBlob? {
        db.rawQuery(
            "SELECT data_enc, data_iv, data_tag FROM companies WHERE user_id=? LIMIT 1",
            arrayOf(userId.toString())
        ).use { c ->
            if (c.moveToNext()) {
                return VaultCrypto.EncBlob(
                    iv = c.str("data_iv") ?: "",
                    tag = c.str("data_tag") ?: "",
                    data = c.str("data_enc") ?: "",
                )
            }
        }
        db.rawQuery(
            "SELECT profile_enc, profile_iv, profile_tag FROM users WHERE rowid=? " +
                "AND profile_enc IS NOT NULL",
            arrayOf(userId.toString())
        ).use { c ->
            if (c.moveToNext()) {
                return VaultCrypto.EncBlob(
                    iv = c.str("profile_iv") ?: "",
                    tag = c.str("profile_tag") ?: "",
                    data = c.str("profile_enc") ?: "",
                )
            }
        }
        return null
    }

    /** Decrypted companies for the unlocked profile, ordered by name. */
    fun listCompanies(): List<Company> {
        val key = requireKey()
        val userId = currentUserId!!
        val out = ArrayList<Company>()
        db.rawQuery(
            "SELECT rowid AS rid, data_enc, data_iv, data_tag FROM companies WHERE user_id=?",
            arrayOf(userId.toString())
        ).use { c ->
            while (c.moveToNext()) {
                val rid = c.getInt(c.getColumnIndexOrThrow("rid"))
                val blob = VaultCrypto.EncBlob(
                    iv = c.str("data_iv") ?: "",
                    tag = c.str("data_tag") ?: "",
                    data = c.str("data_enc") ?: "",
                )
                out += try {
                    parseCompany(rid, VaultCrypto.decrypt(blob, key))
                } catch (e: Exception) {
                    Company(id = rid, name = "[Decryption Error]")
                }
            }
        }
        return out.sortedBy { it.name.lowercase() }
    }

    /**
     * Decrypted entries, newest first. Pass [companyId] to scope to one company,
     * or null for the whole global log.
     */
    fun listEntries(companyId: Int? = null): List<TimeEntry> {
        val key = requireKey()
        val userId = currentUserId!!
        val sql = StringBuilder(
            "SELECT rowid AS rid, company_id, log_date, session_label, total_mins, " +
                "rows_json, rows_enc, rows_iv, rows_tag FROM time_entries WHERE user_id=?"
        )
        val args = ArrayList<String>().apply { add(userId.toString()) }
        if (companyId != null) {
            sql.append(" AND company_id=?")
            args.add(companyId.toString())
        }
        sql.append(" ORDER BY log_date DESC, rowid DESC")

        val out = ArrayList<TimeEntry>()
        db.rawQuery(sql.toString(), args.toTypedArray()).use { c ->
            while (c.moveToNext()) {
                val rid = c.getInt(c.getColumnIndexOrThrow("rid"))
                val rowsJson = decryptRows(c, key)
                out += TimeEntry(
                    id = rid,
                    companyId = c.getInt(c.getColumnIndexOrThrow("company_id")),
                    logDate = c.str("log_date") ?: "",
                    sessionLabel = c.str("session_label") ?: "",
                    totalMins = c.getInt(c.getColumnIndexOrThrow("total_mins")),
                    rows = parseRows(rowsJson),
                )
            }
        }
        return out
    }

    /** Mirror of session.ts decryptEntry: prefer the encrypted rows, fall back
     *  to plaintext rows_json; a failed decrypt yields an empty row set. */
    private fun decryptRows(c: Cursor, key: ByteArray): String {
        val enc = c.str("rows_enc")
        val iv = c.str("rows_iv")
        val tag = c.str("rows_tag")
        if (!enc.isNullOrEmpty() && !iv.isNullOrEmpty() && !tag.isNullOrEmpty()) {
            return try {
                VaultCrypto.decrypt(VaultCrypto.EncBlob(iv = iv, tag = tag, data = enc), key)
            } catch (e: Exception) {
                "[]"
            }
        }
        return c.str("rows_json").takeUnless { it.isNullOrEmpty() } ?: "[]"
    }

    private fun parseCompany(rid: Int, plain: String): Company {
        val o = JSONObject(plain)
        return Company(
            id = rid, // rowid wins over any id inside the blob (gotcha #1)
            name = o.optString("name", "[Unnamed]"),
            jobTitle = o.optStringOrNull("job_title"),
            workType = o.optStringOrNull("work_type"),
            location = o.optStringOrNull("location"),
            hierCompany = o.optStringOrNull("hier_company"),
            hierProject = o.optStringOrNull("hier_project"),
            hierPlatform = o.optStringOrNull("hier_platform"),
            navId = o.optStringOrNull("nav_id"),
            supervisors = o.optStringOrNull("supervisors"),
            notes = o.optStringOrNull("notes"),
            reportEmail = o.optStringOrNull("report_email"),
        )
    }

    private fun parseRows(json: String): List<EntryRow> {
        val arr = try { JSONArray(json) } catch (e: Exception) { return emptyList() }
        val out = ArrayList<EntryRow>(arr.length())
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            // `desc` is canonical; `description` is the legacy alias (cluster C3).
            val desc = o.optString("desc", "").ifEmpty { o.optString("description", "") }
            out += EntryRow(
                label = o.optString("label", ""),
                name = o.optString("name", ""),
                desc = desc,
                clockIn = o.optString("clock_in", ""),
                clockOut = o.optString("clock_out", ""),
                totalMins = o.optInt("total_mins", 0),
            )
        }
        return out
    }

    private fun requireKey(): ByteArray =
        sessionKey ?: throw IllegalStateException("Vault is locked — call unlock() first.")

    override fun close() {
        sessionKey?.fill(0)
        sessionKey = null
        db.close()
    }
}

// ── small Cursor helpers ────────────────────────────────────────────────────
private fun Cursor.str(col: String): String? {
    val idx = getColumnIndex(col)
    return if (idx < 0 || isNull(idx)) null else getString(idx)
}

private fun JSONObject.optStringOrNull(key: String): String? {
    if (!has(key) || isNull(key)) return null
    return optString(key, "").takeUnless { it.isEmpty() }
}
