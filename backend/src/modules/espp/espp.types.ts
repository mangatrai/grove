export type EsppBatchRow = {
  id: string;
  householdId: string;
  purchaseDate: string;
  offeringDate: string;
  sharesGranted: number;
  fmvPerShare: number | null;
  costBasisPerShare: number;
  discountPerShare: number | null;
  sharesTransferred: number;
  payslipId: string | null;
  esppDiscountPayslip: number | null;
  esppSalaryDeduction: number | null;
  esppOtherDeduction: number | null;
  createdAt: string;
  updatedAt: string;
};

export type EsppSaleRow = {
  id: string;
  batchId: string;
  householdId: string;
  saleDate: string;
  sharesSold: number;
  salePricePerShare: number;
  proceeds: number;
  dispositionType: 'qualifying' | 'disqualifying' | null;
  ordinaryIncome: number | null;
  capGainLoss: number | null;
  createdAt: string;
};

export type EsppBatchWithSales = EsppBatchRow & {
  sharesSold: number;
  held: number;
  status: 'Unsold' | 'Partially Sold' | 'Fully Sold';
  sales: EsppSaleRow[];
};

export type EsppYearSummary = {
  year: number;
  sharesPurchased: number;
  sharesTransferred: number;
  sharesSold: number;
  totalInvested: number;
  discountReceivedYtd: number;
  saleProceeds: number;
  realizedGainLoss: number;
  ordinaryIncomeYtd: number;
  capGainLossYtd: number;
  pendingOfferingFmvCount: number;
};

export type SaleInput = {
  batchId: string;
  sharesSold: number;
  salePricePerShare: number;
};

export type EsppOfferingPeriod = {
  id: string;
  householdId: string;
  offeringDate: string;
  fmvPerShare: number | null;
  createdAt: string;
  updatedAt: string;
};

export type EsppTaxReportRow = {
  batchId: string;
  saleId: string;
  description: string;
  offeringDate: string;
  offeringFmv: number | null;
  dateAcquired: string;
  dateSold: string;
  term: 'Short-term' | 'Long-term';
  dispositionType: 'qualifying' | 'disqualifying';
  sharesSold: number;
  proceeds: number;
  brokerBasis: number;
  ordinaryIncome: number | null;
  adjustedBasis: number | null;
  capGainLoss: number | null;
  w2Status: string;
  needsReview: boolean;
};

export type EsppTaxReportSummary = {
  year: number;
  totalProceeds: number;
  totalBrokerBasis: number;
  totalOrdinaryIncomeInW2: number;
  totalOrdinaryIncomeSelfReport: number;
  totalShortTermGainLoss: number;
  totalLongTermGainLoss: number;
  needsReviewCount: number;
};
