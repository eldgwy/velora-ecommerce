"use client";

import Hero from "@/components/home/Hero";
import Products from "@/components/home/Products";
import FeaturedCategories from "@/components/home/FeaturedCategories";
import NewArrivals from "@/components/home/NewArrivals";
import OurStory from "@/components/home/OurStory";
import Promotion from "@/components/home/Promotion";
import BestSellers from "@/components/home/BestSellers";
import Newsletter from "@/components/home/NewSletter";

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
