export interface Category {
  id: string;
  name: string;
  slug: string;
  sort_order: number;
}

export interface Product {
  id: string;
  category_id: string; // matches Category.id
  name: string;
  description: string;
  price: number;
  image_url: string;
  is_best_seller: boolean;
  is_available: boolean;
  sort_order: number;
}

export const CATEGORIES: Category[] = [
  { id: "tux-burger", name: "Tux Burger", slug: "tux-burger", sort_order: 1 },
  { id: "tuxify", name: "Tuxify Burger", slug: "tuxify", sort_order: 2 },
  { id: "hawawshi", name: "Hawawshi", slug: "hawawshi", sort_order: 3 },
  { id: "fries", name: "Fries", slug: "fries", sort_order: 4 },
  { id: "combos", name: "Combos", slug: "combos", sort_order: 5 },
  { id: "drinks", name: "Drinks", slug: "drinks", sort_order: 6 },
];

const TUX_LOGO_PLACEHOLDER = "/src/assets/tuxlogo-transparent.svg";

export const PRODUCTS: Product[] = [
  // Tux Burger
  {
    id: "single-tux-burger",
    category_id: "tux-burger",
    name: "Single Tux Burger",
    description: "The classic Tux. 150g pure beef patty, melted cheddar, crisp lettuce, fresh tomato, onions, and our signature Tux sauce on a toasted brioche bun.",
    price: 190,
    image_url: TUX_LOGO_PLACEHOLDER,
    is_best_seller: true,
    is_available: true,
    sort_order: 1,
  },
  {
    id: "double-tux-burger",
    category_id: "tux-burger",
    name: "Double Tux Burger",
    description: "Double the pleasure. Two 150g beef patties stacked with double cheddar, crisp lettuce, fresh tomato, onions, and signature Tux sauce.",
    price: 250,
    image_url: TUX_LOGO_PLACEHOLDER,
    is_best_seller: false,
    is_available: true,
    sort_order: 2,
  },
  {
    id: "triple-tux-burger",
    category_id: "tux-burger",
    name: "Triple Tux Burger",
    description: "For the truly hungry. Three 150g beef patties, triple cheddar, crisp lettuce, fresh tomato, onions, and signature Tux sauce.",
    price: 310,
    image_url: TUX_LOGO_PLACEHOLDER,
    is_best_seller: false,
    is_available: true,
    sort_order: 3,
  },
  {
    id: "tux-quatro",
    category_id: "tux-burger",
    name: "TUX Quatro",
    description: "The ultimate mountain of meat. Four 150g beef patties, melted cheese layers, and our signature Tux sauce.",
    price: 360,
    image_url: TUX_LOGO_PLACEHOLDER,
    is_best_seller: true,
    is_available: true,
    sort_order: 4,
  },

  // Tuxify
  {
    id: "single-tuxify",
    category_id: "tuxify",
    name: "Single Tuxify",
    description: "High quality single patty with our rich Tuxify sauce, caramelized onions, and high quality cheddar on a soft brioche bun.",
    price: 180,
    image_url: "/src/assets/tuxify_single.png",
    is_best_seller: false,
    is_available: true,
    sort_order: 1,
  },
  {
    id: "double-tuxify",
    category_id: "tuxify",
    name: "Double Tuxify",
    description: "Double patty goodness with double cheddar, caramelized onions, and our signature Tuxify sauce.",
    price: 240,
    image_url: "/src/assets/tuxify_double.png",
    is_best_seller: true,
    is_available: true,
    sort_order: 2,
  },
  {
    id: "triple-tuxify",
    category_id: "tuxify",
    name: "Triple Tuxify",
    description: "Three layers of high quality beef, melted cheddar, sweet caramelized onions, and rich Tuxify sauce.",
    price: 300,
    image_url: "/src/assets/tuxify_triple.png",
    is_best_seller: false,
    is_available: true,
    sort_order: 3,
  },
  {
    id: "quatro-tuxify",
    category_id: "tuxify",
    name: "Quatro Tuxify",
    description: "Four high quality patties, layers of melted cheddar, caramelized onions, and abundant Tuxify sauce.",
    price: 360,
    image_url: "/src/assets/tuxify_quatro.png",
    is_best_seller: false,
    is_available: true,
    sort_order: 4,
  },

  // Hawawshi
  {
    id: "classic-hawawshi",
    category_id: "hawawshi",
    name: "Classic Hawawshi",
    description: "Authentic Egyptian Hawawshi with high quality spiced minced meat baked to crispy perfection.",
    price: 120,
    image_url: TUX_LOGO_PLACEHOLDER,
    is_best_seller: false,
    is_available: true,
    sort_order: 1,
  },
  {
    id: "tux-hawawshi",
    category_id: "hawawshi",
    name: "TUX Hawawshi",
    description: "Our signature Hawawshi loaded with extra high quality meat, special spices, and melted cheese.",
    price: 150,
    image_url: TUX_LOGO_PLACEHOLDER,
    is_best_seller: true,
    is_available: true,
    sort_order: 2,
  },

  // Fries
  {
    id: "classic-fries-small",
    category_id: "fries",
    name: "Classic Fries Small",
    description: "Crispy golden French fries, perfectly salted.",
    price: 30,
    image_url: TUX_LOGO_PLACEHOLDER,
    is_best_seller: false,
    is_available: true,
    sort_order: 1,
  },
  {
    id: "classic-fries-large",
    category_id: "fries",
    name: "Classic Fries Large",
    description: "A large portion of our crispy golden French fries.",
    price: 45,
    image_url: TUX_LOGO_PLACEHOLDER,
    is_best_seller: false,
    is_available: true,
    sort_order: 2,
  },
  {
    id: "cheese-fries",
    category_id: "fries",
    name: "Cheese Fries",
    description: "Crispy fries smothered in rich, creamy melted cheese sauce.",
    price: 60,
    image_url: TUX_LOGO_PLACEHOLDER,
    is_best_seller: true,
    is_available: true,
    sort_order: 3,
  },
  {
    id: "chili-fries",
    category_id: "fries",
    name: "Chili Fries",
    description: "Crispy fries topped with our spicy chili con carne.",
    price: 75,
    image_url: TUX_LOGO_PLACEHOLDER,
    is_best_seller: false,
    is_available: true,
    sort_order: 4,
  },
  {
    id: "tux-fries",
    category_id: "fries",
    name: "TUX Fries",
    description: "Our signature fries loaded with cheese, jalapenos, and special TUX sauce.",
    price: 85,
    image_url: TUX_LOGO_PLACEHOLDER,
    is_best_seller: true,
    is_available: true,
    sort_order: 5,
  },
  {
    id: "doppy-fries",
    category_id: "fries",
    name: "Doppy Fries",
    description: "Crispy fries with our unique doppy seasoning and sauce blend.",
    price: 90,
    image_url: TUX_LOGO_PLACEHOLDER,
    is_best_seller: false,
    is_available: true,
    sort_order: 6,
  },

  // Combos
  {
    id: "single-combo",
    category_id: "combos",
    name: "Single Combo",
    description: "Add small fries and a soda to any single burger.",
    price: 60,
    image_url: TUX_LOGO_PLACEHOLDER,
    is_best_seller: false,
    is_available: true,
    sort_order: 1,
  },
  {
    id: "double-combo",
    category_id: "combos",
    name: "Double Combo",
    description: "Add large fries and a soda to any double burger.",
    price: 80,
    image_url: TUX_LOGO_PLACEHOLDER,
    is_best_seller: false,
    is_available: true,
    sort_order: 2,
  },
  {
    id: "tuxify-combo",
    category_id: "combos",
    name: "Tuxify Combo",
    description: "The ultimate Tuxify experience with cheese fries and a drink.",
    price: 100,
    image_url: TUX_LOGO_PLACEHOLDER,
    is_best_seller: true,
    is_available: true,
    sort_order: 3,
  },
  {
    id: "family-combo",
    category_id: "combos",
    name: "Family Combo",
    description: "4 single burgers, 2 large fries, and 4 sodas.",
    price: 650,
    image_url: TUX_LOGO_PLACEHOLDER,
    is_best_seller: false,
    is_available: true,
    sort_order: 4,
  },

  // Drinks
  {
    id: "soda",
    category_id: "drinks",
    name: "Soda",
    description: "Ice cold carbonated drink.",
    price: 25,
    image_url: TUX_LOGO_PLACEHOLDER,
    is_best_seller: false,
    is_available: true,
    sort_order: 1,
  },
  {
    id: "water",
    category_id: "drinks",
    name: "Water",
    description: "Refreshing bottled water.",
    price: 10,
    image_url: TUX_LOGO_PLACEHOLDER,
    is_best_seller: false,
    is_available: true,
    sort_order: 2,
  },
];
