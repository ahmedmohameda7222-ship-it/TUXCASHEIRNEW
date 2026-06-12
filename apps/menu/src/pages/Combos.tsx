import React, { useEffect } from "react";
import { motion } from "framer-motion";
import { ProductCategoryNav } from "@/components/ProductCategoryNav";
import { WHATSAPP_URL } from "@/lib/constants";

const products = [
  {
    id: "01",
    name: "Single Combo",
    description: "Single burger + fries + drink. The perfect everyday meal.",
    tag: "Popular",
  },
  {
    id: "02",
    name: "Double Combo",
    description: "Double burger + fries + drink. For those who come hungry.",
  },
  {
    id: "03",
    name: "Tuxify Combo",
    description: "Tuxify Burger + fries + drink. The signature combo experience.",
    tag: "Signature",
  },
  {
    id: "04",
    name: "Family Combo",
    description: "Multiple burgers, fries, and drinks. Built for sharing — or not.",
    tag: "Best Value",
  },
];

function PlaceholderImage({ id }: { id: string }) {
  return (
    <div
      className="w-full aspect-square rounded-xl flex items-center justify-center"
      style={{ background: "radial-gradient(ellipse at center, #1a1200 0%, #0D0D0D 80%)" }}
    >
      <div className="text-center">
        <span className="text-[#C9A84C]/20 font-serif text-7xl font-bold select-none">{id}</span>
        <p className="text-[#C9A84C]/30 font-sans text-xs tracking-widest uppercase mt-2">Photo Coming Soon</p>
      </div>
    </div>
  );
}

export default function Combos() {
  useEffect(() => {
    document.title = "Combos | TUX";
  }, []);

  return (
    <div className="w-full bg-[#0D0D0D] min-h-screen pt-[120px] md:pt-[136px]">
      <ProductCategoryNav />

      <div className="max-w-7xl mx-auto px-6 md:px-12 pt-10 pb-24">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7 }}
          className="mb-14"
        >
          <span className="text-[#C9A84C] font-sans text-xs tracking-[0.3em] uppercase">Our Menu</span>
          <h1 className="text-5xl md:text-6xl font-serif font-bold text-white mt-2 mb-4">Combos</h1>
          <p className="text-[#999080] font-sans text-lg max-w-xl">
            The full experience. Burger, fries, and a drink — everything you need in one order.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {products.map((product, i) => (
            <motion.div
              key={product.id}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: i * 0.1 }}
              className="group rounded-xl overflow-hidden border border-[#2a2520] bg-[#111009] hover:border-[#C9A84C]/30 hover:scale-[1.02] transition-all duration-300 relative"
              data-testid={`product-card-${i}`}
            >
              {product.tag && (
                <div className="absolute top-6 right-6 z-10 bg-[#C9A84C] text-black text-xs font-bold font-sans uppercase tracking-wider px-2.5 py-1 rounded">
                  {product.tag}
                </div>
              )}
              <div className="p-4">
                <PlaceholderImage id={product.id} />
              </div>
              <div className="px-5 pb-6">
                <h3 className="text-white font-serif text-xl mb-2">{product.name}</h3>
                <p className="text-[#999080] font-sans text-sm mb-5 leading-relaxed">{product.description}</p>
                <a
                  href={WHATSAPP_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-full text-center py-3 rounded bg-[#8B1A1A] text-white font-sans font-bold uppercase tracking-wider text-sm hover:brightness-110 transition-all"
                  data-testid={`order-now-${i}`}
                >
                  Order Now
                </a>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}
