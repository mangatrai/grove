import {
  searchDCADByAddress,
  getDCADPropertyById,
  getDCADValueHistory,
  getDCADTaxable,
  getDCADAppeal,
  type DCADProperty,
} from "../dcad.service.js";
import type { CadAdapter, CadAppealEntry, CadProperty, CadValueHistoryEntry } from "./cad-adapter.types.js";

function toCADProperty(p: DCADProperty): CadProperty {
  return {
    cadPropertyId: p.dcadPropertyId,
    accountId: p.pAccountId,
    address: p.address,
    city: p.city,
    assessedValue: p.assessedValue,
    marketValue: p.marketValue,
    landValue: p.landValue,
    sqft: p.sqft,
    beds: p.beds,
    baths: p.baths,
    yearBuilt: p.yearBuilt,
    owner: p.owner,
    legalDescription: p.legalDescription,
    apn: p.apn,
    raw: p.raw,
  };
}

export class DcadAdapter implements CadAdapter {
  readonly provider = "dcad";
  readonly state = "TX";
  readonly county = "Denton";

  async searchByAddress(address: string, taxYear: number): Promise<CadProperty[]> {
    const results = await searchDCADByAddress(address, taxYear, null);
    return results.map(toCADProperty);
  }

  async getById(cadPropertyId: string, taxYear: number): Promise<CadProperty | null> {
    const result = await getDCADPropertyById(cadPropertyId, taxYear, null);
    return result ? toCADProperty(result) : null;
  }

  async getValueHistory(accountId: number): Promise<CadValueHistoryEntry[]> {
    return getDCADValueHistory(accountId, null);
  }

  async getTaxable(accountId: number): Promise<Record<string, unknown>[]> {
    return getDCADTaxable(accountId, null);
  }

  async getAppeal(accountId: number): Promise<CadAppealEntry[]> {
    return getDCADAppeal(accountId, null);
  }
}
