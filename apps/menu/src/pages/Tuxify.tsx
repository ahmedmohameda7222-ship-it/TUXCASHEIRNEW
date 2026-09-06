import React, { useEffect, useRef } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import { ProductCategoryNav } from "@/components/ProductCategoryNav";
import singleImg from "@assets/tuxify_single.png";
import doubleImg from "@assets/tuxify_double.png";
import tripleImg from "@assets/tuxify_triple.png";
import quatroImg from "@assets/tuxify_quatro.png";

const tuxifyProducts = [
  {
    id: "01",
    name: "Single Tuxify",
    description: "The one that started it all.",
    ingredients: ["Brioche bun", "1 beef patty", "American cheese", "Pickles", "Chopped onion", "Ketchup", "TUXIFY sauce"],
    image: singleImg,
  },
  {
    id: "02",
    name: "Double Tuxify",
    description: "Double the impact. Double the flavor.",
    ingredients: ["Brioche bun", "2 beef patties", "American cheese", "Pickles", "Chopped onion", "Ketchup", "TUXIFY sauce"],
    image: doubleImg,
  },
  {
    id: "03",
    name: "Triple Tuxify",
    description: "For the serious. Three stacked, layered flavor.",
    ingredients: ["Brioche bun", "3 beef patties", "American cheese", "Pickles", "Chopped onion", "Ketchup", "TUXIFY sauce"],
    image: tripleImg,
  },
  {
    id: "04",
    name: "Quatro Tuxify",
    description: "The legend. Four patties. Maximum indulgence.",
    ingredients: ["Brioche bun", "4 beef patties", "American cheese", "Pickles", "Chopped onion", "Ketchup", "TUXIFY sauce"],
    image: quatroImg,
  },
];

export default function Tuxify() {
  const containerRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start start", "end end"],
  });

  useEffect(() => {
    document.title = "Tuxify Burger | TUX";
  }, []);

  // Pre-compute all panel opacity + scale values (hooks must not be in loops)
  // Container is 500vh → scroll distance = 400vh → 4 equal 100vh zones
  // Transitions at progress 0.25 / 0.50 / 0.75 with ±0.04 crossfade overlap

  const op0 = useTransform(scrollYProgress, [0, 0.22, 0.28], [1, 1, 0]);
  const sc0 = useTransform(scrollYProgress, [0, 0.22, 0.28], [1, 1, 1.06]);

  const op1 = useTransform(scrollYProgress, [0.22, 0.28, 0.47, 0.53], [0, 1, 1, 0]);
  const sc1 = useTransform(scrollYProgress, [0.22, 0.28, 0.47, 0.53], [0.94, 1, 1, 1.06]);

  const op2 = useTransform(scrollYProgress, [0.47, 0.53, 0.72, 0.78], [0, 1, 1, 0]);
  const sc2 = useTransform(scrollYProgress, [0.47, 0.53, 0.72, 0.78], [0.94, 1, 1, 1.06]);

  // Panel 3 fades in then stays — never fades out
  const op3 = useTransform(scrollYProgress, [0.72, 0.78, 1.0], [0, 1, 1]);
  const sc3 = useTransform(scrollYProgress, [0.72, 0.78], [0.94, 1]);

  // Sidebar dots
  const dot0 = useTransform(scrollYProgress, [0, 0.22, 0.28], [1, 1, 0]);
  const dot1 = useTransform(scrollYProgress, [0.22, 0.28, 0.47, 0.53], [0, 1, 1, 0]);
  const dot2 = useTransform(scrollYProgress, [0.47, 0.53, 0.72, 0.78], [0, 1, 1, 0]);
  const dot3 = useTransform(scrollYProgress, [0.72, 0.78, 1.0], [0, 1, 1]);

  const panelMotion = [
    { opacity: op0, scale: sc0 },
    { opacity: op1, scale: sc1 },
    { opacity: op2, scale: sc2 },
    { opacity: op3, scale: sc3 },
  ];

  const dotMotion = [dot0, dot1, dot2, dot3];

  return (
    <div className="w-full bg-[#0D0D0D] pt-[120px] md:pt-[136px]">
      <ProductCategoryNav />

      {/* Page header — sits below both navbars */}
      <div className="pt-6 pb-6 px-6 md:px-16 max-w-7xl mx-auto">
        <span className="text-[#C9A84C] font-sans text-xs tracking-[0.3em] uppercase">Our Menu</span>
        <h1 className="text-5xl md:text-6xl font-serif font-bold text-white mt-2">Tuxify Burger</h1>
        <p className="text-[#999080] mt-3 font-sans text-base max-w-xl">
          The signature line. Smashed, sauced, and built for people who take their burgers seriously.
        </p>
      </div>

      {/* Scroll container — 320vh → ~220vh of scroll → ~55vh per panel */}
      <div ref={containerRef} style={{ height: "320vh" }} className="relative">
        {/* Sticky viewport */}
        <div className="sticky top-0 h-screen overflow-hidden">
          {tuxifyProducts.map((product, i) => (
            <motion.div
              key={product.id}
              style={{
                opacity: panelMotion[i].opacity,
                scale: panelMotion[i].scale,
                position: "absolute",
                inset: 0,
              }}
              className="w-full h-full flex flex-col md:flex-row items-stretch"
            >
              {/* Left: info */}
              <div className="flex flex-col justify-center px-8 md:px-16 py-10 w-full md:w-[42%] bg-[#0D0D0D] relative z-10 order-2 md:order-1">
                <span className="text-[#C9A84C] font-sans text-xs tracking-[0.3em] uppercase mb-2 block">
                  Tuxify Burger
                </span>
                <div className="text-[6rem] leading-none font-serif font-bold text-white/5 select-none">
                  {product.id}
                </div>
                <h2 className="text-3xl md:text-5xl font-serif font-bold text-white leading-tight -mt-4 mb-3">
                  {product.name}
                </h2>
                <p className="text-[#999080] font-sans text-sm mb-5 leading-relaxed">
                  {product.description}
                </p>
                <ul className="space-y-1.5">
                  {product.ingredients.map((ing) => (
                    <li key={ing} className="flex items-center gap-3 text-[#F5EDD8]/75 font-sans text-sm">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#C9A84C] flex-shrink-0" />
                      {ing}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Right: full product image */}
              <div className="w-full md:w-[58%] relative flex items-center justify-center bg-[#0B0900] order-1 md:order-2 overflow-hidden">
                <img
                  src={product.image}
                  alt={product.name}
                  className="w-full h-full object-contain"
                  draggable={false}
                />
                {/* Blend left edge into info panel */}
                <div className="absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-[#0D0D0D] to-transparent pointer-events-none" />
              </div>
            </motion.div>
          ))}
        </div>

        {/* Sidebar scroll dots */}
        <div className="fixed right-5 top-1/2 -translate-y-1/2 z-50 flex flex-col gap-3 pointer-events-none">
          {dotMotion.map((dotOp, i) => (
            <motion.div
              key={i}
              style={{ opacity: dotOp }}
              className="w-2 h-2 rounded-full bg-[#C9A84C]"
            />
          ))}
        </div>
      </div>

      <div className="h-16 bg-[#0D0D0D]" />
    </div>
  );
}
