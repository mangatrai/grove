// Grove — Real Estate Pages (List + Detail)
const { useState } = React;
const { T, fmt, fmtD, fmtM, PROPERTIES, PORTFOLIO } = window.RE_MOCK;

// ── SHELL ────────────────────────────────────────────────────────────────────
function REShell({ children, page = 'Real Estate' }) {
  const groups = [
    { label:'Daily',          items:['Home','Transactions','Payslips'] },
    { label:'Reports',        items:['Net Worth','Budget'] },
    { label:'Property & Tax', items:['Real Estate','Tax Protest'] },
    { label:'Setup',          items:['Categories','Settings'] },
  ];
  return (
    <div style={{ display:'flex', height:'100%', background:T.pageBg, fontFamily:"'Inter',system-ui,sans-serif", fontSize:13.5, overflow:'hidden' }}>
      <div style={{ width:170, flexShrink:0, background:T.sidebarBg, display:'flex', flexDirection:'column', padding:'10px 7px', gap:12 }}>
        <div style={{ display:'flex', alignItems:'center', gap:7, padding:'3px 7px 10px', borderBottom:'1px solid rgba(255,255,255,0.07)' }}>
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none"><rect width="22" height="22" rx="6" fill="url(#rg)"/><defs><linearGradient id="rg" x1="0" y1="0" x2="22" y2="22"><stop stopColor="#c8860a"/><stop offset="1" stopColor="#2d6a4f"/></linearGradient></defs><rect x="5.5" y="8" width="3" height="8" rx="1" fill="#f0e9d8"/><rect x="9.5" y="5.5" width="3" height="10.5" rx="1" fill="#f0e9d8"/><rect x="13.5" y="9" width="3" height="7" rx="1" fill="#f0e9d8"/></svg>
          <span style={{ color:'#f0e9d8', fontWeight:700, fontSize:14.5, fontFamily:"'Inter Tight','Inter',sans-serif" }}>Grove</span>
        </div>
        {groups.map(g => (
          <div key={g.label}>
            <div style={{ fontSize:9.5, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'rgba(168,196,178,0.4)', padding:'0 9px 4px' }}>{g.label}</div>
            {g.items.map(item => {
              const active = item === page;
              return (
                <div key={item} style={{ padding:'5px 9px', borderRadius:5, fontSize:12.5, fontWeight:active?600:500, color:active?'#f0e9d8':'rgba(168,196,178,0.7)', background:active?'rgba(240,233,216,0.12)':'transparent', borderLeft:active?'2px solid #f0e9d8':'2px solid transparent', marginBottom:1 }}>{item}</div>
              );
            })}
          </div>
        ))}
      </div>
      <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
        <div style={{ background:T.sidebarBg, borderBottom:'1px solid rgba(255,255,255,0.07)', padding:'7px 16px', display:'flex', alignItems:'center', minHeight:42, flexShrink:0 }}>
          <div style={{ flex:1 }} />
          <span style={{ color:'rgba(168,196,178,0.45)', fontSize:11.5, marginRight:8 }}>May 18, 2026</span>
          <span style={{ padding:'3px 10px', borderRadius:999, background:'rgba(45,106,79,0.35)', border:'1px solid rgba(240,233,216,0.2)', color:'#f0e9d8', fontSize:11.5, fontWeight:600 }}>Import</span>
        </div>
        <div style={{ flex:1, overflow:'auto' }}>{children}</div>
      </div>
    </div>
  );
}

// ── PROPERTY IMAGE PLACEHOLDER ────────────────────────────────────────────────
function PropImage({ height = 120, property }) {
  const colors = { 'Primary Home': [T.forest, T.forest2], 'Rental': [T.stone, T.sage] };
  const [c1, c2] = colors[property.propertyType] || [T.stone, T.sage];
  return (
    <div style={{ height, background:`repeating-linear-gradient(135deg, rgba(28,25,23,0.04), rgba(28,25,23,0.04) 6px, transparent 6px, transparent 12px), ${T.surfaceAlt}`, display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:4 }}>
      <svg width="32" height="28" viewBox="0 0 32 28" fill="none" opacity="0.3">
        <path d="M2 26L16 4L30 26H2Z" stroke={T.stone} strokeWidth="1.5" fill="none"/>
        <rect x="12" y="16" width="8" height="10" rx="1" stroke={T.stone} strokeWidth="1.3"/>
        <rect x="9" y="9" width="14" height="8" rx="1" stroke={T.stone} strokeWidth="1.3"/>
      </svg>
      <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, color:T.textMuted, letterSpacing:'0.06em' }}>property photo</span>
    </div>
  );
}

