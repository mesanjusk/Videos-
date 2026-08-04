"use client";

import { usePathname } from "next/navigation";
import { motion } from "framer-motion";

/** Subtle fade/slide between dashboard routes — keyed on pathname so each navigation re-triggers it. */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <motion.div
      key={pathname}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}
