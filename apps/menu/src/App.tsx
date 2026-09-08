import { Switch, Route, Router as WouterRouter } from 'wouter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { PageTransitionProvider } from '@/components/PageTransition';
import { Navbar } from '@/components/Navbar';
import { Footer } from '@/components/Footer';
import { CartProvider } from '@/context/CartContext';
import { MenuProvider, useMenu } from '@/context/MenuContext';
import { CartDrawer } from '@/components/cart/CartDrawer';
import { StickyCartBar } from '@/components/cart/StickyCartBar';
import Home from '@/pages/Home';
import OrderNow from '@/pages/OrderNow';
import ProductCategoryPage from '@/pages/ProductCategoryPage';

const queryClient = new QueryClient();

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
    <div className="flex flex-col min-h-screen bg-black text-white selection:bg-[#D4AF37] selection:text-black">
      <Navbar />
      <CatalogAvailabilityBanner />
      <main className="flex-grow">
        <Switch>
          <Route path="/" component={Home} />
          <Route path="/order-now" component={OrderNow} />
          <Route path="/tux-burger">
            {() => <CanonicalCategoryRoute slug="tux-burger" />}
          </Route>
          <Route path="/tuxify">{() => <CanonicalCategoryRoute slug="tuxify" />}</Route>
          <Route path="/hawawshi">{() => <CanonicalCategoryRoute slug="hawawshi" />}</Route>
          <Route path="/fries">{() => <CanonicalCategoryRoute slug="fries" />}</Route>
          <Route path="/combos">{() => <CanonicalCategoryRoute slug="combos" />}</Route>
          <Route path="/drinks">{() => <CanonicalCategoryRoute slug="drinks" />}</Route>
          <Route path="/products/:slug" component={ProductCategoryPage} />
          <Route component={NotFound} />
        </Switch>
      </main>
      <Footer />
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <MenuProvider>
          <CartProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
              <PageTransitionProvider>
                <Router />
              </PageTransitionProvider>
            </WouterRouter>
            <CartDrawer />
            <StickyCartBar />
            <Toaster />
          </CartProvider>
        </MenuProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
