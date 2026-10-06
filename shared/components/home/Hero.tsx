"use client";

import Image from "next/image";
import { Button } from "../ui/button";
import { ArrowDown, ArrowRight } from "lucide-react";
import HeroImage from "@/images/hero.jpg";
import { useGSAP } from "@gsap/react";
import { SplitText } from "gsap/SplitText";
import gsap from "gsap";
import { useRouter } from "next/navigation";

const Hero = () => {
  const year = new Date().getFullYear();
  const router = useRouter();

  useGSAP(() => {
    const tl = gsap.timeline();

    const splitHead1 = SplitText.create("#head-1", {
      type: "words, chars",
    });

    const splitHead2 = SplitText.create("#head-2", {
      type: "lines, words",
    });

    const splitHead3 = SplitText.create("#head-3", {
      type: "lines, words",
    });

    // Initial animation state
    gsap.set(splitHead1.chars, {
      y: 100,
      autoAlpha: 0,
    });

    gsap.set(splitHead2.words, {
      y: 100,
      autoAlpha: 0,
    });

    gsap.set(splitHead3.words, {
      y: 100,
      autoAlpha: 0,
    });

    gsap.set("#hero-cta", {
      y: 100,
      autoAlpha: 0,
    });

    // Make containers visible after SplitText is ready
    gsap.set(["#head-1", "#head-2", "#head-3", "#hero-cta"], {
      visibility: "visible",
    });

    gsap.to("#arrow-scroll", {
      y: -10,
      duration: 1,
      yoyo: true,
      repeat: -1,
      ease: "power1.inOut",
    });

    tl.to(splitHead1.chars, {
      y: 0,
      autoAlpha: 1,
      duration: 0.5,
      stagger: 0.05,
      ease: "power3.out",
    })

      .to(
        splitHead2.words,
        {
          y: 0,
          autoAlpha: 1,
          duration: 0.8,
          stagger: 0.08,
          ease: "power3.out",
        },
        "<0.2",
      )

      .to(
        splitHead3.words,
        {
          y: 0,
          autoAlpha: 1,
          duration: 0.5,
          stagger: 0.05,
          ease: "power3.out",
        },
        "<0.15",
      )

      .to(
        "#hero-cta",
        {
          y: 0,
          autoAlpha: 1,
          duration: 0.75,
          ease: "power3.out",
        },
        "<0.1",
      );

    return () => {
      splitHead1.revert();
      splitHead2.revert();
      splitHead3.revert();
    };
  });

  return (
    <div className="hero relative h-screen w-full overflow-x-hidden">
      <div className="flex flex-col-reverse md:flex-row gap-2">
        <div className="flex flex-col items-center md:items-start flex-1/2 justify-center pl-4 lg:ml-8 lg:pl-16 gap-6 text-center md:text-start">
          <p className="text-xl text-accent uppercase" id="head-1">
            New Collection - {year}
          </p>
          <h1
            className="md:text-7xl text-4xl tracking-widest text-primary"
            id="head-2"
          >
            THE ART OF <br /> EVERYDAY <br /> LUXURY
          </h1>
          <p className="w-80 text-gray-600" id="head-3">
            Curated essentials designed for those who appreciate the finer
            details.
          </p>
          <div
            className="flex mt-12 gap-4 items-center flex-col md:flex-row"
            id="hero-cta"
          >
            <Button
              className="flex gap-2 items-center text-accent text-lg border border-accent p-8"
              onClick={() => router.push("/collections")}
            >
              Shop Collections <ArrowRight />
            </Button>
            <Button
              variant="ghost"
              className="flex gap-2 items-center text-accent text-lg border border-accent px-12 py-8 hover:text-accent"
              onClick={() => router.push("/products")}
            >
              Explore
            </Button>
          </div>
        </div>
        <div className="h-screen flex-1/2">
          <Image src={HeroImage} alt="Hero Image" className="h-full" />
        </div>
      </div>
      <span className="md:absolute left-1/2 bottom-2 flex flex-col gap-4 items-center font-bold text-accent mt-4">
        Scroll <ArrowDown size={24} id="arrow-scroll" />
      </span>
    </div>
  );
};

export default Hero;
