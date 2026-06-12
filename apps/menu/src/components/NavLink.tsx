import React from "react";
import { Link, useLocation } from "wouter";
import { usePageTransition } from "./PageTransition";

export const NavLink = ({ href, className, children, onClick }: { href: string; className?: string; children: React.ReactNode; onClick?: () => void }) => {
  const { triggerTransition } = usePageTransition();
  const [location] = useLocation();

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (onClick) onClick();
    if (location !== href) {
      triggerTransition(href);
    }
  };

  return (
    <a href={href} onClick={handleClick} className={className}>
      {children}
    </a>
  );
};
