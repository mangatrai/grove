// Grove — PT-1 Shared Components
const { useState } = React;
const { T, fmt, fmtD, fmtM, fmtPct,
        PROPERTIES, FRISCO_COMPS, SUBJECT,
        SUB_PPSQFT, COMP_MED_PPSQFT, COMP_MED_SOLD, COMP_SOLD_RNG,
        OVERASSESS, OVER_PCT, UNQ_GAP_PPSQFT, UNQ_GAP_PCT, EST_SAVINGS, LLM
      } = window.PT1_MOCK;

// ── SHELL ────────────────────────────────────────────────────────────────────
function Shell({ children, page = 'Tax Protest' }) {
  const groups = [
    { label:'Daily',           items:['Home','Transactions','Payslips'] },
    { label:'Reports',         items:['Net Worth','Budget'] },
    { label:'Property & Tax',  items:['Real Estate','Tax Protest'] },
    { label:'Setup',           items:['Categories','Settings'] },
  ];
  return (
    <div style={{ display:'flex', height:'100%', background:T.pageBg, fontFamily:"'Inter',system-ui,sans-serif", fontSize:13.5, overflow:'hidden' }}>
      <div style={{ width:170, flexShrink:0, background:T.sidebarBg, display:'flex', flexDirection:'column', padding:'10px 7px', gap:12 }}>
        <div style={{ display:'flex', alignItems:'center', gap:7, padding:'3px 7px 10px', borderBottom:'1px solid rgba(255,255,255,0.07)' }}>
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none"><rect width="22" height="22" rx="6" fill="url(#g1)"/><defs><linearGradient id="g1" x1="0" y1="0" x2="22" y2="22"><stop stopColor="#c8860a"/><stop offset="1" stopColor="#2d6a4f"/></linearGradient></defs><rect x="5.5" y="8" width="3" height="8" rx="1" fill="#f0e9d8"/><rect x="9.5" y="5.5" width="3" height="10.5" rx="1" fill="#f0e9d8"/><rect x="13.5" y="9" width="3" height="7" rx="1" fill="#f0e9d8"/></svg>
          <span style={{ color:'#f0e9d8', fontWeight:700, fontSize:14.5, fontFamily:"'Inter Tight','Inter',sans-serif" }}>Grove</span>
        </div>
        {groups.map(g => (
          <div key={g.label}>
            <div style={{ fontSize:9.5, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'rgba(168,196,178,0.4)', padding:'0 9px 4px' }}>{g.label}</div>
            {g.items.map(item => {
              const active = item === page;
              return (
                <div key={item} style={{ padding:'5px 9px', borderRadius:5, fontSize:12.5, fontWeight:active?600:500, color:active?'#f0e9d8':'rgba(168,196,178,0.7)', background:active?'rgba(240,233,216,0.12)':'transparent', borderLeft:active?'2px solid #f0e9d8':'2px solid transparent', marginBottom:1, cursor:'pointer' }}>{item}</div>
              );
            })}
          </div>
        ))}
      </div>
      <div style={{ flex:1, display:'flex', flexDirection:'column', minWidth:0, overflow:'hidden' }}>
        <div style={{ background:T.sidebarBg, borderBottom:'1px solid rgba(255,255,255,0.07)', padding:'7px 16px', display:'flex', alignItems:'center', gap:8, minHeight:42, flexShrink:0 }}>
          <div style={{ flex:1 }}/>
          <span style={{ color:'rgba(168,196,178,0.45)', fontSize:11.5 }}>May 18, 2026</span>
          <span style={{ padding:'3px 10px', borderRadius:999, background:'rgba(45,106,79,0.35)', border:'1px solid rgba(240,233,216,0.2)', color:'#f0e9d8', fontSize:11.5, fontWeight:600 }}>Import</span>
          <span style={{ padding:'3px 10px', borderRadius:999, background:'rgba(255,255,255,0.08)', border:'1px solid rgba(255,255,255,0.1)', color:'#e2e8f0', fontSize:11.5 }}>Mangat + Sarah</span>
        </div>
        <div style={{ flex:1, overflow:'auto' }}>{children}</div>
      </div>
    </div>
  );
}

// ── PROPERTY SWITCHER ─────────────────────────────────────────────────────────
function PropertySwitcher({ selected, onSelect, style }) {
  const statusMap = {
    'filed':     { label:'Filed',    bg:'rgba(45,106,79,0.12)',    color:T.forest },
    'not-filed': { label:null,       bg:'transparent',             color:T.textMuted },
    'arb':       { label:'ARB',      bg:'rgba(200,134,10,0.12)',   color:T.gold },
    'resolved':  { label:'Resolved', bg:'rgba(45,106,79,0.12)',    color:T.forest },
  };
  return (
    <div style={{ display:'flex', gap:6, ...style }}>
      {PROPERTIES.map(p => {
        const active = p.id === selected;
        const sc = statusMap[p.protestStatus] || statusMap['not-filed'];
        return (
          <button key={p.id} onClick={() => onSelect && onSelect(p.id)}
            style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 12px', borderRadius:8,
              background: active ? T.surface : 'transparent',
              border:`1px solid ${active ? T.border : 'transparent'}`,
              boxShadow: active ? '0 1px 4px rgba(28,25,23,0.07)' : 'none',
              cursor:'pointer', transition:'all 0.15s' }}>
            <div>
              <div style={{ fontSize:12.5, fontWeight:active?700:500, color:active?T.text:T.textMuted, lineHeight:1.2 }}>{p.shortName}</div>
              <div style={{ fontSize:11, color:T.textMuted, marginTop:1 }}>{p.county.split(',')[0]} · {p.state}</div>
            </div>
            {sc.label && <span style={{ fontSize:10.5, fontWeight:700, padding:'2px 6px', borderRadius:4, background:sc.bg, color:sc.color, whiteSpace:'nowrap' }}>{sc.label}</span>}
          </button>
        );
      })}
    </div>
  );
}

