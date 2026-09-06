import React from "react";
import { useLocation } from "wouter";
import { usePageTransition } from "./PageTransition";

type NavLinkProps = {
  href: string;
  className?: string;
  children: React.ReactNode;
  onClick?: () => void;
  withPageTransition?: boolean;
  "data-testid"?: string;
};

export const NavLink = ({
  href,
  className,
  children,
  onClick,
  withPageTransition = true,
  "data-testid": dataTestId,
}: NavLinkProps) => {
  const { triggerTransition } = usePageTransition();
  const [location, setLocation] = useLocation();

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (onClick) onClick();
    if (location !== href) {
      if (withPageTransition) {
        triggerTransition(href);
      } else {
        setLocation(href);
      }
    }
  };

  return (
    <a href={href} onClick={handleClick} className={className} data-testid={dataTestId}>
      {children}
    </a>
  );
};
