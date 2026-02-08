// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default function (_srv: unknown) {
  // SessionParameters is a read-only projection — no custom handler needed.
  // CDS auto-serves the entity.
  // L3: @requires: 'any' is intentional — session config is public and non-sensitive.
}
