/* Throwaway: force LIVE mode to test the real TokenRouter API, bypassing mocks */
delete process.env.LLM_API_KEY_DUMMY;
process.env.LLM_API_KEY = process.env.LLM_API_KEY || require('fs').readFileSync('.env', 'utf-8').split('\n').find(l => l.startsWith('LLM_API_KEY=')).slice(11).trim();

const { callLLM } = require('./lib/callLLM');

async function main() {
  console.log('--- FORCED LIVE TEST against', process.env.LLM_BASE_URL, 'model:', process.env.LLM_MODEL);
  const t0 = Date.now();
  const out = await callLLM(
    'You are a test assistant. Respond with ONLY this JSON object: {"ok": true, "vehicle": "<vehicle_id from input>"}',
    { vehicle_id: 'TRK-042', report_text: 'unusual vibration and pulling to the left at highway speed' },
    { mock: { ok: false, note: 'THIS IS THE MOCK — IF YOU SEE THIS, THE LIVE CALL FAILED' }, timeoutMs: 30000 }
  );
  console.log(`LIVE RESULT (${Date.now() - t0}ms):`, JSON.stringify(out, null, 2));
  if (out.ok === false) throw new Error('Live call fell back to mock — API is failing');
  console.log('LIVE API WORKS');
}

main().catch((e) => { console.error('LIVE TEST FAILED:', e.message); process.exit(1); });
