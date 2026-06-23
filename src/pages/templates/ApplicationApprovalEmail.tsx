import { APP_LOGO_SRC } from "@/constants/appLogo";
import type { TemplateComponentProps, TemplateVariable } from "./types";
import { pick } from "./types";
import {
  CLIENT_PROVIDED_STIPS,
  COMPANY_HANDLED_STIPS,
  resolveApplicationApprovalEmailFields,
} from "./applicationApprovalEmailShared";

export const APPLICATION_APPROVAL_EMAIL_VARIABLES: TemplateVariable[] = [
  {
    key: "client_name",
    label: "Client / ISO name",
    placeholder: "John Doe",
    defaultValue: "John Doe",
  },
  {
    key: "company_name",
    label: "Company name",
    placeholder: "Kinsen LLC",
    defaultValue: "Kinsen LLC",
  },
  {
    key: "view_application_url",
    label: "View application URL",
    placeholder: "https://example.com/applications/123",
  },
  {
    key: "calculate_approval_url",
    label: "Calculate approval URL",
    placeholder: "https://example.com/public/application/approval/token",
  },
];

const v = APPLICATION_APPROVAL_EMAIL_VARIABLES.reduce<
  Record<string, TemplateVariable>
>((acc, variable) => {
  acc[variable.key] = variable;
  return acc;
}, {});

const emailFont =
  "'Helvetica Neue', Helvetica, Arial, sans-serif" as const;

function EmailCtaButton({
  href,
  label,
  fontSize = "14px",
}: {
  href: string;
  label: string;
  fontSize?: string;
}) {
  return (
    <table
      role="presentation"
      border={0}
      cellPadding={0}
      cellSpacing={0}
      style={{ margin: "16px 0" }}
    >
      <tbody>
        <tr>
          <td
            align="center"
            style={{ borderRadius: 5, backgroundColor: "#3b7ab0" }}
          >
            <a
              href={href}
              style={{
                display: "inline-block",
                padding: "10px 20px",
                color: "#ffffff",
                fontSize,
                fontWeight: "bold",
                textDecoration: "none",
              }}
            >
              {label}
            </a>
          </td>
        </tr>
      </tbody>
    </table>
  );
}

