// Grove — Real Estate Mock Data (standalone, no PT1 dependency)
window.RE_MOCK = (() => {

const T = {
  pageBg:'#efebe3', surface:'#fdfcfb', surfaceAlt:'#f5f0e8', border:'#ddd6ce',
  sidebarBg:'#1a2b1f', text:'#1c1917', textMuted:'#78716c', textSecondary:'#57534e',
  forest:'#2d6a4f', forest2:'#4a8a6e', gold:'#c8860a', gold2:'#e0a83a',
  terracotta:'#8b3a26', clay:'#b86b4a', sage:'#7a8a6e',
  accentSubtle:'rgba(45,106,79,0.09)', goldSubtle:'rgba(200,134,10,0.09)',
  terracottaSubtle:'rgba(139,58,38,0.07)',
};

const fmt  = n => n.toLocaleString('en-US', {minimumFractionDigits:0, maximumFractionDigits:0});
const fmtD = n => '$' + fmt(n);
const fmtM = n => n >= 1000000
  ? '$' + (n/1000000).toFixed(2).replace(/\.?0+$/, '') + 'M'
  : n >= 1000 ? '$' + (n/1000).toFixed(0) + 'k' : '$' + fmt(n);

const PROPERTIES = [
  {
    id:'frisco', shortName:'7070 Coulter Lake', tag:'TX', sort:1,
    address:'7070 Coulter Lake Rd', city:'Frisco', state:'TX', zip:'75036',
    county:'Denton County, TX', portal:'DCAD', apn:'R 000000560912',
    appealProcess:'ARB (Appraisal Review Board)',
    propertyType:'Primary Home',
    sqft:4009, beds:4, baths:4.5, yearBuilt:2017, lotSqft:9817, stories:2,
    purchasePrice:785000, purchaseDate:'Aug 2017',
    cadAssessed:1101813, cadLand:284693, cadImprovement:817120,
    avm:994000, avmLow:940000, avmHigh:1048000,
    taxRate:0.02103, taxesDue:23151, monthlyRent:null,
    taxHistory:[
      {year:2026, assessed:1101813, pct:+10.4},
      {year:2025, assessed:998000,  pct:+11.6},
      {year:2024, assessed:894000,  pct:+5.2},
      {year:2023, assessed:850000,  pct:null},
    ],
    protestStatus:'filed', hearingDate:'June 8, 2026', hearingDaysLeft:21,
    filedDate:'May 14, 2026',
  },
  {
    id:'memphis1', shortName:'1842 Autumn Ridge', tag:'TN', sort:2,
    address:'1842 Autumn Ridge Dr', city:'Memphis', state:'TN', zip:'38134',
    county:'Shelby County, TN', portal:'Shelby Assessor', apn:'073053  00028',
    appealProcess:'Board of Equalization',
    propertyType:'Rental',
    sqft:1680, beds:3, baths:2.0, yearBuilt:2004, lotSqft:7200, stories:1,
    purchasePrice:182000, purchaseDate:'Mar 2019', monthlyRent:1650,
    cadAssessed:218500, cadLand:42000, cadImprovement:176500,
    avm:198000, avmLow:188000, avmHigh:212000,
    taxRate:0.0268, taxesDue:5856,
    taxHistory:[
      {year:2026, assessed:218500, pct:+8.2},
      {year:2025, assessed:201900, pct:+4.1},
      {year:2024, assessed:194000, pct:+2.8},
      {year:2023, assessed:188700, pct:null},
    ],
    protestStatus:'not-filed', hearingDate:null, filedDate:null,
  },
  {
    id:'memphis2', shortName:'2910 Millbranch', tag:'TN', sort:3,
    address:'2910 Millbranch Rd', city:'Memphis', state:'TN', zip:'38116',
    county:'Shelby County, TN', portal:'Shelby Assessor', apn:'073040  00092',
    appealProcess:'Board of Equalization',
    propertyType:'Rental',
    sqft:1420, beds:3, baths:1.0, yearBuilt:1968, lotSqft:6800, stories:1,
    purchasePrice:95000, purchaseDate:'Jun 2015', monthlyRent:1150,
    cadAssessed:142000, cadLand:28000, cadImprovement:114000,
    avm:131000, avmLow:122000, avmHigh:140000,
    taxRate:0.0268, taxesDue:3806,
    taxHistory:[
      {year:2026, assessed:142000, pct:+6.8},
      {year:2025, assessed:132900, pct:+3.2},
      {year:2024, assessed:128800, pct:+1.5},
      {year:2023, assessed:126900, pct:null},
    ],
    protestStatus:'not-filed', hearingDate:null, filedDate:null,
  },
];

// Portfolio totals
const PORTFOLIO = {
  totalAVM:     PROPERTIES.reduce((s,p) => s + p.avm, 0),       // 1,323,000
  totalCAD:     PROPERTIES.reduce((s,p) => s + p.cadAssessed, 0), // 1,462,313
  totalTaxes:   PROPERTIES.reduce((s,p) => s + p.taxesDue, 0),   // 32,813
  protestSavings: 2267,    // estimated annual savings from frisco protest
  totalPurchased: PROPERTIES.reduce((s,p) => s + p.purchasePrice, 0), // 1,062,000
  annualRent:   (1650 + 1150) * 12, // 33,600
};

return { T, fmt, fmtD, fmtM, PROPERTIES, PORTFOLIO };
})();
