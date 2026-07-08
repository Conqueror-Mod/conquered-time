package com.conquered.time.data

/**
 * Read-only domain models decrypted out of a vault. Mirrors the desktop shapes
 * in types/globals.d.ts. IDs are the SQLite rowid (gotcha #1), never the `id`
 * column.
 */

/** A profile that can be unlocked — one row of the `users` table. */
data class Profile(
    val id: Int,
    val username: String,
    val displayName: String,
    /** Plaintext base32 TOTP secret (speakeasy defaults). */
    val totpSecret: String,
    /** PBKDF2 salt string; may fall back to totpSecret when null. */
    val keySalt: String,
)

/** Decrypted company blob. `name` and all fields live inside the encrypted JSON. */
data class Company(
    val id: Int,
    val name: String,
    val jobTitle: String? = null,
    val workType: String? = null,
    val location: String? = null,
    val hierCompany: String? = null,
    val hierProject: String? = null,
    val hierPlatform: String? = null,
    /** In-session only — never shown on exports (kept here for the detail view). */
    val navId: String? = null,
    val supervisors: String? = null,
    val notes: String? = null,
    val reportEmail: String? = null,
)

/** One punched row inside an entry's decrypted rows_json array. */
data class EntryRow(
    val label: String = "",
    val name: String = "",
    val desc: String = "",
    /** 24-hour HH:MM, or "" when not punched. */
    val clockIn: String = "",
    val clockOut: String = "",
    val totalMins: Int = 0,
)

/** A time entry (session) with its decrypted rows. */
data class TimeEntry(
    val id: Int,
    val companyId: Int,
    /** YYYY-MM-DD */
    val logDate: String,
    val sessionLabel: String,
    val totalMins: Int,
    val rows: List<EntryRow>,
)