// ── DEADLINE BANNER ───────────────────────────────────────────────────────────
function DeadlineBanner({ property }) {
  if (!property.hearingDate) return null;
  return (
    <div style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 14px', borderRadius:8, background:'rgba(200,134,10,0.09)', border:'1px solid rgba(200,134,10,0.22)' }}>
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1" y="2.5" width="12" height="10" rx="2" stroke={T.gold} strokeWidth="1.3"/><path d="M4.5 1v3M9.5 1v3M1 6h12" stroke={T.gold} strokeWidth="1.3" strokeLinecap="round"/></svg>
      <span style={{ fontSize:12.5, color:'#7a5000', fontWeight:500 }}>
        <strong>ARB Hearing</strong> · {property.hearingDate}
      </span>
      <span style={{ fontSize:13, fontWeight:800, color:T.gold, letterSpacing:'-0.01em' }}>{property.hearingDaysLeft} days</span>
      <span style={{ marginLeft:'auto', fontSize:11.5, color:'#9a6a00' }}>{property.county} · Filed {property.filedDate}</span>
    </div>
  );
}

// ── SECTION HEADER ────────────────────────────────────────────────────────────
function SectionHdr({ label, sub, accent }) {
  return (
    <div style={{ display:'flex', alignItems:'baseline', gap:8, paddingBottom:8, borderBottom:`2px solid ${accent ? T.forest : T.border}`, marginBottom:10 }}>
      <span style={{ fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color: accent ? T.forest : T.textMuted }}>{label}</span>
      {sub && <span style={{ fontSize:11, color:T.textMuted, fontWeight:400 }}>{sub}</span>}
    </div>
  );
}

