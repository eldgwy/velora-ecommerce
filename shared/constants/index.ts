/**
 * Static navigation labels only (GP-02): the home merchandising data that
 * used to live here was fake catalog content and has moved to real queries
 * (services/home-sections.ts). Navigation is presentation, not catalog data
 * — these labels stay static by design.
 */
export const NAV_LINKS = [
  {
    title: "Home",
    url: "/",
  },
  {
    title: "Shop",
    url: "/products",
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
    title: "Brands",
    url: "/admin/brands",
  },
  {
    title: "Categories",
    url: "/admin/categories",
  },
  {
    title: "Inventory",
    url: "/admin/inventory",
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
