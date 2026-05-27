export type EsppBatchRow = {
  id: string;
  householdId: string;
  purchaseDate: string;
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
  ordinaryIncome: number;
  capGainLoss: number;
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
};

export type SaleInput = {
  batchId: string;
  sharesSold: number;
  salePricePerShare: number;
};
