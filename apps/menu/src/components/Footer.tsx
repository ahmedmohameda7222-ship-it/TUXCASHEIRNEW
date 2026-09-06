import React from "react";
import { NavLink } from "./NavLink";
import { CONTACT_PHONE, LOCATION_URL } from "@/lib/constants";
export const Footer = () => {
  return (
    <footer className="bg-[#0D0D0D] border-t border-border pt-16 pb-8 px-6 md:px-12 mt-20">
      <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-12 mb-12">
        {/* Left */}
        <div>
          <div className="group inline-flex flex-col items-start mb-6">
            <span className="font-serif text-4xl font-bold tracking-tighter text-white">TUX</span>
            <span className="w-8 h-[2px] bg-primary"></span>
          </div>
          <p className="text-muted font-serif italic mb-2">Burgers Worth The Chase</p>
          <p className="text-muted/80 text-sm max-w-xs">
            Premium burgers made fresh. Built for the chase. Experience the best street-food burger in Egypt.
          </p>
        </div>

        {/* Center */}
        <div>
          <h4 className="text-white font-sans uppercase tracking-widest text-sm mb-6">Quick Links</h4>
          <ul className="space-y-4">
            <li>
              <NavLink href="/" className="text-muted hover:text-primary transition-colors text-sm">Home</NavLink>
            </li>
            <li>
              <NavLink href="/order-now" className="text-muted hover:text-primary transition-colors text-sm">Order Now</NavLink>
            </li>
            <li>
              <a href={`tel:${CONTACT_PHONE}`} className="text-muted hover:text-primary transition-colors text-sm">Contact Us</a>
            </li>
            <li>
              <a href={LOCATION_URL} target="_blank" rel="noopener noreferrer" className="text-muted hover:text-primary transition-colors text-sm">Location</a>
            </li>
          </ul>
        </div>

        {/* Right */}
        <div>
          <h4 className="text-white font-sans uppercase tracking-widest text-sm mb-6">Products</h4>
          <ul className="space-y-4 grid grid-cols-2">
            <li><NavLink href="/tux-burger" className="text-muted hover:text-primary transition-colors text-sm">Tux Burger</NavLink></li>
            <li><NavLink href="/tuxify" className="text-muted hover:text-primary transition-colors text-sm">Tuxify Burger</NavLink></li>
            <li><NavLink href="/hawawshi" className="text-muted hover:text-primary transition-colors text-sm">Hawawshi</NavLink></li>
            <li><NavLink href="/fries" className="text-muted hover:text-primary transition-colors text-sm">Fries</NavLink></li>
            <li><NavLink href="/combos" className="text-muted hover:text-primary transition-colors text-sm">Combos</NavLink></li>
            <li><NavLink href="/drinks" className="text-muted hover:text-primary transition-colors text-sm">Drinks</NavLink></li>
          </ul>
        </div>
      </div>

      <div className="max-w-7xl mx-auto pt-8 border-t border-border/50 text-center">
        <p className="text-muted/60 text-xs font-sans">
          &copy; {new Date().getFullYear()} TUX. All rights reserved.
        </p>
      </div>
    </footer>
  );
};
