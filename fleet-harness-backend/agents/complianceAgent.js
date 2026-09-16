const path = require('path');
const fs = require('fs');
const { callLLM } = require('../lib/callLLM');

const RULES_PATH = path.join(__dirname, '..', 'data', 'compliance-rules.json');

const SYSTEM_PROMPT = `You are the Compliance & Escalation Agent for a fleet incident triage system.

Your job:
1. Check the incident's issue_type against regulatory reporting rules.
2. Compile a final brief summarising the entire triage: severity, root cause, pattern context, compliance status, and a recommended next action.
3. NEVER close the case or take final action — only recommend. Always include "Human confirmation required."

You receive:
- intake: vehicle_id, symptom_summary, issue_type, sensor_data
- rootCause: likely_cause, confidence
- pattern: pattern_found, prior_occurrences, revised_severity, reasoning
- finalSeverity: the effective severity after pattern adjustment
- complianceRule: the rule text from the compliance-rules lookup (may be null)

You MUST respond with a single JSON object — no markdown, no explanation outside the JSON.
{
  "compliance_status": "<DOT reportable | Not DOT-reportable | conditional text>",
  "final_brief": {
    "vehicle_id": "<id>",
    "severity": "<final severity>",
    "likely_cause": "<from root cause>",
    "pattern_context": "<from pattern checker>",
    "compliance_status": "<same as above>",
    "recommended_action": "<specific next step>. Human confirmation required."
  }
}`;

function loadRules() {
  try {
    return JSON.parse(fs.readFileSync(RULES_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function getComplianceRule(issueType, patternCount) {
  const rules = loadRules();
  const rule = rules[issueType] || null;

  if (!rule) return 'No specific reporting rule on file for this issue type.';

  // Handle conditional rules like "not reportable unless recurring 3+ times"
  if (rule.includes('unless recurring') && patternCount >= 3) {
    return 'DOT reportable — recurring threshold met.';
  }

  return rule;
}

function mockCompliance(intake, rootCause, pattern, finalSeverity) {
  const totalOccurrences = pattern.pattern_found ? pattern.prior_occurrences + 1 : 1;
  const complianceRule = getComplianceRule(intake.issue_type, totalOccurrences);
  const isDOT = complianceRule.toLowerCase().includes('dot reportable');

  // Determine recommended action based on severity
  let action;
  switch (finalSeverity) {
    case 'critical':
      action = 'Remove from service immediately. Mandatory inspection before re-deployment. Human confirmation required.';
      break;
    case 'high':
      action = 'Schedule same-day inspection. Restrict to low-speed routes until cleared. Human confirmation required.';
      break;
    case 'medium':
      action = 'Inspect within 24h. Human confirmation required.';
      break;
    default:
      action = 'Schedule routine inspection at next available window. Human confirmation required.';
  }

  if (isDOT) {
    action = `File DOT report within required window. ${action}`;
  }

  return {
    compliance_status: complianceRule,
    final_brief: {
      vehicle_id: intake.vehicle_id,
      severity: finalSeverity,
      likely_cause: rootCause.likely_cause,
      pattern_context: pattern.pattern_found
        ? `${pattern.prior_occurrences} prior similar incidents found — ${pattern.reasoning}`
        : 'No prior similar incidents.',
      compliance_status: complianceRule,
      recommended_action: action,
    },
  };
}

async function complianceAgent(intake, rootCause, pattern, finalSeverity) {
  const totalOccurrences = pattern.pattern_found ? pattern.prior_occurrences + 1 : 1;
  const complianceRule = getComplianceRule(intake.issue_type, totalOccurrences);

  const input = { intake, rootCause, pattern, finalSeverity, complianceRule };
  const result = await callLLM(SYSTEM_PROMPT, input, {
    mock: () => mockCompliance(intake, rootCause, pattern, finalSeverity),
  });

  return result;
}

module.exports = { complianceAgent };
