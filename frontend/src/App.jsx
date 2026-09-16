import { useMemo, useState } from 'react';
import { useTriageStream } from './hooks/useTriageStream';
import Home from './Home';

const INCIDENTS = [
  { id: 'happy', title: 'Happy path', tag: 'Brake temperature', vehicle: 'TRK-208', route: 'Bengaluru → Chennai', report: 'Driver reports a persistent brake odour after descent. No loss of braking power. Vehicle is currently at the Hosur stop.', reportPayload: { vehicle_id: 'TRK-042', timestamp: '2026-09-05T14:20:00', report_text: 'Driver reported unusual vibration and pulling to the left at highway speed', reported_severity: 'unclear', sensor_data: { tire_pressure_psi: 78, temp_f: 145 } }, sensors: [['Brake disc', '412°C', '↑ 18%'], ['Speed', '64 km/h', 'nominal'], ['Load', '12.4 t', 'nominal']], classification: 'Thermal brake event · medium confidence', cause: 'Likely dragging caliper on rear axle. Temperature delta is isolated to the right-rear wheel.', pattern: 'No matching fleet pattern found in the last 30 days.', compliance: 'Not reportable. Hold vehicle after current safe stop.', brief: { severity: 'Medium', cause: 'Possible right-rear caliper drag', recommendation: 'Inspect within 24h. Human confirmation required.', pattern: 'No fleet-wide pattern', compliance: 'Not reportable' } },
  { id: 'insufficient', title: 'Insufficient data', tag: 'Missing context', vehicle: 'VAN-114', route: 'Pune local delivery', report: 'Driver notes an intermittent warning lamp. A photo of the dashboard was not supplied and the event time is approximate.', reportPayload: { vehicle_id: 'TRK-007', timestamp: '2026-09-06T09:00:00', report_text: 'something felt off', reported_severity: null, sensor_data: null }, sensors: [['Odometer', '—', 'missing'], ['DTC code', '—', 'missing'], ['Last service', '16 days', 'known']], classification: '', cause: '', pattern: '', compliance: '', brief: null },
  { id: 'pattern', title: 'Pattern catch', tag: 'Repeat fault', vehicle: 'TRK-041', route: 'Mumbai → Nashik', report: 'ABS warning occurred twice after heavy rain. The warning cleared after a restart, but reappeared on the return route.', reportPayload: { vehicle_id: 'TRK-012', timestamp: '2026-09-06T10:30:00', report_text: 'Slow tire pressure drop noticed during pre-trip inspection', reported_severity: 'low', sensor_data: { tire_pressure_psi: 82, temp_f: 98 } }, sensors: [['ABS events', '2', '↑ repeat'], ['Wheel speed', 'erratic', 'front-left'], ['Rain', 'heavy', 'context']], classification: 'Electrical / wheel-speed signal · high confidence', cause: 'Intermittent front-left wheel-speed sensor connection; moisture intrusion is likely.', pattern: 'Pattern found: 3 similar events on the same vehicle family after monsoon exposure.', compliance: 'Escalate to maintenance lead. Safety system fault requires same-day inspection.', brief: { severity: 'High', cause: 'Moisture-related ABS sensor fault', recommendation: 'Remove from service for same-day inspection.', pattern: '3 similar fleet events detected', compliance: 'Escalate to maintenance lead' } },
];
const PIPELINE = [['intake', 'Intake & sufficiency'], ['classifier', 'Classifier'], ['rootCause', 'Root-cause'], ['pattern', 'Pattern-checker'], ['compliance', 'Compliance & escalation']];

function TruckIcon() { return <svg className="truck" viewBox="0 0 160 72" aria-label="Fleet truck"><path d="M8 15h88v35H8zM96 29h27l18 18v3H96zM23 58a9 9 0 1 0 0 .1M113 58a9 9 0 1 0 0 .1M47 26h36M102 36h12" /></svg>; }
function ClipboardIcon() { return <svg className="clipboard" viewBox="0 0 120 120"><path d="M34 18h52v84H34zM47 18v-8h26v8M46 46h28M46 62h28M46 78h16" /></svg>; }
function Gauge({ severity }) { const rotations = { Low: -45, Medium: 0, High: 43, Critical: 75 }; return <svg className="gauge" viewBox="0 0 180 108"><path d="M22 91a68 68 0 0 1 136 0M30 91h120M43 48l10 8M90 26v13M137 48l-10 8"/><line className="needle" x1="90" y1="90" x2="90" y2="43" style={{ transform: `rotate(${rotations[severity] ?? 0}deg)`, transformOrigin: '90px 90px' }}/><circle cx="90" cy="90" r="5" /></svg>; }

