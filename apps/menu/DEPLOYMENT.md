# Deployment Guide — TUX Burger Website

This is a **static frontend application** built with Vite + React. There is no backend server.
Once built, the output is a folder of HTML/CSS/JS files that can be hosted anywhere.

---

## Prerequisites

- Node.js **v18 or higher**
- npm (comes with Node.js), or pnpm / yarn

---

## 1. Local Development

```bash
# Install dependencies
npm install

# Start the dev server at http://localhost:5173
npm run dev
```

---

## 2. Production Build

```bash
npm run build
```

Output is placed in the `dist/` folder. You can preview it locally:

```bash
npm run preview
# Opens at http://localhost:4173
```

---

## 3. Deploy to Vercel (Recommended)

Vercel is the easiest platform for Vite/React apps.

### Option A — Via GitHub (recommended)

1. Push this repository to GitHub.
2. Go to [vercel.com](https://vercel.com) → **Add New Project**.
3. Import your GitHub repo.
4. Vercel auto-detects Vite. Leave all settings as default:
   - **Framework Preset**: Vite
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
5. Click **Deploy**.

Your site is live on a `*.vercel.app` domain in ~30 seconds.

### Option B — Via Vercel CLI

```bash
npm install -g vercel
vercel login
vercel --prod
```

---

## 4. Deploy to Netlify

1. Push this repository to GitHub.
2. Go to [netlify.com](https://netlify.com) → **Add new site** → **Import from Git**.
3. Connect your GitHub repo.
4. Set build settings:
   - **Build Command**: `npm run build`
   - **Publish Directory**: `dist`
5. Click **Deploy site**.

### Netlify CLI alternative

```bash
npm install -g netlify-cli
netlify login
npm run build
netlify deploy --prod --dir dist
```

---

## 5. Deploy to GitHub Pages

1. Install the `gh-pages` package:
   ```bash
   npm install --save-dev gh-pages
   ```

2. Add a deploy script to `package.json`:
   ```json
   "scripts": {
     "deploy": "gh-pages -d dist"
   }
   ```

3. If your site is hosted at `https://username.github.io/repo-name/` (not the root),
   update the `base` in `vite.config.ts`:
   ```ts
   base: "/repo-name/",
   ```
   If it will be at the root domain, leave `base: "/"`.

4. Build and deploy:
   ```bash
   npm run build
   npm run deploy
   ```

---

## 6. Configuring the WhatsApp Button

All **Order Now** buttons link to WhatsApp. To set your number:

Edit `src/lib/constants.ts`:

```ts
export const WHATSAPP_NUMBER = "201012345678"; // Your number without +
```

No environment variables are needed — this is a purely frontend app.

---

## 7. Custom Domain

All platforms above (Vercel, Netlify, GitHub Pages) support custom domains.
- On Vercel/Netlify: add your domain in the project's domain settings.
- On GitHub Pages: add a `CNAME` file in the `public/` folder containing your domain.

---

## Environment Variables

This project has **no required environment variables**. The WhatsApp number is configured
directly in `src/lib/constants.ts`.

If you add any future environment variables, prefix them with `VITE_` so Vite
exposes them to the browser:

```ts
// Access in code:
const myVar = import.meta.env.VITE_MY_VARIABLE;
```

And add them to `.env.example` so teammates know they exist.
