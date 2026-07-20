# Conquered Time — Android Companion Viewer

**Status: backburnered (intentionally).** Built in PRs #114/#115 (July 2026), signed-release
setup done, then parked while desktop work took priority. Do not delete — it is kept in-tree
on purpose.

## What it is

A native Kotlin/Jetpack Compose **read-only vault viewer**: open a portable vault export
(`vault.db` copy) on a phone, unlock it with the account password (+ optional TOTP), and
browse the Global Log — search, date-range filter, CSV export via the Android share sheet.
It never writes to the vault. The 5 Final Fantasy desktop themes are mirrored with a live
picker.

## Why it lives in this repo

The crypto must match the desktop app byte-for-byte. `app/src/test/.../VaultCryptoParityTest.kt`
and `TotpParityTest.kt` pin the Kotlin implementation to the exact vault format the Electron
app writes (AES-256-GCM blobs, PBKDF2 310k/sha256 key derivation, TOTP). Keeping it in-tree
means any future vault-format change can update the parity tests in the same PR instead of
silently breaking a separate repo.

Note: `android/**` is marked `linguist-detectable=false` in the root `.gitattributes`, so
this subtree does not appear in GitHub's language stats.

## Building

Standard Gradle project: `./gradlew assembleDebug` from this directory (Android Studio also
works). Release signing uses `keystore.properties` (see `keystore.properties.example`;
PKCS12 keystore — store and key passwords must match).
