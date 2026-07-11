# Lens Travel Cockpit

PC-first prototype for a context-aware AI travel companion. It tests the core product loop with uploaded travel/vlog clips, persistent trip memory, live visual questions, Omni Flash visual artifacts, and local/offline text boundaries.

## What is implemented

- Next.js TypeScript cockpit with four work areas: trip setup, uploaded video replay, live assistant, and travel cards.
- 1 FPS replay frame capture from uploaded clips, using a 768x768 JPEG frame shape suitable for Gemini Live.
- Supermemory Cloud adapter for trip memory ingestion and profile/search context retrieval.
- Google Routes and Places adapters for Bengaluru route context, manual location presets, nearby places, and visible Maps evidence.
- Gemini Live adapter for real visual turns when `GEMINI_API_KEY` is present.
- Gemini Omni Flash adapter boundary for visual/video travel cards. It reports disabled/not configured instead of silently routing visual generation to Gemma.
- LiteRT-LM/Gemma adapter boundary for offline text artifacts like booking summaries. It reports disabled/not configured instead of silently falling back to a cloud model.
- Optional custom WebSocket server for `/api/live`; stock Next dev uses the HTTP live-turn fallback.

## Run

```bash
npm install
npm run dev
```

Open `http://localhost:3000`, or set `PORT=3001` if 3000 is in use.

```bash
npm run dev -- -p 3001
```

For the optional WebSocket proxy:

```bash
npm run dev:ws
```

## Environment

Copy `.env.example` to `.env.local` and fill what you want to test:

```bash
GEMINI_API_KEY=
SUPERMEMORY_API_KEY=
GOOGLE_MAPS_API_KEY=
GOOGLE_MAPS_AUTH_MODE=auto
GOOGLE_MAPS_OAUTH_TOKEN=
GOOGLE_MAPS_OAUTH_SCOPES=https://www.googleapis.com/auth/maps-platform
# Optional alternative to GOOGLE_APPLICATION_CREDENTIALS:
GOOGLE_MAPS_SERVICE_ACCOUNT_JSON=
MAPS_FIXTURE_MODE=false
MAPS_DEFAULT_LANGUAGE=en-IN
MAPS_DEFAULT_UNITS=METRIC
LOCAL_MODEL_ENABLED=false
LITERT_MODEL_PATH=
GEMINI_LIVE_MODEL=gemini-3.1-flash-live-preview
OMNI_FLASH_ENABLED=false
OMNI_FLASH_MODEL=gemini-omni-flash-preview
```

Missing keys are intentionally visible in the UI.

Visual card generation uses Gemini Omni Flash when `OMNI_FLASH_ENABLED=true` and `GEMINI_API_KEY` is set. Gemma/LiteRT remains scoped to local/private text tasks.

## Maps testing

- Leave `GOOGLE_MAPS_API_KEY` empty to verify the disabled/no-key state.
- Set `MAPS_FIXTURE_MODE=true` to test the Bengaluru route panel without calling Google Maps.
- Set `GOOGLE_MAPS_API_KEY` and keep `MAPS_FIXTURE_MODE=false` to call Routes API and Places Nearby Search from the server.
- If Routes returns "API keys are not supported", confirm the key is a Google Maps Platform server key with Routes API and Places API (New) enabled. For server-side OAuth testing, set `GOOGLE_MAPS_AUTH_MODE=oauth` and either `GOOGLE_MAPS_OAUTH_TOKEN` or `GOOGLE_APPLICATION_CREDENTIALS`.
- The app injects Maps route context into live turns but does not persist raw Google Maps responses into Supermemory.
