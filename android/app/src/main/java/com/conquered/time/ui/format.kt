package com.conquered.time.ui

/** "6h 05m", "45m", "0m" — matches the desktop's duration presentation. */
fun formatMinutes(mins: Int): String {
    val m = if (mins < 0) 0 else mins
    val h = m / 60
    val r = m % 60
    return when {
        h > 0 -> "${h}h ${r.toString().padStart(2, '0')}m"
        else -> "${r}m"
    }
}

/** "08:30 – 12:15", or a single side when only one is punched, or "—". */
fun formatClockRange(clockIn: String, clockOut: String): String {
    val a = clockIn.trim()
    val b = clockOut.trim()
    return when {
        a.isNotEmpty() && b.isNotEmpty() -> "$a – $b"
        a.isNotEmpty() -> "$a – …"
        b.isNotEmpty() -> "… – $b"
        else -> "—"
    }
}
