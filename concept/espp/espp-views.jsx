/* Grove — ESPP Tracker · Components
 * Forest Studio design system · warm linen / forest-night chrome
 */
const { useState, useRef } = React;

/* ── Design tokens (mirrors index.css) ─────────────────────────────────── */
const T = {
  pageBg:       '#efebe3',
  surface:      '#fdfcfb',
  surfaceAlt:   '#f5f0e8',
  border:       '#ddd6ce',
  sidebarBg:    '#1a2b1f',
  sidebarActive:'#f0e9d8',
  sidebarActBg: 'rgba(240,233,216,0.12)',
  sidebarText:  '#a8c4b2',
  sidebarMuted: '#6b9178',
  sidebarBdr:   'rgba(255,255,255,0.07)',
  text:         '#1c1917',
  textMuted:    '#78716c',
  textSec:      '#57534e',
  forest:       '#2d6a4f',
  forest2:      '#4a8a6e',
  gold:         '#c8860a',
  terracotta:   '#8b3a26',
  sage:         '#7a8a6e',
  accentSub:    '#ebf5ef',
  goldSub:      '#fef6e4',
  terrSub:      'rgba(139,58,38,0.08)',
  shadow:       '0 2px 12px rgba(28,25,23,0.07),0 1px 3px rgba(28,25,23,0.05)',
  shadowFloat:  '0 22px 50px -12px rgba(28,25,23,0.18),0 0 0 1px rgba(28,25,23,0.06)',
  radius:       10,
};

/* ── Utils ──────────────────────────────────────────────────────────────── */
const usd  = (n, d = 2) => new Intl.NumberFormat('en-US', { style:'currency', currency:'USD', minimumFractionDigits:d, maximumFractionDigits:d }).format(n);
const plus = (n) => (n >= 0 ? '+' : '');

/* ── Sidebar nav config ─────────────────────────────────────────────────── */
const NAV = [
  { group:'Daily',   items:['Home','Transactions','Payslips','ESPP'] },
  { group:'Reports', items:['Net Worth','Budget'] },
  { group:'Setup',   items:['Categories','Settings'] },
];

/* ── Shared button styles ───────────────────────────────────────────────── */
const BtnPrimary = {
  display:'inline-flex', alignItems:'center', gap:6, padding:'7px 14px',
  borderRadius:6, border:'none', background:T.forest, color:'#fff',
  fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit',
};
const BtnSecondary = {
  display:'inline-flex', alignItems:'center', gap:6, padding:'7px 14px',
  borderRadius:6, border:`1px solid ${T.border}`, background:T.surface,
  color:T.text, fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit',
};
const BtnIcon = {
  display:'flex', alignItems:'center', justifyContent:'center',
  width:28, height:28, padding:0, borderRadius:6,
  border:`1px solid ${T.border}`, background:'transparent',
  color:T.textMuted, cursor:'pointer', fontFamily:'inherit',
};

/* ── XIcon ──────────────────────────────────────────────────────────────── */
function XIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
      <path d="M1 1l9 9M10 1L1 10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
    </svg>
  );
}

/* ── ChevronRight ───────────────────────────────────────────────────────── */
function ChevronRight({ open }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
      style={{ transform: open ? 'rotate(90deg)' : 'none', transition:'transform 0.18s ease', display:'block' }}>
      <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

/* ── ModalOverlay ───────────────────────────────────────────────────────── */
function ModalOverlay({ children, onClose }) {
  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position:'fixed', inset:0, zIndex:200,
        background:'rgba(28,25,23,0.45)',
        display:'flex', alignItems:'center', justifyContent:'center', padding:16,
      }}
    >
      {children}
    </div>
  );
}

/* ── StatusBadge ────────────────────────────────────────────────────────── */
function StatusBadge({ status }) {
  const map = {
    'Fully Sold':     { bg: T.accentSub, color: T.forest },
    'Partially Sold': { bg: T.goldSub,   color: T.gold   },
    'All Held':       { bg: T.surfaceAlt, color: T.sage  },
  };
  const v = map[status] ?? map['All Held'];
  return (
    <span style={{
      display:'inline-block', padding:'3px 9px', borderRadius:999,
      fontSize:11, fontWeight:600, letterSpacing:'0.025em',
      background:v.bg, color:v.color, whiteSpace:'nowrap',
    }}>{status}</span>
  );
}

