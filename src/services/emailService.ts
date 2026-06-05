import sendMail, { isOutboundSmtpConfigured } from '../config/nodemailer';
import {
    buildBrandHeaderRowHtml,
    buildBrandHeaderStyles,
    buildBrandLogoAttachments,
} from '../constants/brand';
import {
  resolveCrmFrontendBaseUrl,
  resolveDecisionLogicInvitationBaseUrl,
} from '../utils/crmFrontendUrl';

export { buildBrandLogoAttachments } from '../constants/brand';

/**
 * Href values in these templates (`viewApplicationUrl`, `publicPortalUrl`, `calculateApprovalUrl`, etc.)
 * are supplied by callers (e.g. `applicationController`) using `resolveCrmFrontendBaseUrl()` from `../utils/crmFrontendUrl`.
 * For local testing, set `LOCAL_FRONTEND_URL` (or `DEV_FRONTEND_URL`) in the API `.env` so links open your dev SPA;
 * in production, set `PUBLIC_SITE_ORIGIN` or `FRONTEND_URL` to the live client origin.
 */

/**
 * When true (default), workflow step emails are not sent to CRM roles (agent, underwriter,
 * final underwriter, operations, super admin, etc.). In-app bell notifications still work.
 * ISO-branded approval / offer-updated templates are always allowed (see sendApplicationApprovalEmail).
 * Set DISABLE_APPLICATION_NOTIFICATION_EMAILS=false to re-enable internal step mail.
 */
export function areApplicationNotificationEmailsDisabled(): boolean {
    const master = String(process.env.DISABLE_APPLICATION_NOTIFICATION_EMAILS ?? '').trim().toLowerCase();
    if (master === 'false') return false;
    if (master === 'true') return true;
    if (String(process.env.DISABLE_CLIENT_APPLICATION_EMAILS || '').trim().toLowerCase() === 'true') {
        return true;
    }
    if (String(process.env.DISABLE_INTERNAL_APPLICATION_EMAILS ?? 'true').trim().toLowerCase() !== 'false') {
        return true;
    }
    return true;
}

/** Resolves links like `{base}/application-details/:id/overview` (idempotent if `/overview` is already present). */
export function withApplicationDetailsOverviewHref(
    viewApplicationUrl: string | undefined,
): string {
    const u = (viewApplicationUrl || '').trim();
    if (!u) return '#';
    const base = u.replace(/\/$/, '');
    if (/\/overview$/i.test(base)) return base;
    return `${base}/overview`;
}

export interface WelcomeEmailParams {
    to: string;
    name: string;
    role: string;
    temporaryPassword: string;
    loginUrl: string;
}

export async function sendWelcomeEmail({
    to,
    name,
    role,
    temporaryPassword,
    loginUrl,
}: WelcomeEmailParams): Promise<void> {
    const safeName = name || to;
    const subject = 'Your In-House CRM Account Details';
    const body = `
    <h2>Hello ${safeName},</h2>
    <p>Your account has been created in <strong>In-House CRM</strong>.</p>
    <p><strong>Assigned role:</strong> ${role}</p>
    <p><strong>Temporary password:</strong> ${temporaryPassword}</p>
    <p>For security, please log in and change your password after first sign-in.</p>
  `;

    try {
        await sendMail(to, subject, body);
    } catch (error) {
        // Log only – user creation must not fail because of email issues
        // eslint-disable-next-line no-console
        console.error('Welcome email send failed (user was created):', error);
    }
}

export interface ApplicationApprovalEmailParams {
    to: string;
    clientName: string;
    companyName: string;
    viewApplicationUrl?: string;
    calculateApprovalUrl?: string;
}

const buildStatusStep = (
    label: string,
    position: 'first' | 'middle' | 'last',
    isActive: boolean,
    isCompleted: boolean
): string => {
    const circleColor = isCompleted || isActive ? '#1E88E5' : '#E5E7EB';
    const circleBorder = isActive ? '2px solid #1E88E5' : '2px solid #E5E7EB';
    const circleBackground = isActive ? '#ffffff' : circleColor;
    const textColor = isActive || isCompleted ? '#111827' : '#9CA3AF';

    const connectorTop = position !== 'first'
        ? `<tr>
          <td width="40" align="center">
              <table width="2" border="0" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                  <tr>
                      <td style="background-color:#E5E7EB; height:20px; font-size:0; line-height:0;">&nbsp;</td>
                  </tr>
              </table>
          </td>
          <td>&nbsp;</td>
      </tr>`
        : '';

    const connectorBottom = position !== 'last'
        ? `<tr>
          <td width="40" align="center">
              <table width="2" border="0" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                  <tr>
                      <td style="background-color:#E5E7EB; height:20px; font-size:0; line-height:0;">&nbsp;</td>
                  </tr>
              </table>
          </td>
          <td>&nbsp;</td>
      </tr>`
        : '';

    return `
    ${connectorTop}
    <tr>
        <td width="40" align="center" valign="middle">
            <table width="26" height="26" border="0" cellspacing="0" cellpadding="0" style="border-radius:50%; border:${circleBorder}; background-color:${circleBackground};">
                <tr>
                    <td align="center" valign="middle" style="font-size:14px; line-height:14px; color:${isCompleted || isActive ? '#1E88E5' : '#9CA3AF'};">
                        ${isCompleted ? '&#10003;' : isActive ? '&#9679;' : '&nbsp;'}
                    </td>
                </tr>
            </table>
        </td>
        <td align="left" valign="middle" style="font-family:Arial,Helvetica,sans-serif; font-size:14px; line-height:20px; color:${textColor}; padding-left:8px;">
            ${label}
        </td>
    </tr>
    ${connectorBottom}
  `;
};

