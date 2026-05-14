import { google, gmail_v1 } from 'googleapis';
import oAuth2Client from '../config/gmail';

const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });

export interface PdfAttachment {
  attachmentId: string;
  filename: string;
}

export async function fetchNewEmails(): Promise<gmail_v1.Schema$Message[]> {
  const res = await gmail.users.messages.list({
    userId: 'me',
    q: 'is:unread',
  });
  return res.data.messages || [];
}

export async function getEmailDetails(messageId: string): Promise<gmail_v1.Schema$Message> {
  const res = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'full',
  });
  return res.data;
}

export async function getAttachment(messageId: string, attachmentId: string): Promise<Buffer> {
  const res = await gmail.users.messages.attachments.get({
    userId: 'me',
    messageId,
    id: attachmentId,
  });
  return Buffer.from(res.data.data!, 'base64');
}

export function extractPdfAttachments(email: gmail_v1.Schema$Message): PdfAttachment[] {
  const parts = email.payload?.parts || [];
  return parts
    .filter(part => part.filename && part.filename.endsWith('.pdf') && part.body?.attachmentId)
    .map(part => ({ attachmentId: part.body!.attachmentId!, filename: part.filename! }));
}

export async function markAsRead(messageId: string): Promise<void> {
  await gmail.users.messages.modify({
    userId: 'me',
    id: messageId,
    requestBody: { removeLabelIds: ['UNREAD'] },
  });
}