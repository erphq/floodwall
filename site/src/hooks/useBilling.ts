import { useCallback, useEffect, useState } from "react";
import {
  billingAvailable,
  codeFromPage,
  getCredits,
  getPlan,
  lookupCode,
  openBilling,
  saveCode,
  startCheckout,
} from "../helpers/billing";
import type { BillingInterval, PaidPlanKey } from "../constants/pricing";
import type { AccountCredit, AccountPlan, DiscountCode } from "../types/billing";

/**
 * The signed-in account's plan and credit, a discount code to take off at checkout, and the two
 * ways out to pay: checkout and the billing page. Only asks the service when `enabled` (a
 * signed-in account past the waitlist).
 */
export function useBilling(enabled: boolean, { refreshFirst = false } = {}) {
  const [plan, setPlan] = useState<AccountPlan | null>(null);
  const [credit, setCredit] = useState<AccountCredit | null>(null);
  const [code, setCode] = useState<DiscountCode | null>(null);
  const [codeError, setCodeError] = useState("");
  const [checkingCode, setCheckingCode] = useState(false);
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

  const applyCode = useCallback(async (raw: string) => {
    const typed = raw.trim();
    setCodeError("");
    if (!typed) return;
    setCheckingCode(true);
    try {
      const found = await lookupCode(typed);
      setCode(found);
      saveCode(found.code);
    } catch (e) {
      setCode(null);
      saveCode("");
      setCodeError((e as Error).message);
    } finally {
      setCheckingCode(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled || !billingAvailable) return;
    void load(refreshFirst);
    // Credit is a nicety beside the plan: if it can't be read, the card just doesn't show it.
    getCredits().then(setCredit, () => setCredit(null));
    const pending = codeFromPage();
    if (pending) void applyCode(pending);
  }, [enabled, refreshFirst, load, applyCode]);

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
    credit,
    code,
    codeError,
    checkingCode,
    error,
    busy,
    reload: load,
    applyCode,
    clearCode: () => {
      setCode(null);
      setCodeError("");
      saveCode("");
    },
    checkout: (key: PaidPlanKey, interval: BillingInterval = "month") =>
      // The code stays saved until the payment comes back (BillingCard), so leaving checkout keeps it.
      run(`${key}:${interval}`, () => startCheckout(key, interval, code?.code)),
    manage: () => run("manage", openBilling),
  };
}
