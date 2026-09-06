import React, { useEffect, useRef } from "react";
import { motion } from "framer-motion";

const NAVBAR_OFFSET = 130;

const priceCategories = [
  {
    id: "tux-burger",
    label: "Tux Burger",
    items: [
      { name: "Single Tux Burger", price: 95 },
      { name: "Double Tux Burger", price: 140 },
      { name: "Triple Tux Burger", price: 160 },
      { name: "TUX Quatro", price: 190 },
    ],
  },
  {
    id: "tuxify",
    label: "Tuxify Burger",
    items: [
      { name: "Single Tuxify", price: 120 },
      { name: "Double Tuxify", price: 160 },
      { name: "Triple Tuxify", price: 200 },
      { name: "Quatro Tuxify", price: 240 },
    ],
  },
  {
    id: "hawawshi",
    label: "Hawawshi",
    items: [
      { name: "Classic Hawawshi", price: 80 },
      { name: "TUX Hawawshi", price: 100 },
    ],
  },
  {
    id: "fries",
    label: "Fries",
    items: [
      { name: "Classic Fries (Small)", price: 25 },
      { name: "Classic Fries (Large)", price: 30 },
      { name: "Cheese Fries", price: 30 },
      { name: "Chili Fries", price: 40 },
      { name: "TUX Fries", price: 50 },
      { name: "Doppy Fries", price: 75 },
    ],
  },
  {
    id: "combos",
    label: "Combos",
    items: [
      { name: "Single Combo", price: null },
      { name: "Double Combo", price: null },
      { name: "Tuxify Combo", price: null },
      { name: "Family Combo", price: null },
    ],
  },
  {
    id: "drinks",
    label: "Drinks",
    items: [
      { name: "Soda", price: 20 },
      { name: "Water", price: 10 },
    ],
  },
  {
    id: "extras",
    label: "Extras",
    items: [
      { name: "Extra Patty", price: 40 },
      { name: "Bacon", price: 20 },
      { name: "Cheese", price: 15 },
      { name: "Ranch", price: 10 },
      { name: "Mushroom", price: 15 },
      { name: "Caramelized Onion", price: 10 },
      { name: "Jalapeño", price: 10 },
      { name: "TUX Sauce", price: 10 },
      { name: "Extra Bun", price: 10 },
      { name: "Pickle", price: 5 },
      { name: "BBQ Sauce", price: 5 },
      { name: "Ketchup", price: 5 },
      { name: "Sweet Chili Sauce", price: 5 },
      { name: "Hot Sauce", price: 5 },
    ],
  },
];

export default function OurPrices() {
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    document.title = "Our Prices | TUX";
  }, []);

  const scrollToSection = (id: string) => {
    const el = sectionRefs.current[id];
    if (el) {
      const y = el.getBoundingClientRect().top + window.scrollY - NAVBAR_OFFSET;
      window.scrollTo({ top: y, behavior: "smooth" });
    }
  };

  return (
    <div className="w-full bg-[#0D0D0D] min-h-screen">
      {/* Page header */}
      <div className="pt-32 pb-12 px-6 md:px-12 max-w-7xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7 }}
        >
          <span className="text-[#C9A84C] font-sans text-xs tracking-[0.3em] uppercase">Full Menu</span>
          <h1 className="text-5xl md:text-6xl font-serif font-bold text-white mt-2 mb-4">Our Prices</h1>
          <p className="text-[#999080] font-sans text-lg max-w-xl">
            Every item, every price. No surprises — just great food at a fair price.
          </p>
        </motion.div>
      </div>

      {/* Sticky Category Tabs */}
      <div className="sticky top-[72px] md:top-[88px] z-40 bg-[#0D0D0D]/90 backdrop-blur border-b border-[#2a2520] w-full overflow-x-auto">
        <div className="max-w-7xl mx-auto px-6 md:px-12 flex items-center gap-1 min-w-max h-14">
          {priceCategories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => scrollToSection(cat.id)}
              className="px-4 py-1.5 font-sans text-sm tracking-wide text-[#999080] hover:text-[#C9A84C] hover:bg-[#C9A84C]/5 rounded transition-all whitespace-nowrap"
              data-testid={`price-tab-${cat.id}`}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* Price Sections */}
      <div className="max-w-4xl mx-auto px-6 md:px-12 py-16 space-y-10">
        {priceCategories.map((cat, catIdx) => (
          <motion.section
            key={cat.id}
            ref={(el) => { sectionRefs.current[cat.id] = el; }}
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.1 }}
            transition={{ duration: 0.6, delay: catIdx * 0.05 }}
            className="rounded-xl overflow-hidden border border-[#2a2520]"
            data-testid={`price-section-${cat.id}`}
          >
            {/* Section header */}
            <div className="flex items-center gap-4 bg-[#1A1610] px-6 py-5 border-l-4 border-[#C9A84C]">
              <h2 className="text-[#C9A84C] font-serif text-2xl font-bold">{cat.label}</h2>
            </div>

            {/* Price rows */}
            <div className="divide-y divide-[#2a2520] bg-[#111009]">
              {cat.items.map((item, i) => (
                <div
                  key={item.name}
                  className={`flex items-center justify-between px-6 py-4 ${
                    i % 2 === 0 ? "bg-transparent" : "bg-white/[0.015]"
                  }`}
                  data-testid={`price-row-${cat.id}-${i}`}
                >
                  <span className="text-[#F5EDD8] font-sans text-sm md:text-base">{item.name}</span>
                  <span className="text-[#C9A84C] font-sans font-bold text-sm md:text-base ml-8 whitespace-nowrap">
                    {item.price !== null ? `${item.price} EGP` : "Ask us"}
                  </span>
                </div>
              ))}
            </div>
          </motion.section>
        ))}
      </div>

      {/* Footer CTA */}
      <div className="max-w-4xl mx-auto px-6 md:px-12 pb-24 text-center">
        <p className="text-[#999080] font-sans mb-6">Ready to order? We're just a message away.</p>
        <a
          href="https://wa.me/201000000000?text=Hello TUX, I want to make an order."
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block px-10 py-4 rounded bg-[#8B1A1A] text-white font-sans font-bold uppercase tracking-wider hover:brightness-110 hover:scale-[1.02] transition-all shadow-lg shadow-[#8B1A1A]/20"
          data-testid="prices-order-now"
        >
          Order Now on WhatsApp
        </a>
      </div>
    </div>
  );
}
