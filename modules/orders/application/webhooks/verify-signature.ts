import { createHmac, timingSafeEqual } from "crypto";

export interface WebhookVerificationResult {
  verified: boolean;
  error?: string;
}

/**
 * Verify a Stripe webhook signature.
 * 
 * Stripe sends a `Stripe-Signature` header containing a timestamp and one or more signatures.
 * Format: t=<timestamp>,v1=<signature>,v1=<signature2>,...
 * 
 * @param payload - Raw request body as string
 * @param signatureHeader - Value of the Stripe-Signature header
 * @param secret - Webhook signing secret from Stripe dashboard
 * @param tolerance - Maximum age of the timestamp in seconds (default: 300 = 5 minutes)
 */
export function verifyStripeSignature(
  payload: string,
  signatureHeader: string,
  secret: string,
  tolerance: number = 300,
): WebhookVerificationResult {
  if (!signatureHeader) {
    return { verified: false, error: "Missing Stripe-Signature header" };
  }

  if (!secret) {
    return { verified: false, error: "Webhook secret not configured" };
  }

  // Parse the signature header
  const elements = signatureHeader.split(",").map((e) => e.trim());
  let timestamp: number | null = null;
  const signatures: string[] = [];

  for (const element of elements) {
    const [key, value] = element.split("=");
    if (key === "t" && value !== undefined) {
      timestamp = parseInt(value, 10);
    } else if (key === "v1" && value !== undefined) {
      signatures.push(value);
    }
  }

  if (timestamp === null) {
    return { verified: false, error: "Invalid signature header: missing timestamp" };
  }

  if (signatures.length === 0) {
    return { verified: false, error: "Invalid signature header: no v1 signatures" };
  }

  // Check timestamp tolerance
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > tolerance) {
    return { verified: false, error: "Timestamp outside tolerance" };
  }

  // Construct the signed payload
  const signedPayload = `${timestamp}.${payload}`;

  // Compute expected signature
  const expectedSignature = createHmac("sha256", secret)
    .update(signedPayload, "utf8")
    .digest("hex");

  // Verify against all provided signatures using timing-safe comparison
  let verified = false;
  for (const signature of signatures) {
    try {
      if (timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
        verified = true;
        break;
      }
    } catch {
      // Ignore comparison errors, try next signature
    }
  }

  if (!verified) {
    return { verified: false, error: "Signature verification failed" };
  }

  return { verified: true };
}

/**
 * Generic webhook verification for other providers.
 * Extend as needed for PayPal, etc.
 */
export interface ProviderVerifier {
  verify(payload: string, headers: Record<string, string>): WebhookVerificationResult;
}

export const webhookVerifiers: Record<string, ProviderVerifier> = {
  stripe: {
    verify(payload: string, headers: Record<string, string>): WebhookVerificationResult {
      const signature = headers["stripe-signature"] || headers["Stripe-Signature"];
      const secret = process.env.STRIPE_WEBHOOK_SECRET;
      return verifyStripeSignature(payload, signature || "", secret || "");
    },
  },
  // Add more providers here as needed
};

/**
 * Verify a webhook from any supported provider.
 */
export function verifyWebhook(
  provider: string,
  payload: string,
  headers: Record<string, string>,
): WebhookVerificationResult {
  const verifier = webhookVerifiers[provider.toLowerCase()];
  if (!verifier) {
    return { verified: false, error: `No verifier for provider: ${provider}` };
  }
  return verifier.verify(payload, headers);
}