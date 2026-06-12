import { useState, useEffect } from "react";
import { PRODUCTS, Category } from "@/lib/menu-data";

// Fallback logic for admin using local state since Supabase isn't connected yet.
// In a real app, this would fetch from and save to Supabase.
export default function Admin() {
  const [products, setProducts] = useState(PRODUCTS);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (password === "tuxadmin123") {
      setIsLoggedIn(true);
    } else {
      setMessage({ text: "Invalid password", type: "error" });
    }
  };

  const handlePriceChange = (id: string, newPrice: number) => {
    setProducts((prev) =>
      prev.map((p) => (p.id === id ? { ...p, price: newPrice } : p))
    );
  };

  const handleBestSellerToggle = (id: string) => {
    setProducts((prev) =>
      prev.map((p) => (p.id === id ? { ...p, is_best_seller: !p.is_best_seller } : p))
    );
  };

  const handleSave = () => {
    // Here we would sync with Supabase
    // For now, it's just local UI state since it's a fallback
    setMessage({ text: "Changes saved successfully! (Local fallback only)", type: "success" });
    setTimeout(() => setMessage(null), 3000);
  };

  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-black pt-32 pb-20 flex items-center justify-center px-4">
        <div className="w-full max-w-md bg-[#111] p-8 rounded-2xl border border-white/10 shadow-2xl">
          <h2 className="text-3xl font-black text-[#D4AF37] mb-6 text-center">Admin Login</h2>
          {message && (
            <div className="mb-4 p-3 bg-red-500/20 border border-red-500/50 text-red-500 rounded text-center text-sm font-semibold">
              {message.text}
            </div>
          )}
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="text-gray-400 text-sm mb-1 block">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-black border border-white/20 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-[#D4AF37]"
                placeholder="Enter admin password..."
              />
            </div>
            <button
              type="submit"
              className="w-full bg-[#D4AF37] text-black font-bold py-3 rounded-lg hover:bg-[#F3D55B] transition-colors"
            >
              Login
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black pt-24 pb-32 font-sans text-white">
      <div className="container mx-auto px-4 max-w-5xl">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-10 gap-4">
          <div>
            <h1 className="text-4xl font-black uppercase text-[#D4AF37]">Admin Panel</h1>
            <p className="text-gray-400 mt-2">Manage products, prices, and best sellers.</p>
          </div>
          <button
            onClick={handleSave}
            className="bg-[#25D366] text-white px-6 py-3 rounded-lg font-bold shadow-[0_0_15px_rgba(37,211,102,0.3)] hover:bg-[#1EBE5D] transition-all"
          >
            Save Changes
          </button>
        </div>

        {message && (
          <div className={`mb-6 p-4 rounded-lg font-semibold text-center border ${
            message.type === "success" 
              ? "bg-green-500/20 border-green-500/50 text-green-400" 
              : "bg-red-500/20 border-red-500/50 text-red-400"
          }`}>
            {message.text}
          </div>
        )}

        <div className="space-y-6">
          {products.map((product) => (
            <div key={product.id} className="bg-[#111] border border-white/10 rounded-xl p-4 flex flex-col sm:flex-row items-center gap-4">
              <div className="w-20 h-20 bg-black rounded flex items-center justify-center p-2 flex-shrink-0">
                <img src={product.image_url} alt={product.name} className="max-w-full max-h-full object-contain" />
              </div>
              
              <div className="flex-1 text-center sm:text-left">
                <h3 className="font-bold text-lg">{product.name}</h3>
                <p className="text-xs text-gray-500 uppercase tracking-widest">{product.category_id}</p>
              </div>

              <div className="flex flex-col sm:flex-row items-center gap-4 w-full sm:w-auto">
                <div className="flex items-center gap-2">
                  <label className="text-sm text-gray-400 whitespace-nowrap">Price (EGP)</label>
                  <input
                    type="number"
                    value={product.price}
                    onChange={(e) => handlePriceChange(product.id, parseFloat(e.target.value) || 0)}
                    className="w-24 bg-black border border-white/20 rounded px-3 py-2 text-center text-white focus:outline-none focus:border-[#D4AF37]"
                  />
                </div>

                <button
                  onClick={() => handleBestSellerToggle(product.id)}
                  className={`px-4 py-2 rounded font-bold text-sm transition-all whitespace-nowrap w-full sm:w-auto ${
                    product.is_best_seller 
                      ? "bg-[#D4AF37] text-black" 
                      : "bg-white/10 text-gray-400 hover:bg-white/20"
                  }`}
                >
                  {product.is_best_seller ? "★ Best Seller" : "Set Best Seller"}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
