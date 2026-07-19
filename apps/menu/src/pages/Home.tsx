import React, { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { NavLink } from "@/components/NavLink";

import { ChevronLeft, ChevronRight } from "lucide-react";
import truckImg from "@assets/TUX-Truck.png";
import singleImg from "@assets/tuxify_single.png";
import doubleImg from "@assets/tuxify_double.png";
import tripleImg from "@assets/tuxify_triple.png";
import quatroImg from "@assets/tuxify_quatro.png";

import { useMenu, SupabaseProduct } from "@/context/MenuContext";

function BestSellersCarousel() {
  const { products } = useMenu();
  const bestSellers = products.filter((p) => p.is_best_seller);
  const [current, setCurrent] = useState(0);
  const [direction, setDirection] = useState<"left" | "right">("left");
  const autoPlayRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const touchStartX = useRef<number | null>(null);
  const total = bestSellers.length || 1;

  const next = useCallback(() => {
    if (bestSellers.length <= 1) return;
    setDirection("left");
    setCurrent((prev) => (prev + 1) % total);
  }, [total, bestSellers.length]);

  const prev = useCallback(() => {
    if (bestSellers.length <= 1) return;
    setDirection("right");
    setCurrent((prev) => (prev - 1 + total) % total);
  }, [total, bestSellers.length]);

  useEffect(() => {
    autoPlayRef.current = setInterval(next, 3800);
    return () => { if (autoPlayRef.current) clearInterval(autoPlayRef.current); };
  }, [next]);

  const resetAutoPlay = () => {
    if (autoPlayRef.current) clearInterval(autoPlayRef.current);
    autoPlayRef.current = setInterval(next, 3800);
  };

  const handlePrev = () => { prev(); resetAutoPlay(); };
  const handleNext = () => { next(); resetAutoPlay(); };

  const handleTouchStart = (e: React.TouchEvent) => { touchStartX.current = e.touches[0].clientX; };
  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const delta = touchStartX.current - e.changedTouches[0].clientX;
    if (delta > 50) handleNext();
    else if (delta < -50) handlePrev();
    touchStartX.current = null;
  };

  const getVisibleItems = () => {
    if (bestSellers.length === 0) return [];
    if (bestSellers.length <= 3) return bestSellers;
    return [0, 1, 2].map((offset) => bestSellers[(current + offset) % total]);
  };

  const visibleItems = getVisibleItems();

  if (bestSellers.length === 0) {
    return (
      <div className="text-center py-10 text-gray-500">
        No best sellers found.
      </div>
    );
  }

  return (
    <div onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
      {/* Desktop: 3 cards */}
      <div className="hidden md:grid grid-cols-3 gap-6">
        <AnimatePresence mode="popLayout" initial={false}>
          {visibleItems.map((item, i) => (
            <motion.div
              key={`${item.id}-${current}-${i}`}
              initial={{ opacity: 0, x: direction === "left" ? 60 : -60 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: direction === "left" ? -60 : 60 }}
              transition={{ duration: 0.4, delay: i * 0.05, ease: [0.22, 1, 0.36, 1] }}
            >
              <BestSellerCard item={item} />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Mobile: 1 card */}
      <div className="md:hidden">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={`${bestSellers[current].id}-mobile`}
            initial={{ opacity: 0, x: direction === "left" ? 60 : -60 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: direction === "left" ? -60 : 60 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          >
            <BestSellerCard item={bestSellers[current]} />
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Arrows + dots */}
      <div className="flex items-center justify-center gap-4 mt-8">
        <button onClick={handlePrev} className="w-10 h-10 rounded-full border border-[#C9A84C]/40 flex items-center justify-center text-[#C9A84C] hover:bg-[#C9A84C]/10 transition-all" data-testid="carousel-prev">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="flex gap-2">
          {bestSellers.map((_, i) => (
            <button
              key={i}
              onClick={() => { setDirection(i > current ? "left" : "right"); setCurrent(i); resetAutoPlay(); }}
              className={`h-2 rounded-full transition-all ${i === current ? "bg-[#C9A84C] w-6" : "bg-[#C9A84C]/20 w-2"}`}
            />
          ))}
        </div>
        <button onClick={handleNext} className="w-10 h-10 rounded-full border border-[#C9A84C]/40 flex items-center justify-center text-[#C9A84C] hover:bg-[#C9A84C]/10 transition-all" data-testid="carousel-next">
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}

function BestSellerCard({ item }: { item: SupabaseProduct }) {
  return (
    <div className="group rounded-xl overflow-hidden border border-[#2a2520] bg-[#111009] hover:border-[#C9A84C]/40 hover:scale-[1.02] transition-all duration-300 flex flex-col h-full">
      {/* Full product image — no cropping, object-contain */}
      <div className="w-full bg-[#0B0900] flex items-center justify-center overflow-hidden" style={{ aspectRatio: "4/3" }}>
        <img
          src={item.image_url}
          alt={item.name}
          className="w-full h-full object-contain"
          draggable={false}
        />
      </div>
      <div className="px-5 py-4 flex flex-col flex-1 justify-between">
        <div>
          <h3 className="text-white font-serif text-xl mb-1 group-hover:text-[#C9A84C] transition-colors">
            {item.name}
          </h3>
          <p className="text-[#999080] font-sans text-sm leading-relaxed mb-4">{item.description}</p>
        </div>
        <NavLink
          href="/order-now"
          className="block w-full text-center bg-white/5 hover:bg-[#D4AF37] hover:text-black border border-white/10 text-white py-2 rounded font-bold transition-all mt-auto"
        >
          Order Now
        </NavLink>
      </div>
    </div>
  );
}

export default function Home() {
  useEffect(() => {
    document.title = "TUX | Burgers Worth The Chase";
  }, []);

  return (
    <div className="w-full bg-[#0D0D0D]">

      {/* ── HERO ── */}
      <section className="relative w-full h-[100dvh] flex items-center justify-center overflow-hidden">
        <div
          className="absolute inset-0 z-0 bg-cover bg-center bg-no-repeat"
          style={{
            backgroundImage: "url('https://images.unsplash.com/photo-1568901346375-23c9450c58cd?q=80&w=2000')",
            backgroundPosition: "center 60%",
          }}
        >
          <div className="absolute inset-0 bg-gradient-to-t from-[#0D0D0D] via-black/70 to-black/40" />
        </div>

        <div className="relative z-10 text-center px-6 max-w-4xl mx-auto flex flex-col items-center mt-16">
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.4 }}
            className="text-5xl md:text-7xl lg:text-8xl font-serif text-white font-bold leading-tight mb-6"
          >
            Burgers Worth <br className="hidden md:block" /> The Chase
          </motion.h1>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.6 }}
            className="text-[#F5EDD8]/90 text-lg md:text-xl font-sans max-w-2xl mx-auto mb-10 leading-relaxed"
          >
            Premium smashed burgers, bold sauces, fresh ingredients, and a burger truck experience built to change the taste of burgers in Egypt.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.8 }}
            className="flex flex-col sm:flex-row items-center gap-4"
          >
            <NavLink
              href="/tuxify"
              className="w-full sm:w-auto px-8 py-4 rounded border border-[#C9A84C] text-[#C9A84C] hover:bg-[#C9A84C] hover:text-black font-sans font-bold uppercase tracking-wider transition-all duration-300"
            >
              View Products
            </NavLink>
            <NavLink
              href="/order-now"
              className="w-full sm:w-auto px-8 py-4 rounded bg-[#8B1A1A] text-white font-sans font-bold uppercase tracking-wider hover:brightness-110 hover:scale-[1.02] transition-all duration-300 shadow-lg shadow-[#8B1A1A]/20"
            >
              Order Now
            </NavLink>
          </motion.div>
        </div>

        {/* Scroll indicator */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.5, duration: 1 }}
          className="absolute bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2"
        >
          <span className="text-xs text-[#999080] tracking-widest uppercase">Scroll</span>
          <div className="w-[1px] h-12 bg-[#2a2520] relative overflow-hidden">
            <motion.div
              className="absolute top-0 left-0 w-full h-1/2 bg-[#C9A84C]"
              animate={{ y: [0, 48] }}
              transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
            />
          </div>
        </motion.div>
      </section>

      {/* ── BEST SELLERS ── */}
      <section className="w-full py-24 bg-[#1A1610] overflow-hidden">
        <div className="max-w-7xl mx-auto px-6 md:px-12">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7 }}
            className="mb-12 text-center"
          >
            <span className="text-[#C9A84C] font-sans text-xs tracking-[0.35em] uppercase mb-4 block">
              Best Sellers
            </span>
            <h2 className="text-4xl md:text-5xl font-serif font-bold text-white">Fan Favorites</h2>
            <p className="text-[#999080] mt-4 font-sans text-base max-w-md mx-auto">
              The most-ordered items. Every one a reason to come back.
            </p>
          </motion.div>
          <BestSellersCarousel />
        </div>
      </section>

      {/* ── TUX TRUCK — MISSION / VISION ── */}
      <section className="w-full relative py-28 overflow-hidden">
        {/* TUX Truck photo as background */}
        <div className="absolute inset-0">
          <img
            src={truckImg}
            alt="TUX Truck"
            className="w-full h-full object-cover object-center"
          />
          <div className="absolute inset-0 bg-[#0D0D0D]/80" />
        </div>

        <div className="max-w-7xl mx-auto px-6 md:px-12 relative z-10">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-12 md:gap-20 items-start">
            <motion.div
              initial={{ opacity: 0, x: -30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.7 }}
            >
              <span className="text-[#C9A84C] font-sans text-xs tracking-[0.3em] uppercase mb-3 block">
                What Drives Us
              </span>
              <h2 className="text-3xl md:text-4xl font-serif font-bold text-[#C9A84C] mb-6">Our Goal</h2>
              <p className="text-white text-lg leading-relaxed font-sans font-light">
                Our goal is to serve clean, fresh, high-quality burgers with bold flavor, premium ingredients, and a taste people remember.
              </p>
            </motion.div>

            <div className="hidden md:block absolute left-1/2 top-24 bottom-24 w-[1px] bg-gradient-to-b from-transparent via-[#C9A84C]/25 to-transparent" />

            <motion.div
              initial={{ opacity: 0, x: 30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.7, delay: 0.15 }}
            >
              <span className="text-[#C9A84C] font-sans text-xs tracking-[0.3em] uppercase mb-3 block">
                Where We're Going
              </span>
              <h2 className="text-3xl md:text-4xl font-serif font-bold text-[#C9A84C] mb-6">Our Vision</h2>
              <p className="text-white text-lg leading-relaxed font-sans font-light">
                At TUX, we want to change the idea of burgers in Egypt. We are not just selling fast food. We are building a premium burger truck experience with fresh ingredients, clean preparation, strong branding, and unforgettable taste.
              </p>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ── ORDER CTA ── */}
      <section className="w-full py-20 bg-[#0D0D0D] text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7 }}
          className="max-w-2xl mx-auto px-6"
        >
          <h2 className="text-4xl md:text-5xl font-serif font-bold text-white mb-4">
            Ready to Chase?
          </h2>
          <p className="text-[#999080] font-sans text-lg mb-8">
            Order now on WhatsApp and we'll take care of the rest.
          </p>
          <NavLink
            href="/order-now"
            className="inline-block px-12 py-5 rounded bg-[#8B1A1A] text-white font-sans font-bold uppercase tracking-widest text-sm hover:brightness-110 hover:scale-[1.02] transition-all shadow-xl shadow-[#8B1A1A]/20"
          >
            Order Now
          </NavLink>
        </motion.div>
      </section>
    </div>
  );
}
