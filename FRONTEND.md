# Fleet Incident Triage — Frontend

The React/Vite frontend lives in `frontend/`. It is a single-screen, responsive demo UI built for the Fleet Incident Triage Harness.

## Run locally

```powershell
cd frontend
npm install
npm run dev
```

The app first attempts `POST /api/triage` and consumes Server-Sent Events from the streaming response. Until the backend exists, it automatically uses a local animated demo for all three sample incidents.

## Backend event contract

The frontend recognizes `intake`, `classifier`, `rootCause`, `pattern`, `compliance`, `halted`, `done`, and `error` events. Each step event should send JSON data; `done` should provide `severity`, `cause`, `recommendation`, `pattern`, and `compliance`.

## Visual direction

The UI uses a restrained neo-brutalist system: warm paper, ink-black rules and shadows, deep pine green operational states, rust only for a halted pipeline, custom SVG truck / clipboard / gauge graphics, and subtle live-state motion.
