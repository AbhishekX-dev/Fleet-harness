# Fleet Incident Triage Harness

## Overview

The Fleet Incident Triage Harness is a multi-agent system that reviews vehicle fleet incident reports and decides how serious each one is, what likely caused it, whether it's part of a recurring pattern, and whether it needs to be formally reported — before handing everything to a human for the final decision.

Instead of a person manually reading a raw incident report, digging through maintenance history, and remembering whether this vehicle has had similar issues before, the harness does that work consistently, every time, and shows its reasoning at each step. No agent ever makes the final call alone — the system only recommends and packages evidence; a human always decides.

## Domain

**Operations & Compliance** (Michelin x AI Tinkerers "Harness Engineering" hackathon)

## What We Are Treating

We are treating **vehicle-level incident reports within a fleet used for logistics/transport operations** — mechanical problems, safety events, and maintenance-related issues reported on individual vehicles (a tire problem, a brake issue, an unusual sensor reading, a driver-reported fault).

We are **not** treating broader logistics operation failures — missed delivery windows, route inefficiencies, warehouse delays, or supply chain flow disruptions. Those are a different category of operations problem.

Monitoring here is **not real-time telemetry** — it's periodic/batch: driver-filed incident reports, Driver Vehicle Inspection Report (DVIR)-style flags, periodic sensor snapshots (e.g. tire pressure/temperature checked once per trip or once per day), and static maintenance/service records. The harness processes each new report as it's logged, building pattern recognition over time as more reports accumulate.

## The Problem With Existing Tools

Fleet telematics platforms (e.g. Intangles, Michelin Connected Fleet) already do predictive vehicle health monitoring well — they tell you a component is likely to fail soon, based on sensor signals and diagnostic data. That part of the problem is solved and commercialized.

What none of them do is **structure the decision that happens after a signal fires**: how serious is this specific case, why did it likely happen, has it happened before on this vehicle, does it need to be formally reported, and who should look at it and when. Fleet managers are usually left to interpret a risk score or an alert dashboard themselves.

## Novelty

1. **Decision reasoning, not just prediction.** The harness takes a signal or incident report and reasons through severity, cause, recurrence, and compliance obligation — and shows that reasoning step by step, rather than outputting a single confidence score.

2. **Recurrence-aware severity.** A dedicated Pattern-Checker agent compares each new incident against a memory of past incidents for the same vehicle. A "minor" issue that has occurred 2-3 times recently gets escalated — a distinction a per-event scoring model would miss.

3. **Honest uncertainty instead of a forced confidence score.** If a report doesn't have enough information, the harness says so explicitly and states what's missing, rather than guessing to produce an answer.

4. **Compliance reasoning tied to the specific decision**, not a bolted-on separate module — the compliance flag is a direct consequence of this incident's classification and history.

5. **Architecturally enforced human authority.** No single agent is ever allowed to close a case or take final action — this is a structural constraint of the harness, not a UI suggestion or a policy note.

**One-line summary:** *Existing fleet tools are prediction engines — they tell you something might go wrong. This harness is a decision engine — it takes that signal and reasons through severity, cause, recurrence, and compliance obligation, transparently, with a built-in refusal to guess and a built-in requirement for human sign-off.*

## The End Product

A website where a user submits (or selects from sample data) a fleet incident report and watches, live, as the harness works through it step by step — each agent's output streaming into a visual pipeline view — before landing on a final structured brief: severity, likely cause, pattern context, compliance status, and a recommended next action, explicitly marked as requiring human confirmation.

Demo flow:
1. **Happy path** — a clear, well-documented incident flows through cleanly to a final brief.
2. **Insufficient data** — a vague/incomplete report is stopped early with an explicit statement of what's missing.
3. **Pattern catch** — a "minor-looking" incident on a vehicle with 2+ prior similar incidents gets escalated live, with the Pattern-Checker's reasoning shown on screen.

## The Multi-Agent Harness

Five agents, each with one clearly scoped job, running in sequence with one feedback loop:

```
Intake & Sufficiency Agent
        │
        ▼
Classifier Agent
        │
        ▼
Root-Cause Agent
        │
        ▼
Pattern-Checker Agent  ──── revises Classifier's severity if a pattern is found
        │
        ▼
Compliance & Escalation Agent
        │
        ▼
   Human reviewer
```

| Agent | Job | Checklist item it satisfies |
|---|---|---|
| **Intake & Sufficiency Agent** | Parses the raw report into structured fields (vehicle ID, symptom, timestamp, sensor readings). Checks if there's enough data to proceed; if not, halts and states exactly what's missing. | Clear role; graceful degradation |
| **Classifier Agent** | Assigns an initial severity level (low/medium/high/critical) based on symptom type and sensor thresholds. | Clear role |
| **Root-Cause Agent** | Cross-references the vehicle's maintenance history and proposes a likely cause. | Clear role |
| **Pattern-Checker Agent** | Holds memory of past incidents per vehicle. Checks for recurrence and, if found, revises the Classifier's severity with an explanation. | Feedback loop; persistent state |
| **Compliance & Escalation Agent** | Checks final severity/incident type against a reporting-rules table, flags if formal disclosure is required, and packages everything into a brief for a human — never closes the case itself. | Constraint preventing failure (no single-agent final decision) |

### How the harness is managed

- **Orchestration:** a single backend orchestrator function calls each agent in sequence, passing structured JSON output forward from one agent to the next.
- **Live visibility:** each agent's result streams to the frontend via Server-Sent Events (SSE) as it completes, so the user watches the reasoning happen step by step instead of waiting for one final answer.
- **Memory:** a simple persistent store (JSON file or SQLite table) of past incidents, keyed by vehicle ID, that the Pattern-Checker Agent reads from and writes to — this is what allows recurrence detection across incidents over time.
- **Constraints:** the Sufficiency Gate and the Human-Escalation step are hard stops built into the orchestration logic itself — no agent downstream of an insufficient-data halt runs, and no agent is permitted to output a final action; only a recommendation for a human.

## Stack

- **Frontend:** React, with a live pipeline/timeline view of agent progress and a final brief card
- **Backend:** Node.js + Express, single `/api/triage` endpoint streaming via SSE
- **Agents:** plain functions, each making one scoped call to an LLM API with its own system prompt
- **Data:** JSON files or SQLite for incident memory, maintenance history, and compliance rules — no vector DB or RAG needed for this scope
