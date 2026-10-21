import { describe, it, expect, beforeAll } from "vitest";

type NextConfigModule = {
  default: {
    headers: () =>
      Promise<Array<{ source: string; headers: Array<{ key: string; value: string }> }>>;
  };
};

function parseCsp(csp: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const directive of csp.split("; ")) {
    const [name, ...values] = directive.split(" ");
    out[name] = values;
  }
  return out;
}

type Config = Record<string, string[]>;

async function loadConfig(env: string): Promise<Config> {
  const writableEnv = process.env as Record<string, string | undefined>;
  const previous = writableEnv.NODE_ENV;
  writableEnv.NODE_ENV = env;
  // Query-param import forces a fresh module evaluation for the dev case.
  let mod: NextConfigModule;
  try {
    mod = (await import("@/next.config")) as unknown as NextConfigModule;
  } finally {
    writableEnv.NODE_ENV = previous;
  }
  const [{ headers: headerList }] = await mod.default.headers();
  const cspEntry = headerList.find((h) => h.key === "Content-Security-Policy");
  if (!cspEntry) throw new Error("Content-Security-Policy header is missing");
  return parseCsp(cspEntry.value);
}

describe("security headers (production CSP)", () => {
  let config: Config;

  beforeAll(async () => {
    config = await loadConfig("production");
  });

  it("locks Stripe Payment Element origins", () => {
    expect(config["script-src"]).toContain("https://js.stripe.com");
    expect(config["frame-src"]).toContain("https://js.stripe.com");
    expect(config["connect-src"]).toContain("https://api.stripe.com");
    expect(config["connect-src"]).toContain("https://m.stripe.network");
  });

  it("allows the Cloudinary upload endpoint the browser PUTs to", () => {
    expect(config["connect-src"]).toContain("https://api.cloudinary.com");
  });

  it("drops unnecessary allowances", () => {
    expect(config["script-src"]).not.toContain("'unsafe-eval'");
    expect(config["script-src"]).not.toContain("https://cdn.jsdelivr.net");
    expect(config["connect-src"]).not.toContain("https://api.velora.example.com");
  });

  it("keeps hardening directives", () => {
    expect(config["frame-ancestors"]).toEqual(["'none'"]);
    expect(config["base-uri"]).toEqual(["'self'"]);
    expect(config["form-action"]).toEqual(["'self'"]);
  });
});
