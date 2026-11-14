import { useId, useRef, useState, type FormEvent } from "react";
import { ADMIN_COPY } from "../../constants/admin";
import { adminClient } from "../../helpers/admin";
import { formatCredit } from "../../helpers/billing";
import { consoleActions, consoleField, consoleLabel } from "../../styles/classes";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { ConsoleButton } from "./ConsoleButton";
import { ConsolePanel } from "./ConsolePanel";

const COPY = ADMIN_COPY.credit;

/**
 * Gives an account credit in whole dollars, which Stripe spends on its next invoices. Each grant
 * carries a request id that a retry repeats, so a grant whose answer was lost is given once.
 */
export function AdminCreditPanel({ emails }: { emails: string[] }) {
  const id = useId();
  const [email, setEmail] = useState("");
  const [dollars, setDollars] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  // One id per grant: kept while the same grant is retried, replaced once it lands.
  const requestId = useRef(crypto.randomUUID());

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const amount = Number(dollars);
    if (!window.confirm(COPY.confirm(email.trim(), formatCredit(amount * 100, "usd")))) return;
    setBusy(true);
    setStatus("");
    try {
      const result = await adminClient.credit({ email: email.trim(), dollars: amount, note: note.trim(), requestId: requestId.current });
      setStatus(COPY.granted(email.trim(), formatCredit(result.granted, result.currency), formatCredit(result.credit, result.currency)));
      requestId.current = crypto.randomUUID();
      setDollars("");
      setNote("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ConsolePanel title={COPY.title} className="max-w-180">
      <form className="flex flex-col gap-4 py-1" onSubmit={(e) => void submit(e)}>
        <p className="text-sm text-muted">{COPY.description}</p>
        <div className="flex flex-wrap gap-4 *:min-w-40">
          <div className={consoleField}>
            <Label className={consoleLabel} htmlFor={`${id}-email`}>
              {COPY.email}
            </Label>
            <Input
              id={`${id}-email`}
              type="email"
              list={`${id}-accounts`}
              autoComplete="off"
              required
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                requestId.current = crypto.randomUUID();
              }}
            />
            <datalist id={`${id}-accounts`}>
              {emails.map((address) => (
                <option key={address} value={address} />
              ))}
            </datalist>
          </div>
          <div className={consoleField}>
            <Label className={consoleLabel} htmlFor={`${id}-dollars`}>
              {COPY.amount}
            </Label>
            <Input
              id={`${id}-dollars`}
              type="number"
              inputMode="numeric"
              min={1}
              max={10000}
              step={1}
              required
              value={dollars}
              onChange={(e) => {
                setDollars(e.target.value);
                requestId.current = crypto.randomUUID();
              }}
            />
          </div>
        </div>
        <div className={consoleField}>
          <Label className={consoleLabel} htmlFor={`${id}-note`}>
            {COPY.note}
          </Label>
          <Input id={`${id}-note`} maxLength={200} placeholder={COPY.notePlaceholder} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <div className={consoleActions}>
          <ConsoleButton type="submit" disabled={busy}>
            {busy ? COPY.granting : COPY.grant}
          </ConsoleButton>
        </div>
        <p role="status" aria-live="polite" className="text-sm text-muted empty:hidden">
          {status}
        </p>
      </form>
    </ConsolePanel>
  );
}
