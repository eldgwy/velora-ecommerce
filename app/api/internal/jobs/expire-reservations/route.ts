import { handleExpiredReservationsRequest } from "@/modules/jobs/release-expired-reservations";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  return handleExpiredReservationsRequest(request);
}

export async function POST(request: Request): Promise<Response> {
  return handleExpiredReservationsRequest(request);
}