const { intakeAgent } = require('./agents/intakeAgent');
const { classifierAgent } = require('./agents/classifierAgent');
const { rootCauseAgent } = require('./agents/rootCauseAgent');
const { patternCheckerAgent } = require('./agents/patternCheckerAgent');
const { complianceAgent } = require('./agents/complianceAgent');

/**
 * Runs the five-agent triage pipeline in sequence.
 *
 * @param {object} rawReport - the incident report JSON
 * @param {(stepName: string, data: object) => void} onStep - callback fired after each agent
 */
async function runTriage(rawReport, onStep) {
  // --- 1. Intake & Sufficiency ---
  onStep('progress', { key: 'intake', status: 'Fetching vehicle telemetry & validating report details...' });
  const intake = await intakeAgent(rawReport);
  onStep('intake', intake);

  if (!intake.sufficient) {
    onStep('halted', { reason: intake.missing });
    return;
  }

  // --- 2. Classifier ---
  onStep('progress', { key: 'classifier', status: 'Analyzing symptom severity and sensor safety thresholds...' });
  const classification = await classifierAgent(intake);
  onStep('classifier', classification);

  // --- 3. Root-Cause ---
  onStep('progress', { key: 'rootCause', status: 'Correlating symptoms with component diagnostics & maintenance history...' });
  const rootCause = await rootCauseAgent(intake);
  onStep('rootCause', rootCause);

  // --- 4. Pattern-Checker ---
  onStep('progress', { key: 'pattern', status: 'Checking historical fleet logs for recurring patterns...' });
  const pattern = await patternCheckerAgent(intake, classification);
  onStep('pattern', pattern);

  // --- 5. Compliance & Escalation ---
  onStep('progress', { key: 'compliance', status: 'Evaluating DOT compliance regulations & constructing final action brief...' });
  const finalSeverity = pattern.pattern_found
    ? pattern.revised_severity
    : classification.severity;
  const compliance = await complianceAgent(intake, rootCause, pattern, finalSeverity);
  onStep('compliance', compliance);

  // --- Final brief ---
  onStep('final', compliance.final_brief);
}

module.exports = { runTriage };
