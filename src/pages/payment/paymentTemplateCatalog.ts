export type TemplateCategory = "contract" | "email" | "letter";

export type TemplateItem = {
  id: string;
  name: string;
  category: TemplateCategory;
  variables: string[];
  body: string;
  status: string;
  lastEdited: string;
};

/** Shared catalog for Templates management and Letters composer. */
export const PAYMENT_TEMPLATE_CATALOG: TemplateItem[] = [
  {
    id: "tpl-1",
    name: "Purchase Agreement",
    category: "contract",
    variables: [
      "{{merchant_name}}",
      "{{business_name}}",
      "{{advance_amount}}",
      "{{factor_rate}}",
      "{{payback_amount}}",
      "{{daily_payment}}",
      "{{term_months}}",
    ],
    body: 'This Purchase Agreement is entered into between FusionMCA ("Purchaser") and {{merchant_name}} ("Merchant"), operating as {{business_name}}.\n\nPurchaser agrees to purchase future receivables in the amount of {{advance_amount}} at a factor rate of {{factor_rate}}, for a total payback of {{payback_amount}}.\n\nDaily payment shall be {{daily_payment}} for an estimated term of {{term_months}} months.\n\nMerchant acknowledges this is not a loan but a purchase of future receivables.',
    status: "active",
    lastEdited: "2026-03-10",
  },
  {
    id: "tpl-2",
    name: "Personal Guarantee",
    category: "contract",
    variables: [
      "{{merchant_name}}",
      "{{owner_ssn_last4}}",
      "{{advance_amount}}",
    ],
    body: "I, {{merchant_name}}, personally guarantee the obligations of the business under the Purchase Agreement for the advance amount of {{advance_amount}}.\n\nSSN (last 4): {{owner_ssn_last4}}\n\nI understand that this guarantee survives any default.",
    status: "active",
    lastEdited: "2026-03-08",
  },
  {
    id: "tpl-3",
    name: "Welcome Email",
    category: "email",
    variables: [
      "{{merchant_name}}",
      "{{business_name}}",
      "{{agent_name}}",
      "{{advance_amount}}",
    ],
    body: "Dear {{merchant_name}},\n\nWelcome to FusionMCA! Your application for {{business_name}} has been received.\n\nYour agent {{agent_name}} will guide you through the process. Requested advance: {{advance_amount}}.\n\nBest regards,\nFusionMCA Operations",
    status: "active",
    lastEdited: "2026-03-12",
  },
  {
    id: "tpl-4",
    name: "Funding Confirmation",
    category: "email",
    variables: [
      "{{merchant_name}}",
      "{{advance_amount}}",
      "{{daily_payment}}",
      "{{funded_date}}",
    ],
    body: "Dear {{merchant_name}},\n\nGreat news! Your merchant cash advance of {{advance_amount}} has been funded on {{funded_date}}.\n\nYour daily payment of {{daily_payment}} will begin in 2 business days.\n\nThank you for choosing FusionMCA.",
    status: "active",
    lastEdited: "2026-03-14",
  },
  {
    id: "tpl-5",
    name: "Missed Payment Notice",
    category: "email",
    variables: [
      "{{merchant_name}}",
      "{{missed_date}}",
      "{{daily_payment}}",
      "{{remaining_balance}}",
    ],
    body: "Dear {{merchant_name}},\n\nWe were unable to process your scheduled payment of {{daily_payment}} on {{missed_date}}.\n\nYour remaining balance is {{remaining_balance}}. Please ensure sufficient funds are available.\n\nRegards,\nFusionMCA Collections",
    status: "active",
    lastEdited: "2026-03-16",
  },
  {
    id: "tpl-6",
    name: "Payoff Confirmation",
    category: "email",
    variables: [
      "{{merchant_name}}",
      "{{payoff_amount}}",
      "{{payoff_date}}",
    ],
    body: "Dear {{merchant_name}},\n\nThis confirms your account has been paid in full as of {{payoff_date}}. Total payoff: {{payoff_amount}}.\n\nThank you for your business.\n\nBest,\nFusionMCA",
    status: "active",
    lastEdited: "2026-03-18",
  },
  {
    id: "tpl-letter-payoff",
    name: "Payoff Statement",
    category: "letter",
    variables: [
      "{{merchant_name}}",
      "{{deal_id}}",
      "{{as_of_date}}",
      "{{original_funded}}",
      "{{total_repayment}}",
      "{{total_paid}}",
      "{{payoff_balance}}",
    ],
    body: `Attn: {{merchant_name}}

Dear {{merchant_name}},

RE: Payoff Statement — Deal #{{deal_id}}

This letter serves as a formal payoff statement for your Merchant Cash Advance agreement. As of {{as_of_date}}, the following amounts reflect your current obligation:

────────────────────────────────────
Original Funded Amount:  {{original_funded}}
Total Repayment Amount: {{total_repayment}}
Total Paid to Date:     {{total_paid}}
Payoff Balance Due:     {{payoff_balance}}
────────────────────────────────────

This payoff amount is valid for 10 business days from the date of this letter unless otherwise agreed in writing.

This document was auto-generated for your records.`,
    status: "active",
    lastEdited: "2026-03-19",
  },
  {
    id: "tpl-letter-default",
    name: "Default / Acceleration Notice",
    category: "letter",
    variables: [
      "{{merchant_name}}",
      "{{business_name}}",
      "{{deal_id}}",
      "{{default_date}}",
      "{{outstanding_balance}}",
    ],
    body: `Attn: {{merchant_name}}

Dear {{merchant_name}},

RE: Notice of Default — {{business_name}} — Deal #{{deal_id}}

We are writing regarding your Merchant Cash Advance agreement. As of {{default_date}}, we have determined that an event of default has occurred under the terms of your agreement.

Outstanding balance (as of this notice): {{outstanding_balance}}

Please contact our office within five (5) business days to discuss remediation. Failure to respond may result in further collection activity as permitted by your agreement.

Sincerely,
FusionMCA Legal & Collections`,
    status: "active",
    lastEdited: "2026-03-20",
  },
];

export const TEMPLATE_CATEGORY_LABELS: Record<TemplateCategory, string> = {
  contract: "Contract",
  email: "Email",
  letter: "Letter",
};
