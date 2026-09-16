const { callLLM } = require('../lib/callLLM');

const SYSTEM_PROMPT = `You are the Classifier Agent for a fleet incident triage system.

Your job: assign an initial severity level to the incident based on the symptom type and any sensor readings.

Severity levels (pick exactly one):
- "low" — minor cosmetic or comfort issue, no safety impact
- "medium" — operational concern that needs attention within 24-48h
- "high" — safety-adjacent issue, needs same-day inspection
- "critical" — immediate safety risk, vehicle must be taken out of service

Guidelines:
- tire_pressure_psi below 70 → at least "high"
- tire_pressure_psi 70-85 with vibration/pulling → "medium"
- brake-related symptoms → at least "medium"; with temperature > 400°F → "high"
- blowout at highway speed → "critical"
- ABS warning / safety system fault → at least "high"
- vague vibration with normal sensors → "low"

You MUST respond with a single JSON object — no markdown, no explanation outside the JSON.
{"severity": "<low|medium|high|critical>", "reasoning": "<one-sentence explanation>"}`;

function mockClassifier(intake) {
  const sensors = intake.sensor_data || {};
  const symptom = (intake.symptom_summary || '').toLowerCase();
  const issueType = (intake.issue_type || '').toLowerCase();

  // Blowout
  if (issueType.includes('blowout')) {
    return { severity: 'critical', reasoning: 'Tire blowout at highway speed is an immediate safety risk.' };
  }

  // ABS / safety system
  if (issueType.includes('abs') || symptom.includes('abs')) {
    return { severity: 'high', reasoning: 'ABS warning indicates a safety system fault requiring same-day inspection.' };
  }

  // Brake with high temp
  if (issueType.includes('brake')) {
    const temp = sensors.temp_f || sensors.brake_temp_f || 0;
    if (temp > 400) {
      return { severity: 'high', reasoning: `Brake-related symptom with elevated temperature (${temp}°F).` };
    }
    return { severity: 'medium', reasoning: 'Brake-related symptom — needs inspection within 24-48h.' };
  }

  // Tire pressure
  const psi = sensors.tire_pressure_psi;
  if (psi !== undefined && psi !== null) {
    if (psi < 70) {
      return { severity: 'high', reasoning: `Dangerously low tire pressure (${psi} PSI).` };
    }
    if (psi < 85 && (symptom.includes('vibration') || symptom.includes('pull'))) {
      return { severity: 'medium', reasoning: `Low tire pressure (${psi} PSI) combined with ${symptom.includes('vibration') ? 'vibration' : 'pulling'} symptom.` };
    }
  }

  // Pressure drop (by issue type)
  if (issueType.includes('pressure_drop')) {
    return { severity: 'low', reasoning: 'Slow tire pressure drop with no immediate safety impact.' };
  }

  // Default vibration
  if (symptom.includes('vibration') || issueType.includes('vibration')) {
    return { severity: 'low', reasoning: 'Minor vibration with no abnormal sensor readings.' };
  }

  return { severity: 'medium', reasoning: 'Unclassified symptom — defaulting to medium pending further analysis.' };
}

async function classifierAgent(intake) {
  const result = await callLLM(SYSTEM_PROMPT, intake, { mock: () => mockClassifier(intake) });
  return result;
}

module.exports = { classifierAgent };
