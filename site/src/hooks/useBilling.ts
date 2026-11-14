import { useCallback, useEffect, useState } from "react";
import { billingAvailable, getPlan, openBilling, startCheckout } from "../helpers/billing";
import type { BillingInterval, PaidPlanKey } from "../constants/pricing";
import type { AccountPlan } from "../types/billing";

/**
 * The signed-in account's plan, and the two ways out to pay: checkout and the billing page. Only
 * asks the service when `enabled` (a signed-in account past the waitlist).
 */
export function useBilling(enabled: boolean, { refreshFirst = false } = {}) {
  const [plan, setPlan] = useState<AccountPlan | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async (refresh: boolean) => {
    setError("");
    try {
      const next = await getPlan(refresh);
      setPlan(next);
      return next;
    } catch (e) {
      setError((e as Error).message);
      return null;
    }
  }, []);

  useEffect(() => {
    if (enabled && billingAvailable) void load(refreshFirst);
  }, [enabled, refreshFirst, load]);

  async function run(label: string, action: () => Promise<void>) {
    setBusy(label);
    setError("");
    try {
      await action();
      // The page is on its way to Stripe or Paygate: stay busy until it leaves.
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  return {
    plan,
    error,
    busy,
    reload: load,
    checkout: (key: PaidPlanKey, interval: BillingInterval = "month") =>
      run(`${key}:${interval}`, () => startCheckout(key, interval)),
    manage: () => run("manage", openBilling),
  };
}
