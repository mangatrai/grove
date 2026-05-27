// Grove — PT-1 View C: Analyst Workbench (Dense)
const { useState } = React;
const { T, fmt, fmtD, fmtM,
        PROPERTIES, FRISCO_COMPS, SUBJECT,
        SUB_PPSQFT, COMP_MED_PPSQFT, OVERASSESS, OVER_PCT, EST_SAVINGS,
        UNQ_GAP_PPSQFT, UNQ_GAP_PCT, LLM
      } = window.PT1_MOCK;
const { PT1Shell, PropertySwitcher, ProtestTracker, ExportBtn } = window;

// Compact inline KPI strip
function KPIStrip({ property }) {
  const yoy = property.taxHistory[0].pct;
  const items = [
    { label:'CAD 2026', value:fmtD(property.cadAssessed), color:T.terracotta, flag:`↑${yoy}%` },
    { label:'AVM',      value:fmtD(property.avm),         color:T.text },
    { label:'Gap',      value:`+${OVER_PCT.toFixed(1)}%`, color:T.terracotta },
    { label:'Savings',  value:fmtD(EST_SAVINGS)+'/yr',    color:T.forest },
    { label:'Unequal',  value:`+${UNQ_GAP_PCT.toFixed(1)}%`, color:T.terracotta, flag:`$${UNQ_GAP_PPSQFT}/sqft` },
  ];
  return (
    <div style={{ display:'flex', gap:0, background:T.surface, border:`1px solid ${T.border}`, borderRadius:8, overflow:'hidden' }}>
      {items.map((item, i) => (
        <div key={item.label} style={{ padding:'8px 14px', borderRight:i<items.length-1?`1px solid ${T.border}`:'none', minWidth:100 }}>
          <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:T.textMuted, marginBottom:2 }}>{item.label}</div>
          <div style={{ display:'flex', alignItems:'baseline', gap:5 }}>
            <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:14, fontWeight:700, color:item.color }}>{item.value}</span>
            {item.flag && <span style={{ fontSize:10.5, fontWeight:600, color:item.color, opacity:0.7 }}>{item.flag}</span>}
          </div>
        </div>
      ))}
      {property.hearingDate && (
        <div style={{ padding:'8px 14px', marginLeft:'auto', background:'rgba(200,134,10,0.08)', borderLeft:`1px solid rgba(200,134,10,0.2)` }}>
          <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:T.gold, marginBottom:2 }}>Hearing</div>
          <div style={{ display:'flex', alignItems:'baseline', gap:5 }}>
            <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:14, fontWeight:700, color:T.gold }}>{property.hearingDate.replace('June ','Jun ')}</span>
            <span style={{ fontSize:10.5, fontWeight:700, color:T.gold }}>{property.hearingDaysLeft}d</span>
          </div>
        </div>
      )}
    </div>
  );
}

// Color-coded rate cell helper
function RateCell({ rate, subjectRate }) {
  const ratio = rate / subjectRate;
  const color = ratio >= 0.98 ? T.terracotta
              : ratio >= 0.90 ? T.clay
              : ratio >= 0.82 ? T.gold
              : T.forest;
  return (
    <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:12.5, fontWeight:700, color }}>
      ${rate}
    </span>
  );
}

