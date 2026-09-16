# Fleet Incident Triage Harness — Backend Build Spec

No authentication for this build — demo-only, single user, no login flow.

## Tech Stack

- Node.js + Express
- Server-Sent Events (SSE) for streaming agent progress to the frontend
- Plain async functions for agents — no LangGraph/CrewAI
- JSON files for data (no database)
- Single reusable `callLLM()` helper wrapping whichever AI API is available

## Project Structure

```
fleet-harness-backend/
├── server.js                  # Express app entry point
├── routes/
│   └── triage.js               # POST /api/triage (SSE)
├── agents/
│   ├── intakeAgent.js
│   ├── classifierAgent.js
│   ├── rootCauseAgent.js
│   ├── patternCheckerAgent.js
│   └── complianceAgent.js
├── orchestrator.js             # runs agents in sequence, calls onStep callback
├── lib/
│   └── callLLM.js              # shared LLM API wrapper
├── data/
│   ├── incidents.json          # past incident memory (read + write)
│   ├── maintenance.json        # per-vehicle maintenance history (read-only)
│   └── compliance-rules.json   # incident type → reporting requirement (read-only)
└── package.json
```

## Data Files

### `data/maintenance.json`
Per-vehicle service history, read-only for this build.
```json
[
  {
    "vehicle_id": "TRK-042",
    "last_service": "2026-08-01",
    "past_issues": ["tire replacement - 2026-06-15"]
  },
  {
    "vehicle_id": "TRK-012",
    "last_service": "2026-07-10",
    "past_issues": ["brake pad replacement - 2026-05-01"]
  }
]
```

### `data/incidents.json`
Past incident memory — read by Pattern-Checker to detect recurrence, written to after every new incident is processed so memory grows over time.
```json
[
  { "vehicle_id": "TRK-012", "date": "2026-08-10", "issue_type": "slow_tire_pressure_drop", "severity": "low" },
  { "vehicle_id": "TRK-012", "date": "2026-08-24", "issue_type": "slow_tire_pressure_drop", "severity": "low" }
]
```
Pre-load this with the TRK-012 pattern-catch scenario before the demo.

### `data/compliance-rules.json`
Simple lookup table — kept rule-based (not LLM-driven) so this agent's output is 100% predictable for the demo.
```json
{
  "brake_failure": "DOT reportable",
  "tire_blowout_highway": "DOT reportable",
  "slow_tire_pressure_drop": "not reportable unless recurring 3+ times",
  "minor_vibration": "not reportable"
}
```

## Sample Incident Report (input shape)

```json
{
  "vehicle_id": "TRK-042",
  "timestamp": "2026-09-05T14:20:00",
  "report_text": "Driver reported unusual vibration and pulling to the left at highway speed",
  "reported_severity": "unclear",
  "sensor_data": { "tire_pressure_psi": 78, "temp_f": 145 }
}
```

An intentionally thin version (for the insufficient-data demo):
```json
{
  "vehicle_id": "TRK-007",
  "timestamp": "2026-09-06T09:00:00",
  "report_text": "something felt off",
  "reported_severity": null,
  "sensor_data": null
}
```

## Agents

### 1. Intake & Sufficiency Agent
**File:** `agents/intakeAgent.js`
**Input:** raw incident report (JSON, as above)
**Job:**
- Extract structured fields: `vehicle_id`, `symptom_summary`, `timestamp`, `sensor_data` (if present)
- Decide if there's enough information to proceed. Rule of thumb: insufficient if `report_text` has no identifiable symptom keyword AND `sensor_data` is null/empty.
**Output shape:**
```json
{ "sufficient": true, "vehicle_id": "TRK-042", "symptom_summary": "vibration and pulling left", "sensor_data": {...}, "missing": null }
```
If insufficient:
```json
{ "sufficient": false, "vehicle_id": "TRK-007", "missing": "Need sensor readings or a clearer symptom description to assess this report." }
```
**On insufficient:** orchestrator halts here — no downstream agents run.

### 2. Classifier Agent
**File:** `agents/classifierAgent.js`
**Input:** Intake Agent's output (sufficient case only)
**Job:** assign initial severity — low / medium / high / critical — based on symptom type and sensor thresholds (e.g. tire_pressure_psi below a set floor + vibration → medium or higher).
**Output shape:**
```json
{ "severity": "medium", "reasoning": "Low tire pressure combined with vibration/pulling symptom." }
```

### 3. Root-Cause Agent
**File:** `agents/rootCauseAgent.js`
**Input:** Intake output + `data/maintenance.json` entry for this `vehicle_id`
**Job:** propose a likely cause by cross-referencing maintenance history.
**Output shape:**
```json
{ "likely_cause": "Tire wear — last tire service was 3 months ago, consistent with reported symptom.", "confidence": "medium" }
```

### 4. Pattern-Checker Agent
**File:** `agents/patternCheckerAgent.js`
**Input:** Intake output + Classifier output + `data/incidents.json`
**Job:**
- Query `data/incidents.json` for this `vehicle_id` (and/or matching `issue_type`) within a recent window (e.g. last 30 days).
- If 2+ matching prior incidents found, revise severity **up one level** from the Classifier's output and explain why.
- After processing, **append this incident to `data/incidents.json`** so future checks see it.
**Output shape (pattern found):**
```json
{
  "pattern_found": true,
  "prior_occurrences": 2,
  "revised_severity": "high",
  "reasoning": "3rd occurrence of similar tire issue on TRK-012 in the last 30 days — escalating from medium to high."
}
```
**Output shape (no pattern):**
```json
{ "pattern_found": false, "prior_occurrences": 0, "revised_severity": null, "reasoning": "No prior similar incidents found for this vehicle." }
```
This is the only agent that **writes** to persistent data — it's both the feedback-loop agent (can revise the Classifier's result) and the persistent-state agent (memory across incidents).

