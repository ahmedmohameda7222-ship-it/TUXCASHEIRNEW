import React, { useEffect } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useLocation } from "wouter";
import { ProductCategoryNav } from "@/components/ProductCategoryNav";
import { useMenu, SupabaseProduct } from "@/context/MenuContext";
import { NavLink } from "@/components/NavLink";
import { getOrderProductHref } from "@/lib/product-routes";

function ProductImage({ product, index }: { product: SupabaseProduct; index: number }) {
  if (product.image_url) {
    return (
      <img
        src={product.image_url}
        alt={product.name}
        className="w-full h-full object-contain drop-shadow-[0_28px_60px_rgba(0,0,0,0.55)] transition-transform duration-500 group-hover:scale-[1.03]"
        draggable={false}
        loading="lazy"
      />
    );
  }

  return (
    <div
      className="w-full aspect-square rounded-2xl flex items-center justify-center"
      style={{ background: "radial-gradient(ellipse at center, #1a1200 0%, #0D0D0D 80%)" }}
    >
      <div className="text-center px-4">
        <span className="text-[#C9A84C]/20 font-serif text-7xl md:text-8xl font-bold select-none">
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
  const shouldReduceMotion = useReducedMotion();
  const routeSlug = location.startsWith("/products/")
    ? decodeURIComponent(location.replace("/products/", ""))
    : undefined;

  const section = sections.find((s) => {
    if (sectionId) return s.id === sectionId;
    return s.slug === routeSlug || s.id === routeSlug;
  });

  const sectionUnavailable = Boolean(section && !section.is_active);

  const sectionProducts = section
    ? products
        .filter((product) => product.section_id === section.id)
        .sort((a, b) => a.sort_order - b.sort_order)
    : [];

  useEffect(() => {
    document.title = section ? `${section.name} | TUX` : "Our Products | TUX";
  }, [section]);

  const sectionVariants = shouldReduceMotion
    ? {
        hidden: { opacity: 1, y: 0 },
        visible: { opacity: 1, y: 0 },
      }
    : {
        hidden: { opacity: 0, y: 34 },
        visible: { opacity: 1, y: 0 },
      };

  const imageVariants = shouldReduceMotion
    ? {
        hidden: { opacity: 1, scale: 1, x: 0 },
        visible: { opacity: 1, scale: 1, x: 0 },
      }
    : {
        hidden: { opacity: 0, scale: 0.97, x: 0 },
        visible: { opacity: 1, scale: 1, x: 0 },
      };

  const textVariants = shouldReduceMotion
    ? {
        hidden: { opacity: 1, y: 0 },
        visible: { opacity: 1, y: 0 },
      }
    : {
        hidden: { opacity: 0, y: 24 },
        visible: { opacity: 1, y: 0 },
      };

  return (
    <div className="w-full bg-[#0D0D0D] min-h-screen pt-[120px] md:pt-[136px]">
      <ProductCategoryNav />

      <div className="max-w-7xl mx-auto px-5 sm:px-6 md:px-12 pt-10 pb-24">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: shouldReduceMotion ? 0 : 0.7 }}
          className={`mb-12 md:mb-16 ${sectionUnavailable ? "grayscale opacity-75" : ""}`}
        >
          <span className={sectionUnavailable ? "text-gray-500 font-sans text-xs tracking-[0.3em] uppercase" : "text-[#C9A84C] font-sans text-xs tracking-[0.3em] uppercase"}>
            Our Products Showroom
          </span>
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-serif font-bold text-white mt-2 mb-4">
            {section?.name || "Products"}
          </h1>
          <p className="text-[#999080] font-sans text-base sm:text-lg max-w-2xl leading-relaxed">
            {section?.description || "A closer look at our products before you order."}
          </p>
          {sectionUnavailable && (
            <p className="mt-5 max-w-xl rounded-xl border border-gray-700 bg-gray-900/80 px-4 py-3 text-sm font-semibold text-gray-200">
              This categorie is currently not available.
            </p>
          )}
        </motion.div>

        {loading && (
          <div className="space-y-8 md:space-y-10">
            {[1, 2, 3].map((item) => (
              <div
                key={item}
                className="h-[520px] md:h-[420px] rounded-[2rem] bg-white/5 animate-pulse"
              />
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
          <div className="space-y-12 md:space-y-16">
            {sectionProducts.map((product, index) => {
              const isReversed = index % 2 === 1;
              const productUnavailable = sectionUnavailable || !product.is_active;

              return (
                <motion.section
                  key={product.id}
                  variants={sectionVariants}
                  initial="hidden"
                  whileInView="visible"
                  viewport={{ once: true, amount: 0.22 }}
                  transition={{ duration: shouldReduceMotion ? 0 : 0.55, ease: "easeOut" }}
                  className={`group overflow-hidden rounded-[1.75rem] md:rounded-[2.5rem] border shadow-[0_24px_90px_rgba(0,0,0,0.35)] ${
                    isReversed ? "md:flex-row-reverse" : "md:flex-row"
                  } flex flex-col md:flex ${
                    productUnavailable
                      ? "border-gray-700 bg-gray-900/70 grayscale opacity-75"
                      : "border-[#2a2520] bg-[linear-gradient(135deg,#111009_0%,#181108_55%,#0B0900_100%)]"
                  }`}
                >
                  <motion.div
                    variants={imageVariants}
                    transition={{ duration: shouldReduceMotion ? 0 : 0.65, ease: "easeOut" }}
                    className="relative flex min-h-[300px] sm:min-h-[380px] md:min-h-[460px] md:w-[54%] items-center justify-center overflow-hidden bg-[#090806] px-5 py-8 sm:px-8 md:px-10"
                  >
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(201,168,76,0.18),transparent_58%)]" />
                    <div className="absolute inset-x-8 bottom-8 h-24 rounded-full bg-black/45 blur-3xl" />
                    <div className="relative z-10 h-[280px] sm:h-[340px] md:h-[400px] w-full flex items-center justify-center">
                      <ProductImage product={product} index={index} />
                    </div>
                  </motion.div>

                  <motion.div
                    variants={textVariants}
                    transition={{ duration: shouldReduceMotion ? 0 : 0.55, ease: "easeOut", delay: shouldReduceMotion ? 0 : 0.08 }}
                    className="flex flex-1 flex-col justify-between px-5 py-8 sm:px-8 md:w-[46%] md:px-10 lg:px-14 md:py-12"
                  >
                    <div>
                      <span className={`mb-4 block font-sans text-xs font-bold uppercase tracking-[0.28em] ${productUnavailable ? "text-gray-500" : "text-[#C9A84C]"}`}>
                        {section?.name} • {String(index + 1).padStart(2, "0")}
                      </span>

                      <h2 className={`font-serif text-3xl sm:text-4xl lg:text-5xl font-bold leading-tight mb-5 transition-colors duration-300 ${productUnavailable ? "text-gray-300" : "text-white group-hover:text-[#C9A84C]"}`}>
                        {product.name}
                      </h2>

                      {product.description && (
                        <p className="max-w-xl font-sans text-base sm:text-lg leading-8 text-[#B8AEA0]">
                          {product.description}
                        </p>
                      )}

                      {productUnavailable && (
                        <p className="mt-6 rounded-xl border border-gray-700 bg-gray-800/80 px-4 py-3 text-sm font-semibold text-gray-200">
                          This product is currently not available.
                        </p>
                      )}
                    </div>

                    <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-stretch">
                      {!productUnavailable && (
                        <NavLink
                          href={getOrderProductHref(product.id)}
                          className="inline-flex min-h-12 w-full items-center justify-center rounded-full bg-[#8B1A1A] px-6 py-3 text-center font-sans text-xs font-bold uppercase tracking-[0.22em] text-white transition-all duration-300 hover:brightness-110 active:scale-[0.98] sm:w-auto"
                        >
                          Order Now
                        </NavLink>
                      )}

                      <div className="inline-flex min-h-12 min-w-[142px] items-center justify-between gap-4 rounded-full border border-[#C9A84C]/35 bg-black/25 px-5 py-3 sm:justify-center">
                        <span className="font-sans text-[10px] font-bold uppercase tracking-[0.2em] text-[#8F877A]">
                          Price
                        </span>
                        <span className={`whitespace-nowrap font-sans text-sm font-bold ${productUnavailable ? "text-gray-400" : "text-[#C9A84C]"}`}>
                          {product.price} EGP
                        </span>
                      </div>
                    </div>
                  </motion.div>
                </motion.section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
