import type { CarrierAdapter } from "@/lib/carrier/types";
import { mockCarrier } from "@/lib/carrier/mockCarrier";

/**
 * Active carrier adapter, selected by `CARRIER_PROVIDER`.
 *
 * Defaults to the mock carrier when the env var is unset OR set to a
 * provider that isn't wired up here — this module must NEVER throw at
 * import time for a missing/invalid real-carrier credential, so the app
 * stays demoable without any carrier account. A real adapter should only
 * validate/read its own API-key env vars lazily, inside its own file, at
 * call time (see the shape sketched below) — never here in the selector.
 *
 * To add a real carrier later (e.g. FedEx):
 *   1. Create `src/lib/carrier/fedexCarrier.ts` implementing `CarrierAdapter`
 *      (see `src/lib/carrier/types.ts`). Read `FEDEX_API_KEY` etc. only
 *      inside that file, and only when its methods are actually called —
 *      not at module load — so an unconfigured FedEx adapter can still be
 *      imported (just not successfully called) without crashing the app.
 *   2. Add a case below:
 *        case "fedex": return fedexCarrier;
 *   3. Set `CARRIER_PROVIDER=fedex` (+ that adapter's own env vars) in the
 *      deploy's environment. No other call site changes — the parcel-label
 *      route and the tracking-status route only ever talk to `CarrierAdapter`.
 */
function selectCarrier(): CarrierAdapter {
  const provider = (process.env.CARRIER_PROVIDER ?? "mock").toLowerCase();
  switch (provider) {
    case "mock":
      return mockCarrier;
    // case "fedex": return fedexCarrier;
    default:
      console.warn(
        `[carrier] Unrecognized CARRIER_PROVIDER "${provider}", falling back to the mock carrier.`,
      );
      return mockCarrier;
  }
}

export const carrier: CarrierAdapter = selectCarrier();

export type {
  CarrierAdapter,
  CreateShipmentInput,
  CreateShipmentResult,
  TrackingStatusResult,
  CarrierTrackingStatusValue,
} from "@/lib/carrier/types";