/* ── StatCard ───────────────────────────────────────────────────────────── */
function StatCard({ label, value, sub, tone }) {
  const toneMap = {
    pos:  { color: T.forest,     bg: T.accentSub },
    neg:  { color: T.terracotta, bg: T.terrSub   },
    gold: { color: T.gold,       bg: T.goldSub   },
    neu:  { color: T.text,       bg: 'transparent' },
  };
  const tk = toneMap[tone ?? 'neu'];
  return (
    <div style={{
      background:T.surface, border:`1px solid ${T.border}`,
      borderRadius:T.radius, padding:'10px 12px', boxShadow:T.shadow,
      display:'flex', flexDirection:'column', gap:5,
    }}>
      <div style={{
        fontSize:10, fontWeight:700, textTransform:'uppercase',
        letterSpacing:'0.07em', color:T.textMuted, lineHeight:1,
      }}>{label}</div>
      <div style={{
        fontFamily:"'JetBrains Mono','Fira Code',monospace",
        fontSize:18, fontWeight:600, color:tk.color, lineHeight:1.2,
        letterSpacing:'-0.01em',
      }}>{value}</div>
      {sub && (
        <div style={{ fontSize:10, color:T.textMuted, lineHeight:1.35 }}>{sub}</div>
      )}
    </div>
  );
}

/* ── YearSelector ───────────────────────────────────────────────────────── */
function YearSelector({ year, onPrev, onNext, min, max }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:6 }}>
      <button
        onClick={onPrev} disabled={year <= min}
        style={{ ...BtnIcon, opacity: year <= min ? 0.3 : 1, fontSize:15, fontWeight:700 }}
      >‹</button>
      <div style={{
        padding:'5px 20px', borderRadius:999, userSelect:'none',
        border:`1px solid ${T.border}`, background:T.pageBg,
        fontFamily:"'Inter Tight','Inter',sans-serif",
        fontSize:15, fontWeight:700, color:T.text, letterSpacing:'-0.015em',
      }}>{year}</div>
      <button
        onClick={onNext} disabled={year >= max}
        style={{ ...BtnIcon, opacity: year >= max ? 0.3 : 1, fontSize:15, fontWeight:700 }}
      >›</button>
    </div>
  );
}

/* ── YearSummaryStrip ───────────────────────────────────────────────────── */
function YearSummaryStrip({ year, onPrev, onNext }) {
  const s = ESPP_SUMMARY[year];
  return (
    <div style={{
      background:T.surface, border:`1px solid ${T.border}`,
      borderRadius:T.radius, padding:'16px 20px', boxShadow:T.shadow,
    }}>
      <div style={{
        display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14,
      }}>
        <YearSelector year={year} onPrev={onPrev} onNext={onNext} min={2025} max={2026} />
        <span style={{ fontSize:11, color:T.textMuted, fontWeight:500 }}>
          Company Stock (ESPP) · {year} year summary
        </span>
      </div>

      {s ? (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:10 }}>
          <StatCard label="Shares Purchased YTD"     value={s.purchased}                                       />
          <StatCard label="Transferred to Broker"    value={s.transferred}                                     />
          <StatCard label="Outstanding (EquatePlus)" value={s.outstanding}                                     />
          <StatCard label="Shares Sold YTD"          value={s.sold}                                            />
          <StatCard label="Total Invested"           value={usd(s.invested)}                                   />
          <StatCard label="Discount Received YTD"   value={usd(s.discount)}  tone="gold" sub="FMV − cost basis × shares" />
          <StatCard label="Sale Proceeds YTD"       value={usd(s.proceeds)}                                   />
          <StatCard label="Realized Gain / Loss"
            value={`${plus(s.realized)}${usd(s.realized)}`}
            tone={s.realized >= 0 ? 'pos' : 'neg'}
          />
          <StatCard label="Ordinary Income YTD"     value={usd(s.oi)}        sub="discount × shares sold"     />
          <StatCard label="Capital Gain / Loss"
            value={`${plus(s.capGain)}${usd(s.capGain)}`}
            tone={s.capGain >= 0 ? 'pos' : 'neg'}
            sub="sale price vs FMV at purchase"
          />
        </div>
      ) : (
        <p style={{ color:T.textMuted, fontSize:13 }}>No data for {year}.</p>
      )}
    </div>
  );
}

