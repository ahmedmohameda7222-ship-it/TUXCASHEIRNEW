# TUX Burger — Website

Premium burger truck brand website for **TUX**, built with React + TypeScript + Vite + Tailwind CSS.

Dark luxury aesthetic — black backgrounds, gold accents, Playfair Display headings.

---

## Pages

| Route | Description |
|-------|-------------|
| `/` | Home — hero, mission, best sellers carousel |
| `/tuxify` | Tuxify Burger — scroll-scrubbed crossfade showcase |
| `/tux-burger` | Tux Burger product page |
| `/hawawshi` | Hawawshi product page |
| `/fries` | Fries product page |
| `/combos` | Combos product page |
| `/drinks` | Drinks product page |
| `/our-prices` | Full menu price list |

---

## Tech Stack

| Tool | Purpose |
|------|---------|
| React 19 + TypeScript | UI framework |
| Vite 7 | Dev server & bundler |
| Tailwind CSS v4 | Utility-first styling |
| Framer Motion | Page transitions & scroll animations |
| Wouter | Lightweight client-side routing |
| shadcn/ui | Base UI component library |
| Lucide React | Icons |

---

## Project Structure

```
tux-burger-website/
├── public/                  # Static files (favicon, OG image, robots.txt)
├── src/
│   ├── assets/              # Product images & logo
│   ├── components/
│   │   ├── ui/              # shadcn/ui base components
│   │   ├── Navbar.tsx
│   │   ├── Footer.tsx
│   │   ├── ProductCategoryNav.tsx
│   │   └── PageTransition.tsx
│   ├── hooks/               # Custom React hooks
│   ├── lib/
│   │   ├── constants.ts     # WhatsApp number & shared constants
│   │   └── utils.ts
│   ├── pages/               # One file per route
│   ├── App.tsx              # Router setup
│   ├── main.tsx             # Entry point
│   └── index.css            # Global styles & Tailwind imports
├── index.html
├── vite.config.ts
├── tsconfig.json
├── package.json
└── DEPLOYMENT.md            # Full deployment instructions
```

---

## Getting Started

### Requirements

- **Node.js v18+**
- **npm** (or pnpm / yarn)

### Install & Run

```bash
# Install dependencies
npm install

# Start dev server
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## Build for Production

```bash
npm run build
```

Files are output to `dist/`. Preview locally:

```bash
npm run preview
```

---

## Configuration

### WhatsApp Order Button

All "Order Now" buttons open WhatsApp. Set your number in `src/lib/constants.ts`:

```ts
export const WHATSAPP_NUMBER = "201012345678"; // Egypt format, no +
```

---

## Deployment

See **[DEPLOYMENT.md](./DEPLOYMENT.md)** for detailed instructions covering:
- Vercel (recommended)
- Netlify
- GitHub Pages
- Custom domains

---

## License

All rights reserved — TUX Burger Egypt.
