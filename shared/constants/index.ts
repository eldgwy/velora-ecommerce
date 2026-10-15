import { StaticImageData } from 'next/image'

const IMAGE_PATH='@/shared/images'

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
    image: `${IMAGE_PATH}/products/product1.jpg`,
    stars: 4
  },
  {
    id: 2,
    title: 'Product 2',
    price: 250,
    description: "The Best Product 2",
    category: 'Clothes',
    image: `${IMAGE_PATH}/products/product2.jpg`,
    stars: 4.5
  },
  {
    id: 3,
    title: 'Product 3',
    price: 300,
    description: "The Best Product 3",
    category: 'Clothes',
    image: `${IMAGE_PATH}/products/product3.jpg`,
    stars: 5
  },
  {
    id: 4,
    title: 'Product 4',
    price: 200,
    description: "The Best Product 4",
    category: 'Jackets',
    image: `${IMAGE_PATH}/products/product4.jpg`,
    stars: 3.5
  },
  {
    id: 5,
    title: 'Product 5',
    price: 350,
    description: "The Best Product 5",
    category: 'Bags',
    image: `${IMAGE_PATH}/products/product5.jpg`,
    stars: 3
  },
  {
    id: 6,
    title: 'Product 6',
    price: 450,
    description: "The Best Product 6",
    category: 'Clothes',
    image: `${IMAGE_PATH}/products/product6.jpg`,
    stars: 4
  },
]

export const categories = [
  {
    name: "Women",
    slug: "women",
    image: `${IMAGE_PATH}/categories/women.jpg`,
  },
  {
    name: "Men",
    slug: "men",
    image: `${IMAGE_PATH}/categories/men.jpg`,
  },
  {
    name: "Accessories",
    slug: "accessories",
    image: `${IMAGE_PATH}/categories/accessories.jpg`,
  },
  {
    name: "New Arrivals",
    slug: "new-arrivals",
    image: `${IMAGE_PATH}/categories/newArrivals.jpg`,
  },
];