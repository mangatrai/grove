// Grove — PT-1 Detail Artboards (evidence tables, LLM panel, PDF preview)
const { T, fmt, fmtD, fmtM,
        FRISCO_COMPS, SUBJECT, SUB_PPSQFT, COMP_MED_PPSQFT,
        OVERASSESS, OVER_PCT, UNQ_GAP_PPSQFT, UNQ_GAP_PCT, EST_SAVINGS, LLM
      } = window.PT1_MOCK;
const { MarketValueTable, UnequaTable, LLMStrategyPanel, ProtestTracker } = window;

// Standalone evidence table artboards (no shell, just the table)
function EVMarket() {
  return (
    <div style={{ padding:20, background:T.pageBg, height:'100%', display:'flex', flexDirection:'column', gap:14 }}>
      <div>
        <div style={{ fontSize:11, color:T.textMuted, marginBottom:3, letterSpacing:'0.01em' }}>Evidence Section · Market Value · Tex. Tax Code §41.41</div>
        <div style={{ fontFamily:"'Inter Tight',sans-serif", fontSize:18, fontWeight:800, color:T.text, marginBottom:2 }}>Market Value Comps</div>
        <div style={{ fontSize:12.5, color:T.textSecondary }}>6 recent sales within 0.5 mi · Oct 2025–Mar 2026 · Subject row highlighted at bottom</div>
      </div>
      <MarketValueTable comps={FRISCO_COMPS} subject={SUBJECT} />
      <div style={{ padding:'10px 14px', borderRadius:8, background:'rgba(139,58,38,0.07)', border:'1px solid rgba(139,58,38,0.15)', fontSize:12.5, color:T.textSecondary, lineHeight:1.55 }}>
        <strong style={{ color:T.text }}>Argument:</strong> The subject property's CAD assessed value of <strong style={{ color:T.terracotta }}>{fmtD(SUBJECT.cadAssessed)}</strong> is{' '}
        <strong style={{ color:T.terracotta }}>11.8%</strong> above the median sold price of <strong style={{ color:T.text }}>{fmtD(986500)}</strong> for six comparable recent sales,
        supporting a market value protest under Tex. Tax Code §41.41.
      </div>
    </div>
  );
}

function EVUnequal() {
  return (
    <div style={{ padding:20, background:T.pageBg, height:'100%', display:'flex', flexDirection:'column', gap:14 }}>
      <div>
        <div style={{ fontSize:11, color:T.textMuted, marginBottom:3, letterSpacing:'0.01em' }}>Evidence Section · Unequal Appraisal · Tex. Tax Code §41.43 · Primary Strategy</div>
        <div style={{ fontFamily:"'Inter Tight',sans-serif", fontSize:18, fontWeight:800, color:T.text, marginBottom:2 }}>Unequal Appraisal — CAD Rate Comparison</div>
        <div style={{ fontSize:12.5, color:T.textSecondary }}>County's own assessed values for 6 comparable addresses · DCAD 2026 roll data</div>
      </div>
      <UnequaTable comps={FRISCO_COMPS} subject={SUBJECT} />
      <div style={{ padding:'10px 14px', borderRadius:8, background:'rgba(139,58,38,0.07)', border:'1px solid rgba(139,58,38,0.15)', fontSize:12.5, color:T.textSecondary, lineHeight:1.55 }}>
        <strong style={{ color:T.text }}>Why this wins:</strong> The county cannot dispute its own appraisal roll. Subject is assessed at{' '}
        <strong style={{ color:T.terracotta }}>${SUB_PPSQFT}/sqft</strong> vs. a median of{' '}
        <strong style={{ color:T.forest }}>${COMP_MED_PPSQFT}/sqft</strong> for comparable properties —{' '}
        a <strong style={{ color:T.terracotta }}>{UNQ_GAP_PCT.toFixed(1)}% disparity</strong> of <strong style={{ color:T.terracotta }}>${UNQ_GAP_PPSQFT}/sqft</strong>.
        Projected additional equity reduction: {fmtD(UNQ_GAP_PPSQFT * SUBJECT.sqft)}.
      </div>
    </div>
  );
}

