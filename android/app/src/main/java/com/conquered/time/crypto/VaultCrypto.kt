package com.conquered.time.crypto

import javax.crypto.Cipher
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

/**
 * Port of the desktop vault crypto (src/main/vault-crypto.js). Must stay
 * byte-for-byte compatible with the Electron app — see docs/VAULT-FORMAT.md.
 *
 * Two non-obvious compatibility rules, both enforced here:
 *
 *  1. KEY SALT IS USED AS ITS UTF-8 BYTES, NOT DECODED HEX. On the desktop,
 *     `key_salt` is a 64-char hex STRING and Node's crypto.pbkdf2Sync receives
 *     it as a string, so PBKDF2 salts with the 64 ASCII bytes of that string.
 *     We therefore call salt.toByteArray(Charsets.UTF_8) — decoding the hex to
 *     32 bytes would derive a different key and every decrypt would fail.
 *
 *  2. GCM CIPHERTEXT AND TAG ARE STORED SEPARATELY (hex). Java's GCM expects
 *     ciphertext||tag concatenated, so decrypt() appends the 16-byte tag to the
 *     ciphertext before running the cipher.
 */
object VaultCrypto {

    private const val PBKDF2_ITERATIONS = 310_000
    private const val KEY_BITS = 256
    private const val GCM_TAG_BITS = 128

    /** A stored AES-256-GCM blob. All three fields are lowercase hex (as in the DB). */
    data class EncBlob(val iv: String, val tag: String, val data: String)

    /**
     * PBKDF2(password, salt-as-UTF-8-bytes, 310000, HMAC-SHA256) -> 32-byte key.
     * `salt` is the raw `key_salt` string exactly as stored in the users table.
     */
    fun deriveKey(password: String, salt: String): ByteArray {
        val spec = PBEKeySpec(
            password.toCharArray(),
            salt.toByteArray(Charsets.UTF_8),
            PBKDF2_ITERATIONS,
            KEY_BITS
        )
        val factory = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
        return factory.generateSecret(spec).encoded
    }

    /**
     * Decrypt an [EncBlob] with `key`. Throws (AEADBadTagException) on a wrong
     * key / tampered data — callers use that to detect a bad unlock, exactly as
     * the desktop relies on Node's decipher.final() throwing.
     */
    fun decrypt(blob: EncBlob, key: ByteArray): String {
        val iv = hexToBytes(blob.iv)
        val cipherAndTag = hexToBytes(blob.data) + hexToBytes(blob.tag)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(
            Cipher.DECRYPT_MODE,
            SecretKeySpec(key, "AES"),
            GCMParameterSpec(GCM_TAG_BITS, iv)
        )
        return String(cipher.doFinal(cipherAndTag), Charsets.UTF_8)
    }

    private fun hexToBytes(hex: String): ByteArray {
        require(hex.length % 2 == 0) { "hex string must have even length" }
        val out = ByteArray(hex.length / 2)
        var i = 0
        while (i < hex.length) {
            out[i / 2] = ((hexDigit(hex[i]) shl 4) or hexDigit(hex[i + 1])).toByte()
            i += 2
        }
        return out
    }

    private fun hexDigit(c: Char): Int = when (c) {
        in '0'..'9' -> c - '0'
        in 'a'..'f' -> c - 'a' + 10
        in 'A'..'F' -> c - 'A' + 10
        else -> throw IllegalArgumentException("invalid hex digit: $c")
    }
}
