import { Capabilities } from "@/components/landing/capabilities";
import { Evidence } from "@/components/landing/evidence";
import { Hero } from "@/components/landing/hero";
import { HowItWorks } from "@/components/landing/how-it-works";
import { SiteFooter } from "@/components/landing/site-footer";
import { SiteHeader } from "@/components/landing/site-header";
import { SplitExplainer } from "@/components/landing/split-explainer";

/**
 * owneX landing page.
 *
 * The shell and copy render on the server; only the sections that animate or
 * hold state are client components, so the first paint is HTML and the page has
 * no layout shift.
 */
export default function HomePage() {
  return (
    <>
      <SiteHeader />
      <main className="flex-1">
        <Hero />
        <HowItWorks />
        <SplitExplainer />
        <Capabilities />
        <Evidence />
      </main>
      <SiteFooter />
    </>
  );
}
