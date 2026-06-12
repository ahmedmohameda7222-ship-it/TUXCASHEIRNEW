import { Product } from "@/lib/menu-data";
import { useCart } from "@/context/CartContext";
import { Plus, Minus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ProductOrderCardProps {
  product: Product;
}

export function ProductOrderCard({ product }: ProductOrderCardProps) {
  const { addToCart, items, updateQuantity } = useCart();
  const { toast } = useToast();

  const cartItem = items.find((item) => item.id === product.id);
  const quantity = cartItem?.quantity || 0;

  const handleAdd = () => {
    addToCart(product, 1);
    toast({
      title: "Added to Cart",
      description: `${product.name} has been added to your cart.`,
      duration: 2000,
    });
  };

  return (
    <div className="flex bg-[#111] rounded-xl overflow-hidden border border-white/5 hover:border-[#D4AF37]/30 transition-all duration-300 shadow-md">
      <div className="w-1/3 aspect-square max-w-[120px] bg-black/40 flex items-center justify-center p-2">
        <img
          src={product.image_url}
          alt={product.name}
          className="w-full h-full object-contain"
          loading="lazy"
        />
      </div>
      <div className="w-2/3 p-4 flex flex-col justify-between">
        <div>
          <h3 className="text-white font-bold text-lg leading-tight mb-1">
            {product.name}
          </h3>
          <p className="text-[#D4AF37] font-semibold">
            {product.price} <span className="text-sm text-gray-400">EGP</span>
          </p>
        </div>
        
        <div className="mt-4 flex items-center justify-end">
          {quantity > 0 ? (
            <div className="flex items-center gap-3 bg-white/10 rounded-full px-1 py-1 border border-white/10">
              <button
                onClick={() => updateQuantity(product.id, quantity - 1)}
                className="w-8 h-8 rounded-full bg-black/50 flex items-center justify-center text-white hover:bg-[#D4AF37] hover:text-black transition-colors"
                aria-label="Decrease quantity"
              >
                <Minus className="w-4 h-4" />
              </button>
              <span className="text-white font-bold w-4 text-center">
                {quantity}
              </span>
              <button
                onClick={() => updateQuantity(product.id, quantity + 1)}
                className="w-8 h-8 rounded-full bg-black/50 flex items-center justify-center text-white hover:bg-[#D4AF37] hover:text-black transition-colors"
                aria-label="Increase quantity"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={handleAdd}
              className="bg-[#D4AF37] text-black px-4 py-2 rounded-full font-bold text-sm hover:bg-[#F3D55B] transition-colors shadow-[0_0_10px_rgba(212,175,55,0.2)]"
            >
              Add to Cart
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
