import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useMenu } from "@/context/MenuContext";
import { CategoryTabs } from "@/components/order/CategoryTabs";
import { ProductOrderCard } from "@/components/order/ProductOrderCard";
import { motion } from "framer-motion";
import { getOrderProductElementId, isOrderProductElementId } from "@/lib/product-routes";

const EXTRAS_SECTION_ID = "extras";

export default function OrderNow() {
  const { sections, products, loading } = useMenu();
  const [activeCategory, setActiveCategory] = useState<string>("");
  const [targetProductElementId, setTargetProductElementId] = useState<string>("");
  const categoryRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});
  const isScrollingProgrammatically = useRef(false);

  const extraProducts = useMemo(
    () =>
      products
        .filter((product) => product.section_id === EXTRAS_SECTION_ID && product.is_active)
        .sort((a, b) => a.sort_order - b.sort_order),
    [products]
  );

  const menuSections = useMemo(
    () =>
      sections
        .filter((section) => section.id !== EXTRAS_SECTION_ID)
        .sort((a, b) => a.sort_order - b.sort_order),
    [sections]
  );

  // Set initial active category once sections load.
  useEffect(() => {
    if (menuSections.length > 0 && !activeCategory) {
      setActiveCategory(menuSections[0].id);
    }
  }, [menuSections, activeCategory]);

  // Resolve product deep links after menu data and product cards are rendered.
  useEffect(() => {
    if (loading) return;

    const elementId = window.location.hash.slice(1);
    if (!elementId || !isOrderProductElementId(elementId)) {
      setTargetProductElementId("");
      return;
    }

    const targetProduct = products.find(
      (product) => getOrderProductElementId(product.id) === elementId
    );

    if (!targetProduct) {
      setTargetProductElementId("");
      return;
    }

    setTargetProductElementId(elementId);
    setActiveCategory(targetProduct.section_id);

    let releaseScrollLockTimer: number | undefined;
    const scrollTimer = window.setTimeout(() => {
      const targetElement = document.getElementById(elementId);
      if (!targetElement) return;

      isScrollingProgrammatically.current = true;
      const y = targetElement.getBoundingClientRect().top + window.scrollY - 150;
      window.scrollTo({ top: y, behavior: "smooth" });
      targetElement.focus({ preventScroll: true });

      releaseScrollLockTimer = window.setTimeout(() => {
        isScrollingProgrammatically.current = false;
      }, 900);
    }, 120);

    return () => {
      window.clearTimeout(scrollTimer);
      if (releaseScrollLockTimer !== undefined) {
        window.clearTimeout(releaseScrollLockTimer);
      }
    };
  }, [loading, products]);

  // Scroll-spy: observe which section is in view.
  useEffect(() => {
    if (menuSections.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (isScrollingProgrammatically.current) return;
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
  }, [menuSections, loading]);

  const scrollToCategory = useCallback((categoryId: string) => {
    setActiveCategory(categoryId);
    setTargetProductElementId("");
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
        {menuSections.length > 0 && (
          <CategoryTabs
            categories={menuSections}
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
        {!loading && menuSections.length === 0 && (
          <div className="mt-20 text-center text-gray-600">
            <p className="text-xl">No menu items available yet.</p>
            <p className="text-sm mt-2">Check back soon!</p>
          </div>
        )}

        {/* Menu Sections */}
        {!loading && (
          <div className="mt-8 space-y-14">
            {menuSections.map((section) => {
              const sectionProducts = products
                .filter((p) => p.section_id === section.id)
                .sort((a, b) => a.sort_order - b.sort_order);
              const categoryUnavailable = !section.is_active;

              return (
                <div
                  key={section.id}
                  id={section.id}
                  ref={(el) => {
                    categoryRefs.current[section.id] = el;
                  }}
                  className={`scroll-mt-32 rounded-2xl ${categoryUnavailable ? "bg-gray-900/40 p-4 border border-gray-700" : ""}`}
                >
                  <h2 className={`text-2xl font-black uppercase tracking-wide mb-3 border-b pb-2 ${categoryUnavailable ? "text-gray-400 border-gray-700" : "text-[#D4AF37] border-white/10"}`}>
                    {section.name}
                  </h2>

                  {categoryUnavailable && (
                    <p className="mb-5 rounded-lg border border-gray-700 bg-gray-800/80 px-4 py-3 text-sm font-semibold text-gray-200">
                      This categorie is currently not available.
                    </p>
                  )}

                  {sectionProducts.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-gray-500">
                      No products in this category yet.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {sectionProducts.map((product) => {
                        const elementId = getOrderProductElementId(product.id);

                        return (
                          <ProductOrderCard
                            key={product.id}
                            product={product}
                            extras={extraProducts}
                            categoryUnavailable={categoryUnavailable}
                            elementId={elementId}
                            isTargeted={targetProductElementId === elementId}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

      </div>
    </div>
  );
}
