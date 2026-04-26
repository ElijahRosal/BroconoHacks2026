import { Resend } from "resend";

import { getServerEnv } from "@/lib/env";

function getResendClient() {
  const { RESEND_API_KEY } = getServerEnv();

  if (!RESEND_API_KEY) {
    throw new Error("Missing RESEND_API_KEY. Configure it in .env.local.");
  }

  return new Resend(RESEND_API_KEY);
}

function resolveOrigin(requestOrigin?: string) {
  const nextAuthUrl = process.env.NEXTAUTH_URL?.trim();
  if (nextAuthUrl) {
    return nextAuthUrl;
  }

  if (requestOrigin) {
    return requestOrigin;
  }

  throw new Error("Unable to resolve app origin for verification URL.");
}

export async function sendVerificationEmail(params: {
  toEmail: string;
  token: string;
  requestOrigin?: string;
}) {
  const { EMAIL_FROM } = getServerEnv();
  if (!EMAIL_FROM) {
    throw new Error("Missing EMAIL_FROM. Configure it in .env.local.");
  }

  const resend = getResendClient();
  const origin = resolveOrigin(params.requestOrigin);
  const verifyUrl = `${origin}/verify-email?token=${encodeURIComponent(params.token)}`;

  await resend.emails.send({
    from: EMAIL_FROM,
    to: params.toEmail,
    subject: "Verify your email for AI Citation Finder",
    html: `
      <p>Welcome to AI Citation Finder &amp; Generator.</p>
      <p>Please verify your email to activate your account:</p>
      <p><a href="${verifyUrl}">Verify email</a></p>
      <p>If you did not create this account, you can ignore this email.</p>
    `,
  });
}
