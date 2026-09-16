const path = require('path');
const fs = require('fs');
const { callLLM } = require('../lib/callLLM');

const MAINTENANCE_PATH = path.join(__dirname, '..', 'data', 'maintenance.json');

const SYSTEM_PROMPT = `You are the Root-Cause Agent for a fleet incident triage system.

Your job: cross-reference the vehicle's maintenance history with the current symptom to propose a likely root cause.

You receive two inputs:
1. The structured intake (vehicle_id, symptom_summary, sensor_data, issue_type)
2. The vehicle's maintenance record (last_service date, past_issues list) — may be null if no record exists.

Guidelines:
- If the symptom relates to a component that was recently serviced, note it could be a re-occurrence or incomplete repair.
- If time since last service is long (> 60 days), note potential wear-related cause.
- If no maintenance record exists, state that and lower confidence.
- Confidence: "high" if maintenance history directly explains the symptom, "medium" if plausible, "low" if speculative.

You MUST respond with a single JSON object — no markdown, no explanation outside the JSON.
{"likely_cause": "<one-sentence root cause hypothesis>", "confidence": "<low|medium|high>"}`;

function getMaintenanceRecord(vehicleId) {
  try {
    const records = JSON.parse(fs.readFileSync(MAINTENANCE_PATH, 'utf-8'));
    return records.find((r) => r.vehicle_id === vehicleId) || null;
  } catch {
    return null;
  }
}

function daysSince(dateStr) {
  if (!dateStr) return Infinity;
  const diff = Date.now() - new Date(dateStr).getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

function mockRootCause(intake) {
  const maintenance = getMaintenanceRecord(intake.vehicle_id);
  const symptom = (intake.symptom_summary || '').toLowerCase();
  const issueType = (intake.issue_type || '').toLowerCase();

  if (!maintenance) {
    return {
      likely_cause: `No maintenance record found for ${intake.vehicle_id}. Unable to cross-reference — possible untracked wear.`,
      confidence: 'low',
    };
  }

  const daysSinceService = daysSince(maintenance.last_service);
  const pastIssuesStr = (maintenance.past_issues || []).join(' ').toLowerCase();

  // Check if past issues relate to current symptom
  const tireRelated = issueType.includes('tire') || issueType.includes('pressure') || symptom.includes('tire');
  const brakeRelated = issueType.includes('brake') || symptom.includes('brake') || symptom.includes('odour');
  const hasPastTire = pastIssuesStr.includes('tire');
  const hasPastBrake = pastIssuesStr.includes('brake');

  if (tireRelated && hasPastTire) {
    return {
      likely_cause: `Tire wear — last tire service was ${daysSinceService} days ago, with prior tire issues noted. Consistent with reported symptom.`,
      confidence: daysSinceService > 60 ? 'high' : 'medium',
    };
  }

  if (brakeRelated && hasPastBrake) {
    return {
      likely_cause: `Brake system wear — prior brake work was ${daysSinceService} days ago. Current symptom may indicate component degradation since last service.`,
      confidence: daysSinceService > 60 ? 'high' : 'medium',
    };
  }

  if (daysSinceService > 90) {
    return {
      likely_cause: `Extended time since last service (${daysSinceService} days). General wear is a plausible contributing factor.`,
      confidence: 'medium',
    };
  }

  return {
    likely_cause: `No direct link to maintenance history. Symptom may be caused by road conditions, load factors, or an emerging fault.`,
    confidence: 'low',
  };
}

async function rootCauseAgent(intake) {
  const maintenance = getMaintenanceRecord(intake.vehicle_id);
  const input = { intake, maintenance };
  const result = await callLLM(SYSTEM_PROMPT, input, { mock: () => mockRootCause(intake) });
  return result;
}

module.exports = { rootCauseAgent };
