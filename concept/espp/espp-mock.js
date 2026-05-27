/* Grove — ESPP Tracker · Mock Data
 * Purchase batches from EquatePlus + computed sale history.
 * Numbers verified: OI + CapGain = Realized G/L on every row.
 */

const ESPP_BATCHES = [
  {
    id: 'b1',
    purchaseDate: 'Jan 15, 2025',
    sharesGranted: 52,
    fmv: 185.00,
    costBasis: 157.25,     // 85% of FMV
    discount: 27.75,       // 15% discount
    transferred: 52,
    outstanding: 0,
    sold: 52,
    held: 0,
    status: 'Fully Sold',
    sales: [
      // OI = discount × qty; CG = (price − fmv) × qty
      { date: 'Apr 3, 2025',  qty: 30, price: 196.40, proceeds: 5892.00, oi: 832.50,  cg: 341.40 },
      { date: 'Jun 20, 2025', qty: 22, price: 201.80, proceeds: 4439.60, oi: 610.50,  cg: 369.60 },
    ],
  },
  {
    id: 'b2',
    purchaseDate: 'Jul 15, 2025',
    sharesGranted: 48,
    fmv: 198.40,
    costBasis: 168.64,
    discount: 29.76,
    transferred: 48,
    outstanding: 0,
    sold: 30,
    held: 18,
    status: 'Partially Sold',
    sales: [
      { date: 'Oct 15, 2025', qty: 15, price: 208.50, proceeds: 3127.50, oi: 446.40, cg: 151.50 },
      { date: 'Dec 3, 2025',  qty: 15, price: 215.20, proceeds: 3228.00, oi: 446.40, cg: 252.00 },
    ],
  },
  {
    id: 'b3',
    purchaseDate: 'Jan 15, 2026',
    sharesGranted: 45,
    fmv: 212.80,
    costBasis: 180.88,
    discount: 31.92,
    transferred: 45,
    outstanding: 0,
    sold: 12,
    held: 33,
    status: 'Partially Sold',
    sales: [
      { date: 'Mar 5, 2026',  qty: 12, price: 218.50, proceeds: 2622.00, oi: 383.04, cg: 68.40 },
    ],
  },
];

// Year-level summaries (only years with data)
const ESPP_SUMMARY = {
  2026: {
    purchased: 45, transferred: 45, outstanding: 0, sold: 12,
    invested:   8139.60,   // 45 × $180.88
    discount:   1436.40,   // 45 × $31.92
    proceeds:   2622.00,   // 12 × $218.50
    realized:    451.44,   // proceeds − (12 × cost)  = 2622 − 2170.56
    oi:          383.04,   // 12 × $31.92  (ordinary income)
    capGain:      68.40,   // 12 × ($218.50 − $212.80)
  },
  2025: {
    purchased: 100, transferred: 100, outstanding: 0, sold: 82,
    invested:  16271.72,  // (52 × 157.25) + (48 × 168.64)
    discount:   2871.48,  // (52 × 27.75) + (48 × 29.76)
    proceeds:  16687.10,  // all 2025 sales
    realized:   3450.90,
    oi:         2335.80,
    capGain:    1115.10,
  },
};
