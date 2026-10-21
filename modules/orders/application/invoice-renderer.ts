import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/**
 * PDF invoice documents (T-5.2, product-approved via the Phase 5 gate).
 *
 * Scope discipline: the PDF is a STATEMENT OF THE ORDER — everything comes
 * from the caller's immutable order-detail data (historical amounts, item
 * names, addresses); nothing is repriced from the live catalog and no tax
 * registration data is invented. Seller identity is the brand name only;
 * legally binding invoice fields (VAT/tax identifiers, seller legal entity,
 * invoice-number sequence) are a payment-provider/legal decision recorded
 * as still open in the decision register — the document includes the order
 * number, which serves as the unique document reference until a statutory
 * numbering scheme exists.
 *
 * This file imports NOTHING from the database layer — the ownership-scoped
 * fetch lives in `invoice.ts` so this renderer stays unit-testable.
 */

/** Structural slice of an order address (as returned by getOrderDetail). */
interface InvoiceAddress {
  type: string;
  firstName: string | null;
  lastName: string | null;
  country: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
}

/** Structural slice of the order detail the renderer draws. */
export interface InvoiceSource {
  currency: string | null;
  addresses: InvoiceAddress[];
}

const GOLD = rgb(0.61, 0.51, 0.2); // brand accent
const DARK = rgb(0.13, 0.16, 0.13);
const GREY = rgb(0.45, 0.47, 0.45);

/** Standard-font (WinAnsi) safe text: item names are user/catalog data. */
function sanitize(text: string): string {
  return text.replace(/[^\u0000-\u00FF]/g, "?").replace(/[\u0000-\u001F]/g, " ").trim();
}

function money(amount: string | number | null, currency: string): string {
  if (amount === null) return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(0);
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(amount));
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(date);
}

export function addressLines(detail: InvoiceSource, kind: "BILLING" | "SHIPPING"): string[] {
  const address = detail.addresses.find((a) => a.type === kind) ?? detail.addresses.find((a) => a.type === "SHIPPING");
  if (!address) return [];
  const name = [address.firstName, address.lastName].filter(Boolean).join(" ");
  const lines: Array<string | null | undefined> = [
    ...(name ? [name] : []),
    address.addressLine1,
    address.addressLine2,
    [address.city, address.state, address.postalCode]
      .filter(Boolean)
      .join(", "),
    address.country,
  ];
  return lines.filter((line): line is string => typeof line === "string" && line.trim() !== "");
}

export interface OrderInvoiceRenderInput {
  orderNumber: string;
  createdAt: Date;
  orderStatus: string;
  paymentStatus: string;
  paymentMethod: string | null;
  currency: string;
  items: Array<{ productName: string | null; variantName: string | null; quantity: number; unitPrice: string | null; lineTotal: string | null }>;
  subtotal: string;
  discountAmount: string;
  shippingAmount: string;
  taxAmount: string;
  totalAmount: string;
  billingAddressLines: string[];
  generatedAt: Date;
}

/** Pure renderer: imageless, standard-font, A4 statement of one order. */
export async function renderOrderInvoicePdf(input: OrderInvoiceRenderInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]); // A4 portrait
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const draw = (
    rawText: string,
    x: number,
    y: number,
    opts: { size?: number; bold?: boolean; color?: typeof DARK } = {},
  ) => {
    page.drawText(sanitize(rawText), {
      x,
      y,
      size: opts.size ?? 10,
      font: opts.bold ? bold : regular,
      color: opts.color ?? DARK,
    });
  };

  const currency = input.currency || "USD";
  const moneyFor = (amount: string | number | null) => money(amount, currency);

  let y = 800;
  draw("VELORA", 50, y, { size: 22, bold: true });
  draw("Order Invoice", 50, y - 30, { size: 16, color: GOLD });
  y -= 60;

  // Meta block (left) and statement stamp (right).
  draw(`Order ${input.orderNumber}`, 50, y, { size: 12, bold: true });
  draw(`Placed ${formatDate(input.createdAt)}`, 50, y - 18);
  draw(`Order status: ${input.orderStatus}`, 50, y - 34);
  draw(
    `Payment: ${input.paymentStatus}${input.paymentMethod ? ` · ${input.paymentMethod}` : ""}`,
    50,
    y - 50,
  );
  draw(`Statement generated ${formatDate(input.generatedAt)}`, 380, y - 18, { size: 9, color: GREY });
  y -= 78;

  // Billing address if snapshotted.
  if (input.billingAddressLines.length > 0) {
    draw("Billed to", 50, y, { bold: true });
    y -= 16;
    for (const line of input.billingAddressLines) {
      draw(line, 50, y);
      y -= 14;
    }
    y -= 10;
  }

  // Items table.
  const cols = { name: 50, qty: 370, unit: 420, total: 510 };
  draw("Items", cols.name, y, { bold: true });
  draw("Qty", cols.qty, y, { bold: true });
  draw("Unit", cols.unit, y, { bold: true });
  draw("Total", cols.total, y, { bold: true });
  y -= 18;
  for (const item of input.items) {
    const name = [item.productName, item.variantName ? `(${item.variantName})` : null]
      .filter(Boolean)
      .join(" ");
    draw(name.length > 62 ? `${name.slice(0, 59)}…` : name, cols.name, y);
    draw(String(item.quantity), cols.qty, y);
    draw(moneyFor(item.unitPrice), cols.unit, y);
    draw(moneyFor(item.lineTotal), cols.total, y);
    y -= 16;
  }
  y -= 8;

  // Totals block (right aligned).
  const rows: Array<[string, string]> = [
    ["Subtotal", moneyFor(input.subtotal)],
    ...(Number(input.discountAmount) > 0 ? [["Discount", `−${moneyFor(input.discountAmount)}`] as [string, string]] : []),
    ["Shipping", moneyFor(input.shippingAmount)],
    ["Tax", moneyFor(input.taxAmount)],
  ];
  for (const [label, value] of rows) {
    draw(label, cols.unit - 40, y, { color: GREY });
    draw(value, cols.total, y);
    y -= 16;
  }
  page.drawLine({
    start: { x: cols.unit - 40, y: y + 8 },
    end: { x: cols.total + 40, y: y + 8 },
    thickness: 1,
    color: GOLD,
  });
  y -= 6;
  draw("Total", cols.unit - 40, y, { bold: true });
  draw(moneyFor(input.totalAmount), cols.total, y, { bold: true });
  y -= 40;

  draw(
    "All amounts are the immutable order-time snapshots in " +
      `${currency}. This statement is generated from your VELORA order record.`,
    50,
    y,
    { size: 8.5, color: GREY },
  );

  return doc.save();
}