// ── MARKET VALUE TABLE ────────────────────────────────────────────────────────
function MarketValueTable({ comps, subject, style }) {
  const prices = [...comps.map(c => c.soldPrice)].sort((a,b)=>a-b);
  const med = prices[Math.floor(prices.length/2)];
  const aboveMed = ((subject.cadAssessed / med) - 1) * 100;
  const TH = ({ children, right }) => (
    <th style={{ padding:'6px 10px', textAlign:right?'right':'left', fontSize:10.5, fontWeight:600, color:T.textMuted, borderBottom:`1px solid ${T.border}`, whiteSpace:'nowrap', background:T.surfaceAlt }}>{children}</th>
  );
  return (
    <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:10, overflow:'hidden', ...style }}>
      <div style={{ padding:'9px 14px 8px', borderBottom:`1px solid ${T.border}`, display:'flex', alignItems:'center', gap:8 }}>
        <span style={{ fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', color:T.textMuted, flex:1 }}>Market Value Evidence</span>
        <span style={{ fontSize:11, color:T.textMuted }}>6 comps · ≤0.5 mi · Oct 2025–Mar 2026</span>
        <span style={{ fontSize:11.5, fontWeight:600, color:T.text }}>Median sold {fmtD(med)}</span>
      </div>
      <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
        <thead><tr><TH>Address</TH><TH right>Sqft</TH><TH right>Bd/Ba</TH><TH right>Built</TH><TH right>Sold Date</TH><TH right>Sold Price</TH><TH right>$/sqft</TH><TH>Match</TH></tr></thead>
        <tbody>
          {comps.map(c => (
            <tr key={c.key} style={{ borderBottom:`1px solid ${T.border}` }}>
              <td style={{ padding:'7px 10px', fontSize:12, color:T.text, fontWeight:500, lineHeight:1.3 }}>{c.address}</td>
              <td style={{ padding:'7px 10px', textAlign:'right', fontFamily:"'JetBrains Mono',monospace", fontSize:12, color:T.textSecondary }}>{fmt(c.sqft)}</td>
              <td style={{ padding:'7px 10px', textAlign:'right', fontFamily:"'JetBrains Mono',monospace", fontSize:12, color:T.textSecondary }}>{c.beds}/{c.baths}</td>
              <td style={{ padding:'7px 10px', textAlign:'right', fontFamily:"'JetBrains Mono',monospace", fontSize:12, color:T.textSecondary }}>{c.built}</td>
              <td style={{ padding:'7px 10px', textAlign:'right', fontSize:12, color:T.textMuted }}>{c.soldDate}</td>
              <td style={{ padding:'7px 10px', textAlign:'right', fontFamily:"'JetBrains Mono',monospace", fontSize:12.5, fontWeight:600, color:T.text }}>{fmtD(c.soldPrice)}</td>
              <td style={{ padding:'7px 10px', textAlign:'right', fontFamily:"'JetBrains Mono',monospace", fontSize:12, color:T.textSecondary }}>${c.ppsqft}</td>
              <td style={{ padding:'7px 10px' }}><span style={{ fontSize:10.5, fontWeight:600, padding:'1px 6px', borderRadius:4, background:c.match==='High'?T.accentSubtle:T.goldSubtle, color:c.match==='High'?T.forest:T.gold }}>{c.match}</span></td>
            </tr>
          ))}
          <tr style={{ background:T.terracottaSubtle, borderTop:`2px solid rgba(139,58,38,0.2)` }}>
            <td style={{ padding:'8px 10px', fontWeight:700, fontSize:12, color:T.text }}>
              {subject.address}<span style={{ fontWeight:400, color:T.textMuted, fontSize:11 }}> · Subject</span>
            </td>
            <td style={{ padding:'8px 10px', textAlign:'right', fontFamily:"'JetBrains Mono',monospace", fontSize:12, fontWeight:700 }}>{fmt(subject.sqft)}</td>
            <td style={{ padding:'8px 10px', textAlign:'right', fontFamily:"'JetBrains Mono',monospace", fontSize:12, fontWeight:700 }}>{subject.beds}/{subject.baths}</td>
            <td style={{ padding:'8px 10px', textAlign:'right', fontFamily:"'JetBrains Mono',monospace", fontSize:12, fontWeight:700 }}>{subject.yearBuilt}</td>
            <td style={{ padding:'8px 10px', textAlign:'right', fontSize:11.5, color:T.textMuted }}>—</td>
            <td style={{ padding:'8px 10px', textAlign:'right', fontFamily:"'JetBrains Mono',monospace", fontSize:13, fontWeight:700, color:T.terracotta }}>{fmtD(subject.cadAssessed)}</td>
            <td style={{ padding:'8px 10px', textAlign:'right', fontFamily:"'JetBrains Mono',monospace", fontSize:13, fontWeight:700, color:T.terracotta }}>${SUB_PPSQFT}</td>
            <td style={{ padding:'8px 10px' }}><span style={{ fontSize:11, color:T.textMuted }}>Subject</span></td>
          </tr>
        </tbody>
      </table>
      <div style={{ padding:'7px 14px', borderTop:`1px solid ${T.border}`, background:T.surfaceAlt, fontSize:11.5, display:'flex', gap:16, alignItems:'center' }}>
        <span style={{ color:T.textSecondary }}>Median sold <strong style={{ color:T.text }}>{fmtD(med)}</strong></span>
        <span style={{ color:T.textSecondary }}>Range <strong style={{ color:T.text }}>{fmtM(COMP_SOLD_RNG[0])}–{fmtM(COMP_SOLD_RNG[1])}</strong></span>
        <span style={{ marginLeft:'auto', fontWeight:600, color:T.terracotta }}>CAD {aboveMed.toFixed(1)}% above median sold</span>
      </div>
    </div>
  );
}

