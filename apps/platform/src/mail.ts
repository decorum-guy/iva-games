import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import nodemailer from 'nodemailer';
import type { MailMessage, MailTransport } from './types.js';

export class MemoryMailbox implements MailTransport {
  readonly messages: MailMessage[] = [];
  async send(message: MailMessage): Promise<void> { this.messages.push({ ...message }); }
}

/** Explicit development sink. No message is sent over the network. */
export function createFileMailbox(directory: string): MailTransport {
  const root = resolve(directory);
  return { async send(message) {
    await mkdir(root, { recursive: true, mode: 0o700 });
    const filename = `${Date.now()}-${randomUUID()}.eml`;
    const contents = `To: ${message.to}\nSubject: ${message.subject}\nContent-Type: text/plain; charset=utf-8\nX-Iva-Development-Mail: ${message.kind}\n\n${message.text}\n`;
    await writeFile(resolve(root, filename), contents, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  } };
}

export function createSmtpMailbox(options: { host: string; port: number; secure: boolean; user?: string; password?: string; from: string }): MailTransport {
  const transport = nodemailer.createTransport({
    host: options.host, port: options.port, secure: options.secure,
    requireTLS: !options.secure,
    auth: options.user ? { user: options.user, pass: options.password } : undefined,
    tls: { rejectUnauthorized: true }, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000,
    disableFileAccess: true, disableUrlAccess: true,
  });
  return { async send(message) {
    const info = await transport.sendMail({ from: options.from, to: message.to, subject: message.subject, text: message.text });
    if (!info.accepted?.length || info.rejected?.length) throw new Error('Email delivery was not accepted by SMTP');
  } };
}
