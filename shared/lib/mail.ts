import nodemailer, { type Transporter } from "nodemailer";

import { env } from "@/config/env";

// ============================================
// Transporter
// ============================================

let transporter: Transporter | null = null;

/** Lazily create (and cache) the Nodemailer SMTP transporter. */
function getTransporter(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      // Port 465 requires implicit TLS; every other port upgrades via STARTTLS.
      secure: env.SMTP_SECURE,
      auth: {
        user: env.SMTP_USER,
        pass: env.SMTP_PASS,
      },
    });
  }

  return transporter;
}

/** "From" header – falls back to the authenticated SMTP user. */
const FROM_ADDRESS = env.SMTP_FROM ?? `Velora <${env.SMTP_USER}>`;

// ============================================
// Generic helpers
// ============================================

export interface SendMailOptions {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/** Send a single transactional email through the configured SMTP server. */
export async function sendMail({ to, subject, html, text }: SendMailOptions) {
  return getTransporter().sendMail({
    from: FROM_ADDRESS,
    to,
    subject,
    html,
    text,
  });
}

// ============================================
// Transactional email senders
// ============================================

export const VERIFICATION_EMAIL_SUBJECT =
  "Verify your email address to activate your Velora account";

// ============================================
// Password reset
// ============================================

export const PASSWORD_RESET_EMAIL_SUBJECT = "Reset your Velora password";

export interface SendPasswordResetEmailOptions {
  to: string;
  name: string;
  url: string;
}

/** Send the branded "reset your password" message (60-minute link). */
export async function sendPasswordResetEmail({
  to,
  name,
  url,
}: SendPasswordResetEmailOptions) {
  const firstName = name?.trim().split(/\s+/)[0] || "there";

  return sendMail({
    to,
    subject: PASSWORD_RESET_EMAIL_SUBJECT,
    html: renderPasswordResetEmail({ name: firstName, email: to, url }),
    text: [
      `Hi ${firstName},`,
      "",
      "We received a request to reset the password for your Velora account.",
      "Choose a new password using this link:",
      url,
      "",
      "This link expires in 60 minutes. If you didn't request a password reset you can ignore this email — your password stays the same.",
    ].join("\n"),
  });
}

interface PasswordResetEmailTemplateOptions {
  name: string;
  email: string;
  url: string;
}

/** Branded password-reset email — mirrors the verification email layout. */
export function renderPasswordResetEmail({
  name,
  email,
  url,
}: PasswordResetEmailTemplateOptions): string {
  return `<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:0;background-color:#f4f2ee;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#1c211f;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f2ee;padding:32px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background-color:#ffffff;border:1px solid #e6e2da;border-radius:20px;overflow:hidden;">
            <tr>
              <td style="background-color:#365f54;padding:28px 32px;">
                <p style="margin:0;font-size:20px;font-weight:600;letter-spacing:0.24em;color:#ffffff;">VELORA</p>
                <p style="margin:6px 0 0;font-size:13px;color:#d8c7ae;">Timeless style, thoughtfully curated.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#1c211f;">Reset your password</h1>
                <p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#4a524e;">Hi ${name},</p>
                <p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#4a524e;">
                  We received a request to reset the password for
                  <strong style="color:#1c211f;">${email}</strong>.
                  Choose a new password using the button below.
                </p>
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0;">
                  <tr>
                    <td style="background-color:#365f54;border-radius:999px;">
                      <a href="${url}" style="display:inline-block;padding:14px 34px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">Reset password</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#6b736e;">
                  Button not working? Copy and paste this link into your browser:
                </p>
                <p style="margin:0 0 20px;font-size:13px;line-height:1.6;color:#365f54;word-break:break-all;">${url}</p>
                <p style="margin:0;font-size:13px;line-height:1.6;color:#6b736e;">
                  This link expires in 60 minutes. All other sessions will be signed out automatically.
                </p>
              </td>
            </tr>
            <tr>
              <td style="background-color:#faf8f5;border-top:1px solid #eee9e1;padding:20px 32px;">
                <p style="margin:0;font-size:12px;line-height:1.6;color:#8b938e;">
                  If you didn't request a password reset, you can safely ignore this email — your password stays the same.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

// ============================================
// Verification email template
// ============================================

export interface SendVerificationEmailOptions {
  to: string;
  name: string;
  url: string;
}

/** Send the branded "confirm your email address" message. */
export async function sendVerificationEmail({
  to,
  name,
  url,
}: SendVerificationEmailOptions) {
  const firstName = name?.trim().split(/\s+/)[0] || "there";

  return sendMail({
    to,
    subject: VERIFICATION_EMAIL_SUBJECT,
    html: renderVerificationEmail({ name: firstName, email: to, url }),
    text: [
      `Hi ${firstName},`,
      "",
      "Thanks for joining Velora. Confirm your email address to activate your account:",
      url,
      "",
      "This link expires in 24 hours. If you didn't create a Velora account you can ignore this email.",
    ].join("\n"),
  });
}

interface VerificationEmailTemplateOptions {
  name: string;
  email: string;
  url: string;
}

/** Inline-styled, table-based HTML so it renders consistently across clients. */
export function renderVerificationEmail({
  name,
  email,
  url,
}: VerificationEmailTemplateOptions): string {
  return `<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:0;background-color:#f4f2ee;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#1c211f;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f2ee;padding:32px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background-color:#ffffff;border:1px solid #e6e2da;border-radius:20px;overflow:hidden;">
            <tr>
              <td style="background-color:#365f54;padding:28px 32px;">
                <p style="margin:0;font-size:20px;font-weight:600;letter-spacing:0.24em;color:#ffffff;">VELORA</p>
                <p style="margin:6px 0 0;font-size:13px;color:#d8c7ae;">Timeless style, thoughtfully curated.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#1c211f;">Confirm your email address</h1>
                <p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#4a524e;">Hi ${name},</p>
                <p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#4a524e;">
                  Thanks for joining Velora. Verify <strong style="color:#1c211f;">${email}</strong> to activate
                  your account and start shopping.
                </p>
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0;">
                  <tr>
                    <td style="background-color:#365f54;border-radius:999px;">
                      <a href="${url}" style="display:inline-block;padding:14px 34px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">Verify email</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#6b736e;">
                  Button not working? Copy and paste this link into your browser:
                </p>
                <p style="margin:0 0 20px;font-size:13px;line-height:1.6;color:#365f54;word-break:break-all;">${url}</p>
                <p style="margin:0;font-size:13px;line-height:1.6;color:#6b736e;">
                  This link expires in 24 hours.
                </p>
              </td>
            </tr>
            <tr>
              <td style="background-color:#faf8f5;border-top:1px solid #eee9e1;padding:20px 32px;">
                <p style="margin:0;font-size:12px;line-height:1.6;color:#8b938e;">
                  If you didn't create a Velora account, you can safely ignore this email.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
