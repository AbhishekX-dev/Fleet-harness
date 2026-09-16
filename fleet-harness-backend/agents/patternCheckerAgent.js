const path = require('path');
const fs = require('fs');
const { callLLM } = require('../lib/callLLM');

const INCIDENTS_PATH = path.join(__dirname, '..', 'data', 'incidents.json');

const SEVERITY_ORDER = ['low', 'medium', 'high', 'critical'];

const SYSTEM_PROMPT = `You are the Pattern-Checker Agent for a fleet incident triage system.

Your job:
1. Check whether this vehicle has had similar incidents recently (within 30 days).
2. If 2 or more matching prior incidents are found, revise the severity UP by one level and explain why.
3. Never exceed "critical".

You receive:
- intake: vehicle_id, symptom_summary, issue_type
- classification: the Classifier's assigned severity
- incidents: array of past incident records for this vehicle (filtered to last 30 days, same or similar issue_type)

You MUST respond with a single JSON object — no markdown, no explanation outside the JSON.

If pattern found:
{"pattern_found": true, "prior_occurrences": <number>, "revised_severity": "<bumped level>", "reasoning": "<explanation of the pattern and why severity was escalated>"}

If no pattern:
{"pattern_found": false, "prior_occurrences": 0, "revised_severity": null, "reasoning": "No prior similar incidents found for this vehicle."}`;

function readIncidents() {
  try {
    return JSON.parse(fs.readFileSync(INCIDENTS_PATH, 'utf-8'));
  } catch {
    return [];
  }
}

function writeIncidents(incidents) {
  fs.writeFileSync(INCIDENTS_PATH, JSON.stringify(incidents, null, 2), 'utf-8');
}

function bumpSeverity(current) {
  const idx = SEVERITY_ORDER.indexOf(current);
  if (idx === -1) return 'high'; // unknown → default high
  return SEVERITY_ORDER[Math.min(idx + 1, SEVERITY_ORDER.length - 1)];
}

// Pure matcher: same vehicle, similar issue type, within 30 days. No I/O.
function findMatches(allIncidents, intake) {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  return allIncidents.filter((inc) => {
    if (inc.vehicle_id !== intake.vehicle_id) return false;
    const incDate = new Date(inc.date);
    if (Number.isNaN(incDate.getTime()) || incDate < thirtyDaysAgo) return false;
    // Match on issue_type — allow partial match for flexibility
    if (intake.issue_type && inc.issue_type) {
      return inc.issue_type === intake.issue_type ||
        inc.issue_type.includes(intake.issue_type) ||
        intake.issue_type.includes(inc.issue_type);
    }
    return false;
  });
}

function buildEntry(intake, classification, severity) {
  return {
    vehicle_id: intake.vehicle_id,
    date: intake.timestamp ? intake.timestamp.split('T')[0] : new Date().toISOString().split('T')[0],
    issue_type: intake.issue_type || 'unknown',
    severity,
  };
}

// Pure fallback: computes the verdict from a pre-counted match total.
// Persistence happens exactly once in patternCheckerAgent below — never here.
function mockPatternChecker(intake, classification, count) {
  if (count >= 2) {
    const revised = bumpSeverity(classification.severity);
    return {
      pattern_found: true,
      prior_occurrences: count,
      revised_severity: revised,
      reasoning: `${count + 1}${count + 1 === 3 ? 'rd' : 'th'} occurrence of ${intake.issue_type || 'similar issue'} on ${intake.vehicle_id} in the last 30 days — escalating from ${classification.severity} to ${revised}.`,
    };
  }

  return {
    pattern_found: false,
    prior_occurrences: count,
    revised_severity: null,
    reasoning: count === 0
      ? `No prior similar incidents found for ${intake.vehicle_id}.`
      : `Only ${count} prior occurrence found — not enough to establish a pattern.`,
  };
}

async function patternCheckerAgent(intake, classification) {
  const allIncidents = readIncidents();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const recentForVehicle = allIncidents.filter((inc) => {
    if (inc.vehicle_id !== intake.vehicle_id) return false;
    const d = new Date(inc.date);
    return !Number.isNaN(d.getTime()) && d >= thirtyDaysAgo;
  });
  const matchCount = findMatches(allIncidents, intake).length;

  const input = { intake, classification, incidents: recentForVehicle };
  const result = await callLLM(SYSTEM_PROMPT, input, {
    mock: () => mockPatternChecker(intake, classification, matchCount),
  });

  // Persist the current incident exactly once, regardless of whether the
  // verdict came from the live LLM or the mock fallback. (Previously the
  // mock wrote inside mockPatternChecker AND this block wrote again whenever
  // LLM_API_KEY was set, duplicating every incident on live-call failure.)
  const stored = readIncidents();
  stored.push(buildEntry(intake, classification, result.revised_severity || classification.severity));
  writeIncidents(stored);

  return result;
}

module.exports = { patternCheckerAgent };
