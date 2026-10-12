import { sql } from "drizzle-orm";

import { db } from "@/infrastructure/database";
import { lowStockAlertStatusEnum } from "@/infrastructure/database/schema/enums";
import { logger } from "@/shared/lib/logging/logger";
import {
  getNextPendingAlert,
  markAlertDelivered,
  markAlertFailed,
  type LowStockAlertEvent,
} from "@/modules/inventory/application/low-stock-alerts";
import { sendMail } from "@/shared/lib/mail";

export type LowStockAlertStatus = (typeof lowStockAlertStatusEnum.enumValues)[number];

export interface LowStockAlertDeliveryConfig {
  batchSize: number;
  maxRetries: number;
  retryDelayMs: number;
  recipientEmails: string[];
}

export const DEFAULT_DELIVERY_CONFIG: LowStockAlertDeliveryConfig = {
  batchSize: 50,
  maxRetries: 3,
  retryDelayMs: 60000, // 1 minute
  recipientEmails: [],
};

export interface AlertDeliveryResult {
  alertId: string;
  success: boolean;
  error?: string;
}

export interface DeliveryJobResult {
  processed: number;
  succeeded: number;
  failed: number;
  results: AlertDeliveryResult[];
  durationMs: number;
}

function getConfig(): LowStockAlertDeliveryConfig {
  const emails = process.env.LOW_STOCK_ALERT_RECIPIENTS?.split(",").map((e) => e.trim()).filter(Boolean) ?? [];
  return {
    ...DEFAULT_DELIVERY_CONFIG,
    recipientEmails: emails,
  };
}

/**
 * Get the product and variant details for an alert to include in the email.
 */
async function getAlertDetails(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  alert: LowStockAlertEvent,
): Promise<{
  productName: string;
  variantSku: string;
  variantName: string | null;
}> {
  const rows = await tx.execute(sql`
    SELECT p.name AS product_name, pv.sku AS variant_sku, pv.name AS variant_name
    FROM product_variants pv
    JOIN products p ON p.id = pv.product_id
    WHERE pv.id = ${alert.variantId}
  `) as Array<{ product_name: string; variant_sku: string; variant_name: string | null }>;

  const r = rows[0];
  return {
    productName: r?.product_name ?? "Unknown Product",
    variantSku: r?.variant_sku ?? "Unknown SKU",
    variantName: r?.variant_name ?? null,
  };
}

/**
 * Render the low-stock alert email template.
 */
