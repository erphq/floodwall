import { useId, useState, type FormEvent } from "react";
import { BILLING_COPY } from "../../constants/billing";
import { authInput, pillOutline } from "../../styles/classes";
import type { DiscountCode } from "../../types/billing";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

const COPY = BILLING_COPY.code;

type DiscountCodeFieldProps = {
  code: DiscountCode | null;
  error: string;
  checking: boolean;
  onApply: (code: string) => void;
  onRemove: () => void;
};

/**
 * A discount code for the next checkout. The service checks it with Paygate and says what it takes
 * off; once applied, the code rides along to Stripe Checkout. Without one, Checkout still offers its
 * own box for a code.
 */
export function DiscountCodeField({ code, error, checking, onApply, onRemove }: DiscountCodeFieldProps) {
  const id = useId();
  const [typed, setTyped] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    onApply(typed);
  }

  if (code) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <p className="text-ink">
          {COPY.applied(code.code, code.summary)} <span className="text-muted">{COPY.atCheckout}</span>
        </p>
        <button type="button" className="text-muted underline underline-offset-4 hover:text-ink" onClick={onRemove}>
          {COPY.remove}
        </button>
      </div>
    );
  }

  return (
    <form className="flex flex-col gap-2" onSubmit={submit}>
      <Label className="text-sm font-medium text-ink" htmlFor={id}>
        {COPY.label}
      </Label>
      <div className="flex gap-2">
        <Input
          id={id}
          name="code"
          className={`${authInput} max-w-56 font-mono uppercase`}
          autoComplete="off"
          spellCheck={false}
          maxLength={64}
          aria-invalid={!!error || undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
        />
        <Button type="submit" className={pillOutline} disabled={checking || !typed.trim()}>
          {checking ? COPY.checking : COPY.apply}
        </Button>
      </div>
      {error && (
        <p id={`${id}-error`} className="text-sm text-ink">
          {error}
        </p>
      )}
    </form>
  );
}
