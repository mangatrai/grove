export type CadProperty = {
  cadPropertyId: string;
  accountId: number | null;
  address: string | null;
  city: string | null;
  assessedValue: number | null;
  marketValue: number | null;
  landValue: number | null;
  sqft: number | null;
  beds: number | null;
  baths: number | null;
  yearBuilt: number | null;
  owner: string | null;
  legalDescription: string | null;
  apn: string | null;
  raw: Record<string, unknown>;
};

export type CadValueHistoryEntry = {
  year: number;
  marketValue: number | null;
  assessedValue: number | null;
  landValue: number | null;
  improvementValue: number | null;
};

export type CadAppealEntry = {
  year: string | null;
  status: string | null;
  hearingDate: string | null;
  filedDate: string | null;
  raw: Record<string, unknown>;
};

export interface CadAdapter {
  readonly provider: string;
  readonly state: string;
  readonly county: string;

  searchByAddress(address: string, taxYear: number): Promise<CadProperty[]>;
  getById(cadPropertyId: string, taxYear: number): Promise<CadProperty | null>;
  getValueHistory(accountId: number): Promise<CadValueHistoryEntry[]>;
  getTaxable(accountId: number): Promise<Record<string, unknown>[]>;
  getAppeal(accountId: number): Promise<CadAppealEntry[]>;
}
