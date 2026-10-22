/**
 * Ambient module declarations for static asset imports (jpg, png, webp).
 *
 * `next-env.d.ts` provides these types locally (via
 * `next/image-types/global`) but is deliberately gitignored — it also
 * references generated `.next/dev` artifacts that do not exist during a
 * clean CI checkout, so typechecking there must not depend on it. These
 * declarations mirror Next's own `next/image-types/global` (same
 * `StaticImageData` contract consumed by `next/image`), keeping static
 * asset imports typecheckable in CI and locally alike.
 *
 * Current behavior note: a relative asset import whose FILE is missing
 * still typechecks via these wildcard declarations (both locally and in
 * CI) — the paths must be kept pointing at files that actually exist,
 * which is enforced by nothing else.
 */
declare module "*.jpg" {
  const content: import("next/image").StaticImageData;

  export default content;
}

declare module "*.png" {
  const content: import("next/image").StaticImageData;

  export default content;
}

declare module "*.webp" {
  const content: import("next/image").StaticImageData;

  export default content;
}
