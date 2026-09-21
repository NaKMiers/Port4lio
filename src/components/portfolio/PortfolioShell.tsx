import type { PublicPortfolioViewModel } from '@/lib/profile-view-model'
import type { Profile } from '@/types/profile'

import WritingTeaser from '@/components/blog/WritingTeaser'
import FloatingSectionNav from './FloatingSectionNav'
import PortfolioBackdropOrnaments from './PortfolioBackdropOrnaments'
import PortfolioSectionScrollTarget from './PortfolioSectionScrollTarget'
import AboutStorySection from './sections/AboutStorySection'
import ContactSection from './sections/ContactSection'
import FeaturedProjectsSection from './sections/FeaturedProjectsSection'
import FooterSection from './sections/FooterSection'
import FounderQuoteSection from './sections/FounderQuoteSection'
import HeroSection from './sections/HeroSection'
import ProjectCatalogSection from './sections/ProjectCatalogSection'
import ServicesSection from './sections/ServicesSection'
import SocialProofStrip from './sections/SocialProofStrip'
import TrustSection from './sections/TrustSection'

type PortfolioShellProps = {
  profile: Profile
  viewModel: PublicPortfolioViewModel
}

/** One-page composition root; section surfaces use portfolio primitives + tokens. */
export default function PortfolioShell({
  profile,
  viewModel,
}: PortfolioShellProps) {
  return (
    <>
      {/* Floating section nav client island (Chunk 3+). */}
      <FloatingSectionNav />
      <PortfolioSectionScrollTarget />
      <main className="relative overflow-hidden pb-[5.25rem] md:pb-0">
        <PortfolioBackdropOrnaments />
        <HeroSection
          hero={viewModel.hero}
          featuredProjects={viewModel.featuredProjects.projects}
        />
        <SocialProofStrip socialProof={viewModel.socialProof} />
        <FounderQuoteSection founderProof={viewModel.founderProof} />
        <AboutStorySection about={viewModel.about} />
        <ServicesSection services={viewModel.services} />
        <FeaturedProjectsSection featured={viewModel.featuredProjects} />
        <ProjectCatalogSection catalog={viewModel.projectCatalog} />
        <TrustSection trust={viewModel.trust} />
        {/*
          Directly above the contact form, and that placement is the whole point. A reader
          who has scrolled this far is deciding whether to get in touch; three post titles
          are the last piece of evidence before the ask, and they are the only evidence on
          this page that shows the work rather than describing it. Renders nothing until
          there is a published post - see WritingTeaser.
        */}
        <div className="mx-auto w-full max-w-editorial px-gutter">
          <WritingTeaser />
        </div>
        <ContactSection profile={profile} />
        <FooterSection profile={profile} />
      </main>
    </>
  )
}
