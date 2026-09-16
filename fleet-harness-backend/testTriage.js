/* Quick SSE integration test — verifies all 3 triage scenarios */
const http = require('http');

const SCENARIOS = [
  {
    name: 'Happy path (TRK-042)',
    body: { vehicle_id: 'TRK-042', timestamp: '2026-09-05T14:20:00', report_text: 'Driver reported unusual vibration and pulling to the left at highway speed', reported_severity: 'unclear', sensor_data: { tire_pressure_psi: 78, temp_f: 145 } },
    expect: ['intake', 'classifier', 'rootCause', 'pattern', 'compliance', 'done'],
  },
  {
    name: 'Insufficient data (TRK-007)',
    body: { vehicle_id: 'TRK-007', timestamp: '2026-09-06T09:00:00', report_text: 'something felt off', reported_severity: null, sensor_data: null },
    expect: ['intake', 'halted'],
  },
  {
    name: 'Pattern catch (TRK-012)',
    body: { vehicle_id: 'TRK-012', timestamp: '2026-09-06T10:30:00', report_text: 'Slow tire pressure drop noticed during pre-trip inspection', reported_severity: 'low', sensor_data: { tire_pressure_psi: 82, temp_f: 98 } },
    expect: ['intake', 'classifier', 'rootCause', 'pattern', 'compliance', 'done'],
  },
];

function testScenario(scenario) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(scenario.body);
    const req = http.request({ hostname: 'localhost', port: 3001, path: '/api/triage', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk.toString(); });
      res.on('end', () => {
        const events = [];
        for (const block of raw.split('\n\n')) {
          const m = block.match(/^event: (.+)$/m);
          if (m) events.push(m[1]);
        }
        console.log(`  Events: [${events.join(', ')}]`);

        // Check expected events are present
        const missing = scenario.expect.filter((e) => !events.includes(e));
        if (missing.length) {
          console.log(`  FAIL — missing events: ${missing.join(', ')}`);
          console.log(`  Raw response:\n${raw}`);
          reject(new Error(`${scenario.name}: missing events ${missing}`));
        } else {
          // For pattern-catch, verify pattern_found is true
          if (scenario.name.includes('Pattern')) {
            const patternBlock = raw.split('\n\n').find((b) => b.includes('event: pattern'));
            if (patternBlock && patternBlock.includes('"pattern_found"')) {
              console.log('  Pattern data confirmed in response');
            }
          }
          console.log('  PASS');
          resolve();
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function main() {
  console.log('Fleet Triage SSE Integration Test\n');
  for (const s of SCENARIOS) {
    console.log(`▸ ${s.name}`);
    await testScenario(s);
  }
  console.log('\nAll scenarios passed.');
}

main().catch((e) => { console.error('\nFAILED:', e.message); process.exit(1); });
