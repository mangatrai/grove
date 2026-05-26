// Grove — PT-1 View B: Strategy Dashboard (Modern)
const { useState } = React;
const { T, fmt, fmtD, fmtM, fmtPct,
        PROPERTIES, FRISCO_COMPS, SUBJECT,
        SUB_PPSQFT, COMP_MED_PPSQFT, OVERASSESS, OVER_PCT, EST_SAVINGS, LLM
      } = window.PT1_MOCK;
const { PT1Shell, PropertySwitcher, MarketValueTable, UnequaTable,
        LLMStrategyPanel, ProtestTracker, ExportBtn
      } = window;

// Dark hero header with property + all key numbers
function HeroHeader({ property }) {
  const yoyPct = property.taxHistory[0].pct;
  return (
    <div style={{ background:T.sidebarBg, padding:'18px 26px 16px', display:'flex', gap:24, alignItems:'flex-start', flexShrink:0 }}>
      <div style={{ flex:1 }}>
        <div style={{ color:'rgba(168,196,178,0.55)', fontSize:11.5, marginBottom:5, letterSpacing:'0.01em' }}>
          {property.propertyType} · {property.county}
        </div>
        <div style={{ color:'#f0e9d8', fontSize:22, fontWeight:800, fontFamily:"'Inter Tight','Inter',sans-serif", letterSpacing:'-0.025em', marginBottom:6 }}>
          {property.address}, {property.city} {property.state}
        </div>
        <div style={{ display:'flex', gap:12, alignItems:'center' }}>
          {[
            `${fmt(property.sqft)} sqft`,
            `${property.beds}bd/${property.baths}ba`,
            `Built ${property.yearBuilt}`,
            `APN ${property.apn}`,
          ].map((t, i) => (
            <React.Fragment key={t}>
              {i > 0 && <span style={{ color:'rgba(168,196,178,0.25)', fontSize:11 }}>·</span>}
              <span style={{ color:'rgba(168,196,178,0.65)', fontSize:12 }}>{t}</span>
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* KPI cluster */}
      <div style={{ display:'flex', gap:2 }}>
        {[
          { label:'CAD Assessed', value:fmtD(property.cadAssessed), sub:`↑${yoyPct}% YoY`, accent:'rgba(200,134,10,0.85)' },
          { label:'Market Value (AVM)', value:fmtD(property.avm), sub:`${fmtM(property.avmLow)}–${fmtM(property.avmHigh)}`, accent:'rgba(240,233,216,0.8)' },
          { label:'Gap',          value:`+${OVER_PCT.toFixed(1)}%`,  sub:`$${fmt(OVERASSESS)} over`, accent:'rgba(200,134,10,0.85)' },
        ].map((kpi, i) => (
          <div key={kpi.label} style={{ padding:'10px 16px', textAlign:'right', borderRight: i < 2 ? '1px solid rgba(255,255,255,0.07)' : 'none' }}>
            <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'rgba(168,196,178,0.45)', marginBottom:4 }}>{kpi.label}</div>
            <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:17, fontWeight:700, color:kpi.accent, letterSpacing:'-0.01em' }}>{kpi.value}</div>
            <div style={{ fontSize:10.5, color:'rgba(168,196,178,0.5)', marginTop:2 }}>{kpi.sub}</div>
          </div>
        ))}
      </div>

      {/* Hearing badge */}
      {property.hearingDate && (
        <div style={{ padding:'10px 16px', borderRadius:9, background:'rgba(200,134,10,0.14)', border:'1px solid rgba(200,134,10,0.28)', textAlign:'center', flexShrink:0 }}>
          <div style={{ fontSize:9.5, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', color:'rgba(200,134,10,0.65)', marginBottom:3 }}>ARB Hearing</div>
          <div style={{ fontSize:20, fontWeight:800, color:T.gold2, fontFamily:"'Inter Tight',sans-serif", letterSpacing:'-0.02em', lineHeight:1 }}>Jun 8</div>
          <div style={{ fontSize:13, fontWeight:700, color:T.gold, marginTop:4 }}>{property.hearingDaysLeft} days</div>
        </div>
      )}
    </div>
  );
}