// ── ASSESSMENT SIGNAL BADGE ───────────────────────────────────────────────────
function AssessSignal({ property, compact }) {
  const over = property.cadAssessed > property.avm;
  const pct  = Math.abs(((property.cadAssessed / property.avm) - 1) * 100);
  if (compact) return (
    <span style={{ fontSize:11, fontWeight:700, padding:'2px 7px', borderRadius:4, background:over?T.terracottaSubtle:T.accentSubtle, color:over?T.terracotta:T.forest }}>
      {over ? `CAD +${pct.toFixed(1)}% over AVM` : `CAD ${pct.toFixed(1)}% under AVM`}
    </span>
  );
  return (
    <div style={{ padding:'8px 11px', borderRadius:8, background:over?T.terracottaSubtle:T.accentSubtle, border:`1px solid ${over?'rgba(139,58,38,0.18)':'rgba(45,106,79,0.18)'}` }}>
      <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:3 }}>
        <span style={{ width:7, height:7, borderRadius:'50%', background:over?T.terracotta:T.forest, display:'inline-block' }} />
        <span style={{ fontSize:12, fontWeight:700, color:over?T.terracotta:T.forest }}>
          {over ? 'Consider Protesting' : 'Fairly Assessed'}
        </span>
      </div>
      <div style={{ fontSize:11.5, color:T.textSecondary }}>
        CAD {fmtD(property.cadAssessed)} vs AVM {fmtD(property.avm)} &nbsp;·&nbsp; <strong style={{ color:over?T.terracotta:T.forest }}>{over?'+':'-'}{pct.toFixed(1)}%</strong>
      </div>
    </div>
  );
}

