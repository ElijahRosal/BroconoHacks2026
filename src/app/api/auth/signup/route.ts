import bcrypt from "bcryptjs";

import { apiError, apiSuccess } from "@/lib/api";
import { sendVerificationEmail } from "@/lib/email";
import {
  createEmailVerificationToken,
  createUser,
  findUserByEmail,
} from "@/lib/models/user";

interface SignUpBody {
  email?: string;
  password?: string;
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function POST(request: Request) {
  let body: SignUpBody;

  try {
    body = (await request.json()) as SignUpBody;
  } catch {
    return apiError("BAD_REQUEST", "Request body must be valid JSON.", 400);
  }

  const email = body.email?.trim().toLowerCase() ?? "";
  const password = body.password ?? "";

  if (!email || !password) {
    return apiError("BAD_REQUEST", "Email and password are required.", 400);
  }

  if (!isValidEmail(email)) {
    return apiError("BAD_REQUEST", "Enter a valid email address.", 400);
  }

  if (password.length < 8) {
    return apiError("BAD_REQUEST", "Password must be at least 8 characters.", 400);
  }

  try {
    const existing = await findUserByEmail(email);
    if (existing) {
      return apiError("CONFLICT", "An account with this email already exists.", 409);
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await createUser(email, passwordHash);

    if (!user) {
      return apiError("INTERNAL_ERROR", "Failed to create account.", 500);
    }

    const { token } = await createEmailVerificationToken(user._id);
    const origin = new URL(request.url).origin;

    await sendVerificationEmail({
      toEmail: user.email,
      token,
      requestOrigin: origin,
    });

    return apiSuccess({
      message: "Account created. Check your email to verify before logging in.",
    }, 201);
  } catch (error) {
    return apiError(
      "INTERNAL_ERROR",
      "Sign up failed. Please retry.",
      500,
      error instanceof Error ? error.message : "Unknown sign up error"
    );
  }
}
