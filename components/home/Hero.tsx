"use client";

import Image from "next/image";
import { Button } from "../ui/button";
import { ArrowDown, ArrowRight } from "lucide-react";
import HeroImage from "@/public/hero.jpg";
import { useGSAP } from "@gsap/react";
import { SplitText } from "gsap/SplitText";
import gsap from "gsap";
import { useRouter } from "next/navigation";

const Hero = () => {
  const year = new Date().getFullYear();
  const router = useRouter();

  useGSAP(() => {
    const tl = gsap.timeline();
    const SplitHead1 = SplitText.create("#head-1", { type: "words, chars" });
    const SplitHead2 = SplitText.create("#head-2", { type: "lines, words" });
    const SplitHead3 = SplitText.create("#head-3", { type: "lines, words" });

    gsap.from("#arrow-scroll", {
      duration: 1,
      y: -10,
      yoyo: true,
      ease: "back.inOut",
      repeat: -1,
    });

    tl.from(SplitHead1.chars, {
      duration: 0.5,
      y: 100, // animate from 100px below
      autoAlpha: 0, // fade in from opacity: 0 and visibility: hidden
      stagger: 0.05, // 0.05 seconds between each
    })
      .from(SplitHead2.words, {
        duration: 1,
        y: 100,
        autoAlpha: 0,
        stagger: 0.1,
      })
      .from(SplitHead3.words, {
        duration: 0.7,
        y: 100,
        autoAlpha: 0,
        stagger: 0.2,
      })
      .from("#hero-cta", {
        duration: 0.75,
        y: 100,
        autoAlpha: 0,
        ease: "power1.out",
        smoothChildTiming: true,
        stagger: 0.4,
      });
  });

  return (
    <div className="relative h-screen w-full overflow-x-hidden">
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
              variant="secondary"
              className="flex gap-2 items-center text-accent text-lg border border-accent px-12 py-8"
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
      <span className="md:absolute left-1/2 bottom-5 flex flex-col gap-4 items-center font-bold text-accent mt-4">
        Scroll <ArrowDown size={24} id="arrow-scroll" />
      </span>
    </div>
  );
};

export default Hero;