// ── PROPERTY CARD (list view) ─────────────────────────────────────────────────
function PropertyCard({ property, onDetail }) {
  const protestMap = {
    'filed':     { label:'Filed',    color:T.forest,  bg:T.accentSubtle },
    'not-filed': { label:null },
    'resolved':  { label:'Resolved', color:T.forest,  bg:T.accentSubtle },
    'arb':       { label:'ARB',      color:T.gold,    bg:T.goldSubtle },
  };
  const ps = protestMap[property.protestStatus] || {};
  const over = property.cadAssessed > property.avm;

  return (
    <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:10, overflow:'hidden', display:'flex', flexDirection:'column', boxShadow:'0 1px 4px rgba(28,25,23,0.05)' }}>
      <PropImage property={property} height={110} />
      <div style={{ padding:'12px 14px', flex:1, display:'flex', flexDirection:'column', gap:8 }}>
        {/* Address + badges */}
        <div>
          <div style={{ display:'flex', gap:5, marginBottom:4, flexWrap:'wrap' }}>
            <span style={{ fontSize:10.5, fontWeight:700, padding:'2px 6px', borderRadius:4, background: property.propertyType==='Primary Home'?T.accentSubtle:T.goldSubtle, color:property.propertyType==='Primary Home'?T.forest:T.gold }}>{property.propertyType}</span>
            {ps.label && <span style={{ fontSize:10.5, fontWeight:700, padding:'2px 6px', borderRadius:4, background:ps.bg, color:ps.color }}>{ps.label}</span>}
          </div>
          <div style={{ fontSize:13.5, fontWeight:700, color:T.text, lineHeight:1.3, fontFamily:"'Inter Tight',sans-serif" }}>{property.address}</div>
          <div style={{ fontSize:11.5, color:T.textMuted, marginTop:2 }}>{property.city}, {property.state} {property.zip} · {property.county.split(',')[0]}</div>
        </div>

        {/* Specs */}
        <div style={{ display:'flex', gap:10, fontSize:12, color:T.textSecondary }}>
          <span>{property.beds}bd <span style={{ color:T.textMuted }}>·</span> {property.baths}ba</span>
          <span style={{ color:T.textMuted }}>·</span>
          <span>{fmt(property.sqft)} sqft</span>
          <span style={{ color:T.textMuted }}>·</span>
          <span>Built {property.yearBuilt}</span>
        </div>

        {/* Purchase → AVM */}
        <div style={{ display:'flex', gap:10, alignItems:'center', fontSize:12 }}>
          <div>
            <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', color:T.textMuted }}>Purchased</div>
            <div style={{ fontFamily:"'JetBrains Mono',monospace", fontWeight:600, color:T.textSecondary }}>{fmtD(property.purchasePrice)}</div>
            <div style={{ fontSize:10.5, color:T.textMuted }}>{property.purchaseDate}</div>
          </div>
          <div style={{ color:T.border, fontSize:16 }}>→</div>
          <div>
            <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', color:T.textMuted }}>Current AVM</div>
            <div style={{ fontFamily:"'JetBrains Mono',monospace", fontWeight:700, color:T.text }}>{fmtD(property.avm)}</div>
            <div style={{ fontSize:10.5, color:T.forest }}>+{(((property.avm/property.purchasePrice)-1)*100).toFixed(0)}% since purchase</div>
          </div>
          {property.monthlyRent && (
            <>
              <div style={{ color:T.border, fontSize:16 }}>·</div>
              <div>
                <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', color:T.textMuted }}>Monthly Rent</div>
                <div style={{ fontFamily:"'JetBrains Mono',monospace", fontWeight:700, color:T.gold }}>{fmtD(property.monthlyRent)}</div>
              </div>
            </>
          )}
        </div>

        {/* Assessment signal */}
        <AssessSignal property={property} compact />

        {/* Hearing alert */}
        {property.hearingDate && (
          <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:11.5, color:T.gold }}>
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><rect x=".5" y="1.5" width="10" height="8.5" rx="1.5" stroke={T.gold} strokeWidth="1.1"/><path d="M3 .5v2M8 .5v2M.5 4.5h10" stroke={T.gold} strokeWidth="1.1" strokeLinecap="round"/></svg>
            <span><strong>ARB Hearing</strong> · {property.hearingDate} · {property.hearingDaysLeft} days</span>
          </div>
        )}
      </div>

      {/* Card footer */}
      <div style={{ padding:'9px 14px', borderTop:`1px solid ${T.border}`, display:'flex', gap:8 }}>
        <button onClick={() => onDetail && onDetail(property.id)}
          style={{ flex:1, padding:'6px 0', borderRadius:6, border:`1px solid ${T.border}`, background:T.surfaceAlt, fontSize:12, fontWeight:600, color:T.text, cursor:'pointer' }}>
          View Details
        </button>
        <button style={{ flex:1, padding:'6px 0', borderRadius:6, border:'none', background: over ? T.terracotta : T.forest, fontSize:12, fontWeight:600, color:'#fff', cursor:'pointer' }}>
          {property.protestStatus === 'filed' ? 'View Protest' : 'Tax Protest'}
        </button>
      </div>
    </div>
  );
}

