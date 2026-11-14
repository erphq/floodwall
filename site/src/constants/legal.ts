// The Terms, Privacy and Refund pages: what Floodwall Cloud promises, what it keeps about people,
// and how refunds work. Stripe needs all three on the site before it takes live payments. Written in
// plain words; each page dates its last change, so a change here moves LEGAL_UPDATED.

/** The company behind Floodwall Cloud, as Stripe and invoices name it. */
export const LEGAL_ENTITY = "ERP.AI MA LLC";

/** Where people write about their account, billing, privacy or these terms. */
export const CONTACT_EMAIL = "support@floodwall.ai";

/** When these pages last changed. */
export const LEGAL_UPDATED = "November 14, 2026";

export const LEGAL_PATHS = {
  terms: "/terms",
  privacy: "/privacy",
  refunds: "/refunds",
} as const;

export type LegalKey = keyof typeof LEGAL_PATHS;

/** One page: a short opening, then numbered sections of paragraphs (a list when `items` is set). */
export type LegalDocument = {
  key: LegalKey;
  /** The tab label above the heading, and the page's <title>. */
  name: string;
  /** The heading, its emphasised half in `strong`. */
  title: [string, string];
  description: string;
  intro: string;
  sections: { heading: string; paragraphs?: string[]; items?: string[] }[];
};

const contact = `Write to ${CONTACT_EMAIL}.`;

