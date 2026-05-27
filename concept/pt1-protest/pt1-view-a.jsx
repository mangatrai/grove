// Grove — PT-1 View A: Evidence File (Conservative)
const { useState } = React;
const { T, fmt, fmtD, fmtM, PROPERTIES, FRISCO_COMPS, SUBJECT,
        SUB_PPSQFT, COMP_MED_PPSQFT, OVERASSESS, OVER_PCT, EST_SAVINGS, UNQ_GAP_PCT
      } = window.PT1_MOCK;
const { PT1Shell, PropertySwitcher, DeadlineBanner, SectionHdr,
        MarketValueTable, UnequaTable, LLMStrategyPanel, ProtestTracker, ExportBtn
      } = window;

function ProtestSignalA({ property }) {
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
          { label:'CAD Assessed',      value:fmtD(property.cadAssessed), sub:`↑${yoyPct}% vs 2025`,    subColor:T.terracotta },
          { label:'Redfin AVM',        value:fmtD(property.avm),         sub:`Range ${fmtM(property.avmLow)}–${fmtM(property.avmHigh)}`, subColor:T.textMuted },
          { label:'Overassessment',    value:fmtD(overage),              sub:`+${overPct.toFixed(1)}% above AVM`, subColor:T.terracotta },
          { label:'Est. Annual Savings', value:fmtD(savings),            sub:`if settled at AVM · ${(property.taxRate*100).toFixed(2)}% rate`, subColor:T.forest },
        ].map((kpi, i) => (
          <div key={kpi.label} style={{ padding:'14px 16px', borderRight:i<3?`1px solid ${T.border}`:'none' }}>
            <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:T.textMuted, marginBottom:4 }}>{kpi.label}</div>
            <div style={{ fontFamily:"'JetBrains Mono','Fira Code',monospace", fontSize:18, fontWeight:600, color:T.text, letterSpacing:'-0.01em', marginBottom:3 }}>{kpi.value}</div>
            <div style={{ fontSize:11, color:kpi.subColor }}>{kpi.sub}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AssessmentTrend({ history }) {
  if (!history || history.length < 2) return null;
  const max = Math.max(...history.map(h => h.assessed));
  return (
    <div style={{ display:'flex', alignItems:'flex-end', gap:4, height:32 }}>
      {history.slice().reverse().map(h => (
        <div key={h.year} style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:2 }}>
          <div style={{ width:18, height:Math.round((h.assessed / max) * 28), borderRadius:'2px 2px 0 0', background:T.terracotta, opacity:0.6 + (h.assessed/max)*0.4 }} />
          <div style={{ fontSize:9, color:T.textMuted }}>{String(h.year).slice(2)}</div>
        </div>
      ))}
    </div>
  );
}

function ViewA() {
  const [sel, setSel] = useState('frisco');
  const prop = PROPERTIES.find(p => p.id === sel);

  return (
    <PT1Shell page="Tax Protest">
      <div style={{ padding:'18px 22px', maxWidth:960, margin:'0 auto' }}>

        {/* Page header */}
        <div style={{ display:'flex', alignItems:'flex-start', marginBottom:12 }}>
          <div>
            <div style={{ fontSize:11, color:T.textMuted, marginBottom:3, letterSpacing:'0.01em' }}>Property &amp; Tax › Tax Protest</div>
            <h1 style={{ fontFamily:"'Inter Tight','Inter',sans-serif", fontSize:21, fontWeight:800, color:T.text, margin:0, letterSpacing:'-0.02em' }}>Property Tax Protest</h1>
          </div>
          <div style={{ marginLeft:'auto', display:'flex', gap:8, alignItems:'center' }}>
            <AssessmentTrend history={prop.taxHistory} />
            <ExportBtn compact />
          </div>
        </div>

        {/* Property switcher */}
        <PropertySwitcher selected={sel} onSelect={setSel} style={{ marginBottom:12, background:T.surfaceAlt, padding:'6px 8px', borderRadius:9, border:`1px solid ${T.border}` }} />

        {/* Deadline banner */}
        {prop.hearingDate && <DeadlineBanner property={prop} />}
        <div style={{ marginBottom:12 }} />

        {/* Signal */}
        <ProtestSignalA property={prop} />

        {/* Market value */}
        <SectionHdr label="Market Value Evidence" sub="Tex. Tax Code §41.41 · Sold comps vs. CAD assessed value" />
        <MarketValueTable comps={FRISCO_COMPS} subject={prop} style={{ marginBottom:14 }} />

        {/* Unequal appraisal */}
        <SectionHdr label="Unequal Appraisal Evidence" sub="Tex. Tax Code §41.43 · Recommended primary strategy" accent />
        <UnequaTable comps={FRISCO_COMPS} subject={prop} style={{ marginBottom:14 }} />

        {/* LLM Strategy */}
        <SectionHdr label="Protest Strategy" sub="AI-generated case analysis · Regenerate each cycle" />
        <LLMStrategyPanel style={{ marginBottom:14 }} />

        {/* Tracker */}
        <SectionHdr label="Protest Tracker" sub="2026 status + prior year outcomes" />
        <ProtestTracker property={prop} style={{ marginBottom:14 }} />

        {/* Export */}
        <SectionHdr label="Evidence Export" sub="Print-ready PDF for ARB hearing" />
        <ExportBtn />
        <div style={{ height:24 }} />
      </div>
    </PT1Shell>
  );
}

Object.assign(window, { ViewA });
