# Magellan Lens

Magellan Lens is a phone-first AI travel companion built for a hackathon. It combines Magellan's travel-chat interface with Lens's server-side Gemini Live backend.

The product has two intentional modes:

- **Portrait chat** is a normal Gemini Flash travel chat. It does not open the camera.
- **Landscape Lens** is an explicit Gemini Live camera and voice session, with GPS-aware maps, weather, memory, translated visuals, city finds, and TimeLens historical reconstructions.

## What it does

- Keeps durable trip/profile facts in Supermemory and curates new explicit facts from final Live transcript turns.
- Starts with a local default trip memory: vegetarian, Rs 2,500/day, July 11–13, and Indiranagar cafe exploration.
- Uses Google Places and Routes tools for location, nearby recommendations, and budget/mobility-aware directions.
- Uses weather and current-time tools for practical travel advice.
- Captures menus, signs, notices, placards, timetables, storefronts, and packaging; Gemini Flash reads the text and Nano Banana 2 renders a translated visual copy.
- Runs safe, city-specific visual scavenger hunts. Quest templates are cached per city for 24 hours while progress stays session-specific.
- Generates short, clearly labeled TimeLens historical reconstructions through Gemini Omni Flash when explicitly requested. These are illustrative, non-graphic reconstructions with an educational voiceover, never archival footage.

## Architecture

```
Android Chrome / desktop browser
  ├─ Portrait: /api/chat → Gemini 3.5 Flash
  └─ Landscape: WebSocket /api/live/realtime → Gemini Live
       ├─ Google Places + Routes
       ├─ Weather + current time
       ├─ Supermemory retrieval + async memory curator
       ├─ /api/visual-translation → Flash + Nano Banana 2
       ├─ /api/games/* → Gemini 3.5 Flash
       └─ /api/historical-video → Gemini Omni Flash
```

The browser never receives `GEMINI_API_KEY`. All model, Maps, and Supermemory calls run on the laptop/server.

## Run locally

```bash
npm install
Copy-Item .env.example .env.local
npm run dev:ws
```

Open [http://localhost:3000](http://localhost:3000). The custom server is required for the Gemini Live WebSocket endpoint.

For a production-like local run:

```bash
npm run start:phone
```

## Test on Android

Camera and microphone require a secure origin. With the server running, open a second terminal:

```bash
npm run tunnel:phone
```

Open the resulting `https://*.trycloudflare.com` URL in Android Chrome. Tap the camera control to enter the Live Lens, grant camera/microphone/location permissions, and use the home control to return to portrait chat and stop Live.

Quick Tunnels are temporary and public. Treat the URL as test-only.

## Configuration

Create `.env.local`; it is ignored by Git.

```bash
# Required for Gemini chat, Live, translation, games, and TimeLens.
GEMINI_API_KEY=

# Optional memory persistence/retrieval.
SUPERMEMORY_API_KEY=

# Optional Maps/Routes tool calling.
GOOGLE_MAPS_API_KEY=
MAPS_FIXTURE_MODE=false

# Model defaults.
GEMINI_LIVE_MODEL=gemini-3.1-flash-live-preview
GEMINI_MEMORY_MODEL=gemini-3.5-flash
GEMINI_IMAGE_MODEL=gemini-3.1-flash-image
GEMINI_GAME_MODEL=gemini-3.5-flash
GEMINI_HISTORICAL_VIDEO_MODEL=gemini-omni-flash-preview
```

For real Maps results, enable **Places API (New)** and **Routes API** on the Google Maps Platform project associated with `GOOGLE_MAPS_API_KEY`. Set `MAPS_FIXTURE_MODE=true` to exercise the UI without Maps calls.

## Quality checks

```bash
npm run lint
npx tsc --noEmit
npm run build
npm run test:memory
```

## Notes

- Live audio/video sessions are intentionally capped before Gemini Live's audio+video limit.
- Images are sent to model APIs only after an explicit translation, game-capture, or historical-video request; game attempt photos are not retained after validation.
- TimeLens should be treated as a learning aid. Verify historical details with authoritative sources.
