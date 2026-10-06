import { describe, it, expect } from "vitest";
import {
  AUTH_ROUTES,
  ACCOUNT_ROUTES,
  ADMIN_ROUTES,
  PUBLIC_ONLY_ROUTES,
  AUTH_REQUIRED_PREFIXES,
  AUTH_REQUIRED_ROUTES,
  ADMIN_ROUTES_ARRAY,
} from "@/config/routes";

describe("Route Constants", () => {
  describe("AUTH_ROUTES", () => {
    it("has correct login route", () => {
      expect(AUTH_ROUTES.LOGIN).toBe("/login");
    });

    it("has correct register route", () => {
      expect(AUTH_ROUTES.REGISTER).toBe("/register");
    });

    it("has correct forgot password route", () => {
      expect(AUTH_ROUTES.FORGOT_PASSWORD).toBe("/forgot-password");
    });

    it("has correct reset password route", () => {
      expect(AUTH_ROUTES.RESET_PASSWORD).toBe("/reset-password");
    });

    it("has correct verify email route", () => {
      expect(AUTH_ROUTES.VERIFY_EMAIL).toBe("/verify-email");
    });

    it("does not include /auth/ prefix", () => {
      Object.values(AUTH_ROUTES).forEach((route) => {
        expect(route).not.toContain("/auth/");
      });
    });
  });

  describe("ACCOUNT_ROUTES", () => {
    it("has correct profile route", () => {
      expect(ACCOUNT_ROUTES.PROFILE).toBe("/account/profile");
    });

    it("has correct settings route", () => {
      expect(ACCOUNT_ROUTES.SETTINGS).toBe("/account/settings");
    });
  });

  describe("ADMIN_ROUTES", () => {
    it("has correct dashboard route", () => {
      expect(ADMIN_ROUTES.DASHBOARD).toBe("/admin");
    });

    it("has correct products route", () => {
      expect(ADMIN_ROUTES.PRODUCTS).toBe("/admin/products");
    });

    it("has correct customers route", () => {
      expect(ADMIN_ROUTES.CUSTOMERS).toBe("/admin/customers");
    });

    it("has correct orders route", () => {
      expect(ADMIN_ROUTES.ORDERS).toBe("/admin/orders");
    });
  });

  describe("PUBLIC_ONLY_ROUTES", () => {
    it("includes login and register routes", () => {
      expect(PUBLIC_ONLY_ROUTES).toContain("/login");
      expect(PUBLIC_ONLY_ROUTES).toContain("/register");
    });

    it("has exactly 2 routes", () => {
      expect(PUBLIC_ONLY_ROUTES).toHaveLength(2);
    });
  });

  describe("AUTH_REQUIRED_PREFIXES", () => {
    it("includes /account prefix", () => {
      expect(AUTH_REQUIRED_PREFIXES).toContain("/account");
    });

    it("includes /orders prefix", () => {
      expect(AUTH_REQUIRED_PREFIXES).toContain("/orders");
    });

    it("includes /checkout prefix", () => {
      expect(AUTH_REQUIRED_PREFIXES).toContain("/checkout");
    });

    it("does not include /profile or /settings directly", () => {
      expect(AUTH_REQUIRED_PREFIXES).not.toContain("/profile");
      expect(AUTH_REQUIRED_PREFIXES).not.toContain("/settings");
    });
  });

  describe("AUTH_REQUIRED_ROUTES", () => {
    it("includes account profile and settings", () => {
      expect(AUTH_REQUIRED_ROUTES).toContain("/account/profile");
      expect(AUTH_REQUIRED_ROUTES).toContain("/account/settings");
    });
  });

  describe("ADMIN_ROUTES_ARRAY", () => {
    it("includes /admin prefix", () => {
      expect(ADMIN_ROUTES_ARRAY).toContain("/admin");
    });
  });
});