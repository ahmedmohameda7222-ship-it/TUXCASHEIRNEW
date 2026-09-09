import { useState } from 'react';
import { useLocation } from 'wouter';
import type { OnlineOrderRequestV1 } from '@tux/order-intake-contracts';
import { useCart } from '@/context/CartContext';
import { useMenu } from '@/context/MenuContext';
import { X, Plus, Minus, Trash2, ShoppingBag } from 'lucide-react';
import { WHATSAPP_NUMBER } from '@/lib/constants';
import {
  clearPendingCheckoutAttempt,
  loadPendingCheckoutAttempt,
  persistPendingCheckoutAttempt,
  type PendingCheckoutAttempt,
} from '@/lib/checkout-attempt';
import { configuredOrderShopId, submitOnlineOrder } from '@/lib/order-intake';

const DELIVERY_FEE_MESSAGE =
  'Delivery fee is not included in this total. After you place the order, we will contact you to confirm the delivery fee.';

const DELIVERY_MIXED_PAYMENT_MESSAGE =
  'Because this is a delivery order, the delivery fee has not been calculated yet. After you place the order, we will contact you to confirm the delivery fee and arrange the mixed payment details.';

type OrderType = 'Pick up' | 'Delivery' | '';
type PaymentMethod = 'Cash' | 'InstaPay' | 'Mixed Payment' | '';
type SubmissionStatus = 'idle' | 'submitting' | 'success' | 'error';
type OrderIntent = Omit<OnlineOrderRequestV1, 'idempotencyKey'>;

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
  const { comboBeveragesByProduct, products } = useMenu();
  const [, navigate] = useLocation();

  const [orderType, setOrderType] = useState<OrderType>('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('');
  const [customerName, setCustomerName] = useState<string>('');
  const [customerPhone, setCustomerPhone] = useState<string>('');
  const [deliveryAddress, setDeliveryAddress] = useState<string>('');
  const [submissionStatus, setSubmissionStatus] = useState<SubmissionStatus>('idle');
  const [pendingAttempt, setPendingAttempt] = useState<PendingCheckoutAttempt | null>(() =>
    loadPendingCheckoutAttempt(),
  );
  const [pendingRequestId, setPendingRequestId] = useState<string | null>(null);
  const [comboBeverageSelections, setComboBeverageSelections] = useState<Record<string, string>>(
    {},
  );

  const isDelivery = orderType === 'Delivery';
  const isDeliveryMixedPayment = isDelivery && paymentMethod === 'Mixed Payment';
  const displayTotal = isDelivery ? `${totalPrice} EGP + Delivery Fee` : `${totalPrice} EGP`;
  const isCustomerNameMissing = !customerName.trim();

  const isCheckoutDisabled =
    submissionStatus === 'submitting' ||
    items.length === 0 ||
    isCustomerNameMissing ||
    !orderType ||
    !paymentMethod ||
    (isDelivery && (!customerPhone.trim() || !deliveryAddress.trim()));

  const handleStartOrdering = () => {
    setSubmissionStatus('idle');
    setPendingRequestId(null);
    setIsCartOpen(false);
    navigate('/order-now');
  };

  const buildOrderIntent = (): OrderIntent => {
    if (!orderType || !paymentMethod) {
      throw new Error('order_intent_incomplete');
    }

    const paymentPreference =
      paymentMethod === 'Cash' ? 'CASH' : paymentMethod === 'InstaPay' ? 'INSTAPAY' : 'MIXED';

    return {
      schemaVersion: 1,
      shopId: configuredOrderShopId(),
      customer: {
        name: customerName.trim(),
        phone: isDelivery ? customerPhone.trim() : null,
        address: isDelivery ? deliveryAddress.trim() : null,
      },
      fulfillmentPreference: isDelivery ? 'DELIVERY' : 'PICKUP',
      paymentPreference,
      items: items.map((item) => ({
        productId: item.baseProductId ?? item.id,
        quantity: item.quantity,
        addonProductIds: item.extras?.map((extra) => extra.id) ?? [],
        modifierSelections: [],
        comboBeverageProductId: comboBeverageSelections[item.id] ?? null,
        note: null,
      })),
      orderNote: null,
    };
  };

  const handleCheckout = async () => {
    if (items.length === 0 || submissionStatus === 'submitting') return;
    if (!customerName.trim()) {
      alert('Please enter your name.');
      return;
    }
    if (!orderType) {
      alert('Please select an order type.');
      return;
    }
    if (isDelivery && !customerPhone.trim()) {
      alert('Please enter your phone number.');
      return;
    }
    if (isDelivery && !deliveryAddress.trim()) {
      alert('Please enter your delivery address.');
      return;
    }
    if (!paymentMethod) {
      alert('Please select a payment method.');
      return;
    }
    const unavailablePersistedCombo = items.some((item) => {
      const productId = item.baseProductId ?? item.id;
      const currentProduct = products.find((product) => product.id === productId);
      const options = comboBeveragesByProduct[productId] ?? [];
      return (
        currentProduct?.is_combo === true && (!currentProduct.is_active || options.length === 0)
      );
    });
    if (unavailablePersistedCombo) {
      alert('A combo in your cart is no longer available. Please remove it and choose it again.');
      return;
    }
    const comboSelectionMissing = items.some((item) => {
      const productId = item.baseProductId ?? item.id;
      const currentProduct = products.find((product) => product.id === productId);
      const options = comboBeveragesByProduct[productId] ?? [];
      const selected = comboBeverageSelections[item.id];
      return (
        currentProduct?.is_combo === true &&
        (selected === undefined || !options.some((option) => option.id === selected))
      );
    });
    if (comboSelectionMissing) {
      alert('Please select a beverage for every combo.');
      return;
    }

    try {
      const intent = buildOrderIntent();
      const fingerprint = JSON.stringify(intent);
      const attempt =
        pendingAttempt?.fingerprint === fingerprint
          ? pendingAttempt
          : {
              fingerprint,
              idempotencyKey: crypto.randomUUID(),
            };

      persistPendingCheckoutAttempt(attempt);
      if (attempt !== pendingAttempt) {
        setPendingAttempt(attempt);
      }

      setSubmissionStatus('submitting');
      const response = await submitOnlineOrder({
        ...intent,
        idempotencyKey: attempt.idempotencyKey,
      });

      setPendingRequestId(response.requestId);
      setSubmissionStatus('success');
      clearCart();
      clearPendingCheckoutAttempt();
      setPendingAttempt(null);
    } catch {
      setSubmissionStatus('error');
    }
  };

  const handleClearCart = () => {
    clearCart();
    clearPendingCheckoutAttempt();
    setPendingAttempt(null);
    setSubmissionStatus('idle');
    setPendingRequestId(null);
  };

  const handleWhatsAppContinuation = () => {
    if (!pendingRequestId) return;
    const message = encodeURIComponent(
      `Hello TUX Burger, I placed online order request ${pendingRequestId} and would like to continue on WhatsApp.`,
    );
    window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${message}`, '_blank');
  };

  if (!isCartOpen) return null;

  return (
    <>
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 transition-opacity"
        onClick={() => setIsCartOpen(false)}
      />
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-[#111] shadow-2xl flex flex-col border-l border-white/10 sm:rounded-l-2xl animate-in slide-in-from-right duration-300">
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

        <div className="flex-1 overflow-y-auto p-4 space-y-4 no-scrollbar">
          {submissionStatus === 'success' ? (
            <div className="h-full flex flex-col items-center justify-center text-center space-y-4 px-4">
              <div className="w-16 h-16 rounded-full bg-[#D4AF37]/15 flex items-center justify-center">
                <ShoppingBag className="w-8 h-8 text-[#D4AF37]" />
              </div>
              <div>
                <h3 className="text-2xl font-black text-white">Order received</h3>
                <p className="mt-2 text-sm leading-relaxed text-gray-300">
                  Your order is pending confirmation. TUX will confirm the final order details
                  before it is processed.
                </p>
              </div>
              {pendingRequestId && (
                <p className="text-xs text-gray-500 break-all">Request: {pendingRequestId}</p>
              )}
              <button
                type="button"
                onClick={handleWhatsAppContinuation}
                className="w-full rounded-xl bg-[#25D366] px-4 py-3 font-bold text-white hover:bg-[#1EBE5D] transition-colors"
              >
                Continue on WhatsApp
              </button>
              <button
                type="button"
                onClick={handleStartOrdering}
                className="text-[#D4AF37] hover:underline"
              >
                Start another order
              </button>
            </div>
          ) : items.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-400 space-y-4">
              <ShoppingBag className="w-16 h-16 opacity-20" />
              <p>Your cart is empty.</p>
              <button onClick={handleStartOrdering} className="text-[#D4AF37] hover:underline">
                Start Ordering
              </button>
            </div>
          ) : (
            <>
              {items.map((item) => (
                <div
                  key={item.id}
                  className="flex gap-4 bg-black/40 p-3 rounded-xl border border-white/5"
                >
                  <div className="w-16 h-16 bg-black rounded-lg flex items-center justify-center flex-shrink-0">
                    {item.image_url ? (
                      <img
                        src={item.image_url}
                        alt={item.name}
                        className="w-full h-full object-contain p-1"
                      />
                    ) : (
                      <ShoppingBag className="w-6 h-6 text-gray-600" />
                    )}
                  </div>
                  <div className="flex-1 flex flex-col justify-between">
                    <div className="flex justify-between items-start gap-3">
                      <div>
                        <h4 className="text-white font-semibold text-sm line-clamp-2">
                          {item.baseProductName || item.name}
                        </h4>
                        {(comboBeveragesByProduct[item.baseProductId ?? item.id] ?? []).length >
                          0 && (
                          <label className="mt-2 block text-xs text-gray-300">
                            Combo beverage
                            <select
                              aria-label={`${item.baseProductName || item.name} beverage`}
                              value={comboBeverageSelections[item.id] ?? ''}
                              onChange={(event) =>
                                setComboBeverageSelections((current) => ({
                                  ...current,
                                  [item.id]: event.target.value,
                                }))
                              }
                              className="mt-1 w-full rounded-lg border border-white/20 bg-black px-2 py-1 text-xs text-white"
                            >
                              <option value="">Select beverage</option>
                              {(comboBeveragesByProduct[item.baseProductId ?? item.id] ?? []).map(
                                (beverage) => (
                                  <option key={beverage.id} value={beverage.id}>
                                    {beverage.name}
                                  </option>
                                ),
                              )}
                            </select>
                          </label>
                        )}
                        {item.extras && item.extras.length > 0 && (
                          <p className="mt-1 text-xs leading-relaxed text-gray-400">
                            Extras:{' '}
                            <span className="text-[#D4AF37]">
                              {item.extras.map((extra) => extra.name).join(', ')}
                            </span>
                          </p>
                        )}
                      </div>
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

        {items.length > 0 && submissionStatus !== 'success' && (
          <div className="p-4 border-t border-white/10 bg-black/50 space-y-4 overflow-y-auto max-h-[55vh] no-scrollbar">
            <div className="space-y-1">
              <label className="text-sm text-gray-400 font-semibold">
                Your Name <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={customerName}
                onChange={(event) => setCustomerName(event.target.value)}
                placeholder="e.g. Ahmed"
                aria-required="true"
                className="w-full bg-black border border-white/20 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-[#D4AF37]"
              />
              {isCustomerNameMissing && (
                <p className="text-xs font-semibold text-red-400">Name is required.</p>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-sm text-gray-400 font-semibold">Order Type</label>
              <div className="flex gap-2">
                {(['Pick up', 'Delivery'] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setOrderType(type)}
                    className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${
                      orderType === type
                        ? 'bg-[#D4AF37] text-black'
                        : 'bg-white/10 text-white border border-white/5 hover:bg-white/20'
                    }`}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>

            {isDelivery && (
              <>
                <div className="space-y-1">
                  <label className="text-sm text-gray-400 font-semibold">
                    Phone Number <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="tel"
                    value={customerPhone}
                    onChange={(event) => setCustomerPhone(event.target.value)}
                    placeholder="e.g. 01001234567"
                    aria-required="true"
                    className="w-full bg-black border border-white/20 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-[#D4AF37]"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-sm text-gray-400 font-semibold">
                    Delivery Address <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={deliveryAddress}
                    onChange={(event) => setDeliveryAddress(event.target.value)}
                    placeholder="Enter your full address"
                    aria-required="true"
                    className="w-full bg-black border border-white/20 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-[#D4AF37]"
                  />
                </div>
              </>
            )}

            <div className="space-y-2">
              <label className="text-sm text-gray-400 font-semibold">Payment Method</label>
              <div className="flex gap-2">
                {(['Cash', 'InstaPay', 'Mixed Payment'] as const).map((method) => (
                  <button
                    key={method}
                    type="button"
                    onClick={() => setPaymentMethod(method)}
                    className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${
                      paymentMethod === method
                        ? 'bg-[#D4AF37] text-black'
                        : 'bg-white/10 text-white border border-white/5 hover:bg-white/20'
                    }`}
                  >
                    {method}
                  </button>
                ))}
              </div>
            </div>

            {isDelivery && !isDeliveryMixedPayment && (
              <div className="rounded-lg border border-[#D4AF37]/40 bg-[#D4AF37]/10 p-3 text-sm leading-relaxed text-[#F5EDD8]">
                <p className="font-bold text-[#D4AF37] mb-1">Delivery Fee</p>
                <p>{DELIVERY_FEE_MESSAGE}</p>
              </div>
            )}

            {isDeliveryMixedPayment && (
              <div className="rounded-lg border border-[#D4AF37]/40 bg-[#D4AF37]/10 p-3 text-sm leading-relaxed text-[#F5EDD8]">
                <p className="font-bold text-[#D4AF37] mb-1">Mixed Payment for Delivery</p>
                <p>{DELIVERY_MIXED_PAYMENT_MESSAGE}</p>
              </div>
            )}

            {submissionStatus === 'error' && (
              <div
                role="alert"
                className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm font-semibold text-red-300"
              >
                We could not place your order. Please try again.
              </div>
            )}
          </div>
        )}

        {items.length > 0 && submissionStatus !== 'success' && (
          <div className="p-4 bg-[#111] border-t border-white/10">
            <div className="flex justify-between items-center mb-2 text-white">
              <span className="font-bold text-gray-400">Total</span>
              <span className="text-xl font-bold text-[#D4AF37]">{displayTotal}</span>
            </div>
            {isDelivery && (
              <p className="mb-4 text-xs leading-relaxed text-[#F5EDD8]/80">
                Delivery fee will be confirmed after placing the order.
              </p>
            )}
            {!isDelivery && <div className="mb-4" />}
            <button
              onClick={() => void handleCheckout()}
              disabled={isCheckoutDisabled}
              className={`w-full py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-2 transition-all ${
                isCheckoutDisabled
                  ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                  : 'bg-[#D4AF37] hover:bg-[#F3D55B] text-black shadow-[0_0_15px_rgba(212,175,55,0.22)]'
              }`}
            >
              {submissionStatus === 'submitting' ? 'Placing Order…' : 'Place Order'}
            </button>
            <button
              onClick={handleClearCart}
              disabled={submissionStatus === 'submitting'}
              className="w-full mt-3 py-2 text-sm text-gray-500 hover:text-white transition-colors disabled:opacity-50"
            >
              Clear Cart
            </button>
          </div>
        )}
      </div>
    </>
  );
}
