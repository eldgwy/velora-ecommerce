import { handleAuthEmailRetryRequest } from "@/modules/jobs/auth-email-retry";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  return handleAuthEmailRetryRequest(request);
}

export async function POST(request: Request): Promise<Response> {
  return handleAuthEmailRetryRequest(request);
}
