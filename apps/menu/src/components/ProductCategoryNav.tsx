import React from "react";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "wouter";
import { useMenu } from "@/context/MenuContext";
import { getProductSectionHref } from "@/lib/product-routes";

export const ProductCategoryNav = () => {
  const [location] = useLocation();
  const { sections } = useMenu();
  const activeSections = sections
    .filter((section) => section.is_active)
    .sort((a, b) => a.sort_order - b.sort_order);

  return (
    <div className="fixed top-[64px] md:top-[80px] z-40 bg-[#0D0D0D]/90 backdrop-blur border-b border-border w-full overflow-x-auto no-scrollbar">
      <div className="max-w-7xl mx-auto px-6 md:px-12 flex items-center gap-8 min-w-max h-14">
        {activeSections.map((section) => {
          const href = getProductSectionHref(section);
          const isActive = location === href || location === `/products/${section.slug}` || location === `/products/${section.id}`;
          return (
            <NavLink
              key={section.id}
              href={href}
              className={`font-sans text-sm tracking-wide transition-all h-full flex items-center border-b-2 ${
                isActive 
                  ? "text-primary border-primary font-semibold" 
                  : "text-muted hover:text-foreground border-transparent"
              }`}
            >
              {section.name}
            </NavLink>
          );
        })}
      </div>
    </div>
  );
};