// ── UNEQUAL APPRAISAL TABLE ───────────────────────────────────────────────────
function UnequaTable({ comps, subject, style }) {
  const [fetchState, setFetchState] = useState('done'); // idle | fetching | done
  const maxRate = SUB_PPSQFT;

  function handleFetch() {
    setFetchState('fetching');
    setTimeout(() => setFetchState('done'), 2200);
  }

  return (
    <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:10, overflow:'hidden', ...style }}>
      {/* Header */}
      <div style={{ padding:'9px 14px 8px', borderBottom:`1px solid ${T.border}`, display:'flex', alignItems:'center', gap:8 }}>
        <span style={{ fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', color:T.textMuted, flex:1 }}>Unequal Appraisal Evidence</span>
        <span style={{ fontSize:11, color:T.textMuted }}>DCAD 2026 · §41.43</span>
        <span style={{ fontSize:11.5, fontWeight:700, color:T.terracotta }}>Subject +{UNQ_GAP_PCT.toFixed(1)}% above median</span>
        {/* Fetch button */}
        {fetchState === 'idle' && (
          <button onClick={handleFetch} style={{ padding:'3px 10px', borderRadius:5, border:`1px solid ${T.border}`, background:T.surface, fontSize:11, fontWeight:600, color:T.forest, cursor:'pointer', display:'flex', alignItems:'center', gap:4, flexShrink:0 }}>
            ↻ Fetch DCAD Data
          </button>
        )}
        {fetchState === 'fetching' && (
          <span style={{ fontSize:11, color:T.gold, fontWeight:600, flexShrink:0 }}>⟳ Fetching 6 addresses…</span>
        )}
        {fetchState === 'done' && (
          <button onClick={() => setFetchState('idle')} style={{ padding:'3px 10px', borderRadius:5, border:`1px solid rgba(45,106,79,0.2)`, background:T.accentSubtle, fontSize:11, fontWeight:600, color:T.forest, cursor:'pointer', flexShrink:0 }}>
            ✓ DCAD current · May 18 — Refresh
          </button>
        )}
      </div>
      <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
        <thead>
          <tr style={{ background:T.surfaceAlt }}>
            {['Address','Sqft','CAD Assessed','$/sqft','vs Subject','% of Subject Rate'].map(h => (
              <th key={h} style={{ padding:'6px 10px', textAlign:h==='Address'||h==='% of Subject Rate'?'left':'right', fontSize:10.5, fontWeight:600, color:T.textMuted, borderBottom:`1px solid ${T.border}` }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {comps.map(c => {
            const delta = c.cadPpsqft - SUB_PPSQFT;
            const pct   = Math.round((c.cadPpsqft / maxRate) * 100);
            return (
              <tr key={c.key} style={{ borderBottom:`1px solid ${T.border}` }}>
                <td style={{ padding:'7px 10px', fontSize:12, color:T.text, fontWeight:500 }}>{c.address}</td>
                <td style={{ padding:'7px 10px', textAlign:'right', fontFamily:"'JetBrains Mono',monospace", fontSize:12, color:T.textSecondary }}>{fmt(c.sqft)}</td>
                <td style={{ padding:'7px 10px', textAlign:'right', fontFamily:"'JetBrains Mono',monospace", fontSize:12, fontWeight:500 }}>{fmtD(c.cadAssessed)}</td>
                <td style={{ padding:'7px 10px', textAlign:'right', fontFamily:"'JetBrains Mono',monospace", fontSize:12, fontWeight:600, color:T.forest }}>${c.cadPpsqft}</td>
                <td style={{ padding:'7px 10px', textAlign:'right', fontFamily:"'JetBrains Mono',monospace", fontSize:12, color:T.forest, fontWeight:700 }}>−${Math.abs(delta)}</td>
                <td style={{ padding:'7px 10px', minWidth:130 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                    <div style={{ flex:1, height:5, borderRadius:3, background:T.border, overflow:'hidden' }}>
                      <div style={{ height:'100%', width:`${pct}%`, background:T.forest, borderRadius:3 }} />
                    </div>
                    <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10.5, color:T.textMuted, minWidth:28, textAlign:'right' }}>{pct}%</span>
                  </div>
                </td>
              </tr>
            );
          })}
          <tr style={{ background:T.terracottaSubtle, borderTop:`2px solid rgba(139,58,38,0.2)` }}>
            <td style={{ padding:'8px 10px', fontWeight:700, fontSize:12, color:T.text }}>{subject.address} <span style={{ fontWeight:400, color:T.textMuted }}>· Subject</span></td>
            <td style={{ padding:'8px 10px', textAlign:'right', fontFamily:"'JetBrains Mono',monospace", fontSize:12, fontWeight:700 }}>{fmt(subject.sqft)}</td>
            <td style={{ padding:'8px 10px', textAlign:'right', fontFamily:"'JetBrains Mono',monospace", fontSize:13, fontWeight:700, color:T.terracotta }}>{fmtD(subject.cadAssessed)}</td>
            <td style={{ padding:'8px 10px', textAlign:'right', fontFamily:"'JetBrains Mono',monospace", fontSize:13, fontWeight:700, color:T.terracotta }}>${SUB_PPSQFT}</td>
            <td style={{ padding:'8px 10px', textAlign:'right', fontSize:11.5, color:T.textMuted }}>baseline</td>
            <td style={{ padding:'8px 10px', minWidth:130 }}>
              <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                <div style={{ flex:1, height:5, borderRadius:3, background:T.border, overflow:'hidden' }}>
                  <div style={{ height:'100%', width:'100%', background:T.terracotta, borderRadius:3 }} />
                </div>
                <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10.5, color:T.terracotta, fontWeight:700, minWidth:28, textAlign:'right' }}>100%</span>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <div style={{ padding:'7px 14px', borderTop:`1px solid ${T.border}`, background:T.surfaceAlt, fontSize:11.5, display:'flex', gap:16, alignItems:'center', flexWrap:'wrap' }}>
        <span style={{ color:T.textSecondary }}>Subject <strong style={{ color:T.terracotta }}>${SUB_PPSQFT}/sqft = 100%</strong></span>
        <span style={{ color:T.textSecondary }}>Median comp <strong style={{ color:T.forest }}>${COMP_MED_PPSQFT}/sqft</strong></span>
        <span style={{ fontSize:11, color:T.textMuted }}>
          <span style={{ display:'inline-block', width:8, height:8, borderRadius:2, background:T.forest, marginRight:4, verticalAlign:'middle' }}></span>Comps assessed lower than subject (supports argument) &nbsp;
          <span style={{ display:'inline-block', width:8, height:8, borderRadius:2, background:T.terracotta, marginRight:4, verticalAlign:'middle' }}></span>Subject (baseline)
        </span>
        <span style={{ marginLeft:'auto', fontWeight:700, color:T.terracotta }}>+${UNQ_GAP_PPSQFT}/sqft gap · {UNQ_GAP_PCT.toFixed(1)}% above median</span>
      </div>
    </div>
  );
}

// ── LLM STRATEGY PANEL ────────────────────────────────────────────────────────
function LLMStrategyPanel({ compact, style }) {
  const [expanded, setExpanded] = useState(null);
  return (
    <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:10, overflow:'hidden', ...style }}>
      <div style={{ padding:'9px 14px', borderBottom:`1px solid ${T.border}`, display:'flex', alignItems:'center', gap:8, background:'rgba(45,106,79,0.04)' }}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.5" stroke={T.forest} strokeWidth="1.3"/><path d="M5 5.5c0-1.1.9-2 2-2s2 .9 2 2c0 .8-.5 1.5-1.2 1.8L7.5 8" stroke={T.forest} strokeWidth="1.3" strokeLinecap="round"/><circle cx="7.5" cy="9.5" r=".75" fill={T.forest}/></svg>
        <span style={{ fontSize:12, fontWeight:700, color:T.forest, flex:1 }}>Protest Strategy · AI Analysis</span>
        <span style={{ fontSize:10.5, color:T.textMuted }}>Generated {LLM.generatedAt}</span>
      </div>
      <div style={{ padding:'12px 14px' }}>
        <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:11 }}>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:10.5, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', color:T.textMuted, marginBottom:5 }}>Case Strength</div>
            <div style={{ height:7, borderRadius:4, background:T.border, overflow:'hidden' }}>
              <div style={{ height:'100%', width:`${(LLM.caseStrength/10)*100}%`, background:`linear-gradient(90deg,${T.forest2},${T.forest})`, borderRadius:4 }} />
            </div>
          </div>
          <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:22, fontWeight:700, color:T.forest, lineHeight:1 }}>{LLM.caseStrength}<span style={{ fontSize:13, color:T.textMuted, fontWeight:400 }}>/10</span></div>
        </div>
        <div style={{ display:'flex', gap:8, marginBottom:12 }}>
          <div style={{ flex:1, padding:'9px 12px', borderRadius:8, background:T.accentSubtle, border:`1px solid rgba(45,106,79,0.15)` }}>
            <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', color:T.forest, marginBottom:3 }}>Recommended Ask</div>
            <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:18, fontWeight:700, color:T.text }}>{fmtD(LLM.targetValue)}</div>
            <div style={{ fontSize:10.5, color:T.textMuted, marginTop:2 }}>Range {fmtM(LLM.targetLow)}–{fmtM(LLM.targetHigh)}</div>
          </div>
          <div style={{ width:110, padding:'9px 12px', borderRadius:8, background:T.surfaceAlt, border:`1px solid ${T.border}`, textAlign:'right' }}>
            <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', color:T.textMuted, marginBottom:3 }}>Est. Savings</div>
            <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:18, fontWeight:700, color:T.forest }}>{fmtD(LLM.estSavingsMid)}</div>
            <div style={{ fontSize:10.5, color:T.textMuted, marginTop:2 }}>per year</div>
          </div>
        </div>
        {LLM.strategies.map((s, i) => (
          <div key={i} style={{ marginBottom:8, border:`1px solid ${T.border}`, borderRadius:8, overflow:'hidden' }}>
            <div style={{ padding:'7px 12px', display:'flex', alignItems:'center', gap:8, background:T.surfaceAlt }}>
              <span style={{ fontSize:12, fontWeight:700, color:T.text }}>{s.label}</span>
              <span style={{ fontSize:10.5, color:T.textMuted, flex:1 }}>{s.tag}</span>
              <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                <div style={{ height:4, width:36, borderRadius:2, background:T.border, overflow:'hidden' }}>
                  <div style={{ height:'100%', width:`${(s.strength/10)*100}%`, background:i===0?T.forest:T.forest2, borderRadius:2 }} />
                </div>
                <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:11.5, fontWeight:700, color:T.text }}>{s.strength}</span>
              </div>
            </div>
            <div style={{ padding:'8px 12px', fontSize:12, color:T.textSecondary, lineHeight:1.6 }}>{s.text}</div>
            <button onClick={() => setExpanded(expanded===i ? null : i)} style={{ width:'100%', padding:'5px 12px', background:'none', border:'none', borderTop:`1px solid ${T.border}`, textAlign:'left', cursor:'pointer', fontSize:11.5, color:T.forest, fontWeight:600, display:'flex', gap:5, alignItems:'center' }}>
              <span style={{ fontSize:9 }}>{expanded===i?'▾':'▸'}</span>
              {expanded===i ? 'Hide draft argument' : 'View draft argument for hearing'}
            </button>
            {expanded===i && (
              <div style={{ padding:'10px 12px', fontSize:11.5, color:T.textSecondary, lineHeight:1.65, background:'rgba(45,106,79,0.03)', borderTop:`1px solid ${T.border}`, fontStyle:'italic' }}>
                "{s.draft}"
              </div>
            )}
          </div>
        ))}
        <div style={{ marginTop:6, display:'flex', flexDirection:'column', gap:4 }}>
          {LLM.flags.map((f, i) => (
            <div key={i} style={{ display:'flex', alignItems:'flex-start', gap:6, fontSize:11.5, color:T.textSecondary }}>
              <span style={{ color:T.gold, flexShrink:0 }}>⚑</span>
              <span>{f}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── PROTEST TRACKER ───────────────────────────────────────────────────────────
function ProtestTracker({ property, style }) {
  const steps = [
    { key:'filed',    label:'Filed',         date:property.filedDate ? 'May 14' : null, done:property.protestStatus !== 'not-filed' },
    { key:'informal', label:'Informal',       date:null, done:false, pending:true },
    { key:'arb',      label:'ARB Hearing',    date:property.hearingDate ? 'Jun 8' : null, done:false, upcoming:!!property.hearingDate },
    { key:'resolved', label:'Resolved',       date:null, done:false },
  ];
  return (
    <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:10, padding:'12px 16px', ...style }}>
      <div style={{ fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', color:T.textMuted, marginBottom:14 }}>2026 Protest Status</div>
      <div style={{ display:'flex', alignItems:'center' }}>
        {steps.map((step, i) => (
          <React.Fragment key={step.key}>
            <div style={{ textAlign:'center', minWidth:80 }}>
              <div style={{ width:28, height:28, borderRadius:'50%', margin:'0 auto 5px', display:'flex', alignItems:'center', justifyContent:'center',
                background: step.done ? T.forest : step.upcoming ? 'transparent' : T.surfaceAlt,
                border: `2px solid ${step.done ? T.forest : step.upcoming ? T.gold : T.border}` }}>
                {step.done
                  ? <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2.5 6l2.5 2.5 4.5-5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/></svg>
                  : <span style={{ width:8, height:8, borderRadius:'50%', background: step.upcoming ? T.gold : T.border, display:'block' }} />
                }
              </div>
              <div style={{ fontSize:11, fontWeight: step.done||step.upcoming ? 700 : 400, color: step.done ? T.forest : step.upcoming ? T.gold : T.textMuted }}>{step.label}</div>
              {step.date && <div style={{ fontSize:10.5, color:T.textMuted, marginTop:1 }}>{step.date}</div>}
            </div>
            {i < steps.length - 1 && (
              <div style={{ flex:1, height:2, background: step.done ? T.forest : T.border, marginBottom:22 }} />
            )}
          </React.Fragment>
        ))}
      </div>
      {property.protestHistory.length > 0 && (
        <div style={{ marginTop:12, paddingTop:12, borderTop:`1px solid ${T.border}` }}>
          <div style={{ fontSize:10.5, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', color:T.textMuted, marginBottom:7 }}>Prior Protest History</div>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
            <thead><tr>
              {['Year','Grounds','Noticed','Settled','Saved'].map(h => (
                <th key={h} style={{ padding:'3px 8px', textAlign:h==='Year'||h==='Grounds'?'left':'right', fontSize:10.5, fontWeight:600, color:T.textMuted }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {property.protestHistory.map(h => (
                <tr key={h.year} style={{ borderTop:`1px solid ${T.border}` }}>
                  <td style={{ padding:'5px 8px', fontWeight:600, fontSize:12 }}>{h.year}</td>
                  <td style={{ padding:'5px 8px', fontSize:12, color:T.textSecondary }}>{h.grounds}</td>
                  <td style={{ padding:'5px 8px', textAlign:'right', fontFamily:"'JetBrains Mono',monospace", fontSize:12 }}>{fmtD(h.noticed)}</td>
                  <td style={{ padding:'5px 8px', textAlign:'right', fontFamily:"'JetBrains Mono',monospace", fontSize:12, color:T.forest, fontWeight:600 }}>{fmtD(h.settled)}</td>
                  <td style={{ padding:'5px 8px', textAlign:'right', fontFamily:"'JetBrains Mono',monospace", fontSize:12, color:T.forest, fontWeight:700 }}>{fmtD(h.taxSavings)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── EXPORT BUTTON ─────────────────────────────────────────────────────────────
function ExportBtn({ compact, style }) {
  if (compact) return (
    <button style={{ display:'flex', alignItems:'center', gap:6, padding:'5px 11px', borderRadius:7, background:T.surface, border:`1px solid ${T.border}`, cursor:'pointer', fontSize:12, fontWeight:600, color:T.text, ...style }}>
      <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><rect x="1.5" y="1" width="10" height="11" rx="1.5" stroke={T.textMuted} strokeWidth="1.1"/><path d="M4 5h5M4 7h5M4 9h3" stroke={T.textMuted} strokeWidth="1.1" strokeLinecap="round"/></svg>
      Export PDF
    </button>
  );
  return (
    <div style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 16px', borderRadius:9, border:`1px dashed ${T.border}`, background:T.surfaceAlt, cursor:'pointer', ...style }}>
      <div style={{ width:36, height:36, borderRadius:7, background:T.surface, border:`1px solid ${T.border}`, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
        <svg width="18" height="20" viewBox="0 0 18 20" fill="none"><rect x="1" y="1" width="13" height="18" rx="2" stroke={T.textMuted} strokeWidth="1.3"/><path d="M4 6h9M4 9h9M4 12h6" stroke={T.textMuted} strokeWidth="1.2" strokeLinecap="round"/><path d="M15 14v5m0 0l-2-2m2 2l2-2" stroke={T.forest} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
      </div>
      <div>
        <div style={{ fontSize:13, fontWeight:700, color:T.text }}>Export Evidence Packet</div>
        <div style={{ fontSize:11.5, color:T.textMuted, marginTop:2 }}>8-page PDF · Market value + unequal appraisal tables · ARB-ready</div>
      </div>
      <div style={{ marginLeft:'auto', padding:'6px 14px', borderRadius:6, background:T.forest, color:'#fff', fontSize:12.5, fontWeight:600, cursor:'pointer', whiteSpace:'nowrap' }}>Download PDF</div>
    </div>
  );
}

Object.assign(window, {
  PT1Shell: Shell, PropertySwitcher, DeadlineBanner, SectionHdr,
  MarketValueTable, UnequaTable, LLMStrategyPanel, ProtestTracker, ExportBtn,
});
