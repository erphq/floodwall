import { useState, type FormEvent } from "react";
import { useOutletContext } from "react-router";
import { BillingCard } from "../../components/billing/BillingCard";
import { ConsoleButton } from "../../components/console/ConsoleButton";
import type { ConsoleContext } from "../../components/console/ConsoleLayout";
import { ConsolePageHeader } from "../../components/console/ConsolePageHeader";
import { ConsolePanel } from "../../components/console/ConsolePanel";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { AUTH_COPY, NAME_MAX_LENGTH } from "../../constants/auth";
import { BILLING_COPY } from "../../constants/billing";
import { authInput } from "../../styles/classes";

const COPY = AUTH_COPY.account;

/**
 * The account in the console: who is signed in and their name, the plan and billing, and the
 * session. /account comes here, and so does Stripe Checkout on the way back.
 */
export function SettingsPage() {
  const { user, updateProfile, signOut } = useOutletContext<ConsoleContext>();
  const [leaving, setLeaving] = useState(false);
  const [status, setStatus] = useState("");

  return (
    <>
      <ConsolePageHeader title="Settings" description="Your profile, plan and sign-in." />

      <ConsolePanel title="Profile">
        <dl className="mb-5 flex flex-col gap-1">
          <dt className="text-sm font-medium text-ink">Email address</dt>
          <dd className="text-sm text-muted">
            {user.email}. You sign in with a code sent here, so there's no password to manage.
          </dd>
        </dl>
        <NameForm initial={user.name ?? ""} onSave={updateProfile} />
      </ConsolePanel>

      <section id="plan" className="scroll-mt-[calc(var(--console-bar-h,64px)+16px)]">
        <ConsolePanel title={BILLING_COPY.title} flush>
          <BillingCard />
        </ConsolePanel>
      </section>

      <ConsolePanel title="Session">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="max-w-[60ch] text-sm leading-normal text-muted">{COPY.session}</p>
          <ConsoleButton
            variant="secondary"
            disabled={leaving}
            onClick={() => {
              setLeaving(true);
              setStatus("");
              signOut().catch(() => {
                setLeaving(false);
                setStatus(AUTH_COPY.signOutFailed);
              });
            }}
          >
            {leaving ? COPY.signingOut : COPY.signOut}
          </ConsoleButton>
        </div>
        <p role="status" aria-live="polite" className="mt-3 text-sm text-muted empty:hidden">
          {status}
        </p>
      </ConsolePanel>
    </>
  );
}

/** The account's name: shown in the console and the site's header in place of the address. */
function NameForm({ initial, onSave }: { initial: string; onSave: (name: string) => Promise<void> }) {
  const [name, setName] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setStatus("");
    try {
      await onSave(name);
      const cleared = !name.trim();
      if (cleared) setName("");
      setStatus(cleared ? COPY.nameCleared : COPY.nameSaved);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : AUTH_COPY.service.failed);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="flex flex-col gap-2" onSubmit={onSubmit}>
      <Label className="text-sm font-medium text-ink" htmlFor="account-name">
        {COPY.nameLabel}
      </Label>
      <p id="account-name-hint" className="text-sm text-muted">
        {COPY.nameHint}
      </p>
      <div className="flex max-w-xl flex-wrap gap-2">
        <Input
          id="account-name"
          name="name"
          className={`${authInput} min-w-0 flex-1 basis-56`}
          autoComplete="name"
          maxLength={NAME_MAX_LENGTH}
          aria-describedby="account-name-hint"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <ConsoleButton type="submit" variant="secondary" aria-disabled={saving || undefined}>
          {saving ? COPY.savingName : COPY.saveName}
        </ConsoleButton>
      </div>
      <p role="status" aria-live="polite" className="text-sm text-muted empty:hidden">
        {status}
      </p>
    </form>
  );
}
