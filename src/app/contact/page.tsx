/**
 * Public contact page — no sign-in required, linked from the login page.
 */
import Link from "next/link";
import Layout from "@/components/Layout";

const CONTACT_EMAIL = "tmaurodot@gmail.com";

export default function ContactPage() {
  return (
    <Layout>
      <div className="mx-auto max-w-xl">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-gray-900 sm:text-2xl">Contact</h1>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
          <p className="text-sm leading-relaxed text-gray-600">
            Questions, feedback, or issues with Tactical Asset Log — reach out at{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className="font-medium text-blue-600 hover:underline">
              {CONTACT_EMAIL}
            </a>
            .
          </p>
          <p className="mt-3 text-sm leading-relaxed text-gray-600">
            If your question is about getting an account or access within your own department, start with your
            department&apos;s admin first — accounts are invite-only and managed by them, not created here. See the{" "}
            <Link href="/faq" className="font-medium text-blue-600 hover:underline">
              FAQ
            </Link>{" "}
            for more.
          </p>
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