export const LEGAL_DOCUMENTS: Record<LegalKey, LegalDocument> = {
  terms: {
    key: "terms",
    name: "Terms of Service",
    title: ["Terms of Service.", "The rules for Floodwall Cloud."],
    description: "The terms for using Floodwall Cloud, the hosted service at floodwall.ai.",
    intro: `These terms are an agreement between you (or the organisation you sign up for) and ${LEGAL_ENTITY} ("we"), which runs Floodwall Cloud: the hosted ledger, approvals and console at floodwall.ai. By creating an account or paying for a plan you accept them. The open-source Floodwall crate is not covered here: it is licensed separately under its own MIT licence, and running it yourself needs no account.`,
    sections: [
      {
        heading: "Your account",
        paragraphs: [
          "You sign in with a one-time code sent to your email address. Keep that inbox secure: whoever can read it can sign in as you. You are responsible for what happens under your account, and for the agents, policies and integrations you connect to it.",
          "During early access, accounts are approved by hand. We may decline or close an account that breaks these terms.",
        ],
      },
      {
        heading: "Acceptable use",
        items: [
          "Don't use Floodwall Cloud to break the law or to harm, defraud or spy on others.",
          "Don't probe, overload or try to get around the service's limits, security or billing.",
          "Don't resell the hosted service, or share one account between unrelated organisations, without a written agreement with us.",
          "Don't upload anything you don't have the right to share, including other people's personal data beyond what your own use of the service needs.",
        ],
      },
      {
        heading: "Plans, billing and renewal",
        paragraphs: [
          "The Free plan costs nothing and has the limits shown on the pricing page. Team and Business are subscriptions billed monthly or yearly in advance, through Stripe, and renew automatically until you cancel. Each includes a number of decisions per month; when metered billing is switched on for your plan, decisions above that number are charged at the per-thousand rate on the pricing page, in arrears.",
          "Prices exclude taxes, which are added where the law requires. We may change prices for future billing periods; we will tell you by email at least 30 days before a change affects you, and you can cancel before it takes effect.",
          "If a payment fails, we retry it and tell you. A plan whose payment stays unpaid can be moved back to Free.",
          "Discount codes and account credit apply as described when they are given. Credit is applied to your next invoices, has no cash value, and cannot be transferred.",
        ],
      },
      {
        heading: "Cancelling",
        paragraphs: [
          "You can cancel at any time from Billing on your account page. Your plan stays active until the end of the period you have paid for, then the account moves to Free. Refunds are covered by our Refund Policy.",
        ],
      },
      {
        heading: "Your data",
        paragraphs: [
          "What you put into Floodwall Cloud (intents, policies, verdicts and ledger records) stays yours. We use it only to run the service for you, as described in our Privacy Policy. You can export your ledger at any time while your account is open; after an account is closed we delete its data within 30 days, except where the law requires us to keep billing records.",
        ],
      },
      {
        heading: "Availability",
        paragraphs: [
          "We work to keep Floodwall Cloud available and your ledger intact, but outside a written service-level agreement the service is provided as is and may be interrupted for maintenance or by events outside our control. The Business plan's 99.9% uptime target, and any credit for missing it, are set out in its order or agreement.",
        ],
      },
      {
        heading: "Liability",
        paragraphs: [
          "Floodwall decides whether an agent's change may go ahead according to the policies you configure; you remain responsible for those policies and for what your systems do. To the extent the law allows, we are not liable for indirect or consequential losses, and our total liability for any claim is limited to what you paid us in the 12 months before it arose.",
        ],
      },
      {
        heading: "Changes and ending",
        paragraphs: [
          "We may update these terms. For a change that matters, we will email account owners at least 30 days ahead; continuing to use the service after it takes effect means you accept it. You can stop using Floodwall Cloud at any time, and we may suspend or close an account that breaks these terms.",
          "These terms are governed by the laws of the Commonwealth of Massachusetts, USA, without regard to its conflict-of-law rules.",
        ],
      },
      { heading: "Contact", paragraphs: [`Questions about these terms? ${contact}`] },
    ],
  },

  privacy: {
    key: "privacy",
    name: "Privacy Policy",
    title: ["Privacy Policy.", "What we keep, and why."],
    description: "What Floodwall Cloud collects about you, how it is used, who processes it, and your choices.",
    intro: `${LEGAL_ENTITY} ("we") runs floodwall.ai and Floodwall Cloud. This policy says what we collect, why, who helps us process it, and what you can ask of us. We keep as little as the service needs.`,
    sections: [
      {
        heading: "What we collect",
        items: [
          "Your email address, and when you signed up, last signed in and were approved.",
          "A sign-in session: a random token in a cookie on api.floodwall.ai, stored by us only as a hash, for up to 30 days.",
          "One-time sign-in codes, stored only as hashes and deleted once used or expired.",
          "Your network address and the email address you entered, briefly, to limit how often codes can be asked for and tried.",
          "Your plan, its status and renewal date, and any credit on your account.",
          "What you put into Floodwall Cloud: intents, policies, verdicts and ledger records.",
        ],
      },
      {
        heading: "What we don't collect",
        paragraphs: [
          "We never see or store your card details: payments are taken by Stripe on its own checkout and billing pages. The website uses no advertising or third-party analytics trackers; it remembers your light or dark theme in your browser's own storage.",
        ],
      },
      {
        heading: "How we use it",
        items: [
          "To sign you in, keep your account secure and stop abuse.",
          "To run the service, keep your ledger and show you your console.",
          "To bill your plan and tell you about payments, renewals and failed charges.",
          "To email you about your account and changes to the service. We don't send marketing without your consent.",
        ],
      },
      {
        heading: "Who processes it for us",
        items: [
          "Cloudflare: hosts the service and its database.",
          "Resend: sends our emails, including sign-in codes.",
          "Stripe: takes payments and keeps invoices, through Paygate, our own billing service, which keeps your plan and billing history.",
          "GitHub: hosts the public website's pages.",
        ],
        paragraphs: [
          "Each processes data only to provide its service to us. Some are in the United States; where data leaves your country, we rely on the safeguards those providers offer. We don't sell personal data.",
        ],
      },
      {
        heading: "How long we keep it",
        paragraphs: [
          "Account details are kept while your account is open and deleted within 30 days of closing it. Sign-in codes expire in 10 minutes; sessions last at most 30 days; rate-limit records are cleared daily. Billing records are kept as long as tax and accounting law requires.",
        ],
      },
      {
        heading: "Your choices",
        paragraphs: [
          `You can ask to see, correct, export or delete the personal data we hold about you, or object to how we use it. ${contact} We answer within 30 days. You can also complain to your local data-protection authority.`,
        ],
      },
      {
        heading: "Changes",
        paragraphs: ["If we change this policy in a way that matters, we will email account owners before it takes effect."],
      },
    ],
  },

  refunds: {
    key: "refunds",
    name: "Refund Policy",
    title: ["Refund Policy.", "When we give money back."],
    description: "How cancelling and refunds work for Floodwall Cloud's Team and Business plans.",
    intro: "Floodwall Cloud's paid plans are subscriptions you can cancel at any time. This page says when you can have money back, and how to ask.",
    sections: [
      {
        heading: "Cancelling",
        paragraphs: [
          "Cancel from Billing on your account page. Nothing more is charged; your plan stays active until the end of the period you have paid for, then the account moves to Free.",
        ],
      },
      {
        heading: "Monthly plans",
        paragraphs: [
          "Monthly payments are not refunded for a month already started, but you can cancel before the next renewal and won't be charged again. If you forgot to cancel and haven't used the service since the renewal, write to us within 7 days of it and we will refund that month.",
        ],
      },
      {
        heading: "Yearly plans",
        paragraphs: [
          "Your first yearly payment is fully refundable if you ask within 14 days of it. After that, or for a renewal, we refund the unused whole months, less any discount the yearly price gave you over paying monthly.",
        ],
      },
      {
        heading: "Usage, credit and discounts",
        paragraphs: [
          "Charges for decisions above your plan's allowance are for usage already delivered and are not refunded. Account credit and discount codes have no cash value and are not paid out. A refund for a discounted payment is of the amount you actually paid.",
        ],
      },
      {
        heading: "Our mistakes",
        paragraphs: [
          "If you were charged twice, charged after cancelling, or charged the wrong amount, we refund the difference in full, whenever you notice.",
        ],
      },
      {
        heading: "How to ask",
        paragraphs: [
          `${contact} Use the email address on your account and tell us which payment. We reply within 2 business days; an approved refund goes back to the original card, and Stripe usually shows it within 5 to 10 business days.`,
        ],
      },
    ],
  },
};
