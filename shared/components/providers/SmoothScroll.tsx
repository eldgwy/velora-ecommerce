"use client";

import { useEffect } from "react";
import Lenis from "lenis";

/**
 * Inertial smooth scrolling (luxury motion direction). Loaded lazily from the
 * root layout so lenis never sits in the critical bundle.
 *
 * Behavior notes:
 * - The gsap ticker + ScrollTrigger.update wiring this used to have is gone:
 *   nothing in the app creates ScrollTrigger animations (the component-side
 *   registrations were unused), so Lenis runs its own canonical rAF loop.
 * - Honors prefers-reduced-motion: motion-sensitive users get the platform
 *   scroll behavior (no wheel hijacking at all).
 */
const SmoothScroll = () => {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    const lenis = new Lenis({
      duration: 1.1,
      smoothWheel: true,
      syncTouch: false, // native touch scrolling — avoid breaking mobile feel
      wheelMultiplier: 1,
      touchMultiplier: 1,
    });

    let raf = 0;
    const update = (time: number) => {
      lenis.raf(time);
      raf = requestAnimationFrame(update);
    };
    raf = requestAnimationFrame(update);

    return () => {
      cancelAnimationFrame(raf);
      lenis.destroy();
    };
  }, []);

  return null;
};

export default SmoothScroll;
