# SmartSeed Farmer App (Expo / React Native)

Standalone Expo project (SDK 58, expo-router, TypeScript strict). It is **not** part of the root npm workspaces: run `npm install` inside `apps/mobile` only.

## Run

```bash
cd apps/mobile
npm install
cp .env.example .env      # set EXPO_PUBLIC_API_URL
npm start                 # scan the QR with Expo Go (same Wi-Fi)
```

- **Expo Go**: camera scanning, TTS, AsyncStorage and the whole UI work. Remote push tokens do not work in Expo Go on Android (SDK 53+); the "Turn on alerts" button then fails gracefully.
- **Dev build** (needed for push): `npx expo prebuild` then `npx expo run:android` / `run:ios`, or `eas build --profile development`. Set `EXPO_PUBLIC_EAS_PROJECT_ID`.
- Android emulator reaches a host-machine API at `http://10.0.2.2:<port>`; a physical phone needs your LAN IP (and the API must allow it).

## Environment variables

| Var | Purpose |
|---|---|
| `EXPO_PUBLIC_API_URL` | API origin; client calls `/v1/public/...` |
| `EXPO_PUBLIC_VERIFY_HOSTS` | Comma-separated hosts accepted in scanned QR URLs (default `smartseed.example`) |
| `EXPO_PUBLIC_EAS_PROJECT_ID` | Optional, for Expo push tokens |

## Scripts

`npm test` (jest-expo), `npm run test:coverage`, `npm run typecheck`.

## Structure

- `app/` expo-router screens (12): `index` (Splash), `language`, `home`, `scanner`, `verify` (Product Verification), `passport`, `journey` (Supply Chain History), `risk`, `report`, `history`, `notifications`, `profile`.
- `src/domain/` pure logic: `deriveIndicator`, QR token parsing, status rows, speech summary.
- `src/api/` typed client (zod-validated responses, timeout, retry, error mapping).
- `src/storage/` AsyncStorage-backed result cache and history; `src/state/` verify flow, device registration, push.
- `src/locales/{en,te,hi}.json` all UI text. **Add a language**: add `xx.json` (same keys as `en.json`, plus `meta.nativeName` and `meta.speechLocale`) and one line in `src/locales/index.ts`. The locale test fails if keys or placeholders differ or any value is empty.

## Safety behaviour

- `deriveIndicator` mirrors the server rule. The UI shows the **worse** of the server indicator and the local derivation, so a wrong server "GREEN" with a failed/unverified chain is never shown green.
- The four statuses (identity, tamper-proof record, scan activity, investigation) are always listed separately with plain-language text and a text label/icon (not colour only). No copy says "genuine" from a QR alone; a valid identity row explicitly says it does not prove the seeds are real.
- Offline: last result per token is cached with its timestamp. When the network fails/times out the cached copy is shown with the banner "Saved information may be outdated. Check again when online." A cached GREEN becomes a neutral grey "Last checked earlier" state; stale "OK" rows are neutral. Expiry is re-evaluated against today's date. A server 404/429/5xx is shown as an error and is not masked by the cache.
- History stores no verdict, only product, batch and time.
- QR: only `https://<allowed host>/verify/<22-128 char base64url token>` is accepted (no userinfo, port other than 443, query, fragment, extra segments). Anything else shows "not a SmartSeed code".

## API contract (aligned with the real backend)

- Envelope `{data, meta, error}`. Verify `data`: `product`/`manufacturer`/`batch` may be null; `package {serialNo}` for package-level QR; `journey` items are `{step, orgType, at, status}` (no org name/location); `risk {score, level, assessed}`; `warnings` are CODES. Verification/risk/indicator enums are strict (unknown value => generic error); journey/warning codes are open and unknown ones show a generic localized "check with the seller" text. Unknown extra keys are ignored.
- Unknown token = HTTP 200 with nulls, RED, `QR_UNKNOWN`: shown as a localized red "This code is not recognised" result with a Report button; never cached, never added to history, always RED even if a server said otherwise.
- `risk.assessed=false` shows "No risk assessment yet" (not "Low risk"). Note: `deriveIndicator` follows the documented rule (level LOW) and does not itself require `assessed`; the server indicator (worst-of) decides if unscored batches are yellow.
- `X-Device-Id` header (anonymous UUID) is sent on verify and report. `lat`/`lon` query params are supported by the client and `runVerification({location})` but the app does **not** request location permission yet.
- Notifications: `data: [{id, type, title, body, createdAt, readAt}]` (type/readAt optional/nullable).
- Reports send `{token, description?, region?}` (no photo), never auto-retried.

## Not verified

No phone or emulator was available. Verified only by unit/component tests (jest-expo), `tsc --noEmit`, and a successful `expo export --platform android` bundle. **Not verified on a device**: real camera QR scanning, camera permission flows, TTS voices (Telugu/Hindi voices depend on the phone's installed TTS engines), push registration, Telugu/Hindi font rendering and layout, real-network timeouts, accessibility with TalkBack/VoiceOver, visual design and contrast on real screens. Telugu and Hindi translations were machine-drafted and should be reviewed by native speakers. No app icon/splash artwork is included (Expo defaults).
