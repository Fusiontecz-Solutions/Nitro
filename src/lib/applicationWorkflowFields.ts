/** Agent intake extras sent with the create payload (ISO link, notes, new-client details). */
export interface ApplicationWorkflowFieldValues {
  isoId: string;
  note: string;
  newBusinessEmail: string;
  newOwnerEmail: string;
  newOwnerPhone: string;
  newBusinessAddress1: string;
  newBusinessCity: string;
  newBusinessState: string;
  newBusinessZipCode: string;
  newBusinessMonthlyRevenue: string;
}

export const EMPTY_WORKFLOW_FIELDS: ApplicationWorkflowFieldValues = {
  isoId: "",
  note: "",
  newBusinessEmail: "",
  newOwnerEmail: "",
  newOwnerPhone: "",
  newBusinessAddress1: "",
  newBusinessCity: "",
  newBusinessState: "",
  newBusinessZipCode: "",
  newBusinessMonthlyRevenue: "",
};
