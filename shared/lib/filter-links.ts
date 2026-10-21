type FilterParams = Record<string, string | undefined>;

/**
 * Builds a filter-navigation href from the current URL parameters plus a
 * patch, preserving any parameters the patch does not mention. Resets
 * pagination ("page") on every filter change unless the patch itself sets a
 * page. Undefined patch values remove the parameter.
 */
export function buildFilterHref(
  basePath: string,
  current: FilterParams,
  patch: FilterParams,
): string {
  const output: FilterParams = { ...current, ...patch };
  if (Object.prototype.hasOwnProperty.call(patch, "page")) {
    output.page = patch.page ?? undefined;
  } else {
    delete output.page;
  }

  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(output)) {
    if (value !== undefined && value !== "") {
      search.set(key, value);
    }
  }
  const qs = search.toString();
  return qs === "" ? basePath : `${basePath}?${qs}`;
}
