import React, { createContext, useContext, useState } from "react";
import { useLocation } from "wouter";
import { AnimatePresence, motion } from "framer-motion";
import tuxLogo from "@assets/tuxlogowithoutbackground";

type PageTransitionContextType = {
  triggerTransition: (to: string) => void;
  isTransitioning: boolean;
};

const PageTransitionContext = createContext<PageTransitionContextType | null>(null);

export const usePageTransition = () => {
  const context = useContext(PageTransitionContext);
  if (!context) {
    throw new Error("usePageTransition must be used within a PageTransitionProvider");
  }
  return context;
};

export const PageTransitionProvider = ({ children }: { children: React.ReactNode }) => {
  const [, setLocation] = useLocation();
  const [isTransitioning, setIsTransitioning] = useState(false);

  const triggerTransition = (to: string) => {
    setIsTransitioning(true);
    // Simulate transition duration
    setTimeout(() => {
      setLocation(to);
    }, 1800);
    setTimeout(() => {
      setIsTransitioning(false);
    }, 2800);
  };

  return (
    <PageTransitionContext.Provider value={{ triggerTransition, isTransitioning }}>
      {children}
      <AnimatePresence>
        {isTransitioning && (
          <motion.div
            className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[#0D0D0D] text-white"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="absolute inset-0 z-0 bg-[url('https://images.unsplash.com/photo-1550547660-d9450f859349?q=80&w=2000')] bg-cover bg-center opacity-20 blur-sm mix-blend-overlay"></div>
            <motion.div
              initial={{ scale: 0.92, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.3, duration: 0.8, ease: "easeOut" }}
              className="relative z-10 flex items-center justify-center"
            >
              <img
                src={tuxLogo}
                alt="TUX"
                className="h-auto w-[220px] max-w-[70vw] object-contain sm:w-[260px] md:w-[310px] lg:w-[340px]"
                style={{ filter: "invert(1)", mixBlendMode: "screen" }}
              />
            </motion.div>
            <motion.p
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.8, duration: 0.6 }}
              className="z-10 mt-6 text-muted font-sans tracking-widest uppercase text-sm md:text-base"
            >
              Burgers Worth The Chase ...
            </motion.p>
          </motion.div>
        )}
      </AnimatePresence>
    </PageTransitionContext.Provider>
  );
};