function LLMDetail() {
  return (
    <div style={{ padding:20, background:T.pageBg, height:'100%', display:'flex', flexDirection:'column', gap:14 }}>
      <div>
        <div style={{ fontSize:11, color:T.textMuted, marginBottom:3 }}>AI Analysis · Generated May 18, 2026 9:14 AM</div>
        <div style={{ fontFamily:"'Inter Tight',sans-serif", fontSize:18, fontWeight:800, color:T.text }}>Protest Strategy · AI Output</div>
      </div>
      <LLMStrategyPanel />
    </div>
  );
}

// PDF Evidence Packet Preview
function PDFPreview() {
  const pageStyle = {
    width:560, background:'#fff', borderRadius:4,
    boxShadow:'0 4px 24px rgba(28,25,23,0.18)', overflow:'hidden',
    fontFamily:"'Inter','Helvetica Neue',sans-serif", color:'#111',
  };
  const hr = { height:1, background:'#e0e0e0', border:'none', margin:'10px 0' };
  const mono = { fontFamily:"'JetBrains Mono','Courier New',monospace" };

  return (
    <div style={{ padding:24, background:'#ddd6ce', display:'flex', flexDirection:'column', gap:20, alignItems:'center', height:'100%' }}>
      <div style={{ fontSize:11, color:'#8a7a6e', fontWeight:600 }}>EVIDENCE PACKET PREVIEW · PDF · 8 PAGES · ARB SUBMISSION READY</div>

      {/* Page 1 — Cover */}
      <div style={pageStyle}>
        {/* Header band */}
        <div style={{ background:'#1a2b1f', padding:'16px 22px', display:'flex', alignItems:'center', gap:12 }}>
          <svg width="20" height="20" viewBox="0 0 22 22" fill="none"><rect width="22" height="22" rx="5" fill="url(#gp)"/><defs><linearGradient id="gp" x1="0" y1="0" x2="22" y2="22"><stop stopColor="#c8860a"/><stop offset="1" stopColor="#2d6a4f"/></linearGradient></defs><rect x="5.5" y="8" width="3" height="8" rx="1" fill="#f0e9d8"/><rect x="9.5" y="5.5" width="3" height="10.5" rx="1" fill="#f0e9d8"/><rect x="13.5" y="9" width="3" height="7" rx="1" fill="#f0e9d8"/></svg>
          <span style={{ color:'#f0e9d8', fontWeight:700, fontSize:13, letterSpacing:'-0.01em' }}>Grove · Property Tax Evidence Packet</span>
        </div>

        <div style={{ padding:'18px 22px' }}>
          {/* Case header */}
          <div style={{ fontSize:9, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', color:'#888', marginBottom:6 }}>Protest Case</div>
          <div style={{ fontSize:16, fontWeight:800, color:'#111', marginBottom:4, letterSpacing:'-0.01em' }}>7070 Coulter Lake Rd, Frisco TX 75036</div>
          <div style={{ fontSize:11.5, color:'#555' }}>Denton County Appraisal District · ARB Hearing June 8, 2026</div>
          <hr style={hr} />

          {/* 2-col meta */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:14 }}>
            {[
              ['Owner', 'Mangat Rai / Goyal Family Trust'],
              ['APN',   'R 000000560912'],
              ['DCAD Property ID', '560912'],
              ['Hearing Date', 'June 8, 2026'],
              ['Grounds', 'Unequal Appraisal (Primary) + Market Value'],
              ['Generated', 'May 18, 2026'],
            ].map(([k,v]) => (
              <div key={k}>
                <div style={{ fontSize:9, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'#999', marginBottom:2 }}>{k}</div>
                <div style={{ fontSize:11.5, color:'#222', fontWeight:500 }}>{v}</div>
              </div>
            ))}
          </div>
          <hr style={hr} />

          {/* Summary signal */}
          <div style={{ padding:'10px 14px', borderRadius:6, background:'#fef5e4', border:'1px solid #f0c060', marginBottom:14 }}>
            <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', color:'#a07010', marginBottom:4 }}>Case Summary</div>
            <div style={{ fontSize:11.5, color:'#5a3a00', lineHeight:1.55 }}>
              The subject property is assessed at <span style={{ ...mono, fontWeight:700 }}>{fmtD(SUBJECT.cadAssessed)}</span> ($275/sqft) —
              representing a <strong>19.6% disparity</strong> above the median assessed rate of $230/sqft for 6 comparable neighboring properties (DCAD 2026 roll).
              Market value evidence further supports reduction: 6 comparable sales avg. <span style={{ ...mono, fontWeight:700 }}>$986,500</span>, 11.8% below assessed value.
              Requested value: <span style={{ ...mono, fontWeight:700 }}>{fmtD(1020000)}</span>.
            </div>
          </div>

          {/* Value summary table */}
          <div style={{ fontSize:9, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'#888', marginBottom:6 }}>Valuation Summary</div>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11.5, marginBottom:14 }}>
            <tbody>
            {[
              ['2026 CAD Assessed Value',          fmtD(SUBJECT.cadAssessed), '#c0392b'],
              ['Automated Valuation (AVM)',           fmtD(SUBJECT.avm),         '#27ae60'],
              ['Requested Value',           fmtD(1020000),              '#2d6a4f'],
              ['Est. Annual Tax Savings',   fmtD(EST_SAVINGS),          '#2d6a4f'],
            ].map(([label, val, color]) => (
              <tr key={label} style={{ borderBottom:'1px solid #e8e8e8' }}>
                <td style={{ padding:'5px 0', color:'#444' }}>{label}</td>
                <td style={{ padding:'5px 0', textAlign:'right', ...mono, fontWeight:700, color }}>{val}</td>
              </tr>
            ))}
            </tbody>
          </table>

          {/* Table of contents */}
          <div style={{ fontSize:9, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'#888', marginBottom:6 }}>Contents</div>
          {[
            ['1', 'Cover Sheet & Case Summary',           '1'],
            ['2', 'Subject Property Details',              '2'],
            ['3', 'Unequal Appraisal Evidence (§41.43)',   '3'],
            ['4', 'Market Value Comps (§41.41)',            '5'],
            ['5', 'Assessment History (2023–2026)',         '7'],
            ['6', 'Hearing Notes & Strategy',               '8'],
          ].map(([n, title, pg]) => (
            <div key={n} style={{ display:'flex', alignItems:'baseline', gap:4, fontSize:11, color:'#444', padding:'3px 0', borderBottom:'1px dotted #ddd' }}>
              <span style={{ color:'#999', minWidth:16 }}>{n}.</span>
              <span style={{ flex:1 }}>{title}</span>
              <span style={{ ...mono, fontSize:10.5, color:'#888' }}>p.{pg}</span>
            </div>
          ))}

          <div style={{ marginTop:16, fontSize:10, color:'#bbb', textAlign:'center' }}>
            Confidential — for protest use only
          </div>
        </div>
      </div>
    </div>
  );
}

function TrackerDetail() {
  return (
    <div style={{ padding:20, background:T.pageBg, height:'100%' }}>
      <div style={{ marginBottom:14 }}>
        <div style={{ fontSize:11, color:T.textMuted, marginBottom:3 }}>Protest Status · 2026 + Prior Years</div>
        <div style={{ fontFamily:"'Inter Tight',sans-serif", fontSize:18, fontWeight:800, color:T.text }}>Protest Tracker</div>
      </div>
      <ProtestTracker property={SUBJECT} />
    </div>
  );
}

Object.assign(window, { EVMarket, EVUnequal, LLMDetail, PDFPreview, TrackerDetail });
