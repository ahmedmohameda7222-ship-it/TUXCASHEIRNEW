import React, { useEffect } from "react";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "wouter";

export const ProductCategoryNav = () => {
  const [location] = useLocation();

  const categories = [
    { name: "Tux Burger", href: "/tux-burger" },
    { name: "Tuxify Burger", href: "/tuxify" },
    { name: "Hawawshi", href: "/hawawshi" },
    { name: "Fries", href: "/fries" },
    { name: "Combos", href: "/combos" },
    { name: "Drinks", href: "/drinks" },
  ];

  return (
    <div className="fixed top-[64px] md:top-[80px] z-40 bg-[#0D0D0D]/90 backdrop-blur border-b border-border w-full overflow-x-auto no-scrollbar">
      <div className="max-w-7xl mx-auto px-6 md:px-12 flex items-center gap-8 min-w-max h-14">
        {categories.map((cat) => {
          const isActive = location === cat.href;
          return (
            <NavLink
              key={cat.href}
              href={cat.href}
              className={`font-sans text-sm tracking-wide transition-all h-full flex items-center border-b-2 ${
                isActive 
                  ? "text-primary border-primary font-semibold" 
                  : "text-muted hover:text-foreground border-transparent"
              }`}
            >
              {cat.name}
            </NavLink>
          );
        })}
      </div>
    </div>
  );
};
