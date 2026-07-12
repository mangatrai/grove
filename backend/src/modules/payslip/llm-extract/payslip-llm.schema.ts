import { z } from "zod";

const nullableStr = z.union([z.string(), z.null()]);
const nullableNum = z.union([z.number(), z.null()]);

const payslipLineItemDatesSchema = z.object({
  start_date: nullableStr,
  end_date: nullableStr,
  raw: nullableStr
});

const payslipLineItemHoursSchema = z.object({
  current: nullableNum,
  ytd: nullableNum
});

/** Canonical line item used in every `line_items` section array. */
const payslipLineItemSchema = z.object({
  name: nullableStr,
  authority: nullableStr,
  description: nullableStr,
  dates: payslipLineItemDatesSchema,
  hours_or_days: payslipLineItemHoursSchema,
  rate: nullableNum,
  amount_current: nullableNum,
  amount_ytd: nullableNum,
  raw_section: nullableStr
});

export type PayslipLineItem = z.infer<typeof payslipLineItemSchema>;

/** Payload returned by the model (matches [payslip.schema.json](payslip.schema.json); no `document_metadata`). */
export const payslipLlmApiResponseSchema = z.object({
  document_type: z.string(),
  source_employer: z.object({
    name: nullableStr,
    legal_entity: nullableStr,
    ein_or_fein: nullableStr,
    address: nullableStr
  }),
  employee: z.object({
    name: nullableStr,
    employee_id: nullableStr,
    personnel_number: nullableStr,
    talent_id: nullableStr,
    address: nullableStr
  }),
  pay_period: z.object({
    start_date: nullableStr,
    end_date: nullableStr,
    pay_date: nullableStr
  }),
  employment_context: z.object({
    rate: nullableNum,
    rate_type: nullableStr,
    cost_center: nullableStr,
    hours_or_days_worked_current: nullableNum,
    hours_or_days_worked_ytd: nullableNum
  }),
  summary: z.object({
    currency: nullableStr,
    gross_pay_current: nullableNum,
    gross_pay_ytd: nullableNum,
    total_earnings_current: nullableNum,
    total_earnings_ytd: nullableNum,
    taxable_earnings_current: nullableNum,
    taxable_earnings_ytd: nullableNum,
    pre_tax_deductions_current: nullableNum,
    pre_tax_deductions_ytd: nullableNum,
    post_tax_deductions_current: nullableNum,
    post_tax_deductions_ytd: nullableNum,
    tax_deductions_current: nullableNum,
    tax_deductions_ytd: nullableNum,
    other_deductions_current: nullableNum,
    other_deductions_ytd: nullableNum,
    other_information_current: nullableNum,
    other_information_ytd: nullableNum,
    net_pay_current: nullableNum,
    net_pay_ytd: nullableNum
  }),
  line_items: z.object({
    earnings: z.array(payslipLineItemSchema),
    pre_tax_deductions: z.array(payslipLineItemSchema),
    post_tax_deductions: z.array(payslipLineItemSchema),
    tax_deductions: z.array(payslipLineItemSchema),
    other_deductions: z.array(payslipLineItemSchema),
    other_information: z.array(payslipLineItemSchema),
    taxable_earnings: z.array(payslipLineItemSchema)
  }),
  tax_profile: z.object({
    marital_status: nullableStr,
    federal_credits: nullableNum,
    state_credits: nullableNum,
    additional_withholding_federal: nullableNum,
    additional_withholding_state: nullableNum
  }),
  payment_information: z.array(
    z.object({
      payment_type: nullableStr,
      bank_name: nullableStr,
      bank_location: nullableStr,
      account_or_check_number_masked: nullableStr,
      amount: nullableNum,
      currency: nullableStr,
      pay_date: nullableStr
    })
  )
});

export type PayslipLlmApiResponse = z.infer<typeof payslipLlmApiResponseSchema>;

export const payslipDocumentMetadataSchema = z.object({
  page_count: z.number().int().nonnegative(),
  parser_source: z.string(),
  extraction_model: z.string(),
  extracted_at: z.string()
});

export type PayslipDocumentMetadata = z.infer<typeof payslipDocumentMetadataSchema>;

/** Full extract after merging server-side metadata. */
export type PayslipLlmExtract = PayslipLlmApiResponse & {
  document_metadata: PayslipDocumentMetadata;
};