// ── PORTFOLIO STRIP ───────────────────────────────────────────────────────────
function PortfolioStrip({ portfolio }) {
  const kpis = [
    { label:'Portfolio AVM',      value:fmtM(portfolio.totalAVM),       sub:`${PROPERTIES.length} properties`, color:T.text },
    { label:'Total CAD Assessed', value:fmtM(portfolio.totalCAD),       sub:`vs AVM ${fmtM(portfolio.totalAVM)}`, color:T.terracotta },
    { label:'Annual Property Tax',value:fmtD(portfolio.totalTaxes),     sub:'all properties combined', color:T.textSecondary },
    { label:'Annual Rental Income',value:fmtD(portfolio.annualRent),    sub:'2 rental properties', color:T.gold },
    { label:'Protest Savings',    value:fmtD(portfolio.protestSavings)+'/yr', sub:'estimated · 2026 cycle', color:T.forest },
  ];
  return (
    <div style={{ display:'flex', gap:0, background:T.surface, border:`1px solid ${T.border}`, borderRadius:10, overflow:'hidden', marginBottom:16 }}>
      {kpis.map((k, i) => (
        <div key={k.label} style={{ flex:1, padding:'12px 16px', borderRight:i<kpis.length-1?`1px solid ${T.border}`:'none' }}>
          <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:T.textMuted, marginBottom:3 }}>{k.label}</div>
          <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:17, fontWeight:700, color:k.color, letterSpacing:'-0.01em' }}>{k.value}</div>
          <div style={{ fontSize:11, color:T.textMuted, marginTop:2 }}>{k.sub}</div>
        </div>
      ))}
    </div>
  );
}

// ── LIST PAGE ─────────────────────────────────────────────────────────────────
function ListPage({ onDetail }) {
  return (
    <REShell page="Real Estate">
      <div style={{ padding:'18px 22px' }}>
        <div style={{ display:'flex', alignItems:'flex-end', marginBottom:14 }}>
          <div>
            <div style={{ fontSize:11, color:T.textMuted, marginBottom:3 }}>Property &amp; Tax › Real Estate</div>
            <h1 style={{ fontFamily:"'Inter Tight',sans-serif", fontSize:21, fontWeight:800, color:T.text, letterSpacing:'-0.02em', margin:0 }}>Real Estate · Portfolio</h1>
          </div>
          <div style={{ marginLeft:'auto', display:'flex', gap:8 }}>
            <button style={{ padding:'6px 13px', borderRadius:7, border:`1px solid ${T.border}`, background:T.surface, fontSize:12, fontWeight:600, color:T.textSecondary, cursor:'pointer' }}>↻ Refresh All Data</button>
            <button style={{ padding:'6px 13px', borderRadius:7, border:'none', background:T.forest, fontSize:12, fontWeight:600, color:'#fff', cursor:'pointer' }}>+ Add Property</button>
          </div>
        </div>

        <PortfolioStrip portfolio={PORTFOLIO} />

        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:14 }}>
          {PROPERTIES.map(p => (
            <PropertyCard key={p.id} property={p} onDetail={onDetail} />
          ))}
        </div>

        <div style={{ marginTop:14, padding:'10px 14px', borderRadius:8, background:T.surfaceAlt, border:`1px solid ${T.border}`, fontSize:12, color:T.textMuted, display:'flex', alignItems:'center', gap:8 }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.5" stroke={T.textMuted} strokeWidth="1.2"/><path d="M7 4.5V7.5M7 9.5v.5" stroke={T.textMuted} strokeWidth="1.3" strokeLinecap="round"/></svg>
          Data sourced from Redfin AVM and county CAD portals · Last refreshed May 18, 2026 · RealtyAPI.io
        </div>
      </div>
    </REShell>
  );
}

