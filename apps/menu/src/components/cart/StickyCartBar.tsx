import { useCart } from '@/context/CartContext';
import { useMenu } from '@/context/MenuContext';
import { ShoppingBag } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';

export function StickyCartBar() {
  const { items, totalItems, setIsCartOpen, isCartOpen } = useCart();
  const { products, extrasByProduct } = useMenu();

  // Reprice saved cart lines against the same published values used in CartDrawer.
  // A product/extras removal must not leave an obsolete price visible.
  const canonicalTotal = items.reduce<number | null>((total, item) => {
    if (total === null) return null;
    const productId = item.baseProductId ?? item.id;
    const currentProduct = products.find((product) => product.id === productId);
    if (currentProduct === undefined || !currentProduct.is_active) return null;

    let unitPrice = currentProduct.price;
    const availableExtras = extrasByProduct[productId] ?? [];
    for (const selectedExtra of item.extras ?? []) {
      const currentExtra = availableExtras.find((extra) => extra.id === selectedExtra.id);
      if (currentExtra === undefined) return null;
      unitPrice += currentExtra.price;
    }
    return total + unitPrice * item.quantity;
  }, 0);

  if (totalItems === 0 || isCartOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 100, opacity: 0 }}
        className="fixed bottom-0 left-0 right-0 z-40 p-4 pb-6 bg-gradient-to-t from-black via-black/90 to-transparent pointer-events-none md:hidden"
      >
        <button
          onClick={() => setIsCartOpen(true)}
          className="pointer-events-auto w-full bg-[#D4AF37] text-black rounded-full px-6 py-4 flex items-center justify-between font-bold shadow-[0_0_20px_rgba(212,175,55,0.4)] transition-transform active:scale-95"
        >
          <div className="flex items-center gap-2 text-lg">
            <div className="bg-black/10 rounded-full w-8 h-8 flex items-center justify-center">
              {totalItems}
            </div>
            <span>Items</span>
          </div>

          <div className="flex items-center gap-2">
            <span>View Cart</span>
            <ShoppingBag className="w-5 h-5" />
          </div>

          <div className="text-lg">
            {canonicalTotal === null ? 'Price unavailable' : `${canonicalTotal} EGP`}
          </div>
        </button>
      </motion.div>
    </AnimatePresence>
  );
}
