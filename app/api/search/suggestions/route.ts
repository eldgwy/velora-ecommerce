import { NextRequest, NextResponse } from "next/server";
import { getSearchSuggestions } from "@/services/catalog-public/search";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get("q");
  const limit = searchParams.get("limit");

  if (!query || query.trim().length < 2) {
    return NextResponse.json({ suggestions: [] });
  }

  const parsedLimit = limit ? Math.min(Math.max(parseInt(limit, 10), 1), 10) : 5;

  try {
    const suggestions = await getSearchSuggestions(query.trim(), parsedLimit);
    return NextResponse.json({ suggestions });
  } catch (error) {
    console.error("[search] suggestions error:", error);
    return NextResponse.json({ error: "Failed to fetch suggestions" }, { status: 500 });
  }
}