// ── ASSESSMENT HISTORY BARS ───────────────────────────────────────────────────
function AssessHistory({ history }) {
  const maxVal = Math.max(...history.map(h => h.assessed));
  return (
    <div style={{ display:'flex', gap:8, alignItems:'flex-end', height:80, padding:'0 4px' }}>
      {[...history].reverse().map((h, i) => {
        const isLatest = i === history.length - 1;
        const barH = Math.max(20, Math.round((h.assessed / maxVal) * 72));
        return (
          <div key={h.year} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:4 }}>
            <div style={{ fontSize:10, fontFamily:"'JetBrains Mono',monospace", color: isLatest ? T.terracotta : T.textMuted, fontWeight: isLatest ? 700 : 400 }}>{fmtM(h.assessed)}</div>
            <div style={{ width:'100%', height:barH, borderRadius:'3px 3px 0 0', background: isLatest ? T.terracotta : T.forest2, opacity: isLatest ? 1 : 0.55 + i * 0.1 }} />
            <div style={{ fontSize:10, color: isLatest ? T.text : T.textMuted, fontWeight: isLatest ? 700 : 400 }}>{h.year}</div>
          </div>
        );
      })}
    </div>
  );
}

// ── DETAIL PAGE ───────────────────────────────────────────────────────────────
function DetailPage({ propertyId, onBack }) {
  const [hearingEdit, setHearingEdit] = useState(false);
  const property = PROPERTIES.find(p => p.id === propertyId) || PROPERTIES[0];
  const over     = property.cadAssessed > property.avm;
  const overAmt  = property.cadAssessed - property.avm;
  const overPct  = ((property.cadAssessed / property.avm) - 1) * 100;
  const savings  = Math.round(overAmt * property.taxRate);

  const facts = [
    ['Property Type',  property.propertyType],
    ['Address',        `${property.address}, ${property.city} ${property.state} ${property.zip}`],
    ['Beds / Baths',   `${property.beds} bed · ${property.baths} bath`],
    ['Above-Grade Sqft', `${fmt(property.sqft)} sqft`],
    ['Lot Size',       `${fmt(property.lotSqft)} sqft`],
    ['Year Built',     property.yearBuilt],
    ['Stories',        property.stories],
    ['APN',            property.apn],
    ['County / CAD',   `${property.county} · ${property.portal}`],
    ['Appeal Process', property.appealProcess],
  ];

  return (
    <REShell page="Real Estate">
      <div style={{ padding:'16px 22px' }}>

        {/* Breadcrumb */}
        <div style={{ display:'flex', alignItems:'center', gap:5, marginBottom:14, fontSize:12, color:T.textMuted }}>
          <span onClick={onBack} style={{ cursor:'pointer', color:T.textMuted }}>Property &amp; Tax</span>
          <span>›</span>
          <span onClick={onBack} style={{ cursor:'pointer', color:T.textMuted }}>Real Estate</span>
          <span>›</span>
          <span style={{ color:T.text, fontWeight:600 }}>{property.address}</span>
          <span style={{ marginLeft:'auto', padding:'3px 8px', borderRadius:5, background:property.propertyType==='Primary Home'?T.accentSubtle:T.goldSubtle, color:property.propertyType==='Primary Home'?T.forest:T.gold, fontSize:11, fontWeight:700 }}>{property.propertyType}</span>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'1fr 320px', gap:16, alignItems:'start' }}>

          {/* LEFT column */}
          <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
            {/* Image */}
            <div style={{ borderRadius:10, overflow:'hidden', border:`1px solid ${T.border}` }}>
              <PropImage property={property} height={180} />
            </div>

            {/* Property facts */}
            <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:10, overflow:'hidden' }}>
              <div style={{ padding:'9px 14px', borderBottom:`1px solid ${T.border}`, fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', color:T.textMuted }}>Property Details</div>
              <div style={{ padding:'4px 0' }}>
                {facts.map(([k, v]) => (
                  <div key={k} style={{ display:'flex', padding:'5px 14px', borderBottom:`1px solid rgba(221,214,206,0.4)` }}>
                    <span style={{ flex:'0 0 160px', fontSize:12, color:T.textMuted, fontWeight:500 }}>{k}</span>
                    <span style={{ fontSize:12, color:T.text, fontWeight:500 }}>{v}</span>
                  </div>
                ))}
                {property.monthlyRent && (
                  <div style={{ display:'flex', padding:'5px 14px' }}>
                    <span style={{ flex:'0 0 160px', fontSize:12, color:T.textMuted, fontWeight:500 }}>Monthly Rent</span>
                    <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:12, color:T.gold, fontWeight:700 }}>{fmtD(property.monthlyRent)}/mo · {fmtD(property.monthlyRent*12)}/yr</span>
                  </div>
                )}
              </div>
            </div>

            {/* Assessment history */}
            <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:10, padding:'12px 14px' }}>
              <div style={{ fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', color:T.textMuted, marginBottom:12 }}>Assessment History</div>
              <AssessHistory history={property.taxHistory} />
              <div style={{ marginTop:10, display:'flex', gap:12, fontSize:11.5, color:T.textSecondary, borderTop:`1px solid ${T.border}`, paddingTop:10 }}>
                {property.taxHistory.slice(0,3).map((h, i) => i > 0 && (
                  <span key={h.year} style={{ color: h.pct > 8 ? T.terracotta : T.textMuted }}>
                    {h.year}: <strong style={{ fontFamily:"'JetBrains Mono',monospace" }}>{h.pct > 0 ? '+' : ''}{h.pct}%</strong>
                  </span>
                ))}
                <span style={{ marginLeft:'auto', fontSize:11, color:T.textMuted }}>Annual assessed value change</span>
              </div>
            </div>
          </div>

          {/* RIGHT column */}
          <div style={{ display:'flex', flexDirection:'column', gap:12 }}>

            {/* Valuation summary */}
            <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:10, overflow:'hidden' }}>
              <div style={{ padding:'9px 14px', borderBottom:`1px solid ${T.border}`, fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', color:T.textMuted }}>Valuation</div>
              <div style={{ padding:'12px 14px', display:'flex', flexDirection:'column', gap:10 }}>
                {[
                  { label:'Purchased', value:fmtD(property.purchasePrice), sub:property.purchaseDate, color:T.textSecondary },
                  { label:'Current AVM', value:fmtD(property.avm), sub:`Range ${fmtM(property.avmLow)}–${fmtM(property.avmHigh)}`, color:T.text },
                  { label:'CAD Assessed 2026', value:fmtD(property.cadAssessed), sub:`↑${property.taxHistory[0].pct}% YoY · ${fmtD(property.taxesDue)}/yr taxes`, color: over ? T.terracotta : T.text },
                ].map(kpi => (
                  <div key={kpi.label} style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', paddingBottom:8, borderBottom:`1px solid ${T.border}` }}>
                    <div>
                      <div style={{ fontSize:10.5, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.06em', color:T.textMuted }}>{kpi.label}</div>
                      <div style={{ fontSize:10.5, color:T.textMuted, marginTop:2 }}>{kpi.sub}</div>
                    </div>
                    <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:17, fontWeight:700, color:kpi.color }}>{kpi.value}</div>
                  </div>
                ))}
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <span style={{ fontSize:11.5, color:T.textMuted }}>Gain since purchase</span>
                  <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:13, fontWeight:700, color:T.forest }}>+{fmtD(property.avm - property.purchasePrice)} ({(((property.avm/property.purchasePrice)-1)*100).toFixed(0)}%)</span>
                </div>
              </div>
            </div>

            {/* Protest readiness */}
            <div style={{ background:T.surface, border:`1px solid ${over?'rgba(139,58,38,0.2)':T.border}`, borderRadius:10, overflow:'hidden' }}>
              <div style={{ padding:'9px 14px', borderBottom:`1px solid ${T.border}`, display:'flex', alignItems:'center', gap:7, background: over ? T.terracottaSubtle : T.surfaceAlt }}>
                <span style={{ width:7, height:7, borderRadius:'50%', background:over?T.terracotta:T.forest, display:'inline-block' }} />
                <span style={{ fontSize:11.5, fontWeight:700, color:over?T.terracotta:T.forest }}>
                  {over ? 'Consider Protesting' : 'Fairly Assessed'}
                </span>
              </div>
              <div style={{ padding:'12px 14px' }}>
                {over ? (
                  <>
                    <div style={{ fontSize:12.5, color:T.textSecondary, lineHeight:1.6, marginBottom:12 }}>
                      CAD overassessed by <strong style={{ color:T.terracotta }}>{fmtD(overAmt)} ({overPct.toFixed(1)}%)</strong> above automated valuation.
                      Estimated savings if protested: <strong style={{ color:T.forest }}>{fmtD(savings)}/yr</strong>.
                    </div>
                    {property.protestStatus === 'filed' && property.hearingDate && (
                      <div style={{ display:'flex', alignItems:'center', gap:8, padding:'7px 10px', borderRadius:7, background:T.goldSubtle, border:'1px solid rgba(200,134,10,0.2)', marginBottom:12, fontSize:12 }}>
                        <span style={{ color:T.gold, fontWeight:700 }}>ARB Hearing</span>
                        <span style={{ color:T.textSecondary }}>
                          {hearingEdit
                            ? <input defaultValue={property.hearingDate} style={{ border:`1px solid ${T.border}`, borderRadius:4, padding:'1px 5px', fontSize:12, fontFamily:'inherit', background:T.surface }} onBlur={() => setHearingEdit(false)} autoFocus />
                            : <span>{property.hearingDate}</span>}
                        </span>
                        <button onClick={() => setHearingEdit(!hearingEdit)} style={{ marginLeft:2, background:'none', border:'none', cursor:'pointer', fontSize:11, color:T.gold, fontWeight:600 }}>✏</button>
                        <span style={{ marginLeft:'auto', fontWeight:700, color:T.gold }}>{property.hearingDaysLeft} days</span>
                      </div>
                    )}
                    <button style={{ width:'100%', padding:'10px', borderRadius:8, border:'none', background:T.terracotta, color:'#fff', fontSize:13, fontWeight:700, cursor:'pointer', letterSpacing:'-0.01em' }}>
                      {property.protestStatus === 'filed' ? '→ View Protest Worksheet' : '→ Prepare Tax Protest'}
                    </button>
                    {property.protestStatus !== 'filed' && (
                      <div style={{ marginTop:8, fontSize:11.5, color:T.textMuted, textAlign:'center' }}>Kicks off async DCAD data fetch · ~2 min</div>
                    )}
                  </>
                ) : (
                  <div style={{ fontSize:12.5, color:T.textSecondary, lineHeight:1.6 }}>
                    CAD assessed value is within {Math.abs(overPct).toFixed(1)}% of market. No protest benefit at this time.
                  </div>
                )}
              </div>
            </div>

            {/* Data source */}
            <div style={{ background:T.surfaceAlt, border:`1px solid ${T.border}`, borderRadius:8, padding:'10px 13px', fontSize:11.5, color:T.textMuted }}>
              <div style={{ fontWeight:600, color:T.textSecondary, marginBottom:4 }}>Data Sources</div>
              <div>AVM · {property.portal} (CAD) · RealtyAPI.io</div>
              <div style={{ marginTop:4, display:'flex', justifyContent:'space-between' }}>
                <span>Last refreshed May 18, 2026</span>
                <button style={{ background:'none', border:'none', cursor:'pointer', fontSize:11.5, color:T.forest, fontWeight:600 }}>↻ Refresh</button>
              </div>
            </div>

          </div>
        </div>
        <div style={{ height:24 }} />
      </div>
    </REShell>
  );
}

Object.assign(window, { ListPage, DetailPage });
