export interface YearSummaryCategory {
  name: string;
  amount: number;
  pct: number;
}

export interface YearSummaryInvestments {
  start: number;
  end: number;
  growth: number;
  growthPct: number;
}

export interface YearSummaryPayslipData {
  totalGrossYtd: number;
  federalTaxYtd: number;
  stateTaxYtd: number;
  socialSecurityYtd: number;
  medicareTaxYtd: number;
  totalTaxYtd: number;
  effectiveFederalRatePct: number;
  effectiveTotalRatePct: number;
  preTaxContributionsYtd: number;
  postTaxContributionsYtd: number;
}

export interface YearSummaryData {
  year: number;
  householdName: string;
  income: number;
  spending: number;
  netSavings: number;
  savingsRate: number;
  monthlyIncome: number[];
  monthlySpending: number[];
  topCategories: YearSummaryCategory[];
  bestMonth: { month: string; netSavings: number };
  worstMonth: { month: string; netSavings: number };
  netWorthStart: number;
  netWorthEnd: number;
  netWorthChange: number;
  netWorthChangePct: number;
  investments: YearSummaryInvestments | null;
  otherSavings: number;
  largestTransaction: { amount: number; description: string; date: string; category: string | null } | null;
  topMerchant: { name: string; visits: number; totalSpent: number; avgPerVisit: number } | null;
  priorYear: { income: number; spending: number; netSavings: number; savingsRate: number } | null;
  payslip: YearSummaryPayslipData | null;
}

export interface YearSummaryResponse {
  year: number;
  data: YearSummaryData;
  narrative: string[];
  generatedAt: string;
  fromCache: boolean;
}
