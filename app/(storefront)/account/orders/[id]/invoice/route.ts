import { getCurrentSession } from "@/shared/lib/guards";
import { logger } from "@/shared/lib/logging/logger";
import { orderIdSchema } from "@/modules/orders/presentation/schemas/order.schema";
import { buildOrderInvoiceDocument } from "@/modules/orders/application/invoice";
import { OrderNotFoundError } from "@/modules/orders/domain/errors/order-errors";

export const dynamic = "force-dynamic";

/**
 * Customer invoice download (T-5.2). Identity and ownership are enforced
 * server-side: the session supplies the userId, getOrderDetail scopes the
 * read to the owner (or 404s), and no pricing data is ever taken from the
 * client. Private, never cacheable.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getCurrentSession();
  if (!session) {
    return Response.json({ error: "You must be signed in." }, { status: 401 });
  }

  const parsed = orderIdSchema.safeParse((await context.params).id);
  if (!parsed.success) {
    return Response.json({ error: "Invalid order identifier." }, { status: 400 });
  }

  try {
    const bytes = await buildOrderInvoiceDocument(parsed.data, { userId: session.user.id });
    const body = new Uint8Array(bytes);
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="velora-invoice-${parsed.data}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof OrderNotFoundError) {
      return Response.json({ error: "Order not found." }, { status: 404 });
    }
    logger.error("Invoice generation failed", {
      module: "orders",
      action: "invoiceRoute",
      userId: session.user.id,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return Response.json({ error: "Invoice generation failed." }, { status: 500 });
  }
}
