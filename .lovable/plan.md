## Goal

Keep Lovable AI as the primary provider for the quotation image extraction, but automatically fall back to **Google Gemini via Google AI Studio** (your own API key, billed to your Google account) whenever Lovable returns 402 "credits exhausted". No Google Cloud project, no service accounts, no other GCP infrastructure — just one API key.

## What you'll need to do (one-time, ~2 minutes)

1. Go to https://aistudio.google.com/apikey
2. Sign in with any Google account.
3. Click **Create API key** → **Create API key in new project** (Google auto-creates a throwaway project just to hold the key; you never touch it).
4. Copy the key (starts with `AIza...`).
5. When I switch to build mode, I'll open a secure secret prompt asking for `GOOGLE_AI_API_KEY` — paste it there. It's stored server-side only, never shipped to the browser.

Free tier on AI Studio currently gives generous free daily quota on Gemini Flash models — usually more than enough for quotation uploads. No credit card required to start.

## What I'll build

### 1. Add the secret
Register `GOOGLE_AI_API_KEY` via the secure secret tool.

### 2. New server-only helper: `src/lib/google-ai.server.ts`
Thin wrapper that calls Google's REST endpoint directly (no SDK needed):
```
POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=<KEY>
```
Body carries the same system prompt + inline base64 image the Lovable call uses. Returns parsed JSON text.

### 3. Modify `src/lib/quote.functions.ts`
Wrap the existing `generateText` call:
- **Try Lovable AI first** (unchanged behavior).
- On **402** (credits exhausted) → catch, call the Google helper with the same prompt/image, parse the same JSON shape.
- On **429** or other errors → keep current user-facing message (no fallback, because retrying Google won't help a rate-limit on Lovable).
- If Google *also* fails → surface a clear error: "Both AI providers failed: <reason>. Check your Google AI Studio quota or add Lovable credits."

Response shape stays identical (`{ items: MatchedItem[] }`) so the frontend needs zero changes.

### 4. No UI changes
The fallback is invisible to the user — uploads just keep working after Lovable credits are exhausted.

## Technical details

- **Model:** `gemini-2.5-flash` on Google AI Studio (same family as the current `google/gemini-3-flash-preview` on Lovable; supports vision + JSON output; on free tier).
- **Request shape:** Google's native `contents: [{ parts: [{ text }, { inline_data: { mime_type, data } }] }]` with `systemInstruction` and `generationConfig.responseMimeType: "application/json"` so we get clean JSON back.
- **Auth:** API key in `?key=` query param (Google AI Studio's standard). Never exposed to the browser — the call runs inside the server function.
- **Where the key is read:** `process.env.GOOGLE_AI_API_KEY` inside the `.handler()` (not at module scope, per the Worker runtime rules).
- **No new npm packages** — plain `fetch`.
- **No changes** to inventory, categories, synonyms, RLS, or DB.

## Files touched

- **new** `src/lib/google-ai.server.ts` — Gemini AI Studio caller + JSON parser
- **edit** `src/lib/quote.functions.ts` — add 402 fallback branch

## Out of scope (explicitly not doing)

- Google Cloud Vision, Document AI, Vertex AI, service accounts, or gcloud CLI.
- Hosting, database, or storage on Google Cloud.
- Any user-facing settings toggle (can be added later if you want manual control).
