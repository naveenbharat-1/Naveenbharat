# Finish "Safar English → Naveen Bharat" migration

The previous pass renamed ~130 files but a few user-visible strings and the Supabase client URL were **not** updated. This plan closes those gaps. Logos/assets and technical package IDs (`com.safarenglishka.app`, Java folder, keystore) stay untouched as before.

## 1. Supabase client → Naveen Bharat project

`src/integrations/supabase/client.ts` still points at the **old** project `wegamscqtvqhxowlskfm`. Repoint to `cmbattmjwriiesibayfk`:

- `SUPABASE_URL` → `https://cmbattmjwriiesibayfk.supabase.co`
- `SUPABASE_PUBLISHABLE_KEY` → the anon key for `cmbattmjwriiesibayfk` (already in context)
- `supabase/config.toml` `project_id` → `cmbattmjwriiesibayfk`
- `.env`: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID` → new values

No DB migration needed — new project already has 75+ tables and all secrets configured.

## 2. Remaining "Safar English" strings to rename

| File | Change |
| --- | --- |
| `android/app/src/main/res/values/strings.xml` | `app_name` and `title_activity_main` → `Naveen Bharat` (keep `package_name` / `custom_url_scheme` = `com.safarenglishka.app`) |
| `public/manifest.json` | `name`, `short_name`, `description` → Naveen Bharat |
| `src/components/brand/BrandMark.tsx` | default `title` prop → `"Naveen Bharat"` |
| `src/pages/AdminLogin.tsx` | logo `alt`, brand text, placeholder email → Naveen Bharat / `admin@naveenbharat.com` |
| `src/lib/native/naveenStoragePdf.ts` | error string "Unsupported Safar English storage link" → "Unsupported Naveen Bharat storage link" |
| Full repo grep sweep | `rg -i "safar english"` across `src/`, `public/`, `android/app/src/main/res/values*/`, `docs/`, `*.md`, `*.html` — rename every remaining human-readable hit |

## 3. Explicitly EXCLUDED (unchanged)

- All logo/image assets: `nb-mark.webp`, `nb-fist-logo.webp`, `/icons/*`, mipmap/drawable resources, favicon binary
- Android package ID `com.safarenglishka.app` + Java folder `com/safarenglishka/app/` (would break Play Store signing + installed users)
- `assetlinks.json` fingerprints
- iOS bundle ID in `apple-app-site-association` (already `com.naveenbharat.app`)
- Git history / repo name

## 4. Verification after build mode

1. `rg -in "safar english|safarenglish" -g '!*.webp' -g '!*.png' -g '!android/app/src/main/java/**' -g '!android/**/AndroidManifest.xml' -g '!public/.well-known/**'` — expect zero human-readable hits.
2. Load app → Supabase network calls hit `cmbattmjwriiesibayfk.supabase.co`.
3. Android `strings.xml` app label = "Naveen Bharat".

## Technical notes

- Supabase client keys are publishable (anon) — safe to commit.
- `.env` is auto-populated by the Lovable Cloud connection; editing it locally is fine but reconnecting Supabase is the durable source of truth.
- `types.ts` will regenerate automatically from the new project schema.

**Approve to switch to build mode and execute steps 1–2.**
