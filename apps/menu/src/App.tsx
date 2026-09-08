import { Switch, Route } from 'wouter';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { queryClient } from './lib/queryClient';
import { CartProvider } from './context/CartContext';
import { MenuProvider, useMenu } from './context/MenuContext';
import Navbar from './components/Navbar';
import CartDrawer from './components/cart/CartDrawer';
import Footer from './components/Footer';
import Home from './pages/Home';
import About from './pages/About';
import OrderNow from './pages/OrderNow';
import ProductCategoryPage from './pages/ProductCategoryPage';
import NotFound from './pages/not-found';

function CanonicalCategoryRoute({ slug }: { slug: string }) {
  const { sections } = useMenu();
  const sectionId = sections.find((section) => section.slug === slug)?.id;
  return <ProductCategoryPage sectionId={sectionId} />;
}

function CatalogAvailabilityBanner() {
  const { error } = useMenu();
  if (!error) return null;

  return (
    <div
      role="alert"
      className="fixed inset-x-4 top-24 z-[80] mx-auto max-w-xl rounded-xl border border-[#D4AF37]/40 bg-black/95 px-5 py-4 text-center text-sm font-semibold text-white shadow-2xl"
    >
      {error}
    </div>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/about" component={About} />
      <Route path="/order-now" component={OrderNow} />
      <Route path="/tux-burger">
        <CanonicalCategoryRoute slug="tux-burger" />
      </Route>
      <Route path="/tuxify">
        <CanonicalCategoryRoute slug="tuxify" />
      </Route>
      <Route path="/hawawshi">
        <CanonicalCategoryRoute slug="hawawshi" />
      </Route>
      <Route path="/fries">
        <CanonicalCategoryRoute slug="fries" />
      </Route>
      <Route path="/combos">
        <CanonicalCategoryRoute slug="combos" />
      </Route>
      <Route path="/drinks">
        <CanonicalCategoryRoute slug="drinks" />
      </Route>
      <Route path="/products/:slug">
        {(params) => <CanonicalCategoryRoute slug={params.slug} />}
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <MenuProvider>
          <CartProvider>
            <div className="min-h-screen bg-black text-white font-sans selection:bg-[#D4AF37] selection:text-black">
              <Navbar />
              <CatalogAvailabilityBanner />
              <main>
                <Router />
              </main>
              <Footer />
              <CartDrawer />
            </div>
            <Toaster />
          </CartProvider>
        </MenuProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
