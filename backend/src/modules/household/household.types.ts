import { z } from "zod";

/** PATCH body: employer line (id optional — server assigns UUID). */
export const employerInputSchema = z.object({
  id: z.string().uuid().optional(),
  displayName: z.string().min(1).max(200),
  parserProfileId: z.string().max(120).optional(),
  parserMapping: z.record(z.string(), z.unknown()).optional(),
  /** Net-pay deposit account for this employer (optional; stored in `employers_json`). */
  salaryDepositFinancialAccountId: z.union([z.string().uuid(), z.null()]).optional()
});

/** Stored employer row always has an id. */
export const employerStubSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string().min(1).max(200),
  parserProfileId: z.string().max(120).optional(),
  parserMapping: z.record(z.string(), z.unknown()).optional(),
  salaryDepositFinancialAccountId: z.union([z.string().uuid(), z.null()]).optional()
});

export type EmployerInput = z.infer<typeof employerInputSchema>;
export type EmployerStub = z.infer<typeof employerStubSchema>;

export const employersPayloadSchema = z.array(employerStubSchema).max(20);
