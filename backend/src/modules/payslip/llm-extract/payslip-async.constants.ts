/** `import_file.payslip_async_provider` when queued for LLM vision + JSON-schema extract (provider per `LLM_PROVIDER`). */
export const LLM_PAYSLIP_PROVIDER = "llm_payslip" as const;

export type PayslipAsyncProviderId = typeof LLM_PAYSLIP_PROVIDER;
