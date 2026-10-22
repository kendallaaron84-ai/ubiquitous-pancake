import "server-only";

import nodemailer from "nodemailer";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;

export interface WelcomePackagePayload {
  toEmail: string;
  authorName: string;
  studioKey: string;
  pluginDownloadUrl: string;
  accountSetupUrl: string;
  deliveryId: string;
}

export interface SupportIncidentAlertPayload {
  toEmails: string[];
  ticketId: string;
  errorCategory: string;
  authorEmail: string;
  studioKey: string;
  targetWpOrigin: string;
  provider?: string;
  httpStatus?: number;
}

export interface WelcomePackageResult {
  success: true;
  messageId: string;
}

function requireEnvironmentValue(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required mail configuration: ${name}.`);
  }
  return value;
}

function validateDashboardUrl(value: string): string {
  const parsed = new URL(value);
  const isLocalDevelopment =
    process.env.NODE_ENV !== "production" &&
    parsed.protocol === "http:" &&
    (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1");

  if (parsed.protocol !== "https:" && !isLocalDevelopment) {
    throw new Error("KOBA_DASHBOARD_URL must use HTTPS outside local development.");
  }
  return parsed.toString();
}

function validatePluginDownloadUrl(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:") {
    throw new Error("The plugin download URL must use HTTPS.");
  }
  return parsed.toString();
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>'"]/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;",
      })[character] || character,
  );
}

function getTransporter(): ReturnType<typeof nodemailer.createTransport> {
  if (transporter) return transporter;

  const senderEmail = requireEnvironmentValue("GOOGLE_WORKSPACE_EMAIL");
  const appPassword = requireEnvironmentValue(
    "GOOGLE_WORKSPACE_APP_PASSWORD",
  ).replace(/\s+/g, "");

  transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: {
      user: senderEmail,
      pass: appPassword,
    },
  });
  return transporter;
}

export async function sendWelcomePackage({
  toEmail,
  authorName,
  studioKey,
  pluginDownloadUrl,
  accountSetupUrl,
  deliveryId,
}: WelcomePackagePayload): Promise<WelcomePackageResult> {
  const recipient = toEmail.trim().toLowerCase();
  const name = authorName.trim();
  const key = studioKey.trim();

  if (!EMAIL_PATTERN.test(recipient)) {
    throw new Error("A valid welcome-package recipient is required.");
  }
  if (!name) throw new Error("The author's name is required.");
  if (!key) throw new Error("A StudioKey is required.");

  const senderEmail = requireEnvironmentValue("GOOGLE_WORKSPACE_EMAIL");
  const validatedPluginDownloadUrl =
    validatePluginDownloadUrl(pluginDownloadUrl);
  const validatedAccountSetupUrl = validateDashboardUrl(accountSetupUrl);
  const safeName = escapeHtml(name);
  const safeKey = escapeHtml(key);
  const safePluginDownloadUrl = escapeHtml(validatedPluginDownloadUrl);
  const safeAccountSetupUrl = escapeHtml(validatedAccountSetupUrl);

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:0 auto;padding:24px;border:1px solid #dbe3ef;border-radius:12px;color:#1e293b;background:#ffffff;line-height:1.6;">
      <h1 style="margin:0 0 4px;color:#733026;font-size:24px;">Welcome to KOBA-I Audio</h1>
      <p style="margin:0 0 24px;color:#64748b;font-size:14px;">Your direct-to-reader author workspace is ready.</p>

      <p>Dear ${safeName},</p>
      <p>Your secure workspace credentials and WordPress plugin are ready. Keep your StudioKey private and enter it exactly as shown.</p>

      <div style="margin:20px 0;padding:16px;border:1px solid #cbd5e1;border-radius:8px;background:#f8fafc;font-size:14px;">
        <strong>Your Assigned StudioKey:</strong><br />
        <span style="font-family:Consolas,Monaco,monospace;word-break:break-all;">${safeKey}</span>
      </div>

      <p style="margin:20px 0;">
        <a href="${safeAccountSetupUrl}" style="display:inline-block;padding:12px 20px;border-radius:6px;background:#733026;color:#ffffff !important;text-decoration:none;font-weight:700;">Establish your workspace identity</a>
      </p>

      <h2 style="margin:28px 0 8px;color:#0f172a;font-size:18px;">Connect your WordPress website</h2>
      <p>Download the KOBA-I Audio plugin package and install it through your WordPress dashboard.</p>
      <p style="margin:18px 0 24px;">
        <a href="${safePluginDownloadUrl}" style="display:inline-block;padding:12px 20px;border-radius:6px;background:#f97316;color:#000000 !important;text-decoration:none;font-weight:700;">Download KOBA-I Audio Plugin (.zip)</a>
      </p>

      <div style="margin:28px 0;padding:20px;border:1px solid #cbd5e1;border-radius:10px;background:#f8fafc;">
        <h2 style="margin:0 0 8px;color:#733026;font-size:20px;">Getting Started with KOBA-I Audio</h2>
        <p style="margin:0 0 18px;color:#475569;">You do not need to be tech savvy. Follow these four steps, and reply to this email if you would like help.</p>

        <h3 style="margin:18px 0 6px;color:#0f172a;font-size:15px;"><span style="color:#f97316;">1.</span> Claim your Command Center account</h3>
        <p style="margin:0;color:#475569;">Use the secure, single-use account-establishment button above to create your password. The link expires after 72 hours. After setup, sign in normally with this email address.</p>

        <h3 style="margin:18px 0 6px;color:#0f172a;font-size:15px;"><span style="color:#f97316;">2.</span> Download and install the WordPress plugin</h3>
        <p style="margin:0;color:#475569;">In WordPress, go to <strong>Plugins → Add New → Upload Plugin</strong>. Select <strong>koba-i-audio.zip</strong>, choose Install Now, and then Activate.</p>

        <h3 style="margin:18px 0 6px;color:#0f172a;font-size:15px;"><span style="color:#f97316;">3.</span> Activate your StudioKey</h3>
        <p style="margin:0;color:#475569;">Open <strong>Jubilee Activation</strong> or <strong>KOBA-I Audio</strong> in WordPress, enter <strong>${safeKey}</strong>, and select Verify &amp; Activate. A green confirmation will appear when your site is paired.</p>

        <h3 style="margin:18px 0 6px;color:#0f172a;font-size:15px;"><span style="color:#f97316;">4.</span> Optional Content Engine connection</h3>
        <p style="margin:0;color:#475569;">Create a WordPress Application Password named <strong>KOBA-I Content Engine</strong>. In your KOBA-I dashboard, open <strong>Setup &amp; Connections</strong>, enter your WordPress site and username, paste the Application Password, and select Verify and connect my site. Never send or enter your normal WordPress password.</p>
      </div>

      <h2 style="margin:28px 0 8px;color:#0f172a;font-size:17px;">Your pages are created for you</h2>
      <p>KOBA-I Audio automatically creates the required WordPress pages and adds the correct shortcodes. You do not need to build these pages or understand code.</p>
      <div style="padding:14px;border:1px solid #cbd5e1;border-radius:8px;background:#f8fafc;color:#475569;font-size:13px;">
        <strong>Reference only:</strong><br />
        Single publication: <code>[koba_reader asset="your_asset_id"]</code><br />
        Full bookshelf: <code>[koba_window]</code>
      </div>

      <h2 style="margin:28px 0 8px;color:#991b1b;font-size:17px;">Acceptable Use Policy</h2>
      <div style="padding:16px;border:1px solid #fca5a5;border-radius:8px;background:#fef2f2;color:#475569;font-size:13px;">
        <p style="margin-top:0;">By downloading the plugin or using the KOBA-I dashboard, you agree to these platform boundaries:</p>
        <ul style="padding-left:20px;margin-bottom:0;">
          <li><strong>Content guardrails:</strong> Hate speech, racist content, harassment, and content promoting human trafficking are prohibited.</li>
          <li><strong>Zero-tolerance suspension:</strong> Child-endangerment content results in immediate and permanent suspension of plugin authorization, dashboard access, and downstream access tokens.</li>
          <li><strong>Digital purchases:</strong> Digital keys and software are delivered immediately. Applicable purchase and refund terms remain part of your accepted service agreement.</li>
        </ul>
      </div>

      <p style="margin-top:24px;">If you need support, reply directly to this email.</p>
      <p style="margin:24px 0 0;color:#0f172a;font-weight:700;">
        Kendall Aaron<br />
        <span style="color:#64748b;font-size:12px;font-weight:400;">Platform Owner, KOBA-I</span>
      </p>
    </div>
  `;

  const text = [
    `Welcome to KOBA-I Audio, ${name}.`,
    "Your author workspace is ready.",
    `StudioKey: ${key}`,
    `Secure account setup (single use; expires after 72 hours): ${validatedAccountSetupUrl}`,
    `Plugin download: ${validatedPluginDownloadUrl}`,
    "GETTING STARTED",
    "1. Claim your Command Center account: Open the secure account-setup link and create your password. After setup, sign in normally with this email address.",
    "2. Install the plugin: In WordPress, open Plugins > Add New > Upload Plugin, select koba-i-audio.zip, install it, and activate it.",
    `3. Activate your StudioKey: Open Jubilee Activation or KOBA-I Audio in WordPress, enter ${key}, and select Verify & Activate.`,
    "4. Optional Content Engine connection: Create a WordPress Application Password named KOBA-I Content Engine. Open Setup & Connections in your KOBA-I dashboard, enter your site address and WordPress username, paste the generated Application Password, and select Verify and connect my site. Never send or enter your normal WordPress password.",
    'Single publication shortcode: [koba_reader asset="your_asset_id"]',
    "Full bookshelf shortcode: [koba_window]",
    "You do not need to be tech savvy. KOBA-I Audio automatically creates the required WordPress pages and adds the correct shortcodes for you. The shortcode reference simply explains what the plugin does behind the scenes.",
    "Acceptable Use Policy: Hate speech, racist content, harassment, human-trafficking content, and child-endangerment content are prohibited. Child-endangerment content results in immediate permanent suspension.",
    "Digital purchase and refund terms remain governed by your accepted service agreement.",
    "Kendall Aaron — Platform Owner, KOBA-I",
  ].join("\n\n");

  try {
    const info = await getTransporter().sendMail({
      messageId: `<koba-welcome-${deliveryId.replace(/[^a-zA-Z0-9_-]/g, "")}@koba-i.com>`,
      from: {
        name: "Kendall Aaron",
        address: senderEmail,
      },
      replyTo: senderEmail,
      to: recipient,
      subject: "Welcome to KOBA-I Audio — Your Studio Access",
      text,
      html,
    });

    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error(
      "[KOBA-I Mailer] Welcome-package delivery failed:",
      error instanceof Error ? error.message : "Unknown mail transport error.",
    );
    throw new Error("Welcome-package email delivery failed.");
  }
}

