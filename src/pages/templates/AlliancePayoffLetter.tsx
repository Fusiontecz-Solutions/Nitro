import type { TemplateVariable } from "./types";
import { PAY_OFF_LETTER_VARIABLES } from "./PayOffLetter";
import { createHtmlTemplatePreview } from "./HtmlTemplatePreview";
import { renderAlliancePayoffLetterHtml } from "./Allicance_Payoff_Letterhtml";

/** Same merge fields as Katan payoff — Alliance bank details are the defaults. */
export const ALLIANCE_PAYOFF_LETTER_VARIABLES: TemplateVariable[] =
  PAY_OFF_LETTER_VARIABLES;

const AlliancePayoffLetter = createHtmlTemplatePreview(
  renderAlliancePayoffLetterHtml,
  "Alliance payoff letter preview",
);

export default AlliancePayoffLetter;
