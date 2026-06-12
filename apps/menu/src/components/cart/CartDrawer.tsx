import { useState } from "react";
import { useCart } from "@/context/CartContext";
import { X, Plus, Minus, Trash2, ShoppingBag } from "lucide-react";
import { WHATSAPP_NUMBER } from "@/lib/constants";

const DELIVERY_MIXED_PAYMENT_MESSAGE =
  "Because this is a delivery order, the delivery fee has not been calculated yet. After you place the order, we will contact you to confirm the delivery fee and arrange the mixed payment details.";

type OrderType = "Pick up" | "Delivery" | "";
type PaymentMethod = "Cash" | "InstaPay" | "Mixed Payment" | "";

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

  const [orderType, setOrderType] = useState<OrderType>("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("");
  const [customerName, setCustomerName] = useState<string>("");
  const [deliveryAddress, setDeliveryAddress] = useState<string>("");
  const [cashAmount, setCashAmount] = useState<string>("");
  const [instaPayAmount, setInstaPayAmount] = useState<string>("");

  const isDeliveryMixedPayment = orderType === "Delivery" && paymentMethod === "Mixed Payment";
  const cashValue = parseFloat(cashAmount) || 0;
  const instaPayValue = parseFloat(instaPayAmount) || 0;
  const mixedTotal = cashValue + instaPayValue;
  const isMixedValid = Math.abs(mixedTotal - totalPrice) < 0.01;
  const remainingMixed = totalPrice - mixedTotal;
  const isCustomerNameMissing = !customerName.trim();

  const isCheckoutDisabled =
    items.length === 0 ||
    isCustomerNameMissing ||
    !orderType ||
    !paymentMethod ||
    (paymentMethod === "Mixed Payment" && !isDeliveryMixedPayment && !isMixedValid) ||
    (orderType === "Delivery" && !deliveryAddress.trim());

  const handleCheckout = () => {
    if (items.length === 0) return;
    if (!customerName.trim()) {
      alert("Please enter your name.");
      return;
    }
    if (!orderType) {
      alert("Please select an order type.");
      return;
    }
    if (orderType === "Delivery" && !deliveryAddress.trim()) {
      alert("Please enter your delivery address.");
      return;
    }
    if (!paymentMethod) {
      alert("Please select a payment method.");
      return;
    }
    if (paymentMethod === "Mixed Payment" && !isDeliveryMixedPayment && !isMixedValid) {
      alert("The cash amount and InstaPay amount must exactly equal the final total.");
      return;
    }

    // Build clean WhatsApp message (no per-item prices)
    let message = `Hello TUX Burger, I want to place an order.\n\n`;
    message += `*Order Type:* ${orderType}\n`;
    message += `*Name:* ${customerName.trim()}\n`;
    if (orderType === "Delivery" && deliveryAddress.trim()) {
      message += `*Address:* ${deliveryAddress.trim()}\n`;
    }
    message += `\n*Order:*\n`;

    items.forEach((item) => {
      message += `• ${item.quantity}x ${item.name}\n`;
    });

    message += `\n*Payment Method:* ${paymentMethod}`;
    if (paymentMethod === "Mixed Payment" && !isDeliveryMixedPayment) {
      message += ` (Cash: ${cashValue} EGP + InstaPay: ${instaPayValue} EGP)`;
    }
    if (isDeliveryMixedPayment) {
      message += `\n*Note:* Delivery fee and mixed payment details will be confirmed by phone after ordering.`;
    }
    message += `\n\n*Total: ${totalPrice} EGP*`;

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
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-[#111] shadow-2xl flex flex-col border-l border-white/10 sm:rounded-l-2xl animate-in slide-in-from-right duration-300">

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
                    {item.image_url ? (
                      <img src={item.image_url} alt={item.name} className="w-full h-full object-contain p-1" />
                    ) : (
                      <ShoppingBag className="w-6 h-6 text-gray-600" />
                    )}
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
          <div className="p-4 border-t border-white/10 bg-black/50 space-y-4 overflow-y-auto max-h-[55vh] no-scrollbar">

            {/* Customer Name */}
            <div className="space-y-1">
              <label className="text-sm text-gray-400 font-semibold">
                Your Name <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="e.g. Ahmed"
                aria-required="true"
                className="w-full bg-black border border-white/20 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-[#D4AF37]"
              />
              {isCustomerNameMissing && (
                <p className="text-xs font-semibold text-red-400">Name is required.</p>
              )}
            </div>

            {/* Order Type */}
            <div className="space-y-2">
              <label className="text-sm text-gray-400 font-semibold">Order Type</label>
              <div className="flex gap-2">
                {(["Pick up", "Delivery"] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setOrderType(type)}
                    className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${
                      orderType === type
                        ? "bg-[#D4AF37] text-black"
                        : "bg-white/10 text-white border border-white/5 hover:bg-white/20"
                    }`}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>

            {/* Delivery Address (only if Delivery) */}
            {orderType === "Delivery" && (
              <div className="space-y-1">
                <label className="text-sm text-gray-400 font-semibold">
                  Delivery Address <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={deliveryAddress}
                  onChange={(e) => setDeliveryAddress(e.target.value)}
                  placeholder="Enter your full address"
                  className="w-full bg-black border border-white/20 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-[#D4AF37]"
                />
              </div>
            )}

            {/* Payment Method */}
            <div className="space-y-2">
              <label className="text-sm text-gray-400 font-semibold">Payment Method</label>
              <div className="flex gap-2">
                {(["Cash", "InstaPay", "Mixed Payment"] as const).map((method) => (
                  <button
                    key={method}
                    type="button"
                    onClick={() => setPaymentMethod(method)}
                    className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${
                      paymentMethod === method
                        ? "bg-[#D4AF37] text-black"
                        : "bg-white/10 text-white border border-white/5 hover:bg-white/20"
                    }`}
                  >
                    {method}
                  </button>
                ))}
              </div>
            </div>

            {/* Delivery Mixed Payment Info */}
            {isDeliveryMixedPayment && (
              <div className="rounded-lg border border-[#D4AF37]/40 bg-[#D4AF37]/10 p-3 text-sm leading-relaxed text-[#F5EDD8]">
                <p className="font-bold text-[#D4AF37] mb-1">Mixed Payment for Delivery</p>
                <p>{DELIVERY_MIXED_PAYMENT_MESSAGE}</p>
              </div>
            )}

            {/* Mixed Payment Breakdown */}
            {paymentMethod === "Mixed Payment" && !isDeliveryMixedPayment && (
              <div className="bg-white/5 p-3 rounded-lg space-y-3 border border-white/10">
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
                    {remainingMixed.toFixed(0)} EGP
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        {items.length > 0 && (
          <div className="p-4 bg-[#111] border-t border-white/10">
            <div className="flex justify-between items-center mb-4 text-white">
              <span className="font-bold text-gray-400">Total</span>
              <span className="text-xl font-bold text-[#D4AF37]">{totalPrice} EGP</span>
            </div>
            <button
              onClick={handleCheckout}
              disabled={isCheckoutDisabled}
              className={`w-full py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-2 transition-all ${
                isCheckoutDisabled
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
