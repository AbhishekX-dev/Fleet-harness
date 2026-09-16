/* Throwaway: verify callLLM standalone — mock mode (no key set) + JSON parsing */
const { callLLM } = require('./lib/callLLM');

async function main() {
  const out = await callLLM(
    'You are a test assistant. Always respond with a single JSON object: {"ok": true, "echo": <the vehicle_id from input>}',
    { vehicle_id: 'TRK-042', report_text: 'test' },
    { mock: (input) => ({ ok: true, echo: input.vehicle_id }) }
  );
  console.log('MOCK MODE RESULT:', JSON.stringify(out, null, 2));
  if (out.ok !== true || out.echo !== 'TRK-042') throw new Error('mock fallback returned wrong shape');
  console.log('PASS');
}

main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
