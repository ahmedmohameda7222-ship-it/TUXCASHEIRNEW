import { useState } from "react";
import { useCart } from "@/context/CartContext";
import { X, Plus, Minus, Trash2, ShoppingBag } from "lucide-react";
import { WHATSAPP_NUMBER } from "@/lib/constants";

export function CartDrawer() {
  const {
    items,
    isCartOpen,
    setIsCartOpen,
    updateQuantity,
    removeFromCart,
    clearCart,
    totalPrice,
  } = useCart();

  const [orderType, setOrderType] = useState<"Pick up" | "Delivery" | "">("");
  const [paymentMethod, setPaymentMethod] = useState<"Cash" | "InstaPay" | "Mixed" | "">("");
  const [cashAmount, setCashAmount] = useState<string>("");
  const [instaPayAmount, setInstaPayAmount] = useState<string>("");

  const cashValue = parseFloat(cashAmount) || 0;
  const instaPayValue = parseFloat(instaPayAmount) || 0;
  const mixedTotal = cashValue + instaPayValue;
  const isMixedValid = mixedTotal === totalPrice;
  const remainingMixed = totalPrice - mixedTotal;

  const handleCheckout = () => {
    if (items.length === 0) return;
    if (!orderType) {
      alert("Please select an order type.");
      return;
    }
    if (!paymentMethod) {
      alert("Please select a payment method.");
      return;
    }

    if (paymentMethod === "Mixed" && !isMixedValid) {
      alert("The cash amount and InstaPay amount must exactly equal the final total.");
      return;
    }

    let message = `Hi TUX Burger, I want to order:\n\n*Order:*\n`;
    
    items.forEach((item, index) => {
      message += `${index + 1}. ${item.quantity} x ${item.name} — ${item.price * item.quantity} EGP\n`;
    });

    message += `\n*Total:* ${totalPrice} EGP\n\n`;
    message += `*Order type:* ${orderType}\n`;
    message += `*Payment method:* ${paymentMethod}\n`;

    if (paymentMethod === "Mixed") {
      message += `*Cash amount:* ${cashValue} EGP\n`;
      message += `*InstaPay amount:* ${instaPayValue} EGP\n`;
    }

    const encodedMessage = encodeURIComponent(message);
    window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${encodedMessage}`, "_blank");
  };

  if (!isCartOpen) return null;

  return (
    <>
      <div 
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 transition-opacity"
        onClick={() => setIsCartOpen(false)}
      />
      <div 
        className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-[#111] shadow-2xl flex flex-col border-l border-white/10 sm:rounded-l-2xl sm:inset-y-auto sm:h-auto sm:bottom-0 sm:top-0 md:h-screen md:rounded-none animate-in slide-in-from-right duration-300"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <ShoppingBag className="w-5 h-5 text-[#D4AF37]" />
            Your Cart
          </h2>
          <button 
            onClick={() => setIsCartOpen(false)}
            className="p-2 text-gray-400 hover:text-white rounded-full hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Cart Items */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 no-scrollbar">
          {items.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-400 space-y-4">
              <ShoppingBag className="w-16 h-16 opacity-20" />
              <p>Your cart is empty.</p>
              <button 
                onClick={() => setIsCartOpen(false)}
                className="text-[#D4AF37] hover:underline"
              >
                Start Ordering
              </button>
            </div>
          ) : (
            <>
              {items.map((item) => (
                <div key={item.id} className="flex gap-4 bg-black/40 p-3 rounded-xl border border-white/5">
                  <div className="w-16 h-16 bg-black rounded-lg flex items-center justify-center flex-shrink-0">
                    <img src={item.image_url} alt={item.name} className="w-full h-full object-contain p-1" />
                  </div>
                  <div className="flex-1 flex flex-col justify-between">
                    <div className="flex justify-between items-start">
                      <h4 className="text-white font-semibold text-sm line-clamp-2">{item.name}</h4>
                      <button 
                        onClick={() => removeFromCart(item.id)}
                        className="text-gray-500 hover:text-red-500 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="flex justify-between items-center mt-2">
                      <p className="text-[#D4AF37] font-bold text-sm">
                        {item.price * item.quantity} EGP
                      </p>
                      <div className="flex items-center gap-2 bg-white/10 rounded-full px-1 py-1">
                        <button
                          onClick={() => updateQuantity(item.id, item.quantity - 1)}
                          className="w-6 h-6 rounded-full bg-black flex items-center justify-center text-white"
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="text-white text-xs font-bold w-4 text-center">
                          {item.quantity}
                        </span>
                        <button
                          onClick={() => updateQuantity(item.id, item.quantity + 1)}
                          className="w-6 h-6 rounded-full bg-black flex items-center justify-center text-white"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>

        {/* Checkout Options */}
        {items.length > 0 && (
          <div className="p-4 border-t border-white/10 bg-black/50 space-y-4">
            <div className="space-y-2">
              <label className="text-sm text-gray-400 font-semibold">Order Type</label>
              <div className="flex gap-2">
                {["Pick up", "Delivery"].map((type) => (
                  <button
                    key={type}
                    onClick={() => setOrderType(type as "Pick up" | "Delivery")}
                    className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${
                      orderType === type
                        ? "bg-[#D4AF37] text-black"
                        : "bg-white/10 text-white border border-white/5"
                    }`}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm text-gray-400 font-semibold">Payment Method</label>
              <div className="flex gap-2">
                {["Cash", "InstaPay", "Mixed"].map((method) => (
                  <button
                    key={method}
                    onClick={() => setPaymentMethod(method as "Cash" | "InstaPay" | "Mixed")}
                    className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${
                      paymentMethod === method
                        ? "bg-[#D4AF37] text-black"
                        : "bg-white/10 text-white border border-white/5"
                    }`}
                  >
                    {method}
                  </button>
                ))}
              </div>
            </div>

            {paymentMethod === "Mixed" && (
              <div className="bg-white/5 p-3 rounded-lg space-y-3 border border-white/10 animate-in fade-in zoom-in duration-200">
                <div className="flex gap-3">
                  <div className="flex-1 space-y-1">
                    <label className="text-xs text-gray-400">Cash Amount</label>
                    <input 
                      type="number"
                      inputMode="numeric"
                      min="0"
                      value={cashAmount}
                      onChange={(e) => setCashAmount(e.target.value)}
                      className="w-full bg-black border border-white/20 rounded px-2 py-1.5 text-white text-sm focus:outline-none focus:border-[#D4AF37]"
                      placeholder="0"
                    />
                  </div>
                  <div className="flex-1 space-y-1">
                    <label className="text-xs text-gray-400">InstaPay Amount</label>
                    <input 
                      type="number"
                      inputMode="numeric"
                      min="0"
                      value={instaPayAmount}
                      onChange={(e) => setInstaPayAmount(e.target.value)}
                      className="w-full bg-black border border-white/20 rounded px-2 py-1.5 text-white text-sm focus:outline-none focus:border-[#D4AF37]"
                      placeholder="0"
                    />
                  </div>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-gray-400">Remaining:</span>
                  <span className={`font-bold ${remainingMixed === 0 ? "text-green-500" : remainingMixed < 0 ? "text-red-500" : "text-[#D4AF37]"}`}>
                    {remainingMixed} EGP
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Footer / Checkout Button */}
        {items.length > 0 && (
          <div className="p-4 bg-[#111] border-t border-white/10">
            <div className="flex justify-between items-center mb-4 text-white">
              <span className="font-bold text-gray-400">Total</span>
              <span className="text-xl font-bold text-[#D4AF37]">{totalPrice} EGP</span>
            </div>
            <button
              onClick={handleCheckout}
              disabled={paymentMethod === "Mixed" && !isMixedValid}
              className={`w-full py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-2 transition-all ${
                (paymentMethod === "Mixed" && !isMixedValid)
                  ? "bg-gray-700 text-gray-400 cursor-not-allowed"
                  : "bg-[#25D366] hover:bg-[#1EBE5D] text-white shadow-[0_0_15px_rgba(37,211,102,0.3)]"
              }`}
            >
              Order on WhatsApp
            </button>
            <button 
              onClick={clearCart}
              className="w-full mt-3 py-2 text-sm text-gray-500 hover:text-white transition-colors"
            >
              Clear Cart
            </button>
          </div>
        )}
      </div>
    </>
  );
}