/* ── SaleHistoryTable ───────────────────────────────────────────────────── */
function SaleHistoryTable({ sales }) {
  const TH = { padding:'7px 12px', fontSize:10, fontWeight:700, textTransform:'uppercase',
    letterSpacing:'0.06em', color:T.textMuted, background:T.surfaceAlt,
    borderBottom:`1px solid ${T.border}`, whiteSpace:'nowrap' };
  const TD = { padding:'9px 12px', fontSize:12,
    fontFamily:"'JetBrains Mono','Fira Code',monospace",
    fontWeight:500, borderBottom:`1px solid ${T.border}`,
    color:T.text, whiteSpace:'nowrap' };
  const cols = [
    { h:'Sale Date',        align:'left'  },
    { h:'Shares Sold',      align:'right' },
    { h:'Sale Price / sh',  align:'right' },
    { h:'Proceeds',         align:'right' },
    { h:'Ordinary Income',  align:'right' },
    { h:'Cap Gain / Loss',  align:'right' },
  ];
  return (
    <div style={{ border:`1px solid ${T.border}`, borderRadius:8, overflow:'hidden' }}>
      <table style={{ width:'100%', borderCollapse:'collapse' }}>
        <thead>
          <tr>
            {cols.map(({ h, align }) => (
              <th key={h} style={{ ...TH, textAlign:align }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sales.map((s, i) => {
            const last = i === sales.length - 1;
            const tdLast = last ? { borderBottom:'none' } : {};
            return (
              <tr key={i}>
                <td style={{ ...TD, ...tdLast, textAlign:'left', fontFamily:'inherit', fontWeight:400 }}>{s.date}</td>
                <td style={{ ...TD, ...tdLast, textAlign:'right' }}>{s.qty}</td>
                <td style={{ ...TD, ...tdLast, textAlign:'right' }}>{usd(s.price)}</td>
                <td style={{ ...TD, ...tdLast, textAlign:'right' }}>{usd(s.proceeds)}</td>
                <td style={{ ...TD, ...tdLast, textAlign:'right', color:T.gold }}>{usd(s.oi)}</td>
                <td style={{ ...TD, ...tdLast, textAlign:'right',
                  color: s.cg >= 0 ? T.forest : T.terracotta, fontWeight:600,
                }}>{plus(s.cg)}{usd(s.cg)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ── BatchRow ───────────────────────────────────────────────────────────── */
function BatchRow({ batch: b, expanded, onToggle }) {
  const [hov, setHov] = useState(false);
  const rowBg = expanded ? T.accentSub : hov ? T.surfaceAlt : 'transparent';

  const cell = (extra = {}) => ({
    padding:'11px 10px', fontSize:13, verticalAlign:'middle',
    borderBottom: expanded ? 'none' : `1px solid ${T.border}`,
    color: T.text, ...extra,
  });
  const mono = { fontFamily:"'JetBrains Mono','Fira Code',monospace", fontWeight:500 };

  return (
    <>
      <tr
        onClick={onToggle}
        onMouseEnter={() => setHov(true)}
        onMouseLeave={() => setHov(false)}
        style={{ cursor:'pointer', background:rowBg, transition:'background 0.1s' }}
      >
        {/* Expand chevron */}
        <td style={cell({ width:40, padding:'11px 8px 11px 16px', color:T.textMuted })}>
          <ChevronRight open={expanded} />
        </td>
        <td style={cell({ fontWeight:500 })}>{b.purchaseDate}</td>
        <td style={cell({ ...mono, textAlign:'right' })}>{b.sharesGranted}</td>
        <td style={cell({ ...mono, textAlign:'right' })}>{usd(b.fmv)}</td>
        <td style={cell({ ...mono, textAlign:'right' })}>{usd(b.costBasis)}</td>
        <td style={cell({ ...mono, textAlign:'right', color:T.gold, fontWeight:600 })}>{usd(b.discount)}</td>
        <td style={cell({ ...mono, textAlign:'right' })}>{b.transferred}</td>
        <td style={cell({ ...mono, textAlign:'right', color: b.outstanding > 0 ? T.text : T.textMuted })}>{b.outstanding}</td>
        <td style={cell({ ...mono, textAlign:'right' })}>{b.sold}</td>
        <td style={cell({ ...mono, textAlign:'right', color: b.held > 0 ? T.forest2 : T.textMuted, fontWeight: b.held > 0 ? 600 : 400 })}>{b.held}</td>
        <td style={cell({ textAlign:'center', padding:'11px 14px' })}>
          <StatusBadge status={b.status} />
        </td>
      </tr>

      {/* Expanded sale history */}
      {expanded && (
        <tr>
          <td colSpan={11} style={{
            padding:'0 18px 20px 56px',
            background: T.accentSub,
            borderBottom:`1px solid ${T.border}`,
          }}>
            <div style={{
              fontSize:10, fontWeight:700, textTransform:'uppercase',
              letterSpacing:'0.08em', color:T.forest, padding:'14px 0 10px',
            }}>
              Sale History · {b.purchaseDate} batch · {b.sold} of {b.sharesGranted} shares disposed
            </div>
            <SaleHistoryTable sales={b.sales} />
          </td>
        </tr>
      )}
    </>
  );
}

/* ── BatchTable ─────────────────────────────────────────────────────────── */
function BatchTable({ batches, expandedId, onToggle }) {
  const TH = {
    padding:'9px 10px', fontSize:10, fontWeight:700, textTransform:'uppercase',
    letterSpacing:'0.06em', color:T.textMuted,
    borderBottom:`1px solid ${T.border}`, background:T.surfaceAlt, whiteSpace:'nowrap',
  };
  const cols = [
    ['Purchase Date','left'], ['Shares','right'],  ['FMV / sh','right'],
    ['Cost / sh','right'],    ['Disc / sh','right'],['Transferred','right'],
    ['Outstanding','right'],  ['Sold','right'],     ['Held','right'],
    ['Status','center'],
  ];
  return (
    <div style={{
      background:T.surface, border:`1px solid ${T.border}`,
      borderRadius:T.radius, boxShadow:T.shadow, overflow:'hidden',
    }}>
      <div style={{
        display:'flex', alignItems:'center', justifyContent:'space-between',
        padding:'12px 16px', borderBottom:`1px solid ${T.border}`,
      }}>
        <span style={{
          fontFamily:"'Inter Tight','Inter',sans-serif",
          fontSize:14, fontWeight:700, color:T.text, letterSpacing:'-0.01em',
        }}>Purchase Batches</span>
        <span style={{ fontSize:11, color:T.textMuted }}>
          {batches.length} batches · click a row to expand sale history
        </span>
      </div>

      <div style={{ overflowX:'auto' }}>
        <table style={{ width:'100%', borderCollapse:'collapse', minWidth:880 }}>
          <thead>
            <tr>
              {/* chevron col */}
              <th style={{ ...TH, width:40, padding:'9px 8px 9px 16px' }} />
              {cols.map(([h, align]) => (
                <th key={h} style={{ ...TH, textAlign:align }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {batches.map(b => (
              <BatchRow
                key={b.id}
                batch={b}
                expanded={expandedId === b.id}
                onToggle={() => onToggle(b.id)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── FileDropZone ───────────────────────────────────────────────────────── */
function FileDropZone({ label, hint, accept }) {
  const [drag, setDrag]  = useState(false);
  const [file, setFile]  = useState(null);
  const ref              = useRef(null);

  const handleDrop = (e) => {
    e.preventDefault(); setDrag(false);
    const f = e.dataTransfer.files[0];
    if (f) setFile(f);
  };

  return (
    <div
      onClick={() => ref.current?.click()}
      onDragOver={e => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={handleDrop}
      style={{
        flex:1, minHeight:148,
        border:`2px dashed ${drag ? T.forest : file ? T.forest2 : T.border}`,
        borderRadius:8, display:'flex', flexDirection:'column',
        alignItems:'center', justifyContent:'center', gap:9,
        cursor:'pointer', padding:16, textAlign:'center',
        background: drag ? T.accentSub : T.pageBg, transition:'all 0.15s',
      }}
    >
      <input ref={ref} type="file" accept={accept} style={{ display:'none' }}
        onChange={e => setFile(e.target.files[0])} />

      {/* File icon */}
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none"
        stroke={file ? T.forest : T.textMuted}
        strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        {file
          ? <><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="15" y2="16"/></>
          : <><line x1="12" y1="18" x2="12" y2="12"/><line x1="9"  y1="15" x2="15" y2="15"/></>
        }
      </svg>

      {file ? (
        <>
          <div style={{ fontSize:12, fontWeight:600, color:T.forest }}>{file.name}</div>
          <div style={{ fontSize:11, color:T.textMuted }}>{(file.size / 1024).toFixed(1)} KB · ready</div>
        </>
      ) : (
        <>
          <div style={{ fontSize:13, fontWeight:600, color:T.text }}>{label}</div>
          <div style={{ fontSize:11, color:T.textMuted, lineHeight:1.45 }}>{hint}</div>
          <div style={{ fontSize:11, fontWeight:600, color:T.forest, marginTop:2 }}>
            Click or drag to upload
          </div>
        </>
      )}
    </div>
  );
}

/* ── ImportModal ────────────────────────────────────────────────────────── */
function ImportModal({ onClose }) {
  return (
    <ModalOverlay onClose={onClose}>
      <div style={{
        background:T.surface, borderRadius:T.radius, boxShadow:T.shadowFloat,
        width:'100%', maxWidth:540, padding:24,
        display:'flex', flexDirection:'column', gap:20,
      }}>
        {/* Header */}
        <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:12 }}>
          <div>
            <div style={{
              fontFamily:"'Inter Tight','Inter',sans-serif",
              fontSize:16, fontWeight:700, color:T.text,
            }}>Import ESPP Data</div>
            <div style={{ fontSize:12, color:T.textMuted, marginTop:3 }}>
              Upload both files to sync your latest activity from EquatePlus.
            </div>
          </div>
          <button onClick={onClose} style={BtnIcon}><XIcon /></button>
        </div>

        {/* File zones */}
        <div style={{ display:'flex', gap:12 }}>
          <FileDropZone
            label="Purchase PDF"
            accept=".pdf"
            hint="EquatePlus purchase confirmation PDF"
          />
          <FileDropZone
            label="Allocation CSV"
            accept=".csv"
            hint="EquatePlus allocation export (CSV)"
          />
        </div>

        {/* Footer */}
        <div style={{ display:'flex', justifyContent:'flex-end', gap:8 }}>
          <button onClick={onClose} style={BtnSecondary}>Cancel</button>
          <button style={BtnPrimary}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="8 17 12 21 16 17"/><line x1="12" y1="12" x2="12" y2="21"/>
              <path d="M20.88 18.09A5 5 0 0018 9h-1.26A8 8 0 103 16.29"/>
            </svg>
            Import Files
          </button>
        </div>
      </div>
    </ModalOverlay>
  );
}

/* ── RecordSaleModal ────────────────────────────────────────────────────── */
function RecordSaleModal({ batches, onClose }) {
  const [date, setDate] = useState('2026-05-20');
  const [rows, setRows] = useState([
    { id:1, batchId:'b2', qty:'', price:'' },
  ]);

  const avail  = batches.filter(b => b.held > 0);
  const addRow = () => setRows(r => [...r, { id:Date.now(), batchId: avail[0]?.id ?? '', qty:'', price:'' }]);
  const upd    = (id, f, v) => setRows(r => r.map(row => row.id === id ? { ...row, [f]:v } : row));
  const rem    = (id) => setRows(r => r.filter(row => row.id !== id));

  const inputS = {
    padding:'6px 9px', borderRadius:6, border:`1px solid ${T.border}`,
    background:T.surface, fontSize:13, color:T.text,
    width:'100%', outline:'none', fontFamily:'inherit',
  };

  return (
    <ModalOverlay onClose={onClose}>
      <div style={{
        background:T.surface, borderRadius:T.radius, boxShadow:T.shadowFloat,
        width:'100%', maxWidth:640, padding:24,
        display:'flex', flexDirection:'column', gap:20,
      }}>
        {/* Header */}
        <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:12 }}>
          <div>
            <div style={{ fontFamily:"'Inter Tight','Inter',sans-serif", fontSize:16, fontWeight:700, color:T.text }}>
              Record Sale
            </div>
            <div style={{ fontSize:12, color:T.textMuted, marginTop:3 }}>
              Record one or more lot disposals. Proceeds calculated live; tax impact on submit.
            </div>
          </div>
          <button onClick={onClose} style={BtnIcon}><XIcon /></button>
        </div>

        {/* Date */}
        <div>
          <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase',
            letterSpacing:'0.07em', color:T.textMuted, marginBottom:6 }}>
            Sale Date
          </div>
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            style={{ ...inputS, maxWidth:180 }} />
        </div>

        {/* Row grid */}
        <div>
          {/* Column headers */}
          <div style={{
            display:'grid', gridTemplateColumns:'1fr 80px 108px 112px 30px',
            gap:6, paddingBottom:8, borderBottom:`1px solid ${T.border}`, marginBottom:8,
          }}>
            {['Batch', 'Shares', 'Price / share', 'Proceeds', ''].map((h, i) => (
              <div key={i} style={{
                fontSize:10, fontWeight:700, textTransform:'uppercase',
                letterSpacing:'0.07em', color:T.textMuted,
              }}>{h}</div>
            ))}
          </div>

          {/* Data rows */}
          {rows.map(row => {
            const proceeds = parseFloat(row.qty || 0) * parseFloat(row.price || 0);
            return (
              <div key={row.id} style={{
                display:'grid', gridTemplateColumns:'1fr 80px 108px 112px 30px',
                gap:6, marginBottom:6, alignItems:'center',
              }}>
                <select value={row.batchId} onChange={e => upd(row.id, 'batchId', e.target.value)} style={inputS}>
                  {avail.map(b => (
                    <option key={b.id} value={b.id}>
                      {b.purchaseDate} — {b.held} sh avail.
                    </option>
                  ))}
                </select>
                <input type="number" placeholder="0" value={row.qty}
                  onChange={e => upd(row.id, 'qty', e.target.value)} style={inputS} />
                <input type="number" step="0.01" placeholder="0.00" value={row.price}
                  onChange={e => upd(row.id, 'price', e.target.value)} style={inputS} />
                <div style={{
                  padding:'6px 9px', borderRadius:6, border:`1px solid ${T.border}`,
                  background:T.pageBg, textAlign:'right',
                  fontFamily:"'JetBrains Mono','Fira Code',monospace",
                  fontSize:12, fontWeight:600,
                  color: proceeds > 0 ? T.forest : T.textMuted,
                }}>
                  {proceeds > 0 ? usd(proceeds) : '—'}
                </div>
                <button
                  onClick={() => rem(row.id)}
                  disabled={rows.length === 1}
                  style={{
                    ...BtnIcon, width:30, height:34,
                    opacity: rows.length === 1 ? 0.25 : 1,
                    cursor: rows.length === 1 ? 'not-allowed' : 'pointer',
                  }}
                >×</button>
              </div>
            );
          })}

          <button onClick={addRow} style={{ ...BtnSecondary, fontSize:11, padding:'5px 10px', marginTop:2 }}>
            + Add Row
          </button>
        </div>

        {/* Footer */}
        <div style={{
          display:'flex', alignItems:'center', justifyContent:'space-between',
          paddingTop:4, borderTop:`1px solid ${T.border}`,
        }}>
          <span style={{ fontSize:11, color:T.textMuted }}>
            Ordinary income &amp; capital gain/loss calculated on submit.
          </span>
          <div style={{ display:'flex', gap:8 }}>
            <button onClick={onClose} style={BtnSecondary}>Cancel</button>
            <button style={BtnPrimary}>Record Sales</button>
          </div>
        </div>
      </div>
    </ModalOverlay>
  );
}

/* ── Sidebar ────────────────────────────────────────────────────────────── */
function Sidebar({ active }) {
  return (
    <div style={{
      width:200, flexShrink:0, background:T.sidebarBg,
      height:'100vh', position:'sticky', top:0, overflowY:'auto',
      display:'flex', flexDirection:'column',
      borderRight:`1px solid ${T.sidebarBdr}`,
    }}>
      {/* Brand */}
      <div style={{
        padding:'14px 12px 12px', borderBottom:`1px solid ${T.sidebarBdr}`,
        display:'flex', alignItems:'center', gap:8,
      }}>
        <div style={{
          width:26, height:26, borderRadius:7, flexShrink:0,
          background:'linear-gradient(145deg, #1a3a22, #10180e)',
          display:'flex', alignItems:'center', justifyContent:'center',
        }}>
          {/* Grove stems mark */}
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
            <rect x="2"   y="4"  width="2.5" height="8"  rx="1.25" fill="#f0e9d8"/>
            <rect x="5.75" y="1" width="2.5" height="11" rx="1.25" fill="#f0e9d8"/>
            <rect x="9.5" y="5" width="2.5" height="7"  rx="1.25" fill="#f0e9d8"/>
          </svg>
        </div>
        <span style={{
          fontFamily:"'Inter Tight','Inter',sans-serif",
          fontSize:15, fontWeight:800, color:'#f0e9d8', letterSpacing:'-0.03em',
        }}>Grove</span>
      </div>

      {/* Nav */}
      <nav style={{ flex:1, padding:'8px 6px' }}>
        {NAV.map(({ group, items }) => (
          <div key={group} style={{ marginBottom:14 }}>
            <div style={{
              fontSize:9, fontWeight:700, textTransform:'uppercase',
              letterSpacing:'0.1em', color:T.sidebarMuted,
              padding:'0 10px', marginBottom:3,
            }}>{group}</div>
            {items.map(label => {
              const isActive = label === active;
              return (
                <div key={label} style={{
                  padding:`7px 10px`, paddingLeft: isActive ? 8 : 10,
                  borderRadius:6, marginBottom:1,
                  fontSize:13, fontWeight: isActive ? 600 : 500,
                  color: isActive ? T.sidebarActive : T.sidebarText,
                  background: isActive ? T.sidebarActBg : 'transparent',
                  borderLeft: isActive ? `2px solid ${T.sidebarActive}` : '2px solid transparent',
                  cursor:'pointer', transition:'all 0.12s',
                }}>{label}</div>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div style={{
        padding:'10px 8px', borderTop:`1px solid ${T.sidebarBdr}`,
      }}>
        <div style={{
          fontSize:11, color:T.sidebarMuted, padding:'4px 8px',
          display:'flex', alignItems:'center', gap:6,
        }}>
          <div style={{
            width:22, height:22, borderRadius:'50%',
            background: T.forest, display:'flex', alignItems:'center',
            justifyContent:'center', flexShrink:0,
            fontFamily:"'Inter Tight','Inter',sans-serif",
            fontSize:9, fontWeight:800, color:'#f0e9d8',
          }}>SC</div>
          Sarah &amp; Alex
        </div>
      </div>
    </div>
  );
}

/* ── TopBar ─────────────────────────────────────────────────────────────── */
function TopBar() {
  return (
    <div style={{
      background:T.sidebarBg, borderBottom:`1px solid ${T.sidebarBdr}`,
      height:48, display:'flex', alignItems:'center', gap:8,
      padding:'0 16px', position:'sticky', top:0, zIndex:30, flexShrink:0,
    }}>
      <div style={{ flex:1 }} />

      {/* Theme switcher */}
      <div style={{
        display:'flex', border:`1px solid rgba(255,255,255,0.08)`,
        borderRadius:8, overflow:'hidden', background:'rgba(255,255,255,0.04)',
      }}>
        {[['☀','L'], ['A','A'], ['🌙','D']].map(([icon, key], i) => (
          <div key={key} style={{
            display:'flex', alignItems:'center', justifyContent:'center',
            width:32, height:28, cursor:'pointer',
            borderRight: i < 2 ? `1px solid rgba(255,255,255,0.07)` : 'none',
            background: i === 2 ? 'rgba(240,233,216,0.12)' : 'transparent',
            color: i === 2 ? T.sidebarActive : 'rgba(255,255,255,0.38)',
            fontSize:11, transition:'all 0.12s',
          }}>{icon}</div>
        ))}
      </div>

      {/* User menu */}
      <div style={{
        padding:'5px 12px', borderRadius:999,
        background:'rgba(255,255,255,0.08)', border:`1px solid rgba(255,255,255,0.12)`,
        color:'#e2e8f0', fontSize:13, cursor:'pointer', userSelect:'none',
      }}>Sarah Chen ▾</div>
    </div>
  );
}

/* ── ESPPPage ────────────────────────────────────────────────────────────── */
function ESPPPage({ onImport, onRecordSale }) {
  const [year,       setYear]       = useState(2026);
  const [expandedId, setExpandedId] = useState('b2'); // Jul 2025 expanded by default

  const toggleRow = (id) => setExpandedId(prev => prev === id ? null : id);

  return (
    <div style={{ padding:'22px 24px 56px', flex:1, minHeight:0 }}>
      {/* Page header */}
      <div style={{
        display:'flex', alignItems:'flex-start',
        justifyContent:'space-between', marginBottom:22,
      }}>
        <div>
          <h1 style={{
            fontFamily:"'Inter Tight','Inter',sans-serif",
            fontSize:22, fontWeight:700, color:T.text,
            letterSpacing:'-0.02em', margin:0, lineHeight:1.2,
          }}>ESPP Tracker</h1>
          <div style={{ fontSize:12, color:T.textMuted, marginTop:4 }}>
            Employee Stock Purchase Plan · Company Stock
          </div>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={onImport} style={BtnSecondary}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/>
              <path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3"/>
            </svg>
            Import
          </button>
          <button onClick={onRecordSale} style={BtnPrimary}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="16"/>
              <line x1="8"  y1="12" x2="16" y2="12"/>
            </svg>
            Record Sale
          </button>
        </div>
      </div>

      {/* Year summary strip */}
      <YearSummaryStrip
        year={year}
        onPrev={() => setYear(y => y - 1)}
        onNext={() => setYear(y => y + 1)}
      />

      {/* Batch table */}
      <div style={{ marginTop:20 }}>
        <BatchTable
          batches={ESPP_BATCHES}
          expandedId={expandedId}
          onToggle={toggleRow}
        />
      </div>
    </div>
  );
}

/* ── App ─────────────────────────────────────────────────────────────────── */
function App() {
  const [modal, setModal] = useState(null); // 'import' | 'sale' | null

  return (
    <div style={{
      display:'flex', minHeight:'100vh',
      background:T.pageBg,
      fontFamily:"'Inter','DM Sans',system-ui,sans-serif",
    }}>
      <Sidebar active="ESPP" />

      <div style={{ flex:1, display:'flex', flexDirection:'column', minWidth:0 }}>
        <TopBar />
        <div style={{ flex:1, overflowY:'auto' }}>
          <ESPPPage
            onImport={() => setModal('import')}
            onRecordSale={() => setModal('sale')}
          />
        </div>
      </div>

      {modal === 'import' && <ImportModal onClose={() => setModal(null)} />}
      {modal === 'sale'   && <RecordSaleModal batches={ESPP_BATCHES} onClose={() => setModal(null)} />}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