export const buildApplicationApprovalEmailHtml = ({
    clientName,
    companyName,
    viewApplicationUrl,
    calculateApprovalUrl,
}: Omit<ApplicationApprovalEmailParams, 'to'>): string => {
    const safeClientName = clientName || 'Valued Client';
    const safeCompanyName = companyName || 'your company';

    const steps: Array<{ label: string; key: string }> = [
        { label: 'Application Submitted', key: 'submitted' },
        { label: 'Underwriting', key: 'underwriting' },
        { label: 'Approved', key: 'approved' },
        { label: 'Contract', key: 'Contract' },
        { label: 'Final Call', key: 'finalCall' },
        { label: 'Funded', key: 'funded' },
    ];

    const currentKey = 'approved';

    const stepsHtml = steps
        .map((step, index) => {
            const position: 'first' | 'middle' | 'last' =
                index === 0 ? 'first' : index === steps.length - 1 ? 'last' : 'middle';
            const isCompleted = ['submitted', 'underwriting'].includes(step.key);
            const isActive = step.key === currentKey;
            return buildStatusStep(step.label, position, isActive, isCompleted);
        })
        .join('');

    const buttonHtml = viewApplicationUrl
        ? `<tr>
            <td align="center" style="padding:24px 0 8px 0;">
                <a href="${viewApplicationUrl}"
                   style="display:inline-block; padding:12px 24px; background-color:#1E88E5; color:#ffffff; text-decoration:none; font-family:Arial,Helvetica,sans-serif; font-size:14px; font-weight:bold; border-radius:4px;">
                    View Your Application
                </a>
            </td>
        </tr>`
        : '';

    return `
<!DOCTYPE html>
<html>
<head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <title>Application Approved</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
    ${buildBrandHeaderStyles()}
</head>
<body style="margin: 0; padding: 0; background-color: #f4f7f9; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;">
    <table border="0" cellpadding="0" cellspacing="0" width="100%">
        <tr>
            <td style="padding: 20px 0;">
                <table align="center" border="0" cellpadding="0" cellspacing="0" width="600" style="background-color: #ffffff; border: 1px solid #dddddd;">
                    
                    ${buildBrandHeaderRowHtml()}

                    <tr>
                        <td style="padding: 0 20px;">
                            <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background: linear-gradient(to right, #3b7ab0, #1a4a7c); background-color: #1a4a7c; border-radius: 8px;">
                                <tr>
                                    <td width="100" align="center" style="padding: 30px 0 30px 20px;">
                                        <div style="width: 70px; height: 70px; border: 2px solid #ffffff; border-radius: 50%; line-height: 70px; text-align: center; font-size: 35px; color: #ffffff;">📄</div>
                                    </td>
                                    <td style="padding: 30px 20px; color: #ffffff;">
                                        <div style="font-size: 22px; font-weight: bold; letter-spacing: 1px; margin-bottom: 5px;">APPLICATION APPROVED</div>
                                        <div style="font-size: 14px; opacity: 0.9;">Congratulations! Your application has been successfully processed.</div>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>

                    <tr>
                        <td style="padding: 30px 20px;">
                            <table border="0" cellpadding="0" cellspacing="0" width="100%">
                                <tr>
                                    <td width="110" valign="top" align="center">
                                        <table border="0" cellpadding="0" cellspacing="0" width="100%">
                                            <tr><td align="center"><div style="width: 32px; height: 32px; background: #0b71a9; border-radius: 50%; color: #ffffff; line-height: 32px; font-size: 16px;">✓</div></td></tr>
                                            <tr><td align="center" style="font-size: 11px; padding: 5px 0; color: #333; line-height: 1.2;">Application<br/>Submitted</td></tr>
                                            <tr><td align="center" style="padding: 5px 0;"><div style="width: 0px; border-left: 2px dotted #0b71a9; height: 35px;"></div></td></tr>
                                            <tr><td align="center"><div style="width: 32px; height: 32px; background: #0b71a9; border-radius: 50%; color: #ffffff; line-height: 32px; font-size: 16px;">✓</div></td></tr>
                                            <tr><td align="center" style="font-size: 11px; padding: 5px 0; color: #333;">Underwriting</td></tr>
                                            <tr><td align="center" style="padding: 5px 0;"><div style="width: 0px; border-left: 2px dotted #0b71a9; height: 35px;"></div></td></tr>
                                            <tr><td align="center"><div style="width: 32px; height: 32px; background: #0b71a9; border-radius: 50%; color: #ffffff; line-height: 32px; font-size: 16px;">✓</div></td></tr>
                                            <tr><td align="center" style="font-size: 11px; padding: 5px 0; color: #333;">Approved</td></tr>
                                            <tr><td align="center" style="padding: 5px 0;"><div style="width: 0px; border-left: 2px dotted #cccccc; height: 35px;"></div></td></tr>
                                            <tr><td align="center"><div style="width: 32px; height: 32px; background: #cccccc; border-radius: 50%; color: #ffffff; line-height: 32px; font-size: 16px;">X</div></td></tr>
                                            <tr><td align="center" style="font-size: 11px; padding: 5px 0; color: #888;">Contract</td></tr>
                                            <tr><td align="center" style="padding: 5px 0;"><div style="width: 0px; border-left: 2px dotted #cccccc; height: 35px;"></div></td></tr>
                                            <tr><td align="center"><div style="width: 32px; height: 32px; background: #cccccc; border-radius: 50%; color: #ffffff; line-height: 32px; font-size: 16px;">X</div></td></tr>
                                            <tr><td align="center" style="font-size: 11px; padding: 5px 0; color: #888;">Funding Call</td></tr>
                                            <tr><td align="center" style="padding: 5px 0;"><div style="width: 0px; border-left: 2px dotted #cccccc; height: 35px;"></div></td></tr>
                                            <tr><td align="center"><div style="width: 32px; height: 32px; background: #cccccc; border-radius: 50%; color: #ffffff; line-height: 32px; font-size: 16px;">X</div></td></tr>
                                            <tr><td align="center" style="font-size: 11px; padding: 5px 0; color: #888;">Funded</td></tr>
                                        </table>
                                    </td>

                                    <td valign="top" style="padding-left: 25px;">
                                        <p style="margin: 0 0 15px 0; font-size: 16px; color: #444;">Hi ${safeClientName}!</p>
                                        
                                        <p style="font-size: 15px; color: #666; line-height: 1.5;">
                                            We are pleased to inform you that your application for 
                                            <strong style="color: #0b71a9;">'${safeCompanyName}'</strong> 
                                            has been pre-approved for a Woodmere Financial!
                                        </p>

                                        <p style="font-size: 14px; color: #666; line-height: 1.5;">
                                            Please click on the button below to calculate your approvals. You do not need a Woodmere Financial CRM login to use our calculator! Everyone on your team will have immediate access via this email.
                                        </p>

                                        <table border="0" cellpadding="0" cellspacing="0" style="margin: 20px 0;">
                                            <tr>
                                                <td align="center" bgcolor="#3b7ab0" style="border-radius: 5px;">
                                                    <a href="${calculateApprovalUrl || '#'}" style="display: inline-block; padding: 12px 25px; color: #ffffff; font-size: 16px; font-weight: bold; text-decoration: none;">Calculate your Approval</a>
                                                </td>
                                            </tr>
                                        </table>

                                        <h4 style="margin: 30px 0 10px 0; font-size: 15px; color: #333; text-decoration: underline;">REQUIRED STIPS FOR FUNDING</h4>
                                        <table border="0" cellpadding="0" cellspacing="0" width="100%">
                                            <tr>
                                                <td width="50%" valign="top" style="font-size: 12px; color: #444; padding-right: 10px;">
                                                    <strong>Provide with signed contracts:</strong>
                                                    <ul style="padding-left: 15px; margin-top: 8px; color: #0b71a9;">
                                                        <li><span style="color: #444;">Void Check</span></li>
                                                        <li><span style="color: #444;">Driver's License</span></li>
                                                    </ul>
                                                </td>
                                                <td width="50%" valign="top" style="font-size: 12px; color: #444;">
                                                    <strong>Abc Company will take care of:</strong>
                                                    <ul style="padding-left: 15px; margin-top: 8px; color: #0b71a9;">
                                                        <li><span style="color: #444;">Merchant Interview</span></li>
                                                        <li><span style="color: #444;">Decision Logic/Bank Login</span></li>
                                                        <li><span style="color: #444;">Recent Bank Statements</span></li>
                                                    </ul>
                                                </td>
                                            </tr>
                                        </table>

                                        <p style="font-size: 14px; color: #0b71a9; margin-top: 30px; font-weight: bold;">To view your application in Woodmere Financial CRM, click on the button below.</p>
                                        <table border="0" cellpadding="0" cellspacing="0" style="margin-bottom: 25px;">
                                            <tr>
                                                <td align="center" bgcolor="#3b7ab0" style="border-radius: 5px;">
                                                    <a href="${viewApplicationUrl || '#'}" style="display: inline-block; padding: 10px 20px; color: #ffffff; font-size: 14px; font-weight: bold; text-decoration: none;">View your Application</a>
                                                </td>
                                            </tr>
                                        </table>

                                        <p style="font-size: 13px; color: #777; margin-top: 20px; line-height: 1.4;">If you need more information or have any questions/comments, contact your representative directly or leave a comment in the portal by clicking on the button below.</p>
                                        
                                        <table border="0" cellpadding="0" cellspacing="0">
                                            <tr>
                                                <td align="center" bgcolor="#3b7ab0" style="border-radius: 5px;">
                                                    <a href="#" style="display: inline-block; padding: 10px 20px; color: #ffffff; font-size: 14px; font-weight: bold; text-decoration: none;">Write Comment</a>
                                                </td>
                                            </tr>
                                        </table>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
`
};

/** @returns true when SMTP accepted the message; false if disabled, invalid `to`, or send failed */
export async function sendApplicationApprovalEmail({
    to,
    clientName,
    companyName,
    viewApplicationUrl,
    calculateApprovalUrl,
}: ApplicationApprovalEmailParams): Promise<boolean> {
    const toTrimmed = String(to || '').trim();
    if (!toTrimmed) {
        // eslint-disable-next-line no-console
        console.warn('[email] Application approval skipped: empty recipient');
        return false;
    }

    const subject = 'Your Application Has Been Approved';
    const html = buildApplicationApprovalEmailHtml({
        clientName,
        companyName,
        viewApplicationUrl,
        calculateApprovalUrl,
    });

    try {
        await sendMail({
            to: toTrimmed,
            subject,
            html,
            attachments: buildBrandLogoAttachments(),
        });
        return true;
    } catch (error) {
        // eslint-disable-next-line no-console
        console.error('Application approval email send failed:', { to: toTrimmed, error });
        return false;
    }
}

export interface OperationsIsoApprovalAlertEmailParams {
    to: string;
    operationsName?: string;
    isoName: string;
    applicationNumber: string;
    clientName: string;
    viewApplicationUrl?: string;
}

