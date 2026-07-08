package com.conquered.time.crypto

import org.junit.Assert.assertEquals
import org.junit.Assert.fail
import org.junit.Test
import javax.crypto.AEADBadTagException

/**
 * Parity against the desktop implementation. Vectors were produced by the real
 * Node module (src/main/vault-crypto.js) — regenerate with:
 *
 *   node -e "const vc=require('./src/main/vault-crypto.js'); ..."
 *
 * If any of these fail, the Kotlin port has drifted from the Electron vault
 * format and NO real vault will decrypt. Do not 'fix' the test by changing the
 * expected values — fix VaultCrypto.
 */
class VaultCryptoParityTest {

    private val password = "devpass123"
    private val keySalt = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2"
    private val expectedKeyHex = "789dc3b59ff633bc9de91d2fbbceec5de2b171eae502d73adcab4ba9e04b7a22"
    private val plaintext = """{"name":"Zenith Corp","project":"Alpha","platform":"Web","navId":"A123456"}"""

    private val blob = VaultCrypto.EncBlob(
        iv = "9e3fd853de63ca6bd0e3bf3d",
        tag = "3e6fe48c051b37ceccbe8387bb4677a6",
        data = "df6cafa166074c7808b765198f8322cbe325ae17ab8523713259dd483cfc58b3" +
            "acb9b17249c42d5c413128f11772e01aa68ac48fb33b9981e838944d628532a3" +
            "cafe2966c75c0116249c4f"
    )

    @Test
    fun deriveKey_matchesNodePbkdf2() {
        val key = VaultCrypto.deriveKey(password, keySalt)
        assertEquals(expectedKeyHex, key.toHex())
    }

    @Test
    fun decrypt_matchesNodeGcmBlob() {
        val key = VaultCrypto.deriveKey(password, keySalt)
        assertEquals(plaintext, VaultCrypto.decrypt(blob, key))
    }

    @Test
    fun decrypt_wrongPassword_throws() {
        val key = VaultCrypto.deriveKey("wrongpassword", keySalt)
        try {
            VaultCrypto.decrypt(blob, key)
            fail("expected AEADBadTagException on wrong-key decrypt")
        } catch (e: AEADBadTagException) {
            // expected — this is how the unlock screen detects a bad password
        }
    }

    private fun ByteArray.toHex(): String =
        joinToString("") { "%02x".format(it) }
}