### 5. Compliance & Escalation Agent
**File:** `agents/complianceAgent.js`
**Input:** final severity (Pattern-Checker's revised value if present, else Classifier's), symptom type
**Job:**
- Look up `issue_type` in `data/compliance-rules.json` to determine reportability.
- Compile the final brief: severity, root cause, pattern context, compliance status, and a recommended next action.
- Never outputs a final closing action — only a recommendation requiring human confirmation.
**Output shape:**
```json
{
  "compliance_status": "Not DOT-reportable at current severity",
  "final_brief": {
    "vehicle_id": "TRK-042",
    "severity": "medium",
    "likely_cause": "Tire wear — last service 3 months ago",
    "pattern_context": "No prior similar incidents",
    "compliance_status": "Not DOT-reportable at current severity",
    "recommended_action": "Inspect within 24h. Human confirmation required."
  }
}
```

## Orchestrator

**File:** `orchestrator.js`

Runs the five agents in sequence, calling an `onStep(stepName, data)` callback after each one completes so the route layer can stream progress. Halts immediately if Intake reports insufficient data.

```js
async function runTriage(rawReport, onStep) {
  const intake = await intakeAgent(rawReport);
  onStep('intake', intake);
  if (!intake.sufficient) {
    onStep('halted', { reason: intake.missing });
    return;
  }

  const classification = await classifierAgent(intake);
  onStep('classifier', classification);

  const rootCause = await rootCauseAgent(intake);
  onStep('rootCause', rootCause);

  const pattern = await patternCheckerAgent(intake, classification);
  onStep('pattern', pattern);

  const finalSeverity = pattern.pattern_found ? pattern.revised_severity : classification.severity;
  const compliance = await complianceAgent(intake, rootCause, pattern, finalSeverity);
  onStep('compliance', compliance);

  onStep('final', compliance.final_brief);
}

module.exports = { runTriage };
```

## Routes

### `POST /api/triage`
**File:** `routes/triage.js`
**Purpose:** accepts one incident report, streams agent progress via SSE, ends with the final brief.

**Request body:** an incident report JSON object (see sample shapes above).

**Response:** `Content-Type: text/event-stream`. Each SSE message corresponds to one orchestrator step:
```
event: intake
data: {"sufficient":true,"vehicle_id":"TRK-042",...}

event: classifier
data: {"severity":"medium","reasoning":"..."}

event: rootCause
data: {"likely_cause":"...","confidence":"medium"}

event: pattern
data: {"pattern_found":false,...}

event: compliance
data: {"compliance_status":"...","final_brief":{...}}

event: done
data: {}
```
If halted early:
```
event: intake
data: {"sufficient":false,"missing":"..."}

event: halted
data: {"reason":"..."}

event: done
data: {}
```

**Implementation sketch:**
```js
router.post('/api/triage', async (req, res) => {
  res.set('Content-Type', 'text/event-stream');
  res.set('Cache-Control', 'no-cache');
  res.set('Connection', 'keep-alive');

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    await runTriage(req.body, send);
  } catch (err) {
    send('error', { message: err.message });
  } finally {
    send('done', {});
    res.end();
  }
});
```

### `GET /api/sample-incidents`
**Purpose:** returns a small set of pre-built sample incident reports (happy path, insufficient-data, pattern-catch) so the demo doesn't require typing input live.
**Response:**
```json
[
  { "label": "Happy path", "report": { ...TRK-042 example... } },
  { "label": "Insufficient data", "report": { ...TRK-007 example... } },
  { "label": "Pattern catch", "report": { ...TRK-012 example... } }
]
```

### `GET /health`
**Purpose:** basic check that the server is up. Returns `{ "status": "ok" }`. Build this first to confirm your environment works before writing any agent logic.

## `lib/callLLM.js` — shared LLM wrapper

Every agent (except the rule-based lookup portion of Compliance) calls this with its own system prompt.

```js
async function callLLM(systemPrompt, userInput) {
  // wraps whichever AI API is available; returns parsed structured output
  // each agent is responsible for prompting for JSON output and parsing it
}

module.exports = { callLLM };
```

## Build Order (do not skip ahead)

1. `npm init`, install `express` + `cors`, get `/health` responding.
2. Write the three JSON data files with sample entries, including the TRK-012 pattern-catch pre-load.
3. Write `callLLM.js`, test it standalone with a console log — confirm you're getting usable responses before touching agent code.
4. Build and test each agent **individually** via a throwaway test script (`node testAgent.js`), in this order: Intake → Classifier → Root-Cause → Pattern-Checker → Compliance.
5. Wire them into `orchestrator.js`, test the full chain by calling `runTriage()` directly and `console.log`-ing each step — confirm end-to-end logic works before adding any HTTP/SSE layer.
6. Add the Express routes (`/api/triage`, `/api/sample-incidents`, `/health`) last, wrapping the already-working orchestrator.
7. Test the SSE stream with `curl -N http://localhost:PORT/api/triage -X POST -d '...'` before connecting the frontend, to isolate frontend bugs from backend bugs.
