import { useState, useRef, useEffect, useCallback } from "react";
import { useMenu } from "@/context/MenuContext";
import { CategoryTabs } from "@/components/order/CategoryTabs";
import { ProductOrderCard } from "@/components/order/ProductOrderCard";
import { motion } from "framer-motion";

export default function OrderNow() {
  const { sections, products, loading } = useMenu();
  const [activeCategory, setActiveCategory] = useState<string>("");
  const categoryRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});
  const isScrollingProgrammatically = useRef(false);

  // Set initial active category once sections load
  useEffect(() => {
    if (sections.length > 0 && !activeCategory) {
      setActiveCategory(sections[0].id);
    }
  }, [sections, activeCategory]);

  // Scroll-spy: observe which section is in view
  useEffect(() => {
    if (sections.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (isScrollingProgrammatically.current) return;
        // Find the most visible section
        let maxRatio = 0;
        let topCandidateId = "";
        entries.forEach((entry) => {
          if (entry.isIntersecting && entry.intersectionRatio > maxRatio) {
            maxRatio = entry.intersectionRatio;
            topCandidateId = entry.target.id;
          }
        });
        if (topCandidateId) {
          setActiveCategory(topCandidateId);
        }
      },
      {
        root: null,
        rootMargin: "-30% 0px -60% 0px",
        threshold: [0, 0.25, 0.5, 0.75, 1],
      }
    );

    Object.values(categoryRefs.current).forEach((el) => {
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [sections, loading]);

  const scrollToCategory = useCallback((categoryId: string) => {
    setActiveCategory(categoryId);
    const element = categoryRefs.current[categoryId];
    if (element) {
      isScrollingProgrammatically.current = true;
      const y = element.getBoundingClientRect().top + window.scrollY - 130;
      window.scrollTo({ top: y, behavior: "smooth" });
      setTimeout(() => {
        isScrollingProgrammatically.current = false;
      }, 800);
    }
  }, []);

  const activeSections = sections.filter((s) => s.is_active);

  return (
    <div className="min-h-screen bg-black pt-24 pb-32 font-sans text-white relative">
      <div className="container mx-auto px-4 max-w-4xl relative z-10">
        
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="text-center mb-10"
        >
          <h1 className="text-4xl md:text-5xl font-black mb-4 uppercase tracking-tighter text-white">
            Order <span className="text-[#D4AF37]">Now</span>
          </h1>
          <p className="text-gray-400 max-w-2xl mx-auto text-lg">
            Choose your favorites and checkout directly via WhatsApp.
          </p>
        </motion.div>

        {/* Category Tabs (sticky + scroll-spy driven) */}
        {activeSections.length > 0 && (
          <CategoryTabs
            categories={activeSections}
            activeCategory={activeCategory}
            onSelectCategory={scrollToCategory}
          />
        )}

        {/* Loading State */}
        {loading && (
          <div className="mt-16 flex flex-col items-center gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="w-full h-24 bg-white/5 rounded-xl animate-pulse" />
            ))}
          </div>
        )}

        {/* Empty State */}
        {!loading && activeSections.length === 0 && (
          <div className="mt-20 text-center text-gray-600">
            <p className="text-xl">No menu items available yet.</p>
            <p className="text-sm mt-2">Check back soon!</p>
          </div>
        )}

        {/* Menu Sections */}
        {!loading && (
          <div className="mt-8 space-y-14">
            {activeSections.map((section) => {
              const sectionProducts = products
                .filter((p) => p.section_id === section.id && p.is_active)
                .sort((a, b) => a.sort_order - b.sort_order);

              if (sectionProducts.length === 0) return null;

              return (
                <div
                  key={section.id}
                  id={section.id}
                  ref={(el) => (categoryRefs.current[section.id] = el)}
                  className="scroll-mt-32"
                >
                  <h2 className="text-2xl font-black text-[#D4AF37] uppercase tracking-wide mb-6 border-b border-white/10 pb-2">
                    {section.name}
                  </h2>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {sectionProducts.map((product) => (
                      <ProductOrderCard key={product.id} product={product} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

      </div>
    </div>
  );
}
