import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { PageTransitionProvider } from "@/components/PageTransition";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { CartProvider } from "@/context/CartContext";
import { MenuProvider } from "@/context/MenuContext";
import { CartDrawer } from "@/components/cart/CartDrawer";
import { StickyCartBar } from "@/components/cart/StickyCartBar";

import Home from "@/pages/Home";
import OrderNow from "@/pages/OrderNow";
import Admin from "@/pages/Admin";
import ProductCategoryPage from "@/pages/ProductCategoryPage";

const queryClient = new QueryClient();

function Router() {
  return (
    <div className="flex flex-col min-h-screen bg-black text-white selection:bg-[#D4AF37] selection:text-black">
      <Navbar />
      <main className="flex-grow">
        <Switch>
          <Route path="/" component={Home} />
          <Route path="/order-now" component={OrderNow} />
          <Route path="/admin" component={Admin} />
          <Route path="/tux-burger">{() => <ProductCategoryPage sectionId="tux-burger" />}</Route>
          <Route path="/tuxify">{() => <ProductCategoryPage sectionId="tuxify" />}</Route>
          <Route path="/hawawshi">{() => <ProductCategoryPage sectionId="hawawshi" />}</Route>
          <Route path="/fries">{() => <ProductCategoryPage sectionId="fries" />}</Route>
          <Route path="/combos">{() => <ProductCategoryPage sectionId="combos" />}</Route>
          <Route path="/drinks">{() => <ProductCategoryPage sectionId="drinks" />}</Route>
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
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
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
