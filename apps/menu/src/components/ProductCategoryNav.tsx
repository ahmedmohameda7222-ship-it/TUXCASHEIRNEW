import React from "react";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "wouter";
import { useMenu } from "@/context/MenuContext";
import { getProductSectionHref } from "@/lib/product-routes";

export const ProductCategoryNav = () => {
  const [location] = useLocation();
  const { sections } = useMenu();
  const productSections = sections.sort((a, b) => a.sort_order - b.sort_order);

  return (
    <div className="fixed top-[64px] md:top-[80px] z-40 bg-[#0D0D0D]/90 backdrop-blur border-b border-border w-full overflow-x-auto no-scrollbar">
      <div className="max-w-7xl mx-auto px-6 md:px-12 flex items-center gap-8 min-w-max h-14">
        {productSections.map((section) => {
          const href = getProductSectionHref(section);
          const isActive = location === href || location === `/products/${section.slug}` || location === `/products/${section.id}`;
          const unavailable = !section.is_active;
          return (
            <NavLink
              key={section.id}
              href={href}
              withPageTransition={false}
              className={`font-sans text-sm tracking-wide transition-all h-full flex items-center border-b-2 ${
                isActive && !unavailable
                  ? "text-primary border-primary font-semibold"
                  : isActive && unavailable
                  ? "text-gray-300 border-gray-500 font-semibold"
                  : unavailable
                  ? "text-gray-600 hover:text-gray-400 border-transparent"
                  : "text-muted hover:text-foreground border-transparent"
              }`}
            >
              {section.name}
              {unavailable && <span className="ml-2 text-[10px] uppercase">Unavailable</span>}
            </NavLink>
          );
        })}
      </div>
    </div>
  );
};
