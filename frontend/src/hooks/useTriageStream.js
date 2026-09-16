import { useRef } from 'react';

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function useTriageStream() {
  const controller = useRef(null);

  const runDemo = async (incident, handlers) => {
    const steps = [
      ['intake', 'Intake & sufficiency', 'Report has the required vehicle, route, and telemetry context.'],
      ['classifier', 'Classifier', incident.classification],
      ['rootCause', 'Root-cause', incident.cause],
      ['pattern', 'Pattern-checker', incident.pattern],
      ['compliance', 'Compliance & escalation', incident.compliance],
    ];
    for (const [key, label, output] of steps) {
      handlers.active(key);
      await pause(620);
      if (incident.id === 'insufficient' && key === 'intake') {
        handlers.halted({ key, label, output: 'Missing odometer reading and post-incident inspection. Request these records before further triage.' });
        return;
      }
      handlers.complete({ key, label, output });
      await pause(210);
    }
    handlers.done(incident.brief);
  };

  const run = async (incident, handlers) => {
    controller.current?.abort();
    controller.current = new AbortController();
    try {
      // The backend expects an incident *report* ({ vehicle_id, timestamp,
      // report_text, reported_severity, sensor_data }), not the frontend
      // display object. Scenarios carry it as `incident.reportPayload`
      // (`report` is the human-readable display string).
      const response = await fetch('/api/triage', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(incident.reportPayload ?? incident), signal: controller.current.signal,
      });
      if (!response.ok || !response.body) throw new Error('No triage service available');
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split('\n\n'); buffer = chunks.pop();
        chunks.forEach((chunk) => {
          const event = chunk.match(/^event: (.+)$/m)?.[1];
          const data = chunk.match(/^data: (.+)$/m)?.[1];
          if (!event || !data) return;
          const parsed = JSON.parse(data);
          if (event === 'done') handlers.done(parsed);
          else if (event === 'progress') handlers.progress(parsed);
          else if (event === 'halted') handlers.halted(parsed);
          else if (event === 'error') handlers.error(parsed);
          else handlers.complete({ key: event, ...parsed });
        });
      }
    } catch (error) {
      if (error.name === 'AbortError') return;
      console.warn('[triage] backend unavailable, using local demo:', error.message);
      await runDemo(incident, handlers);
    }
  };
  return { run, cancel: () => controller.current?.abort() };
}
