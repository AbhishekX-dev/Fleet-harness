const express = require('express');
const router = express.Router();
const { runTriage } = require('../orchestrator');

// ── Agent step labels (for display in the frontend pipeline view) ──
const STEP_LABELS = {
  intake: 'Intake & sufficiency',
  classifier: 'Classifier',
  rootCause: 'Root-cause',
  pattern: 'Pattern-checker',
  compliance: 'Compliance & escalation',
};

// ── Process descriptions for each agent ──
const AGENT_DESCRIPTIONS = {
  intake: 'Parses driver report text and validates whether required vehicle telemetry context is present.',
  classifier: 'Assesses symptom severity and evaluates safety threshold parameters.',
  rootCause: 'Correlates reported symptoms with component telemetry and maintenance history to diagnose root cause.',
  pattern: 'Cross-references historical fleet incident records to identify recurring component issues.',
  compliance: 'Applies DOT regulatory rules and synthesizes an actionable escalation brief.',
};

// ── Human-readable output summaries for SSE ──
function stepOutput(stepName, data) {
  switch (stepName) {
    case 'intake':
      if (!data.sufficient) return data.missing;
      return `[Result]: Report verified for vehicle ${data.vehicle_id}. Telemetry & symptom summary extracted.`;
    case 'classifier':
      return `[Result]: Classified as ${data.severity.toUpperCase()} severity. ${data.reasoning}`;
    case 'rootCause':
      return `[Result]: ${data.likely_cause} (Confidence: ${data.confidence}).`;
    case 'pattern':
      return data.pattern_found
        ? `[Result]: Pattern detected — ${data.reasoning}`
        : `[Result]: No recurring pattern found — ${data.reasoning}`;
    case 'compliance':
      return `[Result]: ${data.compliance_status}. ${data.final_brief.recommended_action}`;
    default:
      return '';
  }
}

// ── POST /api/triage — SSE streaming endpoint ──
router.post('/triage', async (req, res) => {
  // SSE headers
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', // disable nginx buffering if proxied
  });
  res.flushHeaders();

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    await runTriage(req.body, (stepName, data) => {
      if (stepName === 'progress') {
        send('progress', data);
      } else if (stepName === 'halted') {
        send('halted', {
          key: 'intake',
          label: STEP_LABELS.intake,
          description: AGENT_DESCRIPTIONS.intake,
          output: data.reason,
        });
      } else if (stepName === 'final') {
        const brief = data;
        send('done', {
          severity: capitalise(brief.severity),
          cause: brief.likely_cause,
          recommendation: brief.recommended_action,
          pattern: brief.pattern_context,
          compliance: brief.compliance_status,
        });
      } else {
        send(stepName, {
          key: stepName,
          label: STEP_LABELS[stepName] || stepName,
          description: AGENT_DESCRIPTIONS[stepName] || '',
          output: stepOutput(stepName, data),
        });
      }
    });
  } catch (err) {
    console.error('[triage] error:', err);
    send('error', { message: err.message });
  } finally {
    res.end();
  }
});

// ── GET /api/sample-incidents ──
const SAMPLE_INCIDENTS = [
  {
    label: 'Happy path',
    report: {
      vehicle_id: 'TRK-042',
      timestamp: '2026-09-05T14:20:00',
      report_text: 'Driver reported unusual vibration and pulling to the left at highway speed',
      reported_severity: 'unclear',
      sensor_data: { tire_pressure_psi: 78, temp_f: 145 },
    },
  },
  {
    label: 'Insufficient data',
    report: {
      vehicle_id: 'TRK-007',
      timestamp: '2026-09-06T09:00:00',
      report_text: 'something felt off',
      reported_severity: null,
      sensor_data: null,
    },
  },
  {
    label: 'Pattern catch',
    report: {
      vehicle_id: 'TRK-012',
      timestamp: '2026-09-06T10:30:00',
      report_text: 'Slow tire pressure drop noticed during pre-trip inspection',
      reported_severity: 'low',
      sensor_data: { tire_pressure_psi: 82, temp_f: 98 },
    },
  },
];

router.get('/sample-incidents', (req, res) => {
  res.json(SAMPLE_INCIDENTS);
});

// ── helpers ──
function capitalise(s) {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

module.exports = router;
