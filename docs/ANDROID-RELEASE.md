# Android — building a signed release APK

The Android client (`/android`) ships as a directly-installable (sideloaded)
signed APK, the same distribution model as the Windows NSIS beta. This is the
one-time setup + repeatable build.

## 1. Create your signing keystore (ONE TIME — keep it forever)

The keystore is the app's permanent signing identity. **Back it up privately and
never lose or leak it** — like `src/shared/beta-secret.js`. If it's lost, no
future build can update an already-installed copy signed with it.

From the `android/` directory, run (JDK 17's keytool):

```
"C:\Program Files\BellSoft\LibericaJDK-17\bin\keytool" -genkeypair -v ^
  -keystore conquered-time-release.jks ^
  -alias conquered-time ^
  -keyalg RSA -keysize 2048 -validity 10000 ^
  -storetype JKS
```

It will prompt for a keystore password, key password (press Enter to reuse the
store password), and a name/org (any values — e.g. "Chris Bowles"). A 10000-day
validity is the Android-recommended minimum for an app you intend to keep
updating.

## 2. Point Gradle at it (gitignored — never committed)

Copy the template and fill in the passwords you just chose:

```
copy keystore.properties.example keystore.properties
```

```properties
storeFile=conquered-time-release.jks
storePassword=<your store password>
keyAlias=conquered-time
keyPassword=<your key password>
```

Both `keystore.properties` and `*.jks` are gitignored. Keep a private backup of
both the `.jks` file and these passwords (e.g. a password manager).

## 3. Build the signed APK

From `android/`:

```
gradlew.bat assembleRelease
```

Output: `app/build/outputs/apk/release/app-release.apk` — already signed and
zipaligned by the Android Gradle plugin (no manual `apksigner`/`zipalign` step).

Verify the signature (optional):

```
"%LOCALAPPDATA%\Android\Sdk\build-tools\<ver>\apksigner" verify --print-certs app\build\outputs\apk\release\app-release.apk
```

## 4. Distribute

Hand testers `app-release.apk`. They enable "Install unknown apps" for their
browser/file manager, then tap the APK to install. Because it's not Play-signed,
the installer shows an "unknown source" prompt — expected for a sideloaded beta
(same story as the unsigned Windows SmartScreen prompt).

## Notes
- `versionCode` / `versionName` live in `app/build.gradle.kts` — bump
  `versionCode` (integer) for every build testers should treat as an update.
- Without `keystore.properties`, `assembleRelease` produces an **unsigned** APK
  (debug builds are unaffected) — the config fails open so a fresh clone still
  compiles.
- This is an APK for direct install. Google Play would additionally require an
  AAB (`bundleRelease`) and a Play Console account — not set up here.
