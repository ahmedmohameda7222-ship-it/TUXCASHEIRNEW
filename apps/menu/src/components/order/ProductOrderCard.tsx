import { useMemo, useState } from "react";
import { SupabaseProduct } from "@/context/MenuContext";
import { CartExtra, useCart } from "@/context/CartContext";
import { Plus, Minus, ImageOff } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ProductOrderCardProps {
  product: SupabaseProduct;
  extras?: SupabaseProduct[];
  categoryUnavailable?: boolean;
}

const buildVariantId = (productId: string, selectedExtraIds: string[]) => {
  const extrasKey = [...selectedExtraIds].sort().join("__");
  return extrasKey ? `${productId}__extras__${extrasKey}` : productId;
};

export function ProductOrderCard({ product, extras = [], categoryUnavailable = false }: ProductOrderCardProps) {
  const { addToCart, items, updateQuantity } = useCart();
  const { toast } = useToast();
  const [isExtrasOpen, setIsExtrasOpen] = useState(false);
  const [selectedExtraIds, setSelectedExtraIds] = useState<string[]>([]);

  const unavailable = categoryUnavailable || !product.is_active;
  const cartItem = items.find((item) => item.id === product.id);
  const quantity = cartItem?.quantity || 0;
  const canAddExtras = !unavailable && product.section_id !== "extras" && extras.length > 0;

  const selectedExtras = useMemo(
    () => extras.filter((extra) => selectedExtraIds.includes(extra.id)),
    [extras, selectedExtraIds]
  );

  const selectedExtrasTotal = selectedExtras.reduce((sum, extra) => sum + extra.price, 0);
  const totalWithExtras = product.price + selectedExtrasTotal;

  const toggleExtra = (extraId: string) => {
    setSelectedExtraIds((current) =>
      current.includes(extraId)
        ? current.filter((id) => id !== extraId)
        : [...current, extraId]
    );
  };

  const handleAdd = () => {
    if (unavailable) return;
    addToCart(product, 1);
    toast({
      title: "Added to Cart",
      description: `${product.name} has been added to your cart.`,
      duration: 2000,
    });
  };

  const handleAddWithExtras = () => {
    if (unavailable || selectedExtras.length === 0) return;

    const sortedExtras = [...selectedExtras].sort((a, b) => a.id.localeCompare(b.id));
    const cartExtras: CartExtra[] = sortedExtras.map((extra) => ({
      id: extra.id,
      name: extra.name,
      price: extra.price,
    }));

    const productWithExtras = {
      id: buildVariantId(product.id, cartExtras.map((extra) => extra.id)),
      name: product.name,
      baseProductId: product.id,
      baseProductName: product.name,
      description: product.description,
      price: product.price + cartExtras.reduce((sum, extra) => sum + extra.price, 0),
      image_url: product.image_url,
      is_best_seller: product.is_best_seller,
      extras: cartExtras,
    };

    addToCart(productWithExtras, 1);
    setSelectedExtraIds([]);
    setIsExtrasOpen(false);
    toast({
      title: "Added with Extras",
      description: `${product.name} with ${cartExtras.map((extra) => extra.name).join(", ")} has been added to your cart.`,
      duration: 2500,
    });
  };

  return (
    <div
      className={`flex flex-col rounded-xl overflow-hidden border transition-all duration-300 shadow-md ${
        unavailable
          ? "bg-gray-900/70 border-gray-700 grayscale opacity-70"
          : "bg-[#111] border-white/5 hover:border-[#D4AF37]/30"
      }`}
    >
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
            <h3 className={`font-bold text-base leading-tight mb-1 ${unavailable ? "text-gray-300" : "text-white"}`}>
              {product.name}
            </h3>
            {product.description && (
              <p className="text-gray-500 text-xs leading-snug line-clamp-2 mb-1">
                {product.description}
              </p>
            )}
            <p className={`font-semibold ${unavailable ? "text-gray-400" : "text-[#D4AF37]"}`}>
              {product.price} <span className="text-sm text-gray-400">EGP</span>
            </p>
            {unavailable && (
              <p className="mt-2 rounded-lg border border-gray-600 bg-gray-800/80 px-3 py-2 text-xs font-semibold text-gray-200">
                This product is currently not available.
              </p>
            )}
          </div>
          
          {!unavailable && (
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
          )}
        </div>
      </div>

      {canAddExtras && isExtrasOpen && (
        <div className="border-t border-white/10 bg-black/40 p-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#D4AF37]">
              Choose Extras
            </p>
            <p className="text-sm font-bold text-white">
              Total: <span className="text-[#D4AF37]">{totalWithExtras} EGP</span>
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-72 overflow-y-auto pr-1 no-scrollbar">
            {extras.map((extra) => {
              const checked = selectedExtraIds.includes(extra.id);
              return (
                <label
                  key={extra.id}
                  className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${
                    checked
                      ? "border-[#D4AF37]/70 bg-[#D4AF37]/15"
                      : "border-white/10 bg-white/5 hover:border-[#D4AF37]/50 hover:bg-[#D4AF37]/10"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleExtra(extra.id)}
                      className="h-4 w-4 accent-[#D4AF37]"
                    />
                    <span className="text-sm font-semibold text-white leading-snug">{extra.name}</span>
                  </span>
                  <span className="text-sm font-bold text-[#D4AF37] whitespace-nowrap">+{extra.price} EGP</span>
                </label>
              );
            })}
          </div>

          <div className="mt-3 flex flex-col sm:flex-row gap-2">
            <button
              type="button"
              onClick={() => {
                setSelectedExtraIds([]);
                setIsExtrasOpen(false);
              }}
              className="flex-1 rounded-lg bg-white/10 px-4 py-2 text-sm font-bold text-white hover:bg-white/20 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleAddWithExtras}
              disabled={selectedExtras.length === 0}
              className={`flex-1 rounded-lg px-4 py-2 text-sm font-bold transition-colors ${
                selectedExtras.length === 0
                  ? "bg-gray-700 text-gray-400 cursor-not-allowed"
                  : "bg-[#D4AF37] text-black hover:bg-[#F3D55B]"
              }`}
            >
              Add with Extras
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
