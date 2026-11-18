/**
 * "Contract Sent" email to the deal's agent, with the contract package
 * attached. Sent from the selected funder's sender identity and branded with
 * that funder's letter logo and colors.
 */
import type { ContractEmailContext } from '../../contractEmailContext';
import { formatContractEmailDate } from '../../contractEmailContext';
import {
  buildContractSentEmailSubject,
  renderContractSentEmailHtml,
} from '../../emailTemplates/contractStatusEmailHtml';

export interface AgentContractSentEmail {
  subject: string;
  html: string;
  /** True when the logo is the Nitro Advance `cid:` image, which must be attached. */
  usesBrandLogoAttachment: boolean;
}

/**
 * `{Book}: {Merchant}: Contract Sent`. Without a book or merchant the contract
 * label ("{Funder} {Business} {$Amount}") stands in.
 */
export function buildAgentContractSentEmail(options: {
  contractLabel: string;
  context: ContractEmailContext;
  signerEmails?: string[] | null;
  attachmentName?: string | null;
}): AgentContractSentEmail {
  const label = String(options.contractLabel || '').trim() || 'Contract';
  const { context } = options;
  const { branding } = context;
  const subject = buildContractSentEmailSubject(
    context.bookName,
    context.bookName || context.merchantName ? context.merchantName : label,
  );
  const html = renderContractSentEmailHtml({
    bookName: context.bookName || label,
    merchantName: context.merchantName || label,
    applicationId: context.applicationNumber,
    fundedAmount: context.fundedAmount,
    sentDate: formatContractEmailDate(new Date()),
    signerEmails: options.signerEmails,
    attachmentName: options.attachmentName,
    companyName: branding.companyName,
    logoSrc: branding.logoSrc,
    brandPrimary: branding.accentDark,
    brandAccent: branding.accentLight,
  });
  return { subject, html, usesBrandLogoAttachment: branding.logoSrc.startsWith('cid:') };
}