export function Triage() {
  const [selected, setSelected] = useState(null); const [status, setStatus] = useState('idle');
  const [steps, setSteps] = useState({}); const [brief, setBrief] = useState(null); const [open, setOpen] = useState(null);
  const { run } = useTriageStream(); const incident = useMemo(() => INCIDENTS.find((item) => item.id === selected), [selected]);
  const select = (id) => { setSelected(id); setStatus('idle'); setSteps({}); setBrief(null); setOpen(null); };
  const start = () => {
    if (!incident) return;
    setStatus('running'); setSteps({}); setBrief(null);
    run(incident, {
      active: (key) => setSteps((s) => ({ ...s, [key]: { state: 'active', progressText: 'Executing agent logic...' } })),
      progress: ({ key, status: progressText }) => { setSteps((s) => ({ ...s, [key]: { ...s[key], state: 'active', progressText } })); setOpen(key); },
      complete: ({ key, label, description, output }) => { setSteps((s) => ({ ...s, [key]: { state: 'done', label, description, output } })); setOpen(key); },
      halted: ({ key, label, description, output }) => { setSteps((s) => ({ ...s, [key]: { state: 'halted', label, description, output } })); setStatus('halted'); setOpen(key); },
      done: (data) => { setBrief(data); setStatus('done'); },
      error: () => setStatus('error')
    });
  };
  return <main className="shell">
    <header><div><p className="kicker">Operational decision support</p><h1>Fleet incident<br/>triage</h1></div><TruckIcon /></header>
    <section className="input-zone"><div className="section-heading"><span>01</span><h2>Incident input</h2><p>Choose a live training scenario.</p></div>
      <div className="selector">{INCIDENTS.map((item, i) => <button key={item.id} className={selected === item.id ? 'selected' : ''} onClick={() => select(item.id)}><b>0{i + 1}</b><span>{item.title}<small>{item.tag}</small></span><i>↗</i></button>)}</div>
      <div className={`preview ${incident ? '' : 'empty-preview'}`}>{incident ? <><div className="preview-title"><span>Incident report</span><b>{incident.vehicle}</b></div><p>{incident.report}</p><div className="route">{incident.route}</div><div className="sensors">{incident.sensors.map(([label, value, state]) => <div key={label}><small>{label}</small><strong>{value}</strong><em>{state}</em></div>)}</div></> : <><ClipboardIcon/><p>Select a scenario to load its field report and telemetry.</p></>}</div>
      <button className="run" disabled={!incident || status === 'running'} onClick={start}>{status === 'running' ? 'Triage in progress…' : 'Run triage'} <span>→</span></button>
    </section>
    <section className="pipeline-zone"><div className="section-heading"><span>02</span><h2>Live pipeline</h2><p>{status === 'idle' ? 'Waiting for an incident.' : status === 'halted' ? 'Pipeline paused for missing evidence.' : 'Agent findings arrive in sequence.'}</p></div>
      <div className="pipeline">{status === 'idle' && <div className="idle"><ClipboardIcon/><span>Select an incident to begin</span><small>Each result will arrive here as the triage runs.</small></div>}{PIPELINE.map(([key, label], index) => {
        const step = steps[key];
        const state = step?.state || 'pending';
        return status !== 'idle' && <article key={key} className={`step ${state} ${open === key ? 'open' : ''}`}>
          <button onClick={() => step && setOpen(open === key ? null : key)}>
            <span className="marker">{state === 'done' ? '✓' : state === 'halted' ? '!' : state === 'active' ? '●' : ''}</span>
            <b>0{index + 1}</b>
            <strong>{label}</strong>
            <i>{state === 'active' ? 'analysing' : state === 'done' ? 'complete' : state === 'halted' ? 'halted' : 'pending'}</i>
            <em>+</em>
          </button>
          {open === key && (
            <div className="agent-output">
              {state === 'active' && step?.progressText && (
                <div className="progress-log">
                  <span className="spinner">⏳</span> <em>{step.progressText}</em>
                </div>
              )}
              {step?.description && <p className="agent-desc"><strong>Role & Objective:</strong> {step.description}</p>}
              {step?.output && (
                <div className="result-box">
                  <strong>Outcome / Result:</strong>
                  <p>{step.output}</p>
                </div>
              )}
            </div>
          )}
        </article>;
      })}</div>
    </section>
    <section className={`final-zone ${brief ? 'ready' : ''}`}><div className="section-heading"><span>03</span><h2>Final brief</h2><p>{brief ? 'A decision-ready readout.' : 'The brief appears when the pipeline resolves.'}</p></div>{brief ? <div className="brief"><div className="gauge-wrap"><Gauge severity={brief.severity}/><strong>{brief.severity}</strong><small>severity</small></div><div className="brief-copy"><div><span>Likely cause</span><b>{brief.cause}</b></div><div><span>Pattern</span><b>{brief.pattern}</b></div><div><span>Compliance</span><b>{brief.compliance}</b></div><p><i>→</i>{brief.recommendation}</p></div></div> : <div className="awaiting">Awaiting completed triage <span>↘</span></div>}</section>
    <footer>Fleet Harness <span>•</span> Demo environment <span>•</span> Human review always required</footer>
  </main>;
}

export default function App(){const [page,setPage]=useState(()=>window.location.hash==='#triage'?'triage':'home');const enter=()=>{window.location.hash='triage';setPage('triage');window.scrollTo(0,0)};const back=()=>{window.location.hash='';setPage('home');window.scrollTo(0,0)};if(page==='home')return <Home onEnter={enter}/>;return <><div className="triage-top"><button onClick={back}>Back to overview</button><b>Fleet Harness / Multi-agent console</b></div><Triage/></>}
