import { BannerValidationError } from "./banner-errors";

/**
 * Hero banner lifecycle and field rules (domain layer — pure).
 *
 * Stored statuses: DRAFT (never public), SCHEDULED (future), ACTIVE
 * (publishable within its window), EXPIRED (never public). Public
 * eligibility always re-checks the time window live, so correctness never
 * depends on a background sync having run.
 *
 * Admin transitions: any state may move to any other state explicitly
 * (publishing, scheduling, withdrawing), except nothing leaves EXPIRED
 * implicitly — re-publication is always an explicit admin choice recorded
 * below. Same-state repeats are idempotent replays.
 */

export type BannerStatus = "ACTIVE" | "EXPIRED" | "SCHEDULED" | "DRAFT";

export const MAX_TITLE_LENGTH = 120;
export const MAX_SUBTITLE_LENGTH = 300;

const ADMIN_TRANSITIONS: Array<{ from: BannerStatus; to: BannerStatus }> = [
  { from: "DRAFT", to: "SCHEDULED" },
  { from: "DRAFT", to: "ACTIVE" },
  { from: "SCHEDULED", to: "ACTIVE" },
  { from: "SCHEDULED", to: "DRAFT" },
  { from: "SCHEDULED", to: "EXPIRED" },
  { from: "ACTIVE", to: "EXPIRED" },
  { from: "ACTIVE", to: "DRAFT" },
  { from: "EXPIRED", to: "DRAFT" },
  { from: "EXPIRED", to: "SCHEDULED" },
];

/** True when `from → to` is an allowed admin move (replays allowed). */
export function canTransitionBannerStatus(from: BannerStatus, to: BannerStatus): boolean {
  if (from === to) return true;
  return ADMIN_TRANSITIONS.some((r) => r.from === from && r.to === to);
}

export interface BannerWindow {
  status: BannerStatus;
  startsAt: Date | null;
  endsAt: Date | null;
}

/**
 * Public eligibility with one clock value (inclusive interval):
 * stored ACTIVE, started, not yet ended. NULL bounds are open on that
 * side. Sync state never grants visibility by itself.
 */
export function isBannerEligible(banner: BannerWindow, now: Date): boolean {
  if (banner.status !== "ACTIVE") return false;
  if (banner.startsAt !== null && banner.startsAt.getTime() > now.getTime()) return false;
  if (banner.endsAt !== null && banner.endsAt.getTime() < now.getTime()) return false;
  return true;
}

/**
 * Effective display status: what the banner *should* read given the clock.
 * SCHEDULED whose window opened (or closed) reports ACTIVE/EXPIRED; ACTIVE
 * past its end reports EXPIRED. DRAFT never changes by itself.
 */
export function deriveBannerStatus(
  banner: BannerWindow,
  now: Date = new Date(),
): BannerStatus {
  if (banner.status === "DRAFT") return "DRAFT";
  if (banner.status === "EXPIRED") {
    // Re-publication is explicit; an EXPIRED row with a future window is
    // still EXPIRED until an admin moves it (sync never publishes).
    if (
      banner.startsAt !== null &&
      banner.startsAt.getTime() > now.getTime()
    ) {
      return "SCHEDULED";
    }
    return "EXPIRED";
  }
  if (banner.startsAt !== null && banner.startsAt.getTime() > now.getTime()) {
    return "SCHEDULED";
  }
  if (banner.endsAt !== null && banner.endsAt.getTime() < now.getTime()) {
    return "EXPIRED";
  }
  return "ACTIVE";
}

export function assertBannerTitle(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_TITLE_LENGTH) {
    throw new BannerValidationError(
      `Title must be 1–${MAX_TITLE_LENGTH} characters.`,
    );
  }
  return trimmed;
}

export function assertBannerSubtitle(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > MAX_SUBTITLE_LENGTH) {
    throw new BannerValidationError(
      `Subtitle must not exceed ${MAX_SUBTITLE_LENGTH} characters.`,
    );
  }
  return trimmed;
}

function assertImageUrl(value: string | null | undefined, label: string, required: boolean): string | null {
  if (value === null || value === undefined || value.trim() === "") {
    if (required) throw new BannerValidationError(`${label} image is required.`);
    return null;
  }
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new BannerValidationError(`${label} image URL is invalid.`);
  }
  if (url.protocol !== "https:") {
    throw new BannerValidationError(`${label} image URL must use HTTPS.`);
  }
  return url.toString();
}

export function assertDesktopImage(value: string | null | undefined): string {
  const url = assertImageUrl(value, "Desktop", true);
  if (!url) throw new BannerValidationError("Desktop image is required.");
  return url;
}

export function assertMobileImage(value: string | null | undefined): string | null {
  return assertImageUrl(value, "Mobile", false);
}

/**
 * Destination link: site-relative paths (`/collections/x`) or absolute
 * HTTPS URLs. Anything else (javascript:, data:, non-HTTP schemes,
 * protocol-relative trickery) is rejected.
 */
export function assertBannerLink(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value.trim() === "") return null;
  const trimmed = value.trim();
  if (trimmed.startsWith("/")) {
    if (trimmed.startsWith("//") || trimmed.includes("\\") || trimmed.includes(" ")) {
      throw new BannerValidationError("Destination link is invalid.");
    }
    return trimmed;
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new BannerValidationError("Destination link is invalid.");
  }
  if (url.protocol !== "https:") {
    throw new BannerValidationError("Destination link must be a site path or HTTPS URL.");
  }
  return url.toString();
}

export function assertSortOrder(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isInteger(value) || value < 0 || value > 9999) {
    throw new BannerValidationError("Display order must be an integer from 0 to 9999.");
  }
  return value;
}

export function assertBannerWindow(
  startsAt: Date | null,
  endsAt: Date | null,
): void {
  if (startsAt && Number.isNaN(startsAt.getTime())) {
    throw new BannerValidationError("Start time is invalid.");
  }
  if (endsAt && Number.isNaN(endsAt.getTime())) {
    throw new BannerValidationError("End time is invalid.");
  }
  if (startsAt && endsAt && endsAt.getTime() <= startsAt.getTime()) {
    throw new BannerValidationError("End time must be after start time.");
  }
}