/** Operations alert email when ISO approves an application and contract creation can begin. */
export async function sendOperationsIsoApprovalAlertEmail({
    to,
    operationsName,
    isoName,
    applicationNumber,
    clientName,
    viewApplicationUrl,
}: OperationsIsoApprovalAlertEmailParams): Promise<boolean> {
    const toTrimmed = String(to || '').trim();
    if (!toTrimmed) {
        // eslint-disable-next-line no-console
        console.warn('[email] Operations ISO-approval alert skipped: empty recipient');
        return false;
    }

    if (areApplicationNotificationEmailsDisabled()) {
        return false;
    }

    const safeOperationsName = String(operationsName || '').trim() || 'Operations Team';
    const safeIsoName = String(isoName || '').trim() || 'ISO';
    const safeApplicationNumber = String(applicationNumber || '').trim() || 'N/A';
    const safeClientName = String(clientName || '').trim() || 'Client';
    const applicationHref = withApplicationDetailsOverviewHref(viewApplicationUrl);

    const subject = `ISO approved application #${safeApplicationNumber} - proceed to generate contract`;
    const html = `
<!DOCTYPE html>
<html>
<head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
    <title>ISO Approval Alert</title>
    ${buildBrandHeaderStyles()}
</head>
<body style="margin:0; padding:0; background:#f4f7f9; font-family: Arial, Helvetica, sans-serif;">
    <table border="0" cellpadding="0" cellspacing="0" width="100%">
        <tr>
            <td style="padding: 20px 0;">
                <table align="center" border="0" cellpadding="0" cellspacing="0" width="600" style="background:#ffffff; border:1px solid #e5e7eb;">
                    ${buildBrandHeaderRowHtml()}
                    <tr>
                        <td style="padding: 20px 24px 8px;">
                            <h2 style="margin:0; color:#111827; font-size:22px;">ISO Approval Received</h2>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 0 24px 20px; color:#374151; font-size:14px; line-height:1.6;">
                            <p style="margin: 0 0 12px;">Hi ${safeOperationsName},</p>
                            <p style="margin: 0 0 8px;">
                                <strong>Application ID:</strong> #${safeApplicationNumber}
                            </p>
                            <p style="margin: 0 0 16px;">
                                <strong>ISO</strong> approved application <strong>#${safeApplicationNumber}</strong>.
                                Now you can proceed to generate contract.
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;

    try {
        await sendMail({
            to: toTrimmed,
            subject,
            html,
            attachments: buildBrandLogoAttachments(),
        });
        return true;
    } catch (error) {
        // eslint-disable-next-line no-console
        console.error('Operations ISO-approval alert email send failed:', { to: toTrimmed, error });
        return false;
    }
}

export interface OperationsDisbursementReadyEmailParams {
    to: string;
    operationsName: string;
    applicationNumber: string;
    clientName: string;
    viewApplicationUrl?: string;
}

/** Operations alert when funding call is "Call Done" and disbursement can proceed. */
export async function sendOperationsDisbursementReadyEmail({
    to,
    operationsName,
    applicationNumber,
    clientName,
    viewApplicationUrl,
}: OperationsDisbursementReadyEmailParams): Promise<boolean> {
    const toTrimmed = String(to || '').trim();
    if (!toTrimmed) {
        console.warn('[email] Operations disbursement-ready alert skipped: empty recipient');
        return false;
    }

    if (areApplicationNotificationEmailsDisabled()) {
        return false;
    }

    const safeOperationsName = String(operationsName || '').trim() || 'Operations Team';
    const safeApplicationNumber = String(applicationNumber || '').trim() || 'N/A';
    const safeClientName = String(clientName || '').trim() || 'Client';
    const applicationHref = withApplicationDetailsOverviewHref(viewApplicationUrl);

    const subject = `Funding call complete — proceed with disbursement (#${safeApplicationNumber})`;
    const html = `
<!DOCTYPE html>
<html>
<head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
    <title>Disbursement Ready</title>
    ${buildBrandHeaderStyles()}
</head>
<body style="margin:0; padding:0; background:#f4f7f9; font-family: Arial, Helvetica, sans-serif;">
    <table border="0" cellpadding="0" cellspacing="0" width="100%">
        <tr>
            <td style="padding: 20px 0;">
                <table align="center" border="0" cellpadding="0" cellspacing="0" width="600" style="background:#ffffff; border:1px solid #e5e7eb;">
                    ${buildBrandHeaderRowHtml()}
                    <tr>
                        <td style="padding: 20px 24px 8px;">
                            <h2 style="margin:0; color:#111827; font-size:22px;">Ready for Disbursement</h2>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 0 24px 20px; color:#374151; font-size:14px; line-height:1.6;">
                            <p style="margin: 0 0 12px;">Hi ${safeOperationsName},</p>
                            <p style="margin: 0 0 8px;">
                                <strong>Application ID:</strong> #${safeApplicationNumber}
                            </p>
                            <p style="margin: 0 0 8px;">
                                <strong>Client:</strong> ${safeClientName}
                            </p>
                            <p style="margin: 0 0 16px;">
                                The funding call for this application is marked <strong>Call Done</strong>.
                                You may now proceed with disbursement in the CRM.
                            </p>
                            ${
                                applicationHref
                                    ? `<p style="margin: 0;"><a href="${applicationHref}" style="color:#1E88E5;">Open disbursement in CRM</a></p>`
                                    : ''
                            }
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;

    try {
        await sendMail({
            to: toTrimmed,
            subject,
            html,
            attachments: buildBrandLogoAttachments(),
        });
        return true;
    } catch (error) {
        console.error('Operations disbursement-ready email send failed:', { to: toTrimmed, error });
        return false;
    }
}

/** Client email when offer values are updated after approval comments. */
export interface ApplicationOfferUpdatedEmailParams {
    to: string;
    clientName: string;
    companyName: string;
    viewApplicationUrl?: string;
    calculateApprovalUrl?: string;
}

export const buildApplicationOfferUpdatedEmailHtml = ({
    clientName,
    companyName,
    viewApplicationUrl,
    calculateApprovalUrl,
}: Omit<ApplicationOfferUpdatedEmailParams, 'to'>): string => {
    const safeClientName = clientName || 'Valued Client';
    const safeCompanyName = companyName || 'your company';

    return `
<!DOCTYPE html>
<html>
<head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <title>Offer Updated</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
    ${buildBrandHeaderStyles()}
</head>
<body style="margin: 0; padding: 0; background-color: #f4f7f9; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;">
    <table border="0" cellpadding="0" cellspacing="0" width="100%">
        <tr>
            <td style="padding: 20px 0;">
                <table align="center" border="0" cellpadding="0" cellspacing="0" width="600" style="background-color: #ffffff; border: 1px solid #dddddd;">
                    
                    ${buildBrandHeaderRowHtml()}

                    <tr>
                        <td style="padding: 0 20px;">
                            <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background: linear-gradient(to right, #3b7ab0, #1a4a7c); background-color: #1a4a7c; border-radius: 8px;">
                                <tr>
                                    <td width="100" align="center" style="padding: 30px 0 30px 20px;">
                                        <div style="width: 70px; height: 70px; border: 2px solid #ffffff; border-radius: 50%; line-height: 70px; text-align: center; font-size: 35px; color: #ffffff;">📄</div>
                                    </td>
                                    <td style="padding: 30px 20px; color: #ffffff;">
                                        <div style="font-size: 22px; font-weight: bold; letter-spacing: 1px; margin-bottom: 5px;">OFFER UPDATED</div>
                                        <div style="font-size: 14px; opacity: 0.9;">Your offer values have been updated based on the latest approval mail comment.</div>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>

                    <tr>
                        <td style="padding: 30px 20px;">
                            <table border="0" cellpadding="0" cellspacing="0" width="100%">
                                <tr>
                                    <td width="110" valign="top" align="center">
                                        <table border="0" cellpadding="0" cellspacing="0" width="100%">
                                            <tr><td align="center"><div style="width: 32px; height: 32px; background: #0b71a9; border-radius: 50%; color: #ffffff; line-height: 32px; font-size: 16px;">✓</div></td></tr>
                                            <tr><td align="center" style="font-size: 11px; padding: 5px 0; color: #333; line-height: 1.2;">Application<br/>Submitted</td></tr>
                                            <tr><td align="center" style="padding: 5px 0;"><div style="width: 0px; border-left: 2px dotted #0b71a9; height: 35px;"></div></td></tr>
                                            <tr><td align="center"><div style="width: 32px; height: 32px; background: #0b71a9; border-radius: 50%; color: #ffffff; line-height: 32px; font-size: 16px;">✓</div></td></tr>
                                            <tr><td align="center" style="font-size: 11px; padding: 5px 0; color: #333;">Underwriting</td></tr>
                                            <tr><td align="center" style="padding: 5px 0;"><div style="width: 0px; border-left: 2px dotted #0b71a9; height: 35px;"></div></td></tr>
                                            <tr><td align="center"><div style="width: 32px; height: 32px; background: #0b71a9; border-radius: 50%; color: #ffffff; line-height: 32px; font-size: 16px;">✓</div></td></tr>
                                            <tr><td align="center" style="font-size: 11px; padding: 5px 0; color: #333;">Approved</td></tr>
                                            <tr><td align="center" style="padding: 5px 0;"><div style="width: 0px; border-left: 2px dotted #0b71a9; height: 35px;"></div></td></tr>
                                            <tr><td align="center"><div style="width: 32px; height: 32px; background: #0b71a9; border-radius: 50%; color: #ffffff; line-height: 32px; font-size: 16px;">✓</div></td></tr>
                                            <tr><td align="center" style="font-size: 11px; padding: 5px 0; color: #333;">Offer Updated</td></tr>
                                            <tr><td align="center" style="padding: 5px 0;"><div style="width: 0px; border-left: 2px dotted #cccccc; height: 35px;"></div></td></tr>
                                            <tr><td align="center"><div style="width: 32px; height: 32px; background: #cccccc; border-radius: 50%; color: #ffffff; line-height: 32px; font-size: 16px;">X</div></td></tr>
                                            <tr><td align="center" style="font-size: 11px; padding: 5px 0; color: #888;">Final Call</td></tr>
                                            <tr><td align="center" style="padding: 5px 0;"><div style="width: 0px; border-left: 2px dotted #cccccc; height: 35px;"></div></td></tr>
                                            <tr><td align="center"><div style="width: 32px; height: 32px; background: #cccccc; border-radius: 50%; color: #ffffff; line-height: 32px; font-size: 16px;">X</div></td></tr>
                                            <tr><td align="center" style="font-size: 11px; padding: 5px 0; color: #888;">Funded</td></tr>
                                        </table>
                                    </td>

                                    <td valign="top" style="padding-left: 25px;">
                                        <p style="margin: 0 0 15px 0; font-size: 16px; color: #444;">Hi ${safeClientName}!</p>
                                        
                                        <p style="font-size: 15px; color: #666; line-height: 1.5;">
                                            Your offer values for
                                            <strong style="color: #0b71a9;">'${safeCompanyName}'</strong>
                                            are now updated as mentioned in the last approval mail comment.
                                        </p>

                                        <p style="font-size: 14px; color: #666; line-height: 1.5;">
                                            Please review the updated offer details and recalculate approval values if needed.
                                        </p>

                                        <table border="0" cellpadding="0" cellspacing="0" style="margin: 20px 0;">
                                            <tr>
                                                <td align="center" bgcolor="#3b7ab0" style="border-radius: 5px;">
                                                    <a href="${calculateApprovalUrl || '#'}" style="display: inline-block; padding: 12px 25px; color: #ffffff; font-size: 16px; font-weight: bold; text-decoration: none;">Review Updated Offer</a>
                                                </td>
                                            </tr>
                                        </table>

                                        <p style="font-size: 14px; color: #0b71a9; margin-top: 24px; font-weight: bold;">To view your application in Woodmere Financial CRM, click the button below.</p>
                                        <table border="0" cellpadding="0" cellspacing="0" style="margin-bottom: 25px;">
                                            <tr>
                                                <td align="center" bgcolor="#3b7ab0" style="border-radius: 5px;">
                                                    <a href="${viewApplicationUrl || '#'}" style="display: inline-block; padding: 10px 20px; color: #ffffff; font-size: 14px; font-weight: bold; text-decoration: none;">View your Application</a>
                                                </td>
                                            </tr>
                                        </table>

                                        <p style="font-size: 13px; color: #777; margin-top: 20px; line-height: 1.4;">If you have questions, please reply to the latest approval mail comment thread or contact your representative.</p>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
`;
};

export async function sendApplicationOfferUpdatedEmail({
    to,
    clientName,
    companyName,
    viewApplicationUrl,
    calculateApprovalUrl,
}: ApplicationOfferUpdatedEmailParams): Promise<boolean> {
    const toTrimmed = String(to || '').trim();
    if (!toTrimmed) {
        // eslint-disable-next-line no-console
        console.warn('[email] Offer update skipped: empty recipient');
        return false;
    }

    const subject = 'Your Offer Values Have Been Updated';
    const html = buildApplicationOfferUpdatedEmailHtml({
        clientName,
        companyName,
        viewApplicationUrl,
        calculateApprovalUrl,
    });

    try {
        await sendMail({
            to: toTrimmed,
            subject,
            html,
            attachments: buildBrandLogoAttachments(),
        });
        return true;
    } catch (error) {
        // eslint-disable-next-line no-console
        console.error('Offer update email send failed:', { to: toTrimmed, error });
        return false;
    }
}

/** Client email when Operations updates Funding Call status (merchant interview / verification stage). */
export interface FundingCallPendingEmailParams {
    to: string;
    clientName?: string;
    companyName?: string;
}

export const buildFundingCallPendingEmailHtml = ({
    clientName,
    companyName,
}: Omit<FundingCallPendingEmailParams, 'to'>): string => {
    const safeClientName = clientName || 'Valued Client';
    const safeCompanyName = companyName || 'your business';

    return `<!DOCTYPE html>
<html>
<head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <title>Funding Call Stage</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
    ${buildBrandHeaderStyles()}
</head>
<body style="margin: 0; padding: 0; background-color: #f4f7f9; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;">
    <table border="0" cellpadding="0" cellspacing="0" width="100%">
        <tr>
            <td style="padding: 20px 0;">
                <table align="center" border="0" cellpadding="0" cellspacing="0" width="600" style="background-color: #ffffff; border: 1px solid #dddddd;">
                    
                    ${buildBrandHeaderRowHtml()}

                    <tr>
                        <td style="padding: 0 20px;">
                            <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background: linear-gradient(to right, #3b7ab0, #1a4a7c); background-color: #1a4a7c; border-radius: 8px;">
                                <tr>
                                    <td width="100" align="center" style="padding: 30px 0 30px 20px;">
                                        <div style="width: 70px; height: 70px; border: 2px solid #ffffff; border-radius: 50%; line-height: 70px; text-align: center; font-size: 35px; color: #ffffff;">📞</div>
                                    </td>
                                    <td style="padding: 30px 20px; color: #ffffff;">
                                        <div style="font-size: 22px; font-weight: bold; letter-spacing: 1px; margin-bottom: 5px;">FUNDING CALL PENDING</div>
                                        <div style="font-size: 14px; opacity: 0.9;">You're almost there! One final call to verify your funding details.</div>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>

                    <tr>
                        <td style="padding: 30px 20px;">
                            <table border="0" cellpadding="0" cellspacing="0" width="100%">
                                <tr>
                                    <td width="110" valign="top" align="center">
                                        <table border="0" cellpadding="0" cellspacing="0" width="100%">
                                            <tr><td align="center"><div style="width: 32px; height: 32px; background: #0b71a9; border-radius: 50%; color: #ffffff; line-height: 32px; font-size: 16px;">✓</div></td></tr>
                                            <tr><td align="center" style="font-size: 11px; padding: 5px 0; color: #333; line-height: 1.2;">Application<br/>Submitted</td></tr>
                                            <tr><td align="center" style="padding: 5px 0;"><div style="width: 0px; border-left: 2.5px dotted #0b71a9; height: 35px;"></div></td></tr>

                                            <tr><td align="center"><div style="width: 32px; height: 32px; background: #0b71a9; border-radius: 50%; color: #ffffff; line-height: 32px; font-size: 16px;">✓</div></td></tr>
                                            <tr><td align="center" style="font-size: 11px; padding: 5px 0; color: #333;">Underwriting</td></tr>
                                            <tr><td align="center" style="padding: 5px 0;"><div style="width: 0px; border-left: 2.5px dotted #0b71a9; height: 35px;"></div></td></tr>

                                            <tr><td align="center"><div style="width: 32px; height: 32px; background: #0b71a9; border-radius: 50%; color: #ffffff; line-height: 32px; font-size: 16px;">✓</div></td></tr>
                                            <tr><td align="center" style="font-size: 11px; padding: 5px 0; color: #333;">Approved</td></tr>
                                            <tr><td align="center" style="padding: 5px 0;"><div style="width: 0px; border-left: 2.5px dotted #0b71a9; height: 35px;"></div></td></tr>

                                            <tr><td align="center"><div style="width: 32px; height: 32px; background: #0b71a9; border-radius: 50%; color: #ffffff; line-height: 32px; font-size: 16px;">✓</div></td></tr>
                                            <tr><td align="center" style="font-size: 11px; padding: 5px 0; color: #333;">Contract</td></tr>
                                            <tr><td align="center" style="padding: 5px 0;"><div style="width: 0px; border-left: 2.5px dotted #0b71a9; height: 35px;"></div></td></tr>

                                            <tr><td align="center"><div style="width: 32px; height: 32px; background: #0b71a9; border-radius: 50%; color: #ffffff; line-height: 32px; font-size: 16px;">✓</div></td></tr>
                                            <tr><td align="center" style="font-size: 11px; padding: 5px 0; color: #333; font-weight: bold;">Funding Call</td></tr>
                                            <tr><td align="center" style="padding: 5px 0;"><div style="width: 0px; border-left: 2px dotted #cccccc; height: 35px;"></div></td></tr>

                                            <tr><td align="center"><div style="width: 32px; height: 32px; background: #cccccc; border-radius: 50%; color: #ffffff; line-height: 32px; font-size: 16px;">X</div></td></tr>
                                            <tr><td align="center" style="font-size: 11px; padding: 5px 0; color: #888;">Funded</td></tr>
                                        </table>
                                    </td>

                                    <td valign="top" style="padding-left: 25px;">
                                        <p style="margin: 0 0 15px 0; font-size: 16px; color: #444;">Hi ${safeClientName}!</p>
                                        
                                        <p style="font-size: 15px; color: #666; line-height: 1.5;">
                                            Your application for <strong style="color: #0b71a9;">'${safeCompanyName}'</strong> has reached the final verification stage: <strong>The Funding Call</strong>.
                                        </p>

                                        <p style="font-size: 14px; color: #666; line-height: 1.5;">
                                            To complete the process and release your funds, we need to conduct a brief merchant interview. This call is to verify the terms of the advance and confirm your business details. 
                                        </p>

                                      

                                       
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;
};

export async function sendFundingCallPendingEmail({
    to,
    clientName,
    companyName,
}: FundingCallPendingEmailParams): Promise<void> {
    if (areApplicationNotificationEmailsDisabled()) return;

    const subject = 'Funding call — next step for your application';
    const html = buildFundingCallPendingEmailHtml({ clientName, companyName });

    try {
        await sendMail({
            to,
            subject,
            html,
            attachments: buildBrandLogoAttachments(),
        });
    } catch (error) {
        // eslint-disable-next-line no-console
        console.error('Funding call pending email send failed:', error);
    }
}

/** Client email when disbursement is confirmed (funds released notification). */
export interface ApplicationFundedEmailParams {
    to: string;
    clientName?: string;
    companyName?: string;
}

export const buildApplicationFundedEmailHtml = ({
    clientName,
    companyName,
}: Omit<ApplicationFundedEmailParams, 'to'>): string => {
    const safeClientName = clientName || 'Valued Client';
    const safeCompanyName = companyName || 'your business';

    return `<!DOCTYPE html>
<html>
<head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <title>Application Funded</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
    ${buildBrandHeaderStyles()}
</head>
<body style="margin: 0; padding: 0; background-color: #f4f7f9; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;">
    <table border="0" cellpadding="0" cellspacing="0" width="100%">
        <tr>
            <td style="padding: 20px 0;">
                <table align="center" border="0" cellpadding="0" cellspacing="0" width="600" style="background-color: #ffffff; border: 1px solid #dddddd;">
                    
                    ${buildBrandHeaderRowHtml()}

                    <tr>
                        <td style="padding: 0 20px;">
                            <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background: linear-gradient(to right, #3b7ab0, #1a4a7c); background-color: #1a4a7c; border-radius: 8px;">
                                <tr>
                                    <td width="100" align="center" style="padding: 30px 0 30px 20px;">
                                        <div style="width: 70px; height: 70px; border: 2px solid #ffffff; border-radius: 50%; line-height: 70px; text-align: center; font-size: 35px; color: #ffffff;">💰</div>
                                    </td>
                                    <td style="padding: 30px 20px; color: #ffffff;">
                                        <div style="font-size: 22px; font-weight: bold; letter-spacing: 1px; margin-bottom: 5px;">FUNDS RELEASED</div>
                                        <div style="font-size: 14px; opacity: 0.9;">Success! Your funding has been processed and sent.</div>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>

                    <tr>
                        <td style="padding: 30px 20px;">
                            <table border="0" cellpadding="0" cellspacing="0" width="100%">
                                <tr>
                                    <td width="110" valign="top" align="center">
                                        <table border="0" cellpadding="0" cellspacing="0" width="100%">
                                            <tr><td align="center"><div style="width: 32px; height: 32px; background: #0b71a9; border-radius: 50%; color: #ffffff; line-height: 32px; font-size: 16px;">✓</div></td></tr>
                                            <tr><td align="center" style="font-size: 11px; padding: 5px 0; color: #333; line-height: 1.2;">Application<br/>Submitted</td></tr>
                                            <tr><td align="center" style="padding: 5px 0;"><div style="width: 0px; border-left: 2px dotted #0b71a9; height: 35px;"></div></td></tr>

                                            <tr><td align="center"><div style="width: 32px; height: 32px; background: #0b71a9; border-radius: 50%; color: #ffffff; line-height: 32px; font-size: 16px;">✓</div></td></tr>
                                            <tr><td align="center" style="font-size: 11px; padding: 5px 0; color: #333;">Underwriting</td></tr>
                                            <tr><td align="center" style="padding: 5px 0;"><div style="width: 0px; border-left: 2px dotted #0b71a9; height: 35px;"></div></td></tr>

                                            <tr><td align="center"><div style="width: 32px; height: 32px; background: #0b71a9; border-radius: 50%; color: #ffffff; line-height: 32px; font-size: 16px;">✓</div></td></tr>
                                            <tr><td align="center" style="font-size: 11px; padding: 5px 0; color: #333;">Approved</td></tr>
                                            <tr><td align="center" style="padding: 5px 0;"><div style="width: 0px; border-left: 2px dotted #0b71a9; height: 35px;"></div></td></tr>

                                            <tr><td align="center"><div style="width: 32px; height: 32px; background: #0b71a9; border-radius: 50%; color: #ffffff; line-height: 32px; font-size: 16px;">✓</div></td></tr>
                                            <tr><td align="center" style="font-size: 11px; padding: 5px 0; color: #333;">Verification</td></tr>
                                            <tr><td align="center" style="padding: 5px 0;"><div style="width: 0px; border-left: 2px dotted #0b71a9; height: 35px;"></div></td></tr>

                                            <tr><td align="center"><div style="width: 32px; height: 32px; background: #0b71a9; border-radius: 50%; color: #ffffff; line-height: 32px; font-size: 16px;">✓</div></td></tr>
                                            <tr><td align="center" style="font-size: 11px; padding: 5px 0; color: #333;">Final Review</td></tr>
                                            <tr><td align="center" style="padding: 5px 0;"><div style="width: 0px; border-left: 2px dotted #0b71a9; height: 35px;"></div></td></tr>

                                            <tr><td align="center"><div style="width: 32px; height: 32px; background: #0b71a9; border-radius: 50%; color: #ffffff; line-height: 32px; font-size: 16px;">✓</div></td></tr>
                                            <tr><td align="center" style="font-size: 11px; padding: 5px 0; color: #333; font-weight: bold;">Funded</td></tr>
                                        </table>
                                    </td>

                                    <td valign="top" style="padding-left: 25px;">
                                        <p style="margin: 0 0 15px 0; font-size: 16px; color: #444;">Hi ${safeClientName}!</p>
                                        
                                        <p style="font-size: 15px; color: #666; line-height: 1.5;">
                                            We are excited to inform you that your application for <strong style="color: #0b71a9;">'${safeCompanyName}'</strong> is now fully <strong>Funded</strong>.
                                        </p>

                                        <p style="font-size: 14px; color: #666; line-height: 1.5;">
                                            The funds have been successfully released to your designated bank account. Depending on your bank's processing time, you should see the capital reflected in your balance shortly.
                                        </p>

                                    
                                        <p style="font-size: 13px; color: #777; margin-top: 20px; line-height: 1.4;">
                                            Thank you for choosing Barclays Advance as your funding partner. We look forward to supporting your business growth!
                                        </p>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;
};

export async function sendApplicationFundedEmail({
    to,
    clientName,
    companyName,
}: ApplicationFundedEmailParams): Promise<void> {
    if (areApplicationNotificationEmailsDisabled()) return;

    const subject = 'Your application is funded — funds released';
    const html = buildApplicationFundedEmailHtml({ clientName, companyName });

    try {
        await sendMail({
            to,
            subject,
            html,
            attachments: buildBrandLogoAttachments(),
        });
    } catch (error) {
        // eslint-disable-next-line no-console
        console.error('Application funded email send failed:', error);
    }
}

/** Client email when an agent sends the application to Underwriting — prefer `publicPortalUrl` (token link; no CRM login). */
export interface ApplicationSentToUnderwritingClientEmailParams {
    to: string;
    clientName?: string;
    companyName?: string;
    agentName?: string;
    applicationNumber?: number | string;
    /** Optional CRM deep link for internal staff only. */
    viewApplicationUrl?: string;
    /** Public secure URL: /public/application/status/:token */
    publicPortalUrl?: string;
}

export const buildApplicationSentToUnderwritingClientEmailHtml = ({
    clientName,
    companyName,
    agentName,
    applicationNumber,
    viewApplicationUrl,
    publicPortalUrl,
}: Omit<ApplicationSentToUnderwritingClientEmailParams, 'to'>): string => {
    const safeClientName = clientName || 'Valued Client';
    const safeCompanyName = companyName || 'your business';
    const safeAgentName = agentName || 'your representative';
    const safeAppRef = applicationNumber != null && String(applicationNumber).trim() !== ''
        ? String(applicationNumber).trim()
        : null;
    const externalHref = (publicPortalUrl || '').trim();
    const internalFallback = withApplicationDetailsOverviewHref(viewApplicationUrl);
    const primaryHref = externalHref || internalFallback;
    const hasValidPortalLink = primaryHref !== '#' && primaryHref.length > 1;
    const isPublicTokenLink = Boolean(externalHref);

    const portalButtonBlock = hasValidPortalLink
        ? `<table border="0" cellpadding="0" cellspacing="0" style="margin: 20px 0;">
                                            <tr>
                                                <td align="center" bgcolor="#3b7ab0" style="border-radius: 5px;">
                                                    <a href="${primaryHref}" style="display: inline-block; padding: 12px 25px; color: #ffffff; font-size: 16px; font-weight: bold; text-decoration: none;">View your application</a>
                                                </td>
                                            </tr>
                                        </table>
                                        ${isPublicTokenLink
            ? `<p style="font-size: 12px; color: #777; margin: 8px 0 0 0;">No Barclays Advance CRM login required. This personal link expires after 90 days; do not forward to anyone you do not trust.</p>`
            : ''
        }`
        : `<p style="font-size: 13px; color: #777;">We could not generate a secure portal link. Please contact your representative for an updated link.</p>`;

    return `
<!DOCTYPE html>
<html>
<head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <title>Application Submitted</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
    ${buildBrandHeaderStyles()}
</head>
<body style="margin: 0; padding: 0; background-color: #f4f7f9; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;">
    <table border="0" cellpadding="0" cellspacing="0" width="100%">
        <tr>
            <td style="padding: 20px 0;">
                <table align="center" border="0" cellpadding="0" cellspacing="0" width="600" style="background-color: #ffffff; border: 1px solid #dddddd;">
                    
                    ${buildBrandHeaderRowHtml()}

                    <tr>
                        <td style="padding: 0 20px;">
                            <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background: linear-gradient(to right, #3b7ab0, #1a4a7c); background-color: #1a4a7c; border-radius: 8px;">
                                <tr>
                                    <td width="100" align="center" style="padding: 30px 0 30px 20px;">
                                        <div style="width: 70px; height: 70px; border: 2px solid #ffffff; border-radius: 50%; line-height: 70px; text-align: center; font-size: 35px; color: #ffffff;">📩</div>
                                    </td>
                                    <td style="padding: 30px 20px; color: #ffffff;">
                                        <div style="font-size: 22px; font-weight: bold; letter-spacing: 1px; margin-bottom: 5px;">APPLICATION SUBMITTED</div>
                                        <div style="font-size: 14px; opacity: 0.9;">Your application has been successfully submitted.</div>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>

                    <tr>
                        <td style="padding: 30px 20px;">
                            <table border="0" cellpadding="0" cellspacing="0" width="100%">
                                <tr>
                                    <td width="120" valign="top" align="center">
                                        <table border="0" cellpadding="0" cellspacing="0" width="100%">
                                            <tr><td align="center"><div style="width: 35px; height: 35px; background: #0b71a9; border-radius: 50%; color: #ffffff; line-height: 35px; font-size: 18px;">✓</div></td></tr>
                                            <tr><td align="center" style="font-size: 11px; padding: 5px 0; color: #333; font-weight: bold; line-height: 1.2;">Application<br/>Submitted</td></tr>
                                            <tr><td align="center" style="padding: 2px 0;"><div style="width: 0px; border-left: 2px dotted #cccccc; height: 30px;"></div></td></tr>

                                            <tr><td align="center"><div style="width: 35px; height: 35px; background: #cccccc; border-radius: 50%; color: #ffffff; line-height: 35px; font-size: 18px;">X</div></td></tr>
                                            <tr><td align="center" style="font-size: 11px; padding: 5px 0; color: #888;">Underwriting</td></tr>
                                            <tr><td align="center" style="padding: 2px 0;"><div style="width: 0px; border-left: 2px dotted #cccccc; height: 30px;"></div></td></tr>

                                            <tr><td align="center"><div style="width: 35px; height: 35px; background: #cccccc; border-radius: 50%; color: #ffffff; line-height: 35px; font-size: 18px;">X</div></td></tr>
                                            <tr><td align="center" style="font-size: 11px; padding: 5px 0; color: #888;">Approved</td></tr>
                                            <tr><td align="center" style="padding: 2px 0;"><div style="width: 0px; border-left: 2px dotted #cccccc; height: 30px;"></div></td></tr>

                                            <tr><td align="center"><div style="width: 35px; height: 35px; background: #cccccc; border-radius: 50%; color: #ffffff; line-height: 35px; font-size: 18px;">X</div></td></tr>
                                            <tr><td align="center" style="font-size: 11px; padding: 5px 0; color: #888;">Contract</td></tr>
                                            <tr><td align="center" style="padding: 2px 0;"><div style="width: 0px; border-left: 2px dotted #cccccc; height: 30px;"></div></td></tr>

                                            <tr><td align="center"><div style="width: 35px; height: 35px; background: #cccccc; border-radius: 50%; color: #ffffff; line-height: 35px; font-size: 18px;">X</div></td></tr>
                                            <tr><td align="center" style="font-size: 11px; padding: 5px 0; color: #888;">Funding Call</td></tr>
                                            <tr><td align="center" style="padding: 2px 0;"><div style="width: 0px; border-left: 2px dotted #cccccc; height: 30px;"></div></td></tr>

                                            <tr><td align="center"><div style="width: 35px; height: 35px; background: #cccccc; border-radius: 50%; color: #ffffff; line-height: 35px; font-size: 18px;">X</div></td></tr>
                                            <tr><td align="center" style="font-size: 11px; padding: 5px 0; color: #888;">Funded</td></tr>
                                        </table>
                                    </td>

                                    <td valign="top" style="padding-left: 25px;">
                                        <p style="margin: 0 0 15px 0; font-size: 16px; color: #444;">Hi ${safeClientName}!</p>
                                        
                                        <p style="font-size: 15px; color: #666; line-height: 1.5;">
                                            Great news! Your application for 
                                            <strong style="color: #0b71a9;">'${safeCompanyName}'</strong> 
                                            has been <strong>successfully submitted</strong>.
                                        </p>

                                        <p style="font-size: 14px; color: #666; line-height: 1.5;">
                                            Our underwriting team will begin reviewing your request shortly.${hasValidPortalLink
            ? ' Use the button below to view status, leave comments, and upload documents — the same secure experience we use for approvals.'
            : ''
        }
                                        </p>

                                        ${portalButtonBlock}

                                        <p style="font-size: 13px; color: #777; margin-top: 20px; line-height: 1.4;">
                                            Need help or have questions? Open the link above — you can leave a comment for your representative from that page.
                                        </p>
                                        
                                        <table border="0" cellpadding="0" cellspacing="0" style="margin-top: 10px;">
                                            <tr>
                                                <td align="center" bgcolor="#eeeeee" style="border-radius: 5px;">
                                                    <a href="${hasValidPortalLink ? primaryHref : '#'}" style="display: inline-block; padding: 10px 20px; color: #555555; font-size: 14px; font-weight: bold; text-decoration: none;">Write a comment</a>
                                                </td>
                                            </tr>
                                        </table>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`
};

export async function sendApplicationSentToUnderwritingClientEmail({
    to,
    clientName,
    companyName,
    agentName,
    applicationNumber,
    viewApplicationUrl,
    publicPortalUrl,
}: ApplicationSentToUnderwritingClientEmailParams): Promise<void> {
    if (areApplicationNotificationEmailsDisabled()) return;

    const safeAppRef = applicationNumber != null && String(applicationNumber).trim() !== ''
        ? String(applicationNumber).trim()
        : '';
    const subject = safeAppRef
        ? `Your application #${safeAppRef} is with Underwriting`
        : 'Your application is with Underwriting';

    const html = buildApplicationSentToUnderwritingClientEmailHtml({
        clientName,
        companyName,
        agentName,
        applicationNumber,
        viewApplicationUrl,
        publicPortalUrl,
    });

    try {
        await sendMail({
            to,
            subject,
            html,
            attachments: buildBrandLogoAttachments(),
        });
    } catch (error) {
        // eslint-disable-next-line no-console
        console.error('Client sent-to-underwriting email send failed:', error);
    }
}

/** Client email when an Underwriter forwards the application to Final Underwriter (initial underwriting complete). */
export interface ApplicationUnderwritingCompletedClientEmailParams {
    to: string;
    clientName?: string;
    companyName?: string;
    /** Optional CRM deep link */
    viewApplicationUrl?: string;
    /** Public secure URL: /public/application/status/:token */
    publicPortalUrl?: string;
    applicationNumber?: number | string;
}

export const buildApplicationUnderwritingCompletedClientEmailHtml = ({
    clientName,
    companyName,
    viewApplicationUrl,
    publicPortalUrl,
}: Omit<ApplicationUnderwritingCompletedClientEmailParams, 'to' | 'applicationNumber'>): string => {
    const safeClientName = clientName || 'Valued Client';
    const safeCompanyName = companyName || 'your business';
    const externalHref = (publicPortalUrl || '').trim();
    const internalFallback = withApplicationDetailsOverviewHref(viewApplicationUrl);
    const primaryHref = externalHref || internalFallback;
    const hasValidPortalLink = primaryHref !== '#' && primaryHref.length > 1;

    const statusButtonBlock = hasValidPortalLink
        ? `<table border="0" cellpadding="0" cellspacing="0" style="margin: 20px 0;">
                                            <tr>
                                                <td align="center" bgcolor="#3b7ab0" style="border-radius: 5px;">
                                                    <a href="${primaryHref}" style="display: inline-block; padding: 12px 25px; color: #ffffff; font-size: 16px; font-weight: bold; text-decoration: none;">View Review Status</a>
                                                </td>
                                            </tr>
                                        </table>`
        : `<p style="font-size: 13px; color: #777;">We could not generate a secure portal link. Please contact your representative for an updated link.</p>`;

    return `<!DOCTYPE html>
<html>
<head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <title>Underwriting Completed</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
    ${buildBrandHeaderStyles()}
</head>
<body style="margin: 0; padding: 0; background-color: #f4f7f9; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;">
    <table border="0" cellpadding="0" cellspacing="0" width="100%">
        <tr>
            <td style="padding: 20px 0;">
                <table align="center" border="0" cellpadding="0" cellspacing="0" width="600" style="background-color: #ffffff; border: 1px solid #dddddd;">
                    
                    ${buildBrandHeaderRowHtml()}

                    <tr>
                        <td style="padding: 0 20px;">
                            <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background: linear-gradient(to right, #3b7ab0, #1a4a7c); background-color: #1a4a7c; border-radius: 8px;">
                                <tr>
                                    <td width="100" align="center" style="padding: 30px 0 30px 20px;">
                                        <div style="width: 70px; height: 70px; border: 2px solid #ffffff; border-radius: 50%; line-height: 70px; text-align: center; font-size: 35px; color: #ffffff;">✅</div>
                                    </td>
                                    <td style="padding: 30px 20px; color: #ffffff;">
                                        <div style="font-size: 22px; font-weight: bold; letter-spacing: 1px; margin-bottom: 5px;">UNDERWRITING COMPLETED</div>
                                        <div style="font-size: 14px; opacity: 0.9;">Great news! The initial underwriting review is finished.</div>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>

                    <tr>
                        <td style="padding: 30px 20px;">
                            <table border="0" cellpadding="0" cellspacing="0" width="100%">
                                <tr>
                                    <td width="120" valign="top" align="center">
                                        <table border="0" cellpadding="0" cellspacing="0" width="100%">
                                            <tr><td align="center"><div style="width: 35px; height: 35px; background: #0b71a9; border-radius: 50%; color: #ffffff; line-height: 35px; font-size: 18px;">✓</div></td></tr>
                                            <tr><td align="center" style="font-size: 11px; padding: 5px 0; color: #333; line-height: 1.2;">Application<br/>Submitted</td></tr>
                                            <tr><td align="center" style="padding: 2px 0;"><div style="width: 0px; border-left: 2.5px dotted #0b71a9; height: 30px;"></div></td></tr>

                                            <tr><td align="center"><div style="width: 35px; height: 35px; background: #0b71a9; border-radius: 50%; color: #ffffff; line-height: 35px; font-size: 18px;">✓</div></td></tr>
                                            <tr><td align="center" style="font-size: 11px; padding: 5px 0; color: #333; font-weight: bold;">Underwriting</td></tr>
                                            <tr><td align="center" style="padding: 2px 0;"><div style="width: 0px; border-left: 2px dotted #cccccc; height: 30px;"></div></td></tr>

                                            <tr><td align="center"><div style="width: 35px; height: 35px; background: #cccccc; border-radius: 50%; color: #ffffff; line-height: 35px; font-size: 18px;">X</div></td></tr>
                                            <tr><td align="center" style="font-size: 11px; padding: 5px 0; color: #888;">Approved</td></tr>
                                            <tr><td align="center" style="padding: 2px 0;"><div style="width: 0px; border-left: 2px dotted #cccccc; height: 30px;"></div></td></tr>

                                            <tr><td align="center"><div style="width: 35px; height: 35px; background: #cccccc; border-radius: 50%; color: #ffffff; line-height: 35px; font-size: 18px;">X</div></td></tr>
                                            <tr><td align="center" style="font-size: 11px; padding: 5px 0; color: #888;">Contract</td></tr>
                                            <tr><td align="center" style="padding: 2px 0;"><div style="width: 0px; border-left: 2px dotted #cccccc; height: 30px;"></div></td></tr>

                                            <tr><td align="center"><div style="width: 35px; height: 35px; background: #cccccc; border-radius: 50%; color: #ffffff; line-height: 35px; font-size: 18px;">X</div></td></tr>
                                            <tr><td align="center" style="font-size: 11px; padding: 5px 0; color: #888;">Funding Call</td></tr>
                                            <tr><td align="center" style="padding: 2px 0;"><div style="width: 0px; border-left: 2px dotted #cccccc; height: 30px;"></div></td></tr>

                                            <tr><td align="center"><div style="width: 35px; height: 35px; background: #cccccc; border-radius: 50%; color: #ffffff; line-height: 35px; font-size: 18px;">X</div></td></tr>
                                            <tr><td align="center" style="font-size: 11px; padding: 5px 0; color: #888;">Funded</td></tr>
                                        </table>
                                    </td>

                                    <td valign="top" style="padding-left: 25px;">
                                        <p style="margin: 0 0 15px 0; font-size: 16px; color: #444;">Hi ${safeClientName}!</p>
                                        
                                        <p style="font-size: 15px; color: #666; line-height: 1.5;">
                                            We are happy to inform you that our underwriters have finished 
                                            analyzing your application for <strong style="color: #0b71a9;">'${safeCompanyName}'</strong>.
                                        </p>

                                        <p style="font-size: 14px; color: #666; line-height: 1.5;">
                                            The review stage is now complete. Your application is being prepared for the <strong>Approval</strong> stage. Please check your dashboard to see if any specific conditions or additional documents are needed to finalize the offer.
                                        </p>

                                        ${statusButtonBlock}

                                        <p style="font-size: 13px; color: #777; margin-top: 20px; line-height: 1.4;">
                                            Our team will reach out shortly if further clarification is required. You can also leave a direct comment for the underwriter below.
                                        </p>
                                        
                                        <table border="0" cellpadding="0" cellspacing="0" style="margin-top: 10px;">
                                            <tr>
                                                <td align="center" bgcolor="#eeeeee" style="border-radius: 5px;">
                                                    <a href="${hasValidPortalLink ? primaryHref : '#'}" style="display: inline-block; padding: 10px 20px; color: #555555; font-size: 14px; font-weight: bold; text-decoration: none;">Write a Comment</a>
                                                </td>
                                            </tr>
                                        </table>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;
};

export async function sendApplicationUnderwritingCompletedClientEmail({
    to,
    clientName,
    companyName,
    viewApplicationUrl,
    publicPortalUrl,
    applicationNumber,
}: ApplicationUnderwritingCompletedClientEmailParams): Promise<void> {
    if (areApplicationNotificationEmailsDisabled()) return;

    const safeAppRef =
        applicationNumber != null && String(applicationNumber).trim() !== ''
            ? String(applicationNumber).trim()
            : '';
    const subject = safeAppRef
        ? `Application #${safeAppRef}: underwriting complete — next step is approval`
        : 'Your application: underwriting complete';

    const html = buildApplicationUnderwritingCompletedClientEmailHtml({
        clientName,
        companyName,
        viewApplicationUrl,
        publicPortalUrl,
    });

    try {
        await sendMail({
            to,
            subject,
            html,
            attachments: buildBrandLogoAttachments(),
        });
    } catch (error) {
        // eslint-disable-next-line no-console
        console.error('Client underwriting-completed email send failed:', error);
    }
}

export interface UnderwriterNewApplicationEmailParams {
    to: string;
    underwriterName?: string;
    agentName: string;
    applicationNumber?: number | string;
    clientName?: string;
    viewApplicationUrl?: string;
}

export async function sendUnderwriterNewApplicationEmail({
    to,
    underwriterName,
    agentName,
    applicationNumber,
    clientName,
    viewApplicationUrl,
}: UnderwriterNewApplicationEmailParams): Promise<void> {
    if (areApplicationNotificationEmailsDisabled()) {
        return;
    }

    const safeUnderwriterName = underwriterName || to;
    const safeAgentName = agentName || 'Agent';
    const safeClientName = clientName || 'Client';
    const safeApplicationNumber = applicationNumber ? String(applicationNumber) : '';

    const subject = `New application${safeApplicationNumber ? ` #${safeApplicationNumber}` : ''} sent to Underwriting`;

    const buttonHtml = viewApplicationUrl
        ? `<p style="margin:24px 0;">
        <a href="${viewApplicationUrl}"
           style="display:inline-block; padding:12px 18px; background-color:#1E88E5; color:#ffffff; text-decoration:none; font-family:Arial,Helvetica,sans-serif; font-size:14px; font-weight:600; border-radius:6px;">
          View application
        </a>
      </p>`
        : '';

    const html = `
    <div style="font-family:Arial,Helvetica,sans-serif; color:#111827; line-height:1.5;">
      <h2 style="margin:0 0 12px 0;">Hi ${safeUnderwriterName},</h2>
      <p style="margin:0 0 10px 0;">
        <strong>${safeAgentName}</strong> sent a new application${safeApplicationNumber ? ` <strong>#${safeApplicationNumber}</strong>` : ''} to <strong>Underwriting</strong>.
      </p>
      <p style="margin:0 0 10px 0;">
        Client: <strong>${safeClientName}</strong>
      </p>
      ${buttonHtml}
      <p style="margin:18px 0 0 0; font-size:12px; color:#6B7280;">
        This is an automated notification from In-House CRM.
      </p>
    </div>
  `;

    try {
        await sendMail(to, subject, html);
    } catch (error) {
        // eslint-disable-next-line no-console
        console.error('Underwriter new application email send failed:', error);
    }
}

/** Hostname (+ port) only, `www.` stripped — for detecting duplicate primary vs hosted link. */
function decisionLogicInvitationHostKey(raw: string): string | null {
    const t = String(raw || '').trim();
    if (!t || t.startsWith('(')) return null;
    try {
        const url = /^https?:/i.test(t) ? new URL(t) : new URL(`https://${t}`);
        const host = url.hostname.toLowerCase().replace(/^www\./, '');
        const port =
            url.port && url.port !== '80' && url.port !== '443'
                ? `:${url.port}`
                : '';
        return `${host}${port}`;
    } catch {
        return null;
    }
}

export async function sendDecisionLogicEmail(
    to: string,
    token: string,
): Promise<void> {
    if (!isOutboundSmtpConfigured()) {
        throw new Error(
            'Decision Logic invitation email cannot be sent: outbound mail is not configured. ' +
            'Set SENDGRID_API_KEY (recommended: SendGrid SMTP via smtp.sendgrid.net, user "apikey") ' +
            'or SMTP_AUTH_USER + SMTP_AUTH_PASS. Also set a verified From address: SMTP_FROM, MAIL_FROM, ' +
            'SENDGRID_FROM_EMAIL, or SENDGRID_AUTH_USER.',
        );
    }

    const hostedOrigin = String(
        process.env.WOODMERE_HOSTED_ORIGIN ||
            process.env.DECISION_LOGIC_HOSTED_FALLBACK_ORIGIN ||
            'https://woodmere.finexusai.com',

    )
        .trim()
        .replace(/\/$/, '');
    const base =
        resolveDecisionLogicInvitationBaseUrl() ||
        resolveCrmFrontendBaseUrl()?.replace(/\/$/, '') ||
        '';
    const link = base
        ? `${base}/decision-logic?token=${encodeURIComponent(token)}`
        : `(configure a frontend base URL in env) token=${encodeURIComponent(token)}`;
    const hostedLink = `${hostedOrigin}/decision-logic?token=${encodeURIComponent(token)}`;
    let hostedLinkHostname = 'hosted site';
    try {
        hostedLinkHostname = new URL(hostedOrigin).hostname;
    } catch {
        /* keep fallback label */
    }
    const primaryHost = decisionLogicInvitationHostKey(base);
    const hostedHost = decisionLogicInvitationHostKey(hostedOrigin);
    const primaryIsHosted =
        primaryHost != null &&
        hostedHost != null &&
        primaryHost === hostedHost;
    const subject = 'Bank verification — Decision Logic';
    const hostedBlock =
        primaryIsHosted
            ? ''
            : `
      <p style="margin-top:14px;"><a href="${hostedLink}">Open Decision Logic (hosted — woodmere.finexusai.com)</a></p>
      <p style="font-size:12px; color:#6B7280;">Hosted URL (copy/paste): ${hostedLink}</p>
    `;
    const html = `
    <div style="font-family:Arial,Helvetica,sans-serif; color:#111827; line-height:1.5;">
      <p>You have been invited to complete bank verification.</p>
      <p><a href="${link}">Open Decision Logic</a></p>
      <p style="font-size:12px; color:#6B7280;">If the link does not work, copy and paste this URL: ${link}</p>
      ${hostedBlock}
    </div>
  `;
    await sendMail(to, subject, html);
}

