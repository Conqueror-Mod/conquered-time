package com.conquered.time.crypto

import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * TOTP verification matching the desktop's speakeasy defaults (see
 * docs/VAULT-FORMAT.md): base32 secret, HMAC-SHA1, 6 digits, 30-second step,
 * ±1 window. Kept in sync with `speakeasy.totp.verify({ ..., window: 1 })`.
 *
 * For an offline vault this is UX parity, not a security boundary — the
 * totp_secret sits in plaintext in the vault, so the password (key derivation)
 * is the only real gate. Callers may treat a failed check as advisory.
 */
object Totp {

    private const val DIGITS = 6
    private const val STEP_SECONDS = 30L
    private const val WINDOW = 1

    /** Generate the 6-digit code for [secret] at [epochSeconds]. */
    fun generate(secret: String, epochSeconds: Long): String {
        val counter = Math.floorDiv(epochSeconds, STEP_SECONDS)
        return hotp(base32Decode(secret), counter)
    }

    /**
     * True if [code] matches the secret within ±1 time step of [epochSeconds]
     * (default now). Non-digit padding/spacing in [code] is ignored.
     */
    fun verify(
        secret: String,
        code: String,
        epochSeconds: Long = System.currentTimeMillis() / 1000,
    ): Boolean {
        val cleaned = code.trim().filter { it.isDigit() }
        if (cleaned.length != DIGITS) return false
        val base = Math.floorDiv(epochSeconds, STEP_SECONDS)
        for (offset in -WINDOW..WINDOW) {
            if (hotp(base32Decode(secret), base + offset) == cleaned) return true
        }
        return false
    }

    private fun hotp(key: ByteArray, counter: Long): String {
        val msg = ByteArray(8)
        var c = counter
        for (i in 7 downTo 0) {
            msg[i] = (c and 0xff).toByte()
            c = c shr 8
        }
        val mac = Mac.getInstance("HmacSHA1")
        mac.init(SecretKeySpec(key, "HmacSHA1"))
        val hash = mac.doFinal(msg)
        val off = (hash[hash.size - 1].toInt() and 0x0f)
        val binary = ((hash[off].toInt() and 0x7f) shl 24) or
            ((hash[off + 1].toInt() and 0xff) shl 16) or
            ((hash[off + 2].toInt() and 0xff) shl 8) or
            (hash[off + 3].toInt() and 0xff)
        val otp = binary % 1_000_000
        return otp.toString().padStart(DIGITS, '0')
    }

    /** RFC 4648 base32 decode (uppercase, no padding required). */
    private fun base32Decode(input: String): ByteArray {
        val alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
        val clean = input.trim().trimEnd('=').uppercase()
        var buffer = 0
        var bitsLeft = 0
        val out = ArrayList<Byte>(clean.length * 5 / 8)
        for (ch in clean) {
            val v = alphabet.indexOf(ch)
            if (v < 0) continue // skip stray separators/whitespace
            buffer = (buffer shl 5) or v
            bitsLeft += 5
            if (bitsLeft >= 8) {
                bitsLeft -= 8
                out.add(((buffer shr bitsLeft) and 0xff).toByte())
            }
        }
        return out.toByteArray()
    }
}