export default function ApplicationApprovalEmail({
  values,
}: TemplateComponentProps) {
  const fields = resolveApplicationApprovalEmailFields({
    client_name: pick(values, v.client_name),
    company_name: pick(values, v.company_name),
    view_application_url: pick(values, v.view_application_url),
    calculate_approval_url: pick(values, v.calculate_approval_url),
  });

  return (
    <table
      role="presentation"
      border={0}
      cellPadding={0}
      cellSpacing={0}
      width="100%"
      style={{
        margin: 0,
        padding: 0,
        backgroundColor: "#f4f7f9",
        fontFamily: emailFont,
      }}
    >
      <tbody>
        <tr>
          <td style={{ padding: "20px 0" }}>
            <table
              role="presentation"
              align="center"
              border={0}
              cellPadding={0}
              cellSpacing={0}
              width={600}
              style={{
                backgroundColor: "#ffffff",
                border: "1px solid #dddddd",
              }}
            >
              <tbody>
                <tr>
                  <td align="center" style={{ padding: "6px 16px 0" }}>
                    <img
                      src={APP_LOGO_SRC}
                      alt={fields.companyNameBrand}
                      width={180}
                      style={{
                        display: "block",
                        margin: "0 auto",
                        width: 180,
                        height: "auto",
                        border: 0,
                      }}
                    />
                  </td>
                </tr>

                <tr>
                  <td style={{ padding: "0 20px" }}>
                    <table
                      role="presentation"
                      border={0}
                      cellPadding={0}
                      cellSpacing={0}
                      width="100%"
                      style={{
                        background:
                          "linear-gradient(to right, #3b7ab0, #1a4a7c)",
                        backgroundColor: "#1a4a7c",
                        borderRadius: 8,
                      }}
                    >
                      <tbody>
                        <tr>
                          <td
                            width={100}
                            align="center"
                            style={{ padding: "30px 0 30px 20px" }}
                          >
                            <div
                              style={{
                                width: 70,
                                height: 70,
                                border: "2px solid #ffffff",
                                borderRadius: "50%",
                                lineHeight: "70px",
                                textAlign: "center",
                                fontSize: 35,
                                color: "#ffffff",
                              }}
                            >
                              📄
                            </div>
                          </td>
                          <td style={{ padding: "30px 20px", color: "#ffffff" }}>
                            <div
                              style={{
                                fontSize: 22,
                                fontWeight: "bold",
                                letterSpacing: 1,
                                marginBottom: 5,
                              }}
                            >
                              APPLICATION APPROVED
                            </div>
                            <div style={{ fontSize: 14, opacity: 0.9 }}>
                              Congratulations! Your application has been
                              successfully processed.
                            </div>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </td>
                </tr>

                <tr>
                  <td style={{ padding: "30px 24px" }}>
                    <p
                      style={{
                        margin: "0 0 16px 0",
                        fontSize: 16,
                        color: "#444",
                      }}
                    >
                      Hi {fields.clientName}
                    </p>

                    <p
                      style={{
                        margin: "0 0 16px 0",
                        fontSize: 15,
                        color: "#666",
                        lineHeight: 1.5,
                      }}
                    >
                      We are pleased to inform you that your application for{" "}
                      <strong style={{ color: "#0b71a9" }}>
                        &apos;{fields.companyName}&apos;
                      </strong>{" "}
                      has been pre-approved by{" "}
                      <strong style={{ color: "#0b71a9" }}>
                        {fields.companyNameBrand}
                      </strong>
                      !
                    </p>

                    <p
                      style={{
                        margin: "0 0 8px 0",
                        fontSize: 14,
                        color: "#666",
                        lineHeight: 1.5,
                      }}
                    >
                      Please click on the button below to calculate your
                      approvals. You do not need a {fields.crmName} login to use
                      our calculator! Everyone on your team will have immediate
                      access via this email.
                    </p>

                    <EmailCtaButton
                      href={fields.calculateApprovalUrl}
                      label="Calculate your Approval"
                      fontSize="16px"
                    />

                    <h4
                      style={{
                        margin: "24px 0 12px 0",
                        fontSize: 15,
                        color: "#333",
                        textDecoration: "underline",
                      }}
                    >
                      REQUIRED STIPS FOR FUNDING
                    </h4>

                    <table
                      role="presentation"
                      border={0}
                      cellPadding={0}
                      cellSpacing={0}
                      width="100%"
                    >
                      <tbody>
                        <tr>
                          <td
                            width="50%"
                            valign="top"
                            style={{
                              fontSize: 12,
                              color: "#444",
                              paddingRight: 12,
                            }}
                          >
                            <strong>Provide with signed contracts:</strong>
                            <ul
                              style={{
                                paddingLeft: 18,
                                margin: "8px 0 0 0",
                                lineHeight: 1.6,
                              }}
                            >
                              {CLIENT_PROVIDED_STIPS.map((item) => (
                                <li key={item}>{item}</li>
                              ))}
                            </ul>
                          </td>
                          <td
                            width="50%"
                            valign="top"
                            style={{ fontSize: 12, color: "#444" }}
                          >
                            <strong>
                              {fields.companyNameBrand} Company will take care
                              of:
                            </strong>
                            <ul
                              style={{
                                paddingLeft: 18,
                                margin: "8px 0 0 0",
                                lineHeight: 1.6,
                              }}
                            >
                              {COMPANY_HANDLED_STIPS.map((item) => (
                                <li key={item}>{item}</li>
                              ))}
                            </ul>
                          </td>
                        </tr>
                      </tbody>
                    </table>

                  </td>
                </tr>
              </tbody>
            </table>
          </td>
        </tr>
      </tbody>
    </table>
  );
}
