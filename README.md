# Lens Travel Cockpit

PC-first prototype for a context-aware AI travel companion. It tests the core product loop with uploaded travel/vlog clips, persistent trip memory, live visual questions, cloud visual artifacts, and a phone-first Live test surface.

## What is implemented

- Next.js TypeScript cockpit with four work areas: trip setup, uploaded video replay, live assistant, and travel cards.
- 1 FPS replay frame capture from uploaded clips, using a 768x768 JPEG frame shape suitable for Gemini Live.
- Supermemory Cloud adapter for trip memory ingestion and profile/search context retrieval.
- Google Routes and Places adapters for Bengaluru route context, manual location presets, nearby places, and visible Maps evidence.
- Gemini Live adapter for real visual turns when `GEMINI_API_KEY` is present.
- Gemini Omni Flash adapter boundary for visual/video travel cards.
- Gemini 3.5 Flash cloud summaries, visual translation analysis, and city-game orchestration.
- Nano Banana 2 image editing for on-demand translated visual copies.
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

## Android Gemini Live test

The focused phone test is available at `/live-test`. It streams the Android camera and microphone over a WebSocket to your laptop; the laptop owns the Gemini Live session and keeps `GEMINI_API_KEY` private.

1. Copy `.env.example` to `.env.local` and set `GEMINI_API_KEY`.
2. Start the production laptop server in one terminal. This intentionally avoids Next development mode, whose hot-reload WebSocket is incompatible with a Quick Tunnel:

   ```bash
   npm run start:phone
   ```

3. Start an HTTPS tunnel in a second terminal:

   ```bash
   npm run tunnel:phone
   ```

4. Open the printed `https://*.trycloudflare.com/live-test` URL in Android Chrome and grant camera/microphone access.

To ask “where am I?”, request directions, or discover places by voice (for example, “good cafes on 12th Road in Indiranagar”), also set `GOOGLE_MAPS_API_KEY` to a Google Maps Platform **server** key with both **Routes API** and **Places API (New)** enabled, and keep `MAPS_FIXTURE_MODE=false`. The tunnel URL is temporary and public: do not share it or the test code. The test ends after 110 seconds, before Gemini Live's audio+video session limit.

`npm run dev:ws` remains available for laptop-only development, but do not use it through the phone tunnel.

## Environment

Copy `.env.example` to `.env.local` and fill what you want to test:

```bash
GEMINI_API_KEY=
SUPERMEMORY_API_KEY=
GEMINI_MEMORY_MODEL=gemini-3.5-flash
GOOGLE_MAPS_API_KEY=
GOOGLE_MAPS_AUTH_MODE=auto
GOOGLE_MAPS_OAUTH_TOKEN=
GOOGLE_MAPS_OAUTH_SCOPES=https://www.googleapis.com/auth/maps-platform
# Optional alternative to GOOGLE_APPLICATION_CREDENTIALS:
GOOGLE_MAPS_SERVICE_ACCOUNT_JSON=
MAPS_FIXTURE_MODE=false
MAPS_DEFAULT_LANGUAGE=en-IN
MAPS_DEFAULT_UNITS=METRIC
GEMINI_LIVE_MODEL=gemini-3.1-flash-live-preview
GEMINI_MEMORY_MODEL=gemini-3.5-flash
GEMINI_IMAGE_MODEL=gemini-3.1-flash-image
GEMINI_GAME_MODEL=gemini-3.5-flash
OMNI_FLASH_ENABLED=false
OMNI_FLASH_MODEL=gemini-omni-flash-preview
```

Missing keys are intentionally visible in the UI.

Visual card generation uses Gemini Omni Flash when `OMNI_FLASH_ENABLED=true` and `GEMINI_API_KEY` is set. Booking summaries use Gemini 3.5 Flash. The phone Translate Lens uses Nano Banana 2 only after a deliberate capture, while city games use one-off Gemini 3.5 Flash vision checks and do not retain photos.

## Maps testing

- Leave `GOOGLE_MAPS_API_KEY` empty to verify the disabled/no-key state.
- Set `MAPS_FIXTURE_MODE=true` to test the Bengaluru route panel without calling Google Maps.
- Set `GOOGLE_MAPS_API_KEY` and keep `MAPS_FIXTURE_MODE=false` to call Routes API and Places Nearby Search from the server.
- If Routes returns "API keys are not supported", confirm the key is a Google Maps Platform server key with Routes API and Places API (New) enabled. For server-side OAuth testing, set `GOOGLE_MAPS_AUTH_MODE=oauth` and either `GOOGLE_MAPS_OAUTH_TOKEN` or `GOOGLE_APPLICATION_CREDENTIALS`.
- The app injects Maps route context into live turns but does not persist raw Google Maps responses into Supermemory.