function renderLowStockAlertEmail(
  alerts: Array<{
    productName: string;
    variantSku: string;
    variantName: string | null;
    availableStock: number;
    threshold: number;
  }>,
): { subject: string; html: string; text: string } {
  const count = alerts.length;
  const subject = `[VELORA Low Stock] ${count} variant${count > 1 ? "s" : ""} below threshold`;

  const rowsHtml = alerts
    .map(
      (a) => `
    <tr>
      <td style="padding:12px 16px;border-bottom:1px solid #eee9e1;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#1c211f;">${a.productName}</td>
      <td style="padding:12px 16px;border-bottom:1px solid #eee9e1;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#1c211f;">${a.variantSku}</td>
      <td style="padding:12px 16px;border-bottom:1px solid #eee9e1;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#1c211f;">${a.variantName ?? "—"}</td>
      <td style="padding:12px 16px;border-bottom:1px solid #eee9e1;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#1c211f;text-align:center;">${a.availableStock}</td>
      <td style="padding:12px 16px;border-bottom:1px solid #eee9e1;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#1c211f;text-align:center;">${a.threshold}</td>
    </tr>
  `,
    )
    .join("");

  const html = `<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:0;background-color:#f4f2ee;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#1c211f;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f2ee;padding:32px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background-color:#ffffff;border:1px solid #e6e2da;border-radius:20px;overflow:hidden;">
            <tr>
              <td style="background-color:#365f54;padding:28px 32px;">
                <p style="margin:0;font-size:20px;font-weight:600;letter-spacing:0.24em;color:#ffffff;">VELORA</p>
                <p style="margin:6px 0 0;font-size:13px;color:#d8c7ae;">Inventory Alert</p>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#1c211f;">Low Stock Alert</h1>
                <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#4a524e;">
                  The following variant${count > 1 ? "s" : ""} have fallen below their low-stock threshold
                  and require attention:
                </p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e6e2da;border-radius:8px;overflow:hidden;">
                  <thead>
                    <tr style="background-color:#faf8f5;">
                      <th style="padding:12px 16px;text-align:left;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:600;color:#1c211f;border-bottom:1px solid #e6e2da;">Product</th>
                      <th style="padding:12px 16px;text-align:left;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:600;color:#1c211f;border-bottom:1px solid #e6e2da;">SKU</th>
                      <th style="padding:12px 16px;text-align:left;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:600;color:#1c211f;border-bottom:1px solid #e6e2da;">Variant</th>
                      <th style="padding:12px 16px;text-align:center;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:600;color:#1c211f;border-bottom:1px solid #e6e2da;">Available</th>
                      <th style="padding:12px 16px;text-align:center;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:600;color:#1c211f;border-bottom:1px solid #e6e2da;">Threshold</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${rowsHtml}
                  </tbody>
                </table>
                <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#6b736e;">
                  Log in to the Velora admin dashboard to review inventory levels and restock as needed.
                </p>
              </td>
            </tr>
            <tr>
              <td style="background-color:#faf8f5;border-top:1px solid #eee9e1;padding:20px 32px;">
                <p style="margin:0;font-size:12px;line-height:1.6;color:#8b938e;">
                  This is an automated alert from the Velora inventory system.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const textLines = [
    "VELORA Low Stock Alert",
    "",
    `The following ${count} variant${count > 1 ? "s" : ""} have fallen below their low-stock threshold:`,
    "",
    ...alerts.map(
      (a) =>
        `• ${a.productName} (${a.variantSku}${a.variantName ? ` - ${a.variantName}` : ""}) — Available: ${a.availableStock}, Threshold: ${a.threshold}`,
    ),
    "",
    "Log in to the Velora admin dashboard to review inventory levels and restock as needed.",
    "",
    "— Velora Inventory System",
  ];

  return { subject, html, text: textLines.join("\n") };
}

/**
 * Send a single low-stock alert email for one alert.
 * Returns the delivery result.
 */
async function deliverSingleAlert(
  alert: LowStockAlertEvent,
  recipientEmails: string[],
): Promise<AlertDeliveryResult> {
  if (recipientEmails.length === 0) {
    return {
      alertId: alert.id,
      success: false,
      error: "No recipient emails configured (set LOW_STOCK_ALERT_RECIPIENTS env var)",
    };
  }

  // Get product/variant details
  const details = await db.transaction(async (tx) => {
    return getAlertDetails(tx, alert);
  });

  const emailContent = renderLowStockAlertEmail([
    {
      productName: details.productName,
      variantSku: details.variantSku,
      variantName: details.variantName,
      availableStock: alert.availableStock,
      threshold: alert.threshold,
    },
  ]);

  try {
    // Send to all recipients
    await Promise.all(
      recipientEmails.map((to) =>
        sendMail({
          to,
          subject: emailContent.subject,
          html: emailContent.html,
          text: emailContent.text,
        }),
      ),
    );

    return { alertId: alert.id, success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { alertId: alert.id, success: false, error: message };
  }
}

/**
 * Process pending low-stock alerts and send email notifications.
 * This is the main entry point for the delivery job (e.g., cron job).
 */
export async function processLowStockAlerts(
  config?: Partial<LowStockAlertDeliveryConfig>,
): Promise<DeliveryJobResult> {
  const startTime = Date.now();
  const cfg = { ...getConfig(), ...config };

  if (cfg.recipientEmails.length === 0) {
    logger.warn("Low stock alert delivery skipped: no recipients configured", {
      module: "inventory",
      action: "lowStockAlertDeliverySkipped",
      reason: "No recipient emails configured",
    });
    return {
      processed: 0,
      succeeded: 0,
      failed: 0,
      results: [],
      durationMs: Date.now() - startTime,
    };
  }

  const results: AlertDeliveryResult[] = [];
  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < cfg.batchSize; i++) {
    const alert = await db.transaction(async (tx) => {
      return getNextPendingAlert(tx);
    });

    if (!alert) {
      // No more pending alerts
      break;
    }

    processed++;

    // Deliver the alert
    const result = await deliverSingleAlert(alert, cfg.recipientEmails);

    if (result.success) {
      succeeded++;
      await db.transaction(async (tx) => {
        await markAlertDelivered(tx, alert.id);
      });
      logger.info("Low stock alert delivered", {
        module: "inventory",
        action: "lowStockAlertDelivered",
        alertId: alert.id,
        variantId: alert.variantId,
        availableStock: alert.availableStock,
        threshold: alert.threshold,
      });
    } else {
      failed++;
      await db.transaction(async (tx) => {
        await markAlertFailed(tx, alert.id, result.error ?? "Unknown error");
      });
      logger.error("Low stock alert delivery failed", {
        module: "inventory",
        action: "lowStockAlertDeliveryFailed",
        alertId: alert.id,
        variantId: alert.variantId,
        error: result.error,
        attempts: alert.attempts,
      });
    }

    results.push(result);
  }

  const durationMs = Date.now() - startTime;

  logger.info("Low stock alert delivery job completed", {
    module: "inventory",
    action: "lowStockAlertDeliveryJobComplete",
    processed,
    succeeded,
    failed,
    durationMs,
  });

  return {
    processed,
    succeeded,
    failed,
    results,
    durationMs,
  };
}

/**
 * Scheduled job to run periodically (e.g., every 5 minutes via cron).
 * This can be called from a cron job or scheduled task.
 */
export async function runLowStockAlertDeliveryJob(
  config?: Partial<LowStockAlertDeliveryConfig>,
): Promise<void> {
  const result = await processLowStockAlerts(config);

  if (result.processed > 0) {
    logger.info("Low stock alert delivery job finished", {
      module: "inventory",
      action: "lowStockAlertDeliveryJobFinished",
      ...result,
    });
  }
}