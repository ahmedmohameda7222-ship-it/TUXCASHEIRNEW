import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { NavLink } from "./NavLink";

import { Menu, X, ChevronDown, ShoppingBag } from "lucide-react";
import tuxLogo from "@assets/tuxlogo-transparent.svg";
import { useCart } from "@/context/CartContext";
import { useMenu } from "@/context/MenuContext";
import { CONTACT_PHONE, LOCATION_URL } from "@/lib/constants";
import { getProductSectionHref } from "@/lib/product-routes";

export const Navbar = () => {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isProductsDropdownOpen, setIsProductsDropdownOpen] = useState(false);
  const { totalItems, setIsCartOpen } = useCart();
  const { sections } = useMenu();

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 50);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const products = sections
    .filter((section) => section.is_active)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((section) => ({
      name: section.name,
      href: getProductSectionHref(section),
    }));

  return (
    <>
      <nav
        className={`fixed top-0 inset-x-0 z-50 transition-all duration-300 ${
          isScrolled ? "bg-[#0D0D0D]/95 backdrop-blur-md py-3 border-b border-border/50" : "bg-transparent py-3 md:py-5"
        }`}
      >
        <div className="max-w-7xl mx-auto px-6 md:px-12 flex items-center justify-between">
          <NavLink href="/" className="group flex items-center gap-2" data-testid="nav-logo">
            <img
              src={tuxLogo}
              alt="TUX"
              className="h-12 w-auto object-contain"
            />
          </NavLink>

          {/* Desktop Nav */}
          <div className="hidden md:flex items-center gap-8">
            <div
              className="relative"
              onMouseEnter={() => setIsProductsDropdownOpen(true)}
              onMouseLeave={() => setIsProductsDropdownOpen(false)}
            >
              <button className="flex items-center gap-1 font-sans text-sm font-medium text-foreground hover:text-primary transition-colors py-2">
                Our Products <ChevronDown className="w-4 h-4" />
              </button>

              <AnimatePresence>
                {isProductsDropdownOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    transition={{ duration: 0.2 }}
                    className="absolute top-full left-0 w-48 bg-[#1A1610] border border-border shadow-2xl rounded-md overflow-hidden py-2"
                  >
                    {products.map((p) => (
                      <NavLink
                        key={p.href}
                        href={p.href}
                        className="block px-4 py-2 text-sm text-foreground hover:bg-primary/10 hover:text-primary transition-colors"
                      >
                        {p.name}
                      </NavLink>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <NavLink
              href="/order-now"
              className="font-sans text-sm font-medium text-foreground hover:text-primary transition-colors"
            >
              Order Now
            </NavLink>

            <a
              href={`tel:${CONTACT_PHONE}`}
              className="font-sans text-sm font-medium text-foreground hover:text-primary transition-colors"
            >
              Contact Us
            </a>

            <a
              href={LOCATION_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="font-sans text-sm font-medium text-foreground hover:text-primary transition-colors"
            >
              Location
            </a>

            <button
              onClick={() => setIsCartOpen(true)}
              className="relative p-2 text-foreground hover:text-primary transition-colors"
            >
              <ShoppingBag className="w-5 h-5" />
              {totalItems > 0 && (
                <span className="absolute top-0 right-0 w-4 h-4 bg-[#D4AF37] text-black text-[10px] font-bold rounded-full flex items-center justify-center">
                  {totalItems}
                </span>
              )}
            </button>
          </div>

          <div className="flex items-center gap-4 md:hidden">
            <button
              onClick={() => setIsCartOpen(true)}
              className="relative p-2 text-white"
            >
              <ShoppingBag className="w-6 h-6" />
              {totalItems > 0 && (
                <span className="absolute top-0 right-0 w-4 h-4 bg-[#D4AF37] text-black text-[10px] font-bold rounded-full flex items-center justify-center">
                  {totalItems}
                </span>
              )}
            </button>
            <button
              className="text-white"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            >
              {isMobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>
      </nav>

      {/* Mobile Menu */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, x: "100%" }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            className="fixed inset-0 z-40 bg-[#0D0D0D] pt-24 px-6 pb-6 flex flex-col"
          >
            <div className="flex flex-col gap-6 text-xl font-serif">
              <NavLink href="/" onClick={() => setIsMobileMenuOpen(false)}>
                Home
              </NavLink>

              <div className="border-t border-border/50 pt-4">
                <p className="text-muted text-sm font-sans mb-4 uppercase tracking-widest">
                  Our Products
                </p>
                <div className="flex flex-col gap-4 pl-4">
                  {products.map((p) => (
                    <NavLink
                      key={p.href}
                      href={p.href}
                      onClick={() => setIsMobileMenuOpen(false)}
                      className="text-lg"
                    >
                      {p.name}
                    </NavLink>
                  ))}
                </div>
              </div>

              <NavLink
                href="/order-now"
                onClick={() => setIsMobileMenuOpen(false)}
                className="border-t border-border/50 pt-4"
              >
                Order Now
              </NavLink>

              <button
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  setIsCartOpen(true);
                }}
                className="border-t border-border/50 pt-4 text-left flex items-center gap-2"
              >
                Cart <span className="text-[#D4AF37]">({totalItems})</span>
              </button>

              <a
                href={`tel:${CONTACT_PHONE}`}
                onClick={() => setIsMobileMenuOpen(false)}
                className="border-t border-border/50 pt-4 text-left"
              >
                Contact Us
              </a>

              <a
                href={LOCATION_URL}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setIsMobileMenuOpen(false)}
                className="border-t border-border/50 pt-4 text-left"
              >
                Location
              </a>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};