// Tabbed evidence section
function EvidenceTabs({ comps, subject }) {
  const [tab, setTab] = useState('unequal');
  const tabs = [
    { id:'unequal', label:'Unequal Appraisal', badge:'Primary', badgeColor:T.forest },
    { id:'market',  label:'Market Value',       badge:'Secondary', badgeColor:T.stone },
  ];
  return (
    <div>
      <div style={{ display:'flex', gap:2, marginBottom:12, padding:'3px', background:T.surfaceAlt, borderRadius:8, border:`1px solid ${T.border}`, width:'fit-content' }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ display:'flex', alignItems:'center', gap:6, padding:'6px 14px', borderRadius:6, border:'none', cursor:'pointer', transition:'all 0.15s',
              background: tab === t.id ? T.surface : 'transparent',
              boxShadow: tab === t.id ? '0 1px 4px rgba(28,25,23,0.08)' : 'none',
              color: tab === t.id ? T.text : T.textMuted, fontWeight: tab === t.id ? 600 : 500, fontSize:12.5 }}>
            {t.label}
            <span style={{ fontSize:10, fontWeight:700, padding:'1px 5px', borderRadius:3, background: tab === t.id ? (t.id==='unequal'?T.accentSubtle:T.surfaceAlt) : 'transparent', color: tab === t.id ? t.badgeColor : T.textMuted }}>{t.badge}</span>
          </button>
        ))}
      </div>
      {tab === 'unequal'
        ? <UnequaTable comps={comps} subject={subject} />
        : <MarketValueTable comps={comps} subject={subject} />
      }
    </div>
  );
}

// Signal card matching View A's 4-KPI grid layout
function SignalCardB({ property }) {
  const overage  = property.cadAssessed - property.avm;
  const overPct  = ((property.cadAssessed / property.avm) - 1) * 100;
  const savings  = Math.round(overage * property.taxRate);
  const yoyPct   = property.taxHistory[0].pct;
  const recommend = property.cadAssessed > property.avm;
  return (
    <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:10, overflow:'hidden', marginBottom:12, boxShadow:'0 1px 4px rgba(28,25,23,0.05)' }}>
      <div style={{ padding:'11px 16px', borderBottom:`1px solid ${T.border}`, display:'flex', alignItems:'center', gap:10 }}>
        <span style={{ width:10, height:10, borderRadius:'50%', background:recommend?T.forest:T.terracotta, flexShrink:0, boxShadow:recommend?'0 0 0 4px rgba(45,106,79,0.14)':'0 0 0 4px rgba(139,58,38,0.14)', display:'inline-block' }} />
        <span style={{ fontSize:15, fontWeight:700, color:recommend?T.forest:T.terracotta, fontFamily:"'Inter Tight','Inter',sans-serif", letterSpacing:'-0.01em' }}>
          {recommend ? 'Protest Recommended' : 'No Clear Protest Benefit'}
        </span>
        <span style={{ marginLeft:'auto', fontSize:11, color:T.textMuted }}>2026 Appraisal Year · {property.county}</span>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:0 }}>
        {[
          { label:'CAD Assessed',       value:fmtD(property.cadAssessed), sub:`↑${yoyPct}% vs 2025`,   subColor:T.terracotta },
          { label:'Market Value (AVM)', value:fmtD(property.avm),         sub:`${fmtM(property.avmLow)}–${fmtM(property.avmHigh)}`, subColor:T.textMuted },
          { label:'Overassessment',     value:fmtD(overage),              sub:`+${overPct.toFixed(1)}% above AVM`, subColor:T.terracotta },
          { label:'Est. Annual Savings',value:fmtD(savings),              sub:`if settled at AVM · ${(property.taxRate*100).toFixed(2)}% rate`, subColor:T.forest },
        ].map((kpi, i) => (
          <div key={kpi.label} style={{ padding:'14px 16px', borderRight:i<3?`1px solid ${T.border}`:'none' }}>
            <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:T.textMuted, marginBottom:4 }}>{kpi.label}</div>
            <div style={{ fontFamily:"'JetBrains Mono','Fira Code',monospace", fontSize:17, fontWeight:600, color:T.text, letterSpacing:'-0.01em', marginBottom:3 }}>{kpi.value}</div>
            <div style={{ fontSize:11, color:kpi.subColor }}>{kpi.sub}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ViewB() {
  const [sel, setSel] = useState('frisco');
  const prop = PROPERTIES.find(p => p.id === sel);

  return (
    <PT1Shell page="Tax Protest">
      <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
        {/* Dark hero */}
        <HeroHeader property={prop} />

        {/* Property switcher bar */}
        <div style={{ padding:'8px 26px', background:T.surfaceAlt, borderBottom:`1px solid ${T.border}`, display:'flex', alignItems:'center', gap:10, flexShrink:0 }}>
          <PropertySwitcher selected={sel} onSelect={setSel} />
          <div style={{ marginLeft:'auto' }}>
            <ExportBtn compact />
          </div>
        </div>

        {/* Two-column body */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 330px', gap:16, padding:'16px 26px', flex:1, overflow:'auto', alignItems:'start' }}>

          {/* Left: signal + evidence */}
          <div>
            <SignalCardB property={prop} />
            <div style={{ fontSize:10.5, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:T.textMuted, marginBottom:10 }}>Evidence</div>
            <EvidenceTabs comps={FRISCO_COMPS} subject={prop} />
          </div>

          {/* Right: strategy + tracker + export */}
          <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
            <LLMStrategyPanel />
            <ProtestTracker property={prop} />
            <ExportBtn />
          </div>
        </div>
      </div>
    </PT1Shell>
  );
}

Object.assign(window, { ViewB });
