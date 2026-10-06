"use client";

import React, { useRef, useEffect, useState } from "react";
import { motion, useSpring, useMotionValue, useTransform } from "motion/react";
import { Button } from "./button";

interface ElasticButtonProps extends React.ComponentProps<typeof Button> {
  children: React.ReactNode;
  className?: string;
  /** Optional icon component */
  icon?: React.ComponentType<{ className?: string }>;
  /** Elastic intensity (default 1.2) */
  strength?: number;
}

export function ElasticButton({
  children,
  className,
  icon: Icon,
  strength = 1.2,
  ...props
}: ElasticButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);

  // Button width (used for x clamp)
  const [width, setWidth] = useState(120);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const updateWidth = () => {
      setWidth(el.offsetWidth);
    };

    updateWidth();
    window.addEventListener("resize", updateWidth);

    return () => window.removeEventListener("resize", updateWidth);
  }, []);

  // Spring physics for smooth movement
  const x = useSpring(0, { damping: 28, stiffness: 200 });
  const y = useSpring(0, { damping: 28, stiffness: 200 });

  // Mouse position
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);

  // Calculate movement direction
  const translateX = useTransform(mouseX, [0, 1], [-1, 1]);
  const translateY = useTransform(mouseY, [0, 1], [-1, 1]);

  const handleMouseMove = (event: React.MouseEvent) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;

    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    mouseX.set((event.clientX - cx) / (rect.width / 2));
    mouseY.set((event.clientY - cy) / (rect.height / 2));

    x.set(translateX.get() * width * 0.02 * strength);
    y.set(translateY.get() * 4 * strength);
  };

  const handleMouseLeave = () => {
    x.set(0);
    y.set(0);
    mouseX.set(0);
    mouseY.set(0);
  };

  return (
    <motion.div
      style={{
        x,
        y,
        // clamp movement to button width
        width: "fit-content",
      }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      transition={{
        type: "spring",
        stiffness: 200,
        damping: 28,
        restDelta: 0.001,
      }}
      className="inline-block"
    >
      <Button
        ref={ref}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        className={`
          ${className || ""}
          relative
          overflow-visible
          transition-all
          duration-300
          ease-out
          group
        `}
        {...props}
      >
        <span
          className={`
            relative
            z-10
            flex
            items-center
            gap-2
            transition-colors
            duration-300
            group-hover:text-white
            group-hover:scale-105
            will-change-transform
          `}
        >
          {Icon && <Icon className="size-4" />}
          {children}
        </span>

        {/* Hover shadow glow (optional) */}
        <span
          className="
            absolute
            inset-0
            rounded-full
            bg-velora-gold/20
            opacity-0
            blur-xl
            transition-opacity
            duration-300
            group-hover:opacity-100
            pointer-events-none
          "
        />
      </Button>
    </motion.div>
  );
}

export default ElasticButton;
