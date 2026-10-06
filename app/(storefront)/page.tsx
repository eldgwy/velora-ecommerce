"use client";

import Hero from "@/shared/components/home/Hero";
import Products from "@/shared/components/home/Products";
import FeaturedCategories from "@/shared/components/home/FeaturedCategories";
import NewArrivals from "@/shared/components/home/NewArrivals";
import OurStory from "@/shared/components/home/OurStory";
import Promotion from "@/shared/components/home/Promotion";
import BestSellers from "@/shared/components/home/BestSellers";
import Newsletter from "@/shared/components/home/NewSletter";

const Home = () => {
  return (
    <main>
      <Hero />
      <FeaturedCategories />
      <Products />
      <NewArrivals />
      <OurStory />
      <Promotion />
      <BestSellers />
      <Newsletter />
    </main>
  );
};

export default Home;
