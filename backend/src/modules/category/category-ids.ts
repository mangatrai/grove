/**
 * Default taxonomy from `backend/db/seeds/0001_bootstrap.sql` (household_id NULL).
 * Stable ids for rule engine and tests (includes migration 0032 Entertainment/Banking expansion).
 */
export const DEFAULT_CATEGORY_IDS = {
  // Top-level parents (roll-up only)
  income: "30000000-0000-0000-0000-000000000001",
  taxes: "30000000-0000-0000-0000-000000000111",
  transfers: "30000000-0000-0000-0000-000000000112",
  home: "30000000-0000-0000-0000-000000000102",
  /** Home > HOA Fees */
  homeHoaFees: "30000000-0000-0000-0000-000000000146",
  utilitiesParent: "30000000-0000-0000-0000-000000000117",
  loansParent: "30000000-0000-0000-0000-000000000133",
  travelParent: "30000000-0000-0000-0000-000000000134",
  entertainmentParent: "30000000-0000-0000-0000-000000000152",
  bankingParent: "30000000-0000-0000-0000-000000000153",
  housing: "30000000-0000-0000-0000-000000000002",
  utilitiesEnergy: "30000000-0000-0000-0000-000000000118",
  /** Display name in UI: "City Water" */
  utilitiesWater: "30000000-0000-0000-0000-000000000119",
  utilitiesMobile: "30000000-0000-0000-0000-000000000120",
  utilitiesInternet: "30000000-0000-0000-0000-000000000156",
  groceries: "30000000-0000-0000-0000-000000000004",
  /** Shopping > General merchandise */
  shoppingGeneralMerchandise: "30000000-0000-0000-0000-000000000148",
  shoppingPersonalCare: "30000000-0000-0000-0000-000000000159",
  /** Display name: "Public Transit" */
  transitAndFuel: "30000000-0000-0000-0000-000000000005",
  publicTransit: "30000000-0000-0000-0000-000000000005",
  /** Display name: "Auto Maintenance" */
  autoMaintenance: "30000000-0000-0000-0000-000000000129",
  mobilityTaxi: "30000000-0000-0000-0000-000000000141",
  mobilityFuel: "30000000-0000-0000-0000-000000000154",
  mobilityEvCharging: "30000000-0000-0000-0000-000000000155",
  /** Mobility > Parking & Tolls */
  mobilityParkingAndTolls: "30000000-0000-0000-0000-000000000166",
  creditCardPayments: "30000000-0000-0000-0000-000000000006",
  loanPayments: "30000000-0000-0000-0000-000000000121",
  personalLending: "30000000-0000-0000-0000-000000000122",

  // Income leaves (Epic 5.3 hierarchy + taxonomy expansions, migration 0008)
  incomeSalary: "30000000-0000-0000-0000-000000000007",
  incomeInterest: "30000000-0000-0000-0000-000000000011",
  incomeDividends: "30000000-0000-0000-0000-000000000012",
  incomeRentalIncome: "30000000-0000-0000-0000-000000000010",
  incomeRefunds: "30000000-0000-0000-0000-000000000013",
  /** Income > Reimbursements */
  incomeReimbursements: "30000000-0000-0000-0000-000000000151",

  medical: "30000000-0000-0000-0000-000000000020",
  healthcareDental: "30000000-0000-0000-0000-000000000162",
  pharmacy: "30000000-0000-0000-0000-000000000021",
  fitness: "30000000-0000-0000-0000-000000000022",
  wellness: "30000000-0000-0000-0000-000000000125",
  diningOut: "30000000-0000-0000-0000-000000000023",
  coffee: "30000000-0000-0000-0000-000000000024",
  snacks: "30000000-0000-0000-0000-000000000124",

  educationCamps: "30000000-0000-0000-0000-000000000135",
  homeAppliances: "30000000-0000-0000-0000-000000000136",
  shoppingElectronic: "30000000-0000-0000-0000-000000000142",
  /** Shopping > Software (SaaS / subscriptions — global default category) */
  shoppingSoftware: "30000000-0000-0000-0000-000000000165",
  /** Shopping > Office */
  shoppingOffice: "30000000-0000-0000-0000-000000000167",

  loansAuto: "30000000-0000-0000-0000-000000000137",
  loansHeloc: "30000000-0000-0000-0000-000000000138",
  loansHome: "30000000-0000-0000-0000-000000000139",
  loansPersonal: "30000000-0000-0000-0000-000000000140",

  /** Investments parent (roll-up) */
  investmentsParent: "30000000-0000-0000-0000-000000000105",
  /** Investments > IRA */
  investmentsIra: "30000000-0000-0000-0000-000000000147",
  investmentsStocks: "30000000-0000-0000-0000-000000000009",
  investmentsFiveTwentyNinePlan: "30000000-0000-0000-0000-000000000126",
  investmentsCrypto: "30000000-0000-0000-0000-000000000128",

  travelAirfare: "30000000-0000-0000-0000-000000000143",
  travelCarRental: "30000000-0000-0000-0000-000000000144",
  travelHotel: "30000000-0000-0000-0000-000000000145",
  travelDocuments: "30000000-0000-0000-0000-000000000157",
  travelCruise: "30000000-0000-0000-0000-000000000158",

  entertainmentStreaming: "30000000-0000-0000-0000-000000000160",
  entertainmentMovies: "30000000-0000-0000-0000-000000000161",
  bankingFees: "30000000-0000-0000-0000-000000000164",

  // Taxes leaves (migration 0008 + 0027)
  federalIncomeTax: "30000000-0000-0000-0000-000000000113",
  stateIncomeTax: "30000000-0000-0000-0000-000000000130",
  salesTax: "30000000-0000-0000-0000-000000000114",
  federalTaxRefund: "30000000-0000-0000-0000-000000000131",
  stateTaxRefund: "30000000-0000-0000-0000-000000000132",
  taxesPropertyTax: "30000000-0000-0000-0000-000000000149",
  taxesTaxPrep: "30000000-0000-0000-0000-000000000150",

  // Transfers leaves (added in migration 0008)
  transfersIn: "30000000-0000-0000-0000-000000000115",
  transfersOut: "30000000-0000-0000-0000-000000000116",
  transfersCashWithdrawal: "30000000-0000-0000-0000-000000000163",

  /** Insurance leaves; display names: Home, Auto, Health, Life, Other */
  insuranceHome: "30000000-0000-0000-0000-000000000025",
  insuranceAuto: "30000000-0000-0000-0000-000000000026",
  healthInsurance: "30000000-0000-0000-0000-000000000031",
  lifeInsurance: "30000000-0000-0000-0000-000000000032",
  otherInsurance: "30000000-0000-0000-0000-000000000033",

  /** @deprecated Use `utilitiesEnergy`, `utilitiesWater`, or `utilitiesMobile`. */
  utilities: "30000000-0000-0000-0000-000000000118",
  /** @deprecated Use `creditCardPayments` or `loanPayments`. */
  debtPayments: "30000000-0000-0000-0000-000000000006",
  /** @deprecated Use `federalIncomeTax`. */
  taxPayments: "30000000-0000-0000-0000-000000000113",
  /** @deprecated Use `coffee`. */
  coffeeSnacks: "30000000-0000-0000-0000-000000000024",
  /** @deprecated Use `publicTransit` / `transitAndFuel`. */
  transport: "30000000-0000-0000-0000-000000000005"
} as const;
