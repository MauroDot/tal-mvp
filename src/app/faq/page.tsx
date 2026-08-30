/**
 * Public FAQ — no sign-in required, linked from the login page. Answers
 * the questions a department evaluating this actually asks: what it is,
 * who it's for, how data is kept separate between departments, and
 * — important for a police department specifically — what it does NOT
 * hold (case files, evidence, CJIS-regulated data).
 */
import type { ReactNode } from "react";
import Link from "next/link";
import Layout from "@/components/Layout";

const FAQS: { question: string; answer: ReactNode }[] = [
  {
    question: "What is Tactical Asset Log?",
    answer: (
      <>
        A fleet and equipment operations tool: daily vehicle inspections, defect/issue reporting, work orders,
        maintenance history, and asset status (ready, needs attention, out of service, etc.) for a
        department&apos;s vehicles and equipment. It&apos;s built around the inspection checklist an officer runs
        through before
        taking a unit out, and everything that follows from what that checklist turns up.
      </>
    ),
  },
  {
    question: "Who is it for?",
    answer: (
      <>
        A department&apos;s own fleet operations, top to bottom: officers run daily inspections and report defects
        on the vehicles assigned to them; fleet managers and supervisors see the whole fleet, work orders, and
        maintenance history; admins manage user accounts, inspection templates, and organization settings.
      </>
    ),
  },
  {
    question: "Is our department's data visible to other departments?",
    answer: (
      <>
        No. Every department is a separate, isolated organization in the system — vehicles, inspections, issues,
        work orders, and user accounts all belong to exactly one organization, and the system enforces that
        boundary on every read and write, not just in what the screens happen to show. A user account only ever
        belongs to one department.
      </>
    ),
  },
  {
    question: "Does this hold case files, evidence, or CJIS-regulated data?",
    answer: (
      <>
        No. Tactical Asset Log only holds fleet/equipment operational data — vehicle records, inspection
        checklists, reported defects, work orders, and maintenance history. It has no connection to a CAD or RMS
        system, and it is not a repository for case files, evidence, or any criminal-justice records. If your
        department needs a system for that, this isn&apos;t it — and it&apos;s deliberately built to stay out of
        that territory.
      </>
    ),
  },
  {
    question: "How do I get an account?",
    answer: (
      <>
        Accounts are invite-only — there&apos;s no public sign-up. An admin in your department adds you by email
        with a role (officer, supervisor, fleet manager, equipment manager, or admin) and you&apos;ll get an email
        to set your password. If you need access, ask your department&apos;s admin to invite you.
      </>
    ),
  },
  {
    question: "What if I forget my password?",
    answer: (
      <>
        Use &ldquo;Forgot password?&rdquo; on the sign-in page. You&apos;ll get a reset link by email if an account
        exists for the address you enter.
      </>
    ),
  },
  {
    question: "Who do I contact with questions?",
    answer: (
      <>
        See the <Link href="/contact" className="font-medium text-blue-600 hover:underline">Contact</Link> page.
        For account access specifically, start with your own department&apos;s admin first.
      </>
    ),
  },
];

export default function FaqPage() {
  return (
    <Layout>
      <div className="mx-auto max-w-2xl">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-gray-900 sm:text-2xl">Frequently Asked Questions</h1>
        </div>

        <div className="space-y-4">
          {FAQS.map((faq) => (
            <div key={faq.question} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
              <h2 className="text-sm font-semibold text-gray-900">{faq.question}</h2>
              <p className="mt-1.5 text-sm leading-relaxed text-gray-600">{faq.answer}</p>
            </div>
          ))}
        </div>

        <p className="mt-6 text-center text-sm text-gray-500">
          <Link href="/auth/login" className="font-medium text-blue-600 hover:underline">
            ← Back to sign in
          </Link>
        </p>
      </div>
    </Layout>
  );
}
