import { useState } from "react";
import { SupabaseProduct } from "@/context/MenuContext";
import { useCart } from "@/context/CartContext";
import { Plus, Minus, ImageOff } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ProductOrderCardProps {
  product: SupabaseProduct;
  extras?: SupabaseProduct[];
}

export function ProductOrderCard({ product, extras = [] }: ProductOrderCardProps) {
  const { addToCart, items, updateQuantity } = useCart();
  const { toast } = useToast();
  const [isExtrasOpen, setIsExtrasOpen] = useState(false);

  const cartItem = items.find((item) => item.id === product.id);
  const quantity = cartItem?.quantity || 0;
  const canAddExtras = product.section_id !== "extras" && extras.length > 0;

  const handleAdd = () => {
    addToCart(product, 1);
    toast({
      title: "Added to Cart",
      description: `${product.name} has been added to your cart.`,
      duration: 2000,
    });
  };

  const handleAddWithExtra = (extra: SupabaseProduct) => {
    const productWithExtra = {
      id: `${product.id}__extra__${extra.id}`,
      name: `${product.name} + ${extra.name}`,
      description: `${product.description || ""}${product.description ? " " : ""}Extra: ${extra.name}.`,
      price: product.price + extra.price,
      image_url: product.image_url,
      is_best_seller: product.is_best_seller,
    };

    addToCart(productWithExtra, 1);
    setIsExtrasOpen(false);
    toast({
      title: "Added with Extra",
      description: `${product.name} with ${extra.name} has been added to your cart.`,
      duration: 2000,
    });
  };

  return (
    <div className="flex flex-col bg-[#111] rounded-xl overflow-hidden border border-white/5 hover:border-[#D4AF37]/30 transition-all duration-300 shadow-md">
      <div className="flex">
        <div className="w-1/3 aspect-square max-w-[120px] bg-black/40 flex items-center justify-center p-2 flex-shrink-0">
          {product.image_url ? (
            <img
              src={product.image_url}
              alt={product.name}
              className="w-full h-full object-contain"
              loading="lazy"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          ) : (
            <ImageOff className="w-8 h-8 text-gray-700" />
          )}
        </div>
        <div className="flex-1 p-4 flex flex-col justify-between">
          <div>
            <h3 className="text-white font-bold text-base leading-tight mb-1">
              {product.name}
            </h3>
            {product.description && (
              <p className="text-gray-500 text-xs leading-snug line-clamp-2 mb-1">
                {product.description}
              </p>
            )}
            <p className="text-[#D4AF37] font-semibold">
              {product.price} <span className="text-sm text-gray-400">EGP</span>
            </p>
          </div>
          
          <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
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

            {canAddExtras && (
              <button
                onClick={() => setIsExtrasOpen((open) => !open)}
                className="border border-[#D4AF37]/50 text-[#D4AF37] px-4 py-2 rounded-full font-bold text-sm hover:bg-[#D4AF37] hover:text-black transition-colors"
              >
                Add Extras
              </button>
            )}
          </div>
        </div>
      </div>

      {canAddExtras && isExtrasOpen && (
        <div className="border-t border-white/10 bg-black/40 p-3">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#D4AF37] mb-3">
            Choose one extra
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-72 overflow-y-auto pr-1 no-scrollbar">
            {extras.map((extra) => (
              <button
                key={extra.id}
                onClick={() => handleAddWithExtra(extra)}
                className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-left hover:border-[#D4AF37]/50 hover:bg-[#D4AF37]/10 transition-colors"
              >
                <span className="text-sm font-semibold text-white leading-snug">{extra.name}</span>
                <span className="text-sm font-bold text-[#D4AF37] whitespace-nowrap">+{extra.price} EGP</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