export async function sendSupportIncidentAlert({
  toEmails,
  ticketId,
  errorCategory,
  authorEmail,
  studioKey,
  targetWpOrigin,
  provider,
  httpStatus,
}: SupportIncidentAlertPayload): Promise<WelcomePackageResult> {
  const recipients = Array.from(
    new Set(
      toEmails
        .map((email) => email.trim().toLowerCase())
        .filter((email) => EMAIL_PATTERN.test(email)),
    ),
  );
  if (recipients.length === 0) {
    throw new Error("No valid support-alert recipients are configured.");
  }

  const senderEmail = requireEnvironmentValue("GOOGLE_WORKSPACE_EMAIL");
  const safeTicketId = escapeHtml(ticketId);
  const safeCategory = escapeHtml(errorCategory);
  const safeAuthorEmail = escapeHtml(authorEmail);
  const safeStudioKey = escapeHtml(studioKey);
  const safeOrigin = escapeHtml(targetWpOrigin);
  const safeProvider = escapeHtml(provider || "Not identified");
  const safeHttpStatus = escapeHtml(
    typeof httpStatus === "number" ? String(httpStatus) : "Unavailable",
  );
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:620px;margin:0 auto;padding:24px;border:1px solid #dbe3ef;border-radius:12px;color:#1e293b;background:#ffffff;line-height:1.55;">
      <h1 style="margin:0 0 8px;color:#733026;font-size:22px;">KOBA-I Connection Support Incident</h1>
      <p style="margin:0 0 22px;color:#64748b;">A WordPress infrastructure connection requires owner review.</p>
      <table role="presentation" style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr><td style="padding:8px;border:1px solid #cbd5e1;font-weight:700;">Reference</td><td style="padding:8px;border:1px solid #cbd5e1;">${safeTicketId}</td></tr>
        <tr><td style="padding:8px;border:1px solid #cbd5e1;font-weight:700;">Category</td><td style="padding:8px;border:1px solid #cbd5e1;">${safeCategory}</td></tr>
        <tr><td style="padding:8px;border:1px solid #cbd5e1;font-weight:700;">Author</td><td style="padding:8px;border:1px solid #cbd5e1;">${safeAuthorEmail}</td></tr>
        <tr><td style="padding:8px;border:1px solid #cbd5e1;font-weight:700;">StudioKey</td><td style="padding:8px;border:1px solid #cbd5e1;">${safeStudioKey}</td></tr>
        <tr><td style="padding:8px;border:1px solid #cbd5e1;font-weight:700;">WordPress site</td><td style="padding:8px;border:1px solid #cbd5e1;">${safeOrigin}</td></tr>
        <tr><td style="padding:8px;border:1px solid #cbd5e1;font-weight:700;">Detected provider</td><td style="padding:8px;border:1px solid #cbd5e1;">${safeProvider}</td></tr>
        <tr><td style="padding:8px;border:1px solid #cbd5e1;font-weight:700;">HTTP status</td><td style="padding:8px;border:1px solid #cbd5e1;">${safeHttpStatus}</td></tr>
      </table>
      <p style="margin:20px 0 0;color:#64748b;font-size:12px;">No WordPress password, authorization header, or raw firewall response is included in this alert.</p>
    </div>
  `;
  const text = [
    "KOBA-I Connection Support Incident",
    `Reference: ${ticketId}`,
    `Category: ${errorCategory}`,
    `Author: ${authorEmail}`,
    `StudioKey: ${studioKey}`,
    `WordPress site: ${targetWpOrigin}`,
    `Detected provider: ${provider || "Not identified"}`,
    `HTTP status: ${typeof httpStatus === "number" ? httpStatus : "Unavailable"}`,
    "No WordPress password, authorization header, or raw firewall response is included.",
  ].join("\n");

  const info = await getTransporter().sendMail({
    from: {
      name: "KOBA-I Support Monitor",
      address: senderEmail,
    },
    replyTo: senderEmail,
    to: recipients,
    subject: `[${ticketId}] WordPress connection incident`,
    text,
    html,
  });

  return {
    success: true,
    messageId: info.messageId,
  };
}
