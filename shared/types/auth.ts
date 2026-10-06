import z from "zod";

// ============================================
// Password policy (DRY — shared by register, reset, change)
// ============================================

/**
 * Minimum length for passwords entered by the user.
 * (Not enforced on the login form — see `loginSchema`.)
 */
const MIN_PASSWORD_LENGTH = 8;

/**
 * Complexity regex reused across every form that lets the user pick a password.
 * Requires at least one lowercase, one uppercase, one digit, and one special
 * character from the set `@$!%*?&`.
 */
const PASSWORD_COMPLEXITY_REGEX =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/;

/** The reusable password field with length + complexity rules. */
export const passwordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, "Password must be at least 8 characters")
  .max(128, "Password must not exceed 128 characters")
  .regex(
    PASSWORD_COMPLEXITY_REGEX,
    "Password must include at least one uppercase letter, one lowercase letter, one number, and one special character",
  );

// ============================================
// Register Types
// ============================================

export const registerSchema = z
  .object({
    name: z
      .string()
      .min(2, "Full name must be at least 2 characters")
      .max(100, "Full name cannot exceed 100 characters"),
    email: z
      .string()
      .min(1, "Email address is required")
      .email("Please enter a valid email address"),
    password: passwordSchema,
    confirmPassword: z
      .string()
      .min(1, "Please confirm your password"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type RegisterFormValues = z.infer<typeof registerSchema>;

// ============================================
// Login Types
// ============================================

export const loginSchema = z.object({
  email: z
    .string()
    .min(1, "Email address is required")
    .email("Please enter a valid email address"),
  password: z.string().min(1, "Password is required"),
  rememberMe: z.boolean(),
});

export type LoginFormValues = z.infer<typeof loginSchema>;

// ============================================
// Verify Types and Constants
// ============================================

export type VerificationStatus = "verifying" | "success" | "error";

/** Friendly copy for the error codes better-auth appends to the callback URL. */
export const ERROR_MESSAGES: Record<string, string> = {
  INVALID_TOKEN:
    "This verification link is invalid. Request a fresh link below and try again.",
  TOKEN_EXPIRED:
    "This verification link has expired. Request a fresh link below and try again.",
  INVALID_TOKEN_OR_TOKEN_EXPIRED:
    "This verification link is invalid or has expired. Request a fresh link below and try again.",
  EMAIL_MISMATCH:
    "This verification link doesn't match the requested account. Please request a new one.",
};

// ============================================
// Forgot Password Types
// ============================================

export const forgotPasswordSchema = z.object({
  email: z
    .string()
    .min(1, "Email address is required")
    .email("Please enter a valid email address"),
});

export type ForgotPasswordFormValues = z.infer<typeof forgotPasswordSchema>;

// ============================================
// Reset Password Types
// ============================================

export const resetPasswordSchema = z
  .object({
    newPassword: passwordSchema,
    confirmPassword: z
      .string()
      .min(1, "Please confirm your new password"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type ResetPasswordFormValues = z.infer<typeof resetPasswordSchema>;

// ============================================
// Change Password Types (Settings → Security)
// ============================================

export const changePasswordSchema = z
  .object({
    currentPassword: z
      .string()
      .min(1, "Enter your current password."),
    newPassword: passwordSchema,
    confirmPassword: z
      .string()
      .min(1, "Please confirm your new password"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type ChangePasswordFormValues = z.infer<typeof changePasswordSchema>;
