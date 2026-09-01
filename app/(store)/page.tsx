"use client";

import Hero from "@/components/home/Hero";
import Products from "@/components/home/Products";
import FeaturedCategories from "@/components/home/FeaturedCategories";

const Home = () => {
  return (
    <main>
      <Hero />
      <FeaturedCategories />
      <Products />
    </main>
  );
};

export default Home;
