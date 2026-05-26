// Grove — PT-1 Property Tax Protest Mock Data
window.PT1_MOCK = (() => {

const T = {
  pageBg:'#efebe3', surface:'#fdfcfb', surfaceAlt:'#f5f0e8', border:'#ddd6ce',
  sidebarBg:'#1a2b1f', text:'#1c1917', textMuted:'#78716c', textSecondary:'#57534e',
  forest:'#2d6a4f', forest2:'#4a8a6e', gold:'#c8860a', gold2:'#e0a83a',
  terracotta:'#8b3a26', clay:'#b86b4a', sage:'#7a8a6e', stone:'#6b6358',
  accentSubtle:'rgba(45,106,79,0.09)', goldSubtle:'rgba(200,134,10,0.09)',
  terracottaSubtle:'rgba(139,58,38,0.07)',
};

const fmt  = n => n.toLocaleString('en-US', {minimumFractionDigits:0,maximumFractionDigits:0});
const fmtD = n => '$' + fmt(n);
const fmtM = n => n >= 1000000 ? '$' + (n/1000000).toFixed(3).replace(/0+$/, '').replace(/\.$/, '') + 'M'
                 : n >= 1000    ? '$' + (n/1000).toFixed(0) + 'k'
                 : '$' + fmt(n);
const fmtPct = (n, showSign=false) => (showSign && n>0 ? '+' : '') + n.toFixed(1) + '%';

const PROPERTIES = [
  {
    id:'frisco', shortName:'7070 Coulter Lake', tag:'TX',
    address:'7070 Coulter Lake Rd', city:'Frisco', state:'TX', zip:'75036',
    county:'Denton County, TX', portal:'DCAD', pid:560912, apn:'R 000000560912',
    appealProcess:'ARB (Appraisal Review Board)',
    propertyType:'Primary Home',
    sqft:4009, beds:4, baths:4.5, yearBuilt:2017, lotSqft:9817, stories:2,
    cadAssessed:1101813, cadLand:284693, cadImprovement:817120,
    avm:994000, avmLow:940000, avmHigh:1048000,
    taxRate:0.02103, taxesDue:23151,
    taxHistory:[
      {year:2026, assessed:1101813, pct:+10.4},
      {year:2025, assessed:998000,  pct:+11.6},
      {year:2024, assessed:894000,  pct:+5.2},
      {year:2023, assessed:850000,  pct:null},
    ],
    purchasePrice:785000, purchaseDate:'Aug 2017',
    protestStatus:'filed',
    hearingDate:'June 8, 2026', hearingDaysLeft:21,
    filedDate:'May 14, 2026',
    protestGoal:1020000, cadCounterExpected:1080000,
    protestHistory:[
      {year:2025, noticed:1020000, grounds:'Unequal Appraisal', settled:998000, taxSavings:462},
      {year:2024, noticed:920000,  grounds:'Market Value',       settled:894000, taxSavings:546},
    ],
  },
  {
    id:'memphis1', shortName:'1842 Autumn Ridge', tag:'TN',
    address:'1842 Autumn Ridge Dr', city:'Memphis', state:'TN', zip:'38134',
    county:'Shelby County, TN', portal:'Shelby Assessor', pid:null, apn:'073053  00028',
    appealProcess:'Board of Equalization',
    propertyType:'Rental',
    sqft:1680, beds:3, baths:2.0, yearBuilt:2004, lotSqft:7200, stories:1,
    cadAssessed:218500, cadLand:42000, cadImprovement:176500,
    avm:198000, avmLow:188000, avmHigh:212000,
    taxRate:0.0268, taxesDue:5856,
    purchasePrice:182000, purchaseDate:'Mar 2019', monthlyRent:1650,
    taxHistory:[
      {year:2026, assessed:218500, pct:+8.2},
      {year:2025, assessed:201900, pct:+4.1},
    ],
    protestStatus:'not-filed', hearingDate:null, filedDate:null,
    protestHistory:[],
  },
  {
    id:'memphis2', shortName:'2910 Millbranch', tag:'TN',
    address:'2910 Millbranch Rd', city:'Memphis', state:'TN', zip:'38116',
    county:'Shelby County, TN', portal:'Shelby Assessor', pid:null, apn:'073040  00092',
    appealProcess:'Board of Equalization',
    propertyType:'Rental',
    sqft:1420, beds:3, baths:1.0, yearBuilt:1968, lotSqft:6800, stories:1,
    cadAssessed:142000, cadLand:28000, cadImprovement:114000,
    avm:131000, avmLow:122000, avmHigh:140000,
    taxRate:0.0268, taxesDue:3806,
    purchasePrice:95000, purchaseDate:'Jun 2015', monthlyRent:1150,
    taxHistory:[
      {year:2026, assessed:142000, pct:+6.8},
      {year:2025, assessed:132900, pct:+3.2},
    ],
    protestStatus:'not-filed', hearingDate:null, filedDate:null,
    protestHistory:[],
  },
];

const FRISCO_COMPS = [
  {key:'c1', address:'7105 Enchanted Lake Ln', sqft:3842, beds:4, baths:4.0, built:2016, lotSqft:8940,
   soldPrice:965000, soldDate:'Jan 15, 2026', ppsqft:251, cadAssessed:892400, cadPpsqft:232, match:'High'},
  {key:'c2', address:'7008 Crystal Lake Dr',   sqft:4156, beds:4, baths:4.5, built:2018, lotSqft:10200,
   soldPrice:1020000, soldDate:'Mar 8, 2026',  ppsqft:245, cadAssessed:934000, cadPpsqft:225, match:'High'},
  {key:'c3', address:'6940 Heritage Lake Dr',  sqft:3975, beds:4, baths:4.0, built:2017, lotSqft:9400,
   soldPrice:975000,  soldDate:'Feb 22, 2026', ppsqft:245, cadAssessed:918000, cadPpsqft:231, match:'High'},
  {key:'c4', address:'7122 Parkway Glen Dr',   sqft:4250, beds:5, baths:4.5, built:2019, lotSqft:10800,
   soldPrice:1055000, soldDate:'Dec 3, 2025',  ppsqft:248, cadAssessed:972000, cadPpsqft:229, match:'Med'},
  {key:'c5', address:'7015 Coulter Pkwy',      sqft:3680, beds:4, baths:3.5, built:2016, lotSqft:8200,
   soldPrice:942000,  soldDate:'Mar 14, 2026', ppsqft:256, cadAssessed:851000, cadPpsqft:231, match:'Med'},
  {key:'c6', address:'7201 Clear Lake Ct',     sqft:4120, beds:4, baths:4.0, built:2018, lotSqft:9600,
   soldPrice:998000,  soldDate:'Jan 28, 2026', ppsqft:242, cadAssessed:946000, cadPpsqft:230, match:'High'},
];

const SUBJECT        = PROPERTIES[0];
const SUB_PPSQFT     = Math.round(SUBJECT.cadAssessed / SUBJECT.sqft); // 275
const COMP_MED_PPSQFT = 230;
const COMP_MED_SOLD  = 986500;
const COMP_SOLD_RNG  = [942000, 1055000];
const OVERASSESS     = SUBJECT.cadAssessed - SUBJECT.avm; // 107813
const OVER_PCT       = ((SUBJECT.cadAssessed / SUBJECT.avm) - 1) * 100; // 10.84
const UNQ_GAP_PPSQFT = SUB_PPSQFT - COMP_MED_PPSQFT; // 45
const UNQ_GAP_PCT    = (UNQ_GAP_PPSQFT / COMP_MED_PPSQFT) * 100; // 19.6
const EST_SAVINGS    = Math.round(OVERASSESS * SUBJECT.taxRate); // 2267

const LLM = {
  generatedAt:'May 18, 2026 9:14 AM',
  caseStrength:8.5,
  targetValue:1018000, targetLow:994000, targetHigh:1040000,
  estSavingsMid:1757, estSavingsLow:1334, estSavingsHigh:2274,
  strategies:[
    {
      label:'Unequal Appraisal', strength:9.0,
      tag:'Primary · Tex. Tax Code §41.43',
      text:'Your property is assessed at $275/sqft — 19.6% above the median $230/sqft for 6 comparable nearby properties, using the county\'s own appraisal records. The county cannot dispute its own numbers. Lead with this.',
      comps:['7008 Crystal Lake Dr','6940 Heritage Lake Dr','7201 Clear Lake Ct'],
      draft:'Pursuant to Texas Tax Code §41.43, the subject property at 7070 Coulter Lake Rd is appraised at $1,101,813 ($274.84/sqft) while six comparable properties within 0.5 miles — averaging 4,006 sqft, built 2016–2019 — carry a median CAD assessment of $230/sqft. This 19.6% discrepancy, computed entirely from the district\'s own appraisal roll, constitutes unequal appraisal. We request the appraised value be reduced to $1,020,000 ($254.43/sqft) to achieve equitable treatment with neighboring assessments.',
    },
    {
      label:'Market Value', strength:7.5,
      tag:'Secondary · Tex. Tax Code §41.41',
      text:'Six sold comps (Oct 2025–Mar 2026) range $942k–$1.055M with a median of $986,500. The assessed value of $1.102M is 11.8% above median sold price — a solid independent argument.',
      comps:['7008 Crystal Lake Dr','7201 Clear Lake Ct','6940 Heritage Lake Dr'],
      draft:'The subject property\'s 2026 CAD assessed value of $1,101,813 exceeds its fair market value. Six comparable sold properties within 0.5 miles, sold between October 2025 and March 2026, demonstrate a market value range of $942,000–$1,055,000 with a median of $986,500. The assessed value should be reduced to no more than $994,000 (the Redfin AVM), consistent with comparable sales evidence.',
    },
  ],
  flags:[
    '7122 Parkway Glen Dr has 5 beds vs. your 4 — exclude from lead argument if challenged.',
    'CAD may offer $1,080k informally. Anchor your counter-offer at $994k.',
    'Texas ARBs respond well to printed packets — bring 3 copies to the June 8 hearing.',
  ],
};

return {
  T, fmt, fmtD, fmtM, fmtPct,
  PROPERTIES, FRISCO_COMPS,
  SUBJECT, SUB_PPSQFT, COMP_MED_PPSQFT, COMP_MED_SOLD, COMP_SOLD_RNG,
  OVERASSESS, OVER_PCT, UNQ_GAP_PPSQFT, UNQ_GAP_PCT, EST_SAVINGS,
  LLM,
};
})();
