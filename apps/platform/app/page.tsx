import { AnnouncementBar } from "@/components/landing/announcement-bar";
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
 * A deep green canvas with an oversized monospace display face. The hero owns the
 * first viewport; the sections below carry the explanation, because unlike a
 * wallet this product has to say what identity, access and custody mean before a
 * visitor can judge it.
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
      <AnnouncementBar />
    </>
  );
}
