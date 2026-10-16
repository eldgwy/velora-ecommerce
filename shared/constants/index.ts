import { StaticImageData } from 'next/image'

import product1 from '../images/products/product1.jpg';
import product2 from '../images/products/product2.jpg';
import product3 from '../images/products/product3.jpg';
import product4 from '../images/products/product4.jpg';
import product5 from '../images/products/product5.jpg';
import product6 from '../images/products/product6.jpg';
import catWomen from '../images/categories/women.jpg';
import catMen from '../images/categories/men.jpg';
import catAccessories from '../images/categories/accessories.jpg';
import catNewArrivals from '../images/categories/newArrivals.jpg';

export type Product = {
  id: number,
  title: string,
  price: number,
  description?: string,
  category: string,
  image?: string | StaticImageData,
  stars?: number
}

export const NAV_LINKS = [
  {
    title: "Home",
    url: "/",
  },
  {
    title: "Shop",
    url: "/shop",
  },
  {
    title: "About",
    url: "/about",
  },
  {
    title: "Contact",
    url: "/contact",
  },
];

export const ADMIN_LINKS = [
  {
    title: "Dashboard",
    url: "/admin",
  },
  {
    title: "Products",
    url: "/admin/products",
  },
  {
    title: "Orders",
    url: "/admin/orders",
  },
  {
    title: "Customers",
    url: "/admin/customers",
  },
];

export const Products: Product[] = [
  {
    id: 1,
    title: 'Product 1',
    price: 150,
    description: "The Best Product 1",
    category: 'Jackets',
    image: product1,
    stars: 4
  },
  {
    id: 2,
    title: 'Product 2',
    price: 250,
    description: "The Best Product 2",
    category: 'Clothes',
    image: product2,
    stars: 4.5
  },
  {
    id: 3,
    title: 'Product 3',
    price: 300,
    description: "The Best Product 3",
    category: 'Clothes',
    image: product3,
    stars: 5
  },
  {
    id: 4,
    title: 'Product 4',
    price: 200,
    description: "The Best Product 4",
    category: 'Jackets',
    image: product4,
    stars: 3.5
  },
  {
    id: 5,
    title: 'Product 5',
    price: 350,
    description: "The Best Product 5",
    category: 'Bags',
    image: product5,
    stars: 3
  },
  {
    id: 6,
    title: 'Product 6',
    price: 450,
    description: "The Best Product 6",
    category: 'Clothes',
    image: product6,
    stars: 4
  },
]

export const categories = [
  {
    name: "Women",
    slug: "women",
    image: catWomen,
  },
  {
    name: "Men",
    slug: "men",
    image: catMen,
  },
  {
    name: "Accessories",
    slug: "accessories",
    image: catAccessories,
  },
  {
    name: "New Arrivals",
    slug: "new-arrivals",
    image: catNewArrivals,
  },
];