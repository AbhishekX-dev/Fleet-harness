const { callLLM } = require('../lib/callLLM');

const SYSTEM_PROMPT = `You are the Intake & Sufficiency Agent for a fleet incident triage system.

Your job:
1. Parse the raw incident report into structured fields: vehicle_id, symptom_summary, timestamp, sensor_data.
2. Decide if there is enough information to proceed with triage.

Sufficiency rules:
- INSUFFICIENT if the report_text contains no identifiable symptom keyword (vibration, pull, pressure, brake, tire, blowout, odour, warning, fault, leak, noise, overheat, smoke, ABS, sensor, temperature, wobble, drift) AND sensor_data is null or empty.
- SUFFICIENT otherwise.

You MUST respond with a single JSON object — no markdown, no explanation outside the JSON.

If sufficient:
{"sufficient": true, "vehicle_id": "<id>", "symptom_summary": "<concise summary of the symptom>", "timestamp": "<from input>", "sensor_data": <sensor object or null>, "issue_type": "<snake_case category: e.g. slow_tire_pressure_drop, brake_failure, tire_blowout_highway, minor_vibration, abs_fault, unknown>", "missing": null}

If insufficient:
{"sufficient": false, "vehicle_id": "<id>", "symptom_summary": null, "timestamp": "<from input>", "sensor_data": null, "issue_type": null, "missing": "<specific explanation of what data is needed>"}`;

const SYMPTOM_KEYWORDS = [
  'vibration', 'pull', 'pressure', 'brake', 'tire', 'blowout', 'odour', 'odor',
  'warning', 'fault', 'leak', 'noise', 'overheat', 'smoke', 'abs', 'sensor',
  'temperature', 'wobble', 'drift', 'grinding', 'squeal', 'flat', 'deflat',
];

function mockIntake(raw) {
  const text = (raw.report_text || '').toLowerCase();
  const hasSensors = raw.sensor_data && Object.keys(raw.sensor_data).length > 0;
  const hasSymptom = SYMPTOM_KEYWORDS.some((kw) => text.includes(kw));

  if (!hasSymptom && !hasSensors) {
    return {
      sufficient: false,
      vehicle_id: raw.vehicle_id || 'unknown',
      symptom_summary: null,
      timestamp: raw.timestamp || null,
      sensor_data: null,
      issue_type: null,
      missing: 'Need sensor readings or a clearer symptom description to assess this report.',
    };
  }

  // Derive a rough issue_type from keywords
  let issue_type = 'unknown';
  if (text.includes('pressure') || text.includes('tire') || text.includes('deflat') || text.includes('flat')) {
    issue_type = 'slow_tire_pressure_drop';
  } else if (text.includes('brake') || text.includes('grinding') || text.includes('odour') || text.includes('odor')) {
    issue_type = 'brake_failure';
  } else if (text.includes('blowout')) {
    issue_type = 'tire_blowout_highway';
  } else if (text.includes('vibration') || text.includes('wobble')) {
    issue_type = 'minor_vibration';
  } else if (text.includes('abs') || text.includes('warning')) {
    issue_type = 'abs_fault';
  }

  // Build a symptom summary
  const symptom_summary = raw.report_text
    ? raw.report_text.replace(/^driver\s+(reports?|noted?s?)\s+/i, '').slice(0, 120)
    : 'Sensor anomaly detected';

  return {
    sufficient: true,
    vehicle_id: raw.vehicle_id || 'unknown',
    symptom_summary,
    timestamp: raw.timestamp || null,
    sensor_data: raw.sensor_data || null,
    issue_type,
    missing: null,
  };
}

async function intakeAgent(rawReport) {
  const result = await callLLM(SYSTEM_PROMPT, rawReport, { mock: mockIntake });
  // Normalise: ensure vehicle_id is always present from input
  result.vehicle_id = result.vehicle_id || rawReport.vehicle_id || 'unknown';
  return result;
}

module.exports = { intakeAgent };
