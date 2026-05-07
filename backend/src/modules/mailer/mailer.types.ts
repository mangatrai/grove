export interface EmailTemplate {
  subject: string;
  html: string;
  text: string;
}

export interface MailPayload extends EmailTemplate {
  to: string;
}