// Dense market value table
function DenseMarketTable({ comps, subject }) {
  return (
    <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
      <thead>
        <tr style={{ background:T.surfaceAlt, borderBottom:`1px solid ${T.border}` }}>
          {['Address','Sqft','Bd/Ba','Yr','Sold','Price','$/sqft','M'].map(h => (
            <th key={h} style={{ padding:'5px 9px', textAlign:h==='Address'||h==='M'?'left':'right', fontSize:10, fontWeight:700, color:T.textMuted, letterSpacing:'0.05em', whiteSpace:'nowrap' }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {comps.map(c => (
          <tr key={c.key} style={{ borderBottom:`1px solid rgba(221,214,206,0.5)` }}>
            <td style={{ padding:'5px 9px', fontSize:12, color:T.text, fontWeight:500 }}>{c.address}</td>
            <td style={{ padding:'5px 9px', textAlign:'right', fontFamily:"'JetBrains Mono',monospace", fontSize:11.5, color:T.textSecondary }}>{fmt(c.sqft)}</td>
            <td style={{ padding:'5px 9px', textAlign:'right', fontFamily:"'JetBrains Mono',monospace", fontSize:11.5, color:T.textSecondary }}>{c.beds}/{c.baths}</td>
            <td style={{ padding:'5px 9px', textAlign:'right', fontFamily:"'JetBrains Mono',monospace", fontSize:11.5, color:T.textSecondary }}>{c.built}</td>
            <td style={{ padding:'5px 9px', textAlign:'right', fontSize:11.5, color:T.textMuted, whiteSpace:'nowrap' }}>{c.soldDate}</td>
            <td style={{ padding:'5px 9px', textAlign:'right', fontFamily:"'JetBrains Mono',monospace", fontSize:12, fontWeight:600, color:T.text }}>{fmtD(c.soldPrice)}</td>
            <td style={{ padding:'5px 9px', textAlign:'right', fontFamily:"'JetBrains Mono',monospace", fontSize:12, color:T.textSecondary }}>${c.ppsqft}</td>
            <td style={{ padding:'5px 9px' }}><span style={{ fontSize:10, fontWeight:700, padding:'1px 4px', borderRadius:3, background:c.match==='High'?T.accentSubtle:T.goldSubtle, color:c.match==='High'?T.forest:T.gold }}>{c.match[0]}</span></td>
          </tr>
        ))}
        <tr style={{ background:T.terracottaSubtle, borderTop:`2px solid rgba(139,58,38,0.18)` }}>
          <td style={{ padding:'6px 9px', fontWeight:700, fontSize:12 }}>{subject.address} <span style={{ fontWeight:400, color:T.textMuted }}>— subject</span></td>
          <td style={{ padding:'6px 9px', textAlign:'right', fontFamily:"'JetBrains Mono',monospace", fontSize:12, fontWeight:700 }}>{fmt(subject.sqft)}</td>
          <td style={{ padding:'6px 9px', textAlign:'right', fontFamily:"'JetBrains Mono',monospace", fontSize:12, fontWeight:700 }}>{subject.beds}/{subject.baths}</td>
          <td style={{ padding:'6px 9px', textAlign:'right', fontFamily:"'JetBrains Mono',monospace", fontSize:12, fontWeight:700 }}>{subject.yearBuilt}</td>
          <td style={{ padding:'6px 9px', textAlign:'right', fontSize:11.5, color:T.textMuted }}>—</td>
          <td style={{ padding:'6px 9px', textAlign:'right', fontFamily:"'JetBrains Mono',monospace", fontSize:13, fontWeight:700, color:T.terracotta }}>{fmtD(subject.cadAssessed)}</td>
          <td style={{ padding:'6px 9px', textAlign:'right', fontFamily:"'JetBrains Mono',monospace", fontSize:13, fontWeight:700, color:T.terracotta }}>${SUB_PPSQFT}</td>
          <td />
        </tr>
      </tbody>
    </table>
  );
}

// Dense unequal table with color-coded rates + sparkbar
function DenseUnequaTable({ comps, subject }) {
  const maxRate = SUB_PPSQFT;
  return (
    <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
      <thead>
        <tr style={{ background:T.surfaceAlt, borderBottom:`1px solid ${T.border}` }}>
          {['Address','Sqft','CAD Assessed','$/sqft CAD','vs Subject','Rate Bar'].map(h => (
            <th key={h} style={{ padding:'5px 9px', textAlign:h==='Address'||h==='Rate Bar'?'left':'right', fontSize:10, fontWeight:700, color:T.textMuted, letterSpacing:'0.05em', whiteSpace:'nowrap' }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {comps.map(c => {
          const delta = c.cadPpsqft - SUB_PPSQFT;
          const barPct = (c.cadPpsqft / maxRate) * 100;
          return (
            <tr key={c.key} style={{ borderBottom:`1px solid rgba(221,214,206,0.5)` }}>
              <td style={{ padding:'5px 9px', fontSize:12, color:T.text, fontWeight:500 }}>{c.address}</td>
              <td style={{ padding:'5px 9px', textAlign:'right', fontFamily:"'JetBrains Mono',monospace", fontSize:11.5, color:T.textSecondary }}>{fmt(c.sqft)}</td>
              <td style={{ padding:'5px 9px', textAlign:'right', fontFamily:"'JetBrains Mono',monospace", fontSize:11.5 }}>{fmtD(c.cadAssessed)}</td>
              <td style={{ padding:'5px 9px', textAlign:'right' }}><RateCell rate={c.cadPpsqft} subjectRate={SUB_PPSQFT} /></td>
              <td style={{ padding:'5px 9px', textAlign:'right', fontFamily:"'JetBrains Mono',monospace", fontSize:12, fontWeight:700, color:T.forest }}>−${Math.abs(delta)}</td>
              <td style={{ padding:'5px 9px', minWidth:120 }}>
                <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                  <div style={{ flex:1, height:6, borderRadius:3, background:T.border, overflow:'hidden' }}>
                    <div style={{ height:'100%', width:`${barPct}%`, background:T.forest, borderRadius:3, transition:'width 0.3s' }} />
                  </div>
                  <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:T.textMuted, minWidth:30 }}>{barPct.toFixed(0)}%</span>
                </div>
              </td>
            </tr>
          );
        })}
        <tr style={{ background:T.terracottaSubtle, borderTop:`2px solid rgba(139,58,38,0.18)` }}>
          <td style={{ padding:'6px 9px', fontWeight:700, fontSize:12 }}>{subject.address} <span style={{ fontWeight:400, color:T.textMuted }}>— subject</span></td>
          <td style={{ padding:'6px 9px', textAlign:'right', fontFamily:"'JetBrains Mono',monospace", fontSize:12, fontWeight:700 }}>{fmt(subject.sqft)}</td>
          <td style={{ padding:'6px 9px', textAlign:'right', fontFamily:"'JetBrains Mono',monospace", fontSize:13, fontWeight:700, color:T.terracotta }}>{fmtD(subject.cadAssessed)}</td>
          <td style={{ padding:'6px 9px', textAlign:'right', fontFamily:"'JetBrains Mono',monospace", fontSize:14, fontWeight:700, color:T.terracotta }}>${SUB_PPSQFT}</td>
          <td style={{ padding:'6px 9px', textAlign:'right', fontSize:11, color:T.textMuted }}>baseline</td>
          <td style={{ padding:'6px 9px', minWidth:120 }}>
            <div style={{ display:'flex', alignItems:'center', gap:5 }}>
              <div style={{ flex:1, height:6, borderRadius:3, background:T.border, overflow:'hidden' }}>
                <div style={{ height:'100%', width:'100%', background:T.terracotta, borderRadius:3 }} />
              </div>
              <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:T.terracotta, fontWeight:700, minWidth:30 }}>100%</span>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  );
}

// Compact strategy overview (2 cards side by side)
function StrategyOverview() {
  const [exp, setExp] = useState(null);
  return (
    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
      {LLM.strategies.map((s, i) => (
        <div key={i} style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:9, overflow:'hidden' }}>
          <div style={{ padding:'9px 12px', borderBottom:`1px solid ${T.border}`, background:T.surfaceAlt, display:'flex', alignItems:'center', gap:8 }}>
            <span style={{ fontSize:12, fontWeight:700, color:T.text }}>{s.label}</span>
            <span style={{ fontSize:10.5, color:T.textMuted, flex:1 }}>{s.tag}</span>
            <div style={{ display:'flex', alignItems:'center', gap:4 }}>
              <div style={{ height:4, width:32, borderRadius:2, background:T.border, overflow:'hidden' }}>
                <div style={{ height:'100%', width:`${(s.strength/10)*100}%`, background:i===0?T.forest:T.forest2 }} />
              </div>
              <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:12, fontWeight:700, color:T.text }}>{s.strength}</span>
            </div>
          </div>
          <div style={{ padding:'9px 12px', fontSize:12, color:T.textSecondary, lineHeight:1.55 }}>{s.text}</div>
          <button onClick={() => setExp(exp===i?null:i)}
            style={{ width:'100%', padding:'5px 12px', background:'none', border:'none', borderTop:`1px solid ${T.border}`, textAlign:'left', cursor:'pointer', fontSize:11.5, color:T.forest, fontWeight:600, display:'flex', alignItems:'center', gap:4 }}>
            <span style={{ fontSize:9 }}>{exp===i?'▾':'▸'}</span>
            {exp===i ? 'Hide draft' : 'View draft argument'}
          </button>
          {exp===i && (
            <div style={{ padding:'9px 12px', fontSize:11.5, color:T.textSecondary, lineHeight:1.65, background:'rgba(45,106,79,0.03)', borderTop:`1px solid ${T.border}`, fontStyle:'italic' }}>
              "{s.draft}"
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// Jump navigation
function JumpNav({ sections, active }) {
  return (
    <div style={{ display:'flex', gap:4 }}>
      {sections.map(s => (
        <a key={s.id} href={`#${s.id}`} style={{ fontSize:11.5, fontWeight:active===s.id?700:500, color:active===s.id?T.text:T.textMuted, textDecoration:'none', padding:'4px 10px', borderRadius:5, background:active===s.id?T.surface:'transparent', border:`1px solid ${active===s.id?T.border:'transparent'}`, whiteSpace:'nowrap' }}>
          {s.label}
        </a>
      ))}
    </div>
  );
}

function SectionBlock({ id, label, sub, children }) {
  return (
    <div id={id} style={{ marginBottom:18 }}>
      <div style={{ display:'flex', alignItems:'baseline', gap:8, marginBottom:8 }}>
        <span style={{ fontSize:10.5, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:T.textMuted }}>{label}</span>
        {sub && <span style={{ fontSize:11, color:T.textMuted }}>{sub}</span>}
      </div>
      <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:9, overflow:'hidden' }}>
        {children}
      </div>
    </div>
  );
}

function ViewC() {
  const [sel, setSel] = useState('frisco');
  const prop = PROPERTIES.find(p => p.id === sel);
  const nav = [
    {id:'signal',   label:'Signal'},
    {id:'market',   label:'Market Value'},
    {id:'unequal',  label:'Unequal Appraisal'},
    {id:'strategy', label:'Strategy'},
    {id:'tracker',  label:'Tracker'},
  ];

  return (
    <PT1Shell page="Tax Protest">
      <div style={{ padding:'14px 22px' }}>

        {/* Compact header */}
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:8 }}>
          <div>
            <div style={{ fontSize:11, color:T.textMuted, marginBottom:1 }}>Property &amp; Tax › Tax Protest</div>
            <div style={{ fontFamily:"'Inter Tight',sans-serif", fontSize:16, fontWeight:800, color:T.text, letterSpacing:'-0.02em' }}>{prop.address}, {prop.city} {prop.state}</div>
          </div>
          <div style={{ marginLeft:'auto', display:'flex', gap:8, alignItems:'center' }}>
            <PropertySwitcher selected={sel} onSelect={setSel} />
          </div>
        </div>

        {/* KPI strip */}
        <KPIStrip property={prop} />
        <div style={{ marginBottom:14 }} />

        {/* Jump nav */}
        <div style={{ marginBottom:14, display:'flex', alignItems:'center', gap:10 }}>
          <JumpNav sections={nav} />
          <div style={{ marginLeft:'auto' }}>
            <ExportBtn compact />
          </div>
        </div>

        {/* Signal */}
        <div id="signal" style={{ marginBottom:14, padding:'10px 14px', borderRadius:9, background:T.terracottaSubtle, border:`1px solid rgba(139,58,38,0.18)`, display:'flex', alignItems:'center', gap:12 }}>
          <span style={{ width:9, height:9, borderRadius:'50%', background:T.terracotta, display:'inline-block', flexShrink:0, boxShadow:'0 0 0 4px rgba(139,58,38,0.12)' }} />
          <span style={{ fontSize:13.5, fontWeight:800, color:T.terracotta, fontFamily:"'Inter Tight',sans-serif" }}>Protest Recommended</span>
          <span style={{ fontSize:12, color:T.textSecondary }}>— CAD overassessed by <strong style={{ color:T.terracotta }}>{fmtD(OVERASSESS)}</strong> ({OVER_PCT.toFixed(1)}%) · Estimated savings <strong style={{ color:T.forest }}>{fmtD(EST_SAVINGS)}/yr</strong></span>
          <span style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:6 }}>
            <span style={{ fontSize:11, color:T.textMuted }}>Case strength</span>
            <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:14, fontWeight:700, color:T.forest }}>{LLM.caseStrength}/10</span>
          </span>
        </div>

        {/* Market value */}
        <SectionBlock id="market" label="Market Value Comps" sub="§41.41 · 6 sold comps Oct 2025–Mar 2026">
          <DenseMarketTable comps={FRISCO_COMPS} subject={prop} />
          <div style={{ padding:'6px 10px', background:T.surfaceAlt, borderTop:`1px solid ${T.border}`, fontSize:11.5, display:'flex', gap:16, color:T.textSecondary }}>
            <span>Median sold <strong style={{ color:T.text }}>{fmtD(986500)}</strong></span>
            <span>Range <strong style={{ color:T.text }}>$942k–$1.055M</strong></span>
            <span style={{ marginLeft:'auto', color:T.terracotta, fontWeight:600 }}>CAD 11.8% above median</span>
          </div>
        </SectionBlock>

        {/* Unequal appraisal */}
        <SectionBlock id="unequal" label="Unequal Appraisal · Rate Comparison" sub="§41.43 · DCAD 2026 roll data · Primary strategy">
          <DenseUnequaTable comps={FRISCO_COMPS} subject={prop} />
          <div style={{ padding:'6px 10px', background:T.surfaceAlt, borderTop:`1px solid ${T.border}`, fontSize:11.5, display:'flex', gap:16, color:T.textSecondary }}>
            <span>Subject <strong style={{ color:T.terracotta }}>${SUB_PPSQFT}/sqft</strong></span>
            <span>Median comp <strong style={{ color:T.forest }}>${COMP_MED_PPSQFT}/sqft</strong></span>
            <span style={{ marginLeft:'auto', color:T.terracotta, fontWeight:700 }}>+${UNQ_GAP_PPSQFT}/sqft gap · {UNQ_GAP_PCT.toFixed(1)}% above median</span>
          </div>
        </SectionBlock>

        {/* Strategy */}
        <div id="strategy" style={{ marginBottom:18 }}>
          <div style={{ display:'flex', alignItems:'baseline', gap:8, marginBottom:8 }}>
            <span style={{ fontSize:10.5, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:T.textMuted }}>Strategy Overview</span>
            <span style={{ fontSize:11, color:T.textMuted }}>AI Analysis · Target {fmtD(LLM.targetValue)} · Savings {fmtD(LLM.estSavingsMid)}/yr</span>
          </div>
          <StrategyOverview />
        </div>

        {/* Tracker + Export side by side */}
        <div id="tracker" style={{ display:'grid', gridTemplateColumns:'1fr auto', gap:12, alignItems:'start' }}>
          <ProtestTracker property={prop} />
          <ExportBtn style={{ width:280 }} />
        </div>

        <div style={{ height:24 }} />
      </div>
    </PT1Shell>
  );
}

Object.assign(window, { ViewC });
