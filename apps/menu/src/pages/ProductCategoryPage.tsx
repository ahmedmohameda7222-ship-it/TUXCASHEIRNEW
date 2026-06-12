import React, { useEffect } from "react";
import { motion } from "framer-motion";
import { useLocation } from "wouter";
import { ProductCategoryNav } from "@/components/ProductCategoryNav";
import { useMenu, SupabaseProduct } from "@/context/MenuContext";
import { NavLink } from "@/components/NavLink";

function ProductImage({ product, index }: { product: SupabaseProduct; index: number }) {
  if (product.image_url) {
    return (
      <img
        src={product.image_url}
        alt={product.name}
        className="w-full h-full object-contain"
        draggable={false}
      />
    );
  }

  return (
    <div
      className="w-full aspect-square rounded-xl flex items-center justify-center"
      style={{ background: "radial-gradient(ellipse at center, #1a1200 0%, #0D0D0D 80%)" }}
    >
      <div className="text-center">
        <span className="text-[#C9A84C]/20 font-serif text-7xl font-bold select-none">
          {String(index + 1).padStart(2, "0")}
        </span>
        <p className="text-[#C9A84C]/30 font-sans text-xs tracking-widest uppercase mt-2">
          Photo Coming Soon
        </p>
      </div>
    </div>
  );
}

export default function ProductCategoryPage({ sectionId }: { sectionId?: string }) {
  const [location] = useLocation();
  const { sections, products, loading } = useMenu();
  const routeSlug = location.startsWith("/products/")
    ? decodeURIComponent(location.replace("/products/", ""))
    : undefined;

  const section = sections.find((s) => {
    if (sectionId) return s.id === sectionId;
    return s.slug === routeSlug || s.id === routeSlug;
  });

  const sectionProducts = section
    ? products
        .filter((product) => product.section_id === section.id && product.is_active)
        .sort((a, b) => a.sort_order - b.sort_order)
    : [];

  useEffect(() => {
    document.title = section ? `${section.name} | TUX` : "Our Products | TUX";
  }, [section]);

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
          <span className="text-[#C9A84C] font-sans text-xs tracking-[0.3em] uppercase">
            Our Products
          </span>
          <h1 className="text-5xl md:text-6xl font-serif font-bold text-white mt-2 mb-4">
            {section?.name || "Products"}
          </h1>
          <p className="text-[#999080] font-sans text-lg max-w-xl">
            {section?.description || "Fresh products managed directly from the admin panel."}
          </p>
        </motion.div>

        {loading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[1, 2, 3, 4].map((item) => (
              <div key={item} className="h-80 rounded-xl bg-white/5 animate-pulse" />
            ))}
          </div>
        )}

        {!loading && !section && (
          <div className="rounded-xl border border-white/10 bg-[#111009] p-8 text-center">
            <h2 className="text-2xl font-serif font-bold text-white mb-2">Category not found</h2>
            <p className="text-[#999080] mb-6">This product category is not available.</p>
            <NavLink
              href="/order-now"
              className="inline-block px-6 py-3 rounded bg-[#8B1A1A] text-white font-sans font-bold uppercase tracking-wider text-sm hover:brightness-110 transition-all"
            >
              Go to Order Now
            </NavLink>
          </div>
        )}

        {!loading && section && sectionProducts.length === 0 && (
          <div className="rounded-xl border border-white/10 bg-[#111009] p-8 text-center">
            <h2 className="text-2xl font-serif font-bold text-white mb-2">No products yet</h2>
            <p className="text-[#999080]">Add products to this category from the admin panel.</p>
          </div>
        )}

        {!loading && sectionProducts.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {sectionProducts.map((product, index) => (
              <motion.div
                key={product.id}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: index * 0.08 }}
                className="group rounded-xl overflow-hidden border border-[#2a2520] bg-[#111009] hover:border-[#C9A84C]/30 hover:scale-[1.02] transition-all duration-300 flex flex-col"
                data-testid={`product-card-${index}`}
              >
                <div className="p-4 bg-[#0B0900] flex items-center justify-center" style={{ aspectRatio: "4 / 3" }}>
                  <ProductImage product={product} index={index} />
                </div>
                <div className="px-5 pb-6 pt-4 flex flex-col flex-1">
                  <h3 className="text-white font-serif text-xl mb-2 group-hover:text-[#C9A84C] transition-colors">
                    {product.name}
                  </h3>
                  <p className="text-[#999080] font-sans text-sm mb-5 leading-relaxed flex-1">
                    {product.description}
                  </p>
                  <NavLink
                    href="/order-now"
                    className="block w-full text-center py-3 rounded bg-[#8B1A1A] text-white font-sans font-bold uppercase tracking-wider text-sm hover:brightness-110 transition-all"
                    data-testid={`order-now-${index}`}
                  >
                    Order Now
                  </NavLink>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
