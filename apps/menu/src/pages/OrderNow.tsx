import { useState, useRef } from "react";
import { CATEGORIES, PRODUCTS } from "@/lib/menu-data";
import { CategoryTabs } from "@/components/order/CategoryTabs";
import { ProductOrderCard } from "@/components/order/ProductOrderCard";
import { motion } from "framer-motion";

export default function OrderNow() {
  const [activeCategory, setActiveCategory] = useState<string>(CATEGORIES[0].id);
  const categoryRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});

  const scrollToCategory = (categoryId: string) => {
    setActiveCategory(categoryId);
    const element = categoryRefs.current[categoryId];
    if (element) {
      // account for the fixed header and sticky tabs
      const y = element.getBoundingClientRect().top + window.scrollY - 130;
      window.scrollTo({ top: y, behavior: "smooth" });
    }
  };

  return (
    <div className="min-h-screen bg-black pt-24 pb-32 font-sans text-white relative">
      <div className="container mx-auto px-4 max-w-4xl relative z-10">
        
        {/* Header Section */}
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

        {/* Category Tabs */}
        <CategoryTabs 
          categories={CATEGORIES}
          activeCategory={activeCategory}
          onSelectCategory={scrollToCategory}
        />

        {/* Menu Sections */}
        <div className="mt-8 space-y-12">
          {CATEGORIES.map((category) => {
            const categoryProducts = PRODUCTS.filter(
              (p) => p.category_id === category.id && p.is_available
            ).sort((a, b) => a.sort_order - b.sort_order);

            if (categoryProducts.length === 0) return null;

            return (
              <div 
                key={category.id} 
                ref={(el) => (categoryRefs.current[category.id] = el)}
                className="scroll-mt-32"
              >
                <h2 className="text-2xl font-black text-[#D4AF37] uppercase tracking-wide mb-6 border-b border-white/10 pb-2">
                  {category.name}
                </h2>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {categoryProducts.map((product) => (
                    <ProductOrderCard key={product.id} product={product} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>

      </div>
    </div>
  );
}
