import { describe, it, expect } from "vitest";
import {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
  passwordSchema,
  type RegisterFormValues,
  type LoginFormValues,
  type ResetPasswordFormValues,
  type ChangePasswordFormValues,
} from "@/shared/types/auth";

describe("Auth Schemas", () => {
  describe("passwordSchema", () => {
    it("accepts valid password with all required character types", () => {
      const result = passwordSchema.safeParse("SecureP@ss123");
      expect(result.success).toBe(true);
    });

    it("rejects password shorter than 8 characters", () => {
      const result = passwordSchema.safeParse("Short1!");
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain("at least 8");
      }
    });

    it("rejects password without uppercase", () => {
      const result = passwordSchema.safeParse("securep@ss123");
      expect(result.success).toBe(false);
    });

    it("rejects password without lowercase", () => {
      const result = passwordSchema.safeParse("SECUREP@SS123");
      expect(result.success).toBe(false);
    });

    it("rejects password without number", () => {
      const result = passwordSchema.safeParse("SecureP@ss");
      expect(result.success).toBe(false);
    });

    it("rejects password without special character", () => {
      const result = passwordSchema.safeParse("SecurePass123");
      expect(result.success).toBe(false);
    });

    it("rejects password exceeding 128 characters", () => {
      const longPassword = "A".repeat(126) + "a1@";
      const result = passwordSchema.safeParse(longPassword);
      expect(result.success).toBe(false);
    });
  });

  describe("registerSchema", () => {
    const validRegisterData: RegisterFormValues = {
      name: "John Doe",
      email: "john@example.com",
      password: "SecureP@ss123",
      confirmPassword: "SecureP@ss123",
    };

    it("accepts valid registration data", () => {
      const result = registerSchema.safeParse(validRegisterData);
      expect(result.success).toBe(true);
    });

    it("rejects empty name", () => {
      const result = registerSchema.safeParse({ ...validRegisterData, name: "" });
      expect(result.success).toBe(false);
    });

    it("rejects name shorter than 2 characters", () => {
      const result = registerSchema.safeParse({ ...validRegisterData, name: "J" });
      expect(result.success).toBe(false);
    });

    it("rejects invalid email", () => {
      const result = registerSchema.safeParse({ ...validRegisterData, email: "not-an-email" });
      expect(result.success).toBe(false);
    });

    it("rejects mismatched passwords", () => {
      const result = registerSchema.safeParse({ ...validRegisterData, confirmPassword: "Different1!" });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toContain("confirmPassword");
      }
    });

    it("applies password complexity rules to register password", () => {
      const result = registerSchema.safeParse({ ...validRegisterData, password: "weak", confirmPassword: "weak" });
      expect(result.success).toBe(false);
    });
  });

  describe("loginSchema", () => {
    const validLoginData: LoginFormValues = {
      email: "john@example.com",
      password: "anypassword",
      rememberMe: false,
    };

    it("accepts valid login data", () => {
      const result = loginSchema.safeParse(validLoginData);
      expect(result.success).toBe(true);
    });

    it("rejects empty email", () => {
      const result = loginSchema.safeParse({ ...validLoginData, email: "" });
      expect(result.success).toBe(false);
    });

    it("rejects invalid email format", () => {
      const result = loginSchema.safeParse({ ...validLoginData, email: "not-an-email" });
      expect(result.success).toBe(false);
    });

    it("rejects empty password", () => {
      const result = loginSchema.safeParse({ ...validLoginData, password: "" });
      expect(result.success).toBe(false);
    });

    it("does not enforce password complexity on login", () => {
      // Login should accept any non-empty password, no complexity check
      const result = loginSchema.safeParse({ ...validLoginData, password: "weak" });
      expect(result.success).toBe(true);
    });
  });

  describe("forgotPasswordSchema", () => {
    it("accepts valid email", () => {
      const result = forgotPasswordSchema.safeParse({ email: "john@example.com" });
      expect(result.success).toBe(true);
    });

    it("rejects empty email", () => {
      const result = forgotPasswordSchema.safeParse({ email: "" });
      expect(result.success).toBe(false);
    });

    it("rejects invalid email format", () => {
      const result = forgotPasswordSchema.safeParse({ email: "not-an-email" });
      expect(result.success).toBe(false);
    });
  });

  describe("resetPasswordSchema", () => {
    const validResetData: ResetPasswordFormValues = {
      newPassword: "SecureP@ss123",
      confirmPassword: "SecureP@ss123",
    };

    it("accepts valid reset data", () => {
      const result = resetPasswordSchema.safeParse(validResetData);
      expect(result.success).toBe(true);
    });

    it("rejects mismatched passwords", () => {
      const result = resetPasswordSchema.safeParse({ ...validResetData, confirmPassword: "Different1!" });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toContain("confirmPassword");
      }
    });

    it("applies password complexity rules", () => {
      const result = resetPasswordSchema.safeParse({ newPassword: "weak", confirmPassword: "weak" });
      expect(result.success).toBe(false);
    });
  });

  describe("changePasswordSchema", () => {
    const validChangeData: ChangePasswordFormValues = {
      currentPassword: "OldP@ss123",
      newPassword: "NewP@ss123",
      confirmPassword: "NewP@ss123",
    };

    it("accepts valid change password data", () => {
      const result = changePasswordSchema.safeParse(validChangeData);
      expect(result.success).toBe(true);
    });

    it("rejects empty current password", () => {
      const result = changePasswordSchema.safeParse({ ...validChangeData, currentPassword: "" });
      expect(result.success).toBe(false);
    });

    it("rejects mismatched new passwords", () => {
      const result = changePasswordSchema.safeParse({ ...validChangeData, confirmPassword: "Different1!" });
      expect(result.success).toBe(false);
    });

    it("applies password complexity rules to new password", () => {
      const result = changePasswordSchema.safeParse({ ...validChangeData, newPassword: "weak", confirmPassword: "weak" });
      expect(result.success).toBe(false);
    });
  });
});