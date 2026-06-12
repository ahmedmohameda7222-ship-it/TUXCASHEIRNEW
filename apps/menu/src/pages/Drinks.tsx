import React, { useEffect } from "react";
import { motion } from "framer-motion";
import { ProductCategoryNav } from "@/components/ProductCategoryNav";


const products = [
  {
    id: "01",
    name: "Soda",
    description: "Cold, refreshing, and the perfect companion to any TUX burger.",
  },
  {
    id: "02",
    name: "Water",
    description: "Still water. Clean and simple.",
  },
];

function PlaceholderImage({ id }: { id: string }) {
  return (
    <div
      className="w-full aspect-[3/4] rounded-xl flex items-center justify-center"
      style={{ background: "radial-gradient(ellipse at center, #0a1020 0%, #0D0D0D 80%)" }}
    >
      <div className="text-center">
        <span className="text-[#C9A84C]/20 font-serif text-7xl font-bold select-none">{id}</span>
        <p className="text-[#C9A84C]/30 font-sans text-xs tracking-widest uppercase mt-2">Photo Coming Soon</p>
      </div>
    </div>
  );
}

export default function Drinks() {
  useEffect(() => {
    document.title = "Drinks | TUX";
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
          <h1 className="text-5xl md:text-6xl font-serif font-bold text-white mt-2 mb-4">Drinks</h1>
          <p className="text-[#999080] font-sans text-lg max-w-xl">
            Keep it simple. Cold drinks to pair with your order.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 max-w-xl">
          {products.map((product, i) => (
            <motion.div
              key={product.id}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: i * 0.1 }}
              className="group rounded-xl overflow-hidden border border-[#2a2520] bg-[#111009] hover:border-[#C9A84C]/30 hover:scale-[1.02] transition-all duration-300"
              data-testid={`product-card-${i}`}
            >
              <div className="p-4">
                <PlaceholderImage id={product.id} />
              </div>
              <div className="px-5 pb-6">
                <h3 className="text-white font-serif text-xl mb-2">{product.name}</h3>
                <p className="text-[#999080] font-sans text-sm mb-5 leading-relaxed">{product.description}</p>
                <a
                  href="/order-now"
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
