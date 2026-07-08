package com.conquered.time.crypto

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Parity against the desktop's speakeasy TOTP. Vectors generated with:
 *
 *   node -e "const s=require('speakeasy');
 *     console.log(s.totp({secret:'JBSWY3DPEHPK3PXP',encoding:'base32',time:T}))"
 *
 * If these fail, the Kotlin TOTP has drifted from speakeasy's defaults.
 */
class TotpParityTest {

    private val secret = "JBSWY3DPEHPK3PXP"

    // (epochSeconds, expected code) — straight from speakeasy.
    private val vectors = listOf(
        0L to "282760",
        1234567890L to "742275",
        1700000000L to "324550",
        59L to "996554",
        1111111109L to "071271",
    )

    @Test
    fun generate_matchesSpeakeasy() {
        for ((t, code) in vectors) {
            assertEquals("code at t=$t", code, Totp.generate(secret, t))
        }
    }

    @Test
    fun verify_acceptsCurrentStep() {
        assertTrue(Totp.verify(secret, "324550", epochSeconds = 1700000000L))
    }

    @Test
    fun verify_acceptsWithinWindow() {
        // one step earlier / later than the code's own step still verifies (±1)
        assertTrue(Totp.verify(secret, "324550", epochSeconds = 1700000000L + 29))
        assertTrue(Totp.verify(secret, "324550", epochSeconds = 1700000000L - 1))
    }

    @Test
    fun verify_rejectsOutsideWindow() {
        // two steps away → outside the ±1 window
        assertFalse(Totp.verify(secret, "324550", epochSeconds = 1700000000L + 90))
    }

    @Test
    fun verify_rejectsWrongCode() {
        assertFalse(Totp.verify(secret, "000000", epochSeconds = 1700000000L))
    }

    @Test
    fun verify_ignoresSpacingAndRejectsBadLength() {
        assertTrue(Totp.verify(secret, " 324 550 ", epochSeconds = 1700000000L))
        assertFalse(Totp.verify(secret, "3245", epochSeconds = 1700000000L))
    }
}
