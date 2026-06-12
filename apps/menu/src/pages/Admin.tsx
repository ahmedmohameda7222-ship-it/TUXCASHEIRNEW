import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useMenu, ProductSection, SupabaseProduct } from "@/context/MenuContext";
import { Trash2, Edit2, Plus, Image as ImageIcon } from "lucide-react";

const PRODUCT_IMAGES_BUCKET = "product-images";
const REQUEST_TIMEOUT_MS = 30000;

type SupabaseErrorLike = {
  code?: string;
  details?: string;
  hint?: string;
  message?: string;
  status?: number;
  statusCode?: number | string;
};

const formatAdminError = (fallbackCode: string, fallbackMessage: string, err: unknown) => {
  if (err instanceof Error && /^\[[A-Z0-9-]+/.test(err.message)) {
    return err.message;
  }

  const error = err as SupabaseErrorLike;
  const status = error?.status ?? error?.statusCode;
  const codeParts = [fallbackCode];
  if (error?.code) codeParts.push(`Supabase ${error.code}`);
  if (status) codeParts.push(`HTTP ${status}`);

  const message =
    error?.message ||
    (err instanceof Error ? err.message : "") ||
    "No error message was returned.";
  const extra = [error?.details, error?.hint].filter(Boolean).join(" ");

  return `[${codeParts.join(" / ")}] ${fallbackMessage}: ${message}${extra ? ` ${extra}` : ""}`;
};

const withTimeout = <T,>(operation: PromiseLike<T>, timeoutMessage: string) =>
  new Promise<T>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, REQUEST_TIMEOUT_MS);

    Promise.resolve(operation)
      .then(resolve, reject)
      .finally(() => window.clearTimeout(timeoutId));
  });

const toSlug = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export default function Admin() {
  const { sections, products, refreshMenu } = useMenu();
  const [session, setSession] = useState<any>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"products" | "categories">("products");
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [editingCategory, setEditingCategory] = useState<ProductSection | null>(null);
  const [editingProduct, setEditingProduct] = useState<SupabaseProduct | null>(null);
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  const [productSaveError, setProductSaveError] = useState<string | null>(null);
  const [loadingAction, setLoadingAction] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);

  const sortedSections = useMemo(
    () => [...sections].sort((a, b) => a.sort_order - b.sort_order),
    [sections]
  );

  const groupedProducts = useMemo(
    () =>
      sortedSections.map((section) => ({
        section,
        products: products
          .filter((product) => product.section_id === section.id)
          .sort((a, b) => a.sort_order - b.sort_order),
      })),
    [sortedSections, products]
  );

  const uncategorizedProducts = useMemo(
    () =>
      products
        .filter((product) => !sections.some((section) => section.id === product.section_id))
        .sort((a, b) => a.sort_order - b.sort_order),
    [products, sections]
  );

  useEffect(() => {
    if (!supabase) return;

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  const showMessage = (text: string, type: "success" | "error") => {
    setMessage({ text, type });
    window.setTimeout(() => setMessage(null), 4000);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) {
      setAuthError("Supabase is not connected.");
      return;
    }

    setAuthLoading(true);
    setAuthError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setAuthError(error.message);
    setAuthLoading(false);
  };

  const handleLogout = async () => {
    if (supabase) await supabase.auth.signOut();
  };

  const openNewCategoryModal = () => {
    const id = `cat-${Date.now()}`;
    setEditingCategory({
      id,
      name: "",
      slug: id,
      sort_order: sections.length + 1,
      is_active: true,
    });
    setIsCategoryModalOpen(true);
  };

  const openNewProductModal = (sectionId = sortedSections[0]?.id || "") => {
    setImageFile(null);
    setProductSaveError(null);
    setEditingProduct({
      id: `prod-${Date.now()}`,
      section_id: sectionId,
      name: "",
      description: "",
      price: 0,
      image_url: "",
      image_path: undefined,
      is_best_seller: false,
      is_active: true,
      sort_order: products.filter((product) => product.section_id === sectionId).length + 1,
    });
    setIsProductModalOpen(true);
  };

  const saveCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || !editingCategory) return;

    setLoadingAction(true);
    try {
      const categoryToSave = {
        ...editingCategory,
        slug: editingCategory.slug || toSlug(editingCategory.name || editingCategory.id),
      };
      const isNew = !sections.some((section) => section.id === categoryToSave.id);

      if (isNew) {
        const { error } = await supabase.from("product_sections").insert([categoryToSave]);
        if (error) throw error;
        showMessage("Category added successfully.", "success");
      } else {
        const { error } = await supabase
          .from("product_sections")
          .update(categoryToSave)
          .eq("id", categoryToSave.id);
        if (error) throw error;
        showMessage("Category updated successfully.", "success");
      }

      setIsCategoryModalOpen(false);
      await refreshMenu();
    } catch (err: any) {
      showMessage(err.message || "Category save failed.", "error");
    } finally {
      setLoadingAction(false);
    }
  };

  const deleteCategory = async (id: string) => {
    if (!supabase || !window.confirm("Are you sure? This will delete all products in this category too.")) return;

    try {
      const { error } = await supabase.from("product_sections").delete().eq("id", id);
      if (error) throw error;
      showMessage("Category deleted.", "success");
      await refreshMenu();
    } catch (err: any) {
      showMessage(err.message || "Category delete failed.", "error");
    }
  };

  const saveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || !editingProduct) {
      const errorText = "[SAVE-001] Cannot save product: Supabase is not connected or no product is selected.";
      setProductSaveError(errorText);
      showMessage(errorText, "error");
      return;
    }

    setLoadingAction(true);
    setProductSaveError(null);

    try {
      let finalImageUrl = editingProduct.image_url;
      let finalImagePath = editingProduct.image_path;

      if (imageFile) {
        if (!imageFile.type.startsWith("image/")) {
          throw new Error("[UPLOAD-001] Image upload failed: Please choose a valid image file.");
        }

        const fileExt = imageFile.name.split(".").pop()?.toLowerCase() || "png";
        const fileName = `${Math.random().toString(36).substring(2, 15)}_${Date.now()}.${fileExt}`;
        const filePath = `products/${fileName}`;

        const { error: uploadError } = await withTimeout(
          supabase.storage.from(PRODUCT_IMAGES_BUCKET).upload(filePath, imageFile, {
            cacheControl: "3600",
            contentType: imageFile.type,
            upsert: true,
          }),
          `[UPLOAD-TIMEOUT] Image upload timed out after ${REQUEST_TIMEOUT_MS / 1000}s. Check the "${PRODUCT_IMAGES_BUCKET}" bucket and storage policies.`
        );

        if (uploadError) {
          throw new Error(
            formatAdminError(
              "UPLOAD-002",
              `Image upload failed in bucket "${PRODUCT_IMAGES_BUCKET}"`,
              uploadError
            )
          );
        }

        const { data: publicUrlData } = supabase.storage.from(PRODUCT_IMAGES_BUCKET).getPublicUrl(filePath);
        finalImageUrl = publicUrlData.publicUrl;
        finalImagePath = filePath;

        if (editingProduct.image_path && !editingProduct.image_path.startsWith("/src")) {
          await supabase.storage.from(PRODUCT_IMAGES_BUCKET).remove([editingProduct.image_path]);
        }
      }

      const productToSave = {
        id: editingProduct.id,
        section_id: editingProduct.section_id,
        name: editingProduct.name,
        description: editingProduct.description,
        price: editingProduct.price,
        image_url: finalImageUrl,
        image_path: finalImagePath || null,
        is_best_seller: editingProduct.is_best_seller,
        is_active: editingProduct.is_active,
        sort_order: editingProduct.sort_order,
      };

      if (!productToSave.section_id) {
        throw new Error("[PRODUCT-CATEGORY-001] Product save failed: choose a category before saving.");
      }

      const isNew = !products.some((product) => product.id === productToSave.id);

      if (isNew) {
        const { error } = await supabase.from("products").insert([productToSave]);
        if (error) throw new Error(formatAdminError("DB-INSERT-001", "Product insert failed", error));
        showMessage("Product added successfully.", "success");
      } else {
        const { error } = await supabase.from("products").update(productToSave).eq("id", productToSave.id);
        if (error) throw new Error(formatAdminError("DB-UPDATE-001", "Product update failed", error));
        showMessage("Product updated successfully.", "success");
      }

      setIsProductModalOpen(false);
      setImageFile(null);
      setProductSaveError(null);
      await refreshMenu();
    } catch (err: any) {
      const errorText = formatAdminError("SAVE-FAILED", "Product save failed", err);
      console.error("Product save failed:", err);
      setProductSaveError(errorText);
      showMessage(errorText, "error");
    } finally {
      setLoadingAction(false);
    }
  };

  const deleteProduct = async (id: string, imagePath?: string) => {
    if (!supabase || !window.confirm("Are you sure you want to delete this product?")) return;

    try {
      if (imagePath && !imagePath.startsWith("/src")) {
        await supabase.storage.from(PRODUCT_IMAGES_BUCKET).remove([imagePath]);
      }
      const { error } = await supabase.from("products").delete().eq("id", id);
      if (error) throw error;
      showMessage("Product deleted.", "success");
      await refreshMenu();
    } catch (err: any) {
      showMessage(err.message || "Product delete failed.", "error");
    }
  };

  if (!session) {
    return (
      <div className="min-h-screen bg-black pt-32 pb-20 flex items-center justify-center px-4">
        <div className="w-full max-w-md bg-[#111] p-8 rounded-2xl border border-white/10 shadow-2xl">
          <h2 className="text-3xl font-black text-[#D4AF37] mb-6 text-center">Admin Login</h2>
          {authError && (
            <div className="mb-4 p-3 bg-red-500/20 border border-red-500/50 text-red-500 rounded text-center text-sm font-semibold">
              {authError}
            </div>
          )}
          {!supabase ? (
            <div className="mb-4 p-3 bg-yellow-500/20 border border-yellow-500/50 text-yellow-500 rounded text-center text-sm font-semibold">
              Supabase Environment Variables are missing.
            </div>
          ) : (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="text-gray-400 text-sm mb-1 block">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-black border border-white/20 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-[#D4AF37]"
                  required
                />
              </div>
              <div>
                <label className="text-gray-400 text-sm mb-1 block">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-black border border-white/20 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-[#D4AF37]"
                  required
                />
              </div>
              <button
                type="submit"
                disabled={authLoading}
                className="w-full bg-[#D4AF37] text-black font-bold py-3 rounded-lg hover:bg-[#F3D55B] transition-colors disabled:opacity-50"
              >
                {authLoading ? "Logging in..." : "Login"}
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  const renderProductCard = (product: SupabaseProduct) => (
    <div key={product.id} className="bg-[#111] p-4 rounded-xl border border-white/10 flex flex-col md:flex-row items-center gap-4">
      <div className="w-20 h-20 bg-black rounded flex items-center justify-center p-2 flex-shrink-0">
        {product.image_url ? (
          <img src={product.image_url} alt={product.name} className="max-w-full max-h-full object-contain" />
        ) : (
          <ImageIcon className="text-gray-600" />
        )}
      </div>
      <div className="flex-1 text-center md:text-left">
        <h3 className="font-bold text-lg">{product.name}</h3>
        <p className="text-sm text-gray-400">{product.description}</p>
        <div className="flex flex-wrap gap-2 justify-center md:justify-start mt-2">
          <span className="text-xs bg-white/10 px-2 py-1 rounded text-[#D4AF37]">{product.price} EGP</span>
          <span className="text-xs bg-white/10 px-2 py-1 rounded">Order: {product.sort_order}</span>
          {product.is_best_seller && <span className="text-xs bg-yellow-500/20 text-yellow-500 px-2 py-1 rounded">Best Seller</span>}
          {!product.is_active && <span className="text-xs bg-red-500/20 text-red-500 px-2 py-1 rounded">Hidden</span>}
        </div>
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => {
            setImageFile(null);
            setProductSaveError(null);
            setEditingProduct(product);
            setIsProductModalOpen(true);
          }}
          className="p-3 bg-white/5 hover:bg-white/10 rounded-lg text-gray-300 hover:text-[#D4AF37] transition-colors"
        >
          <Edit2 className="w-5 h-5" />
        </button>
        <button
          onClick={() => deleteProduct(product.id, product.image_path)}
          className="p-3 bg-white/5 hover:bg-white/10 rounded-lg text-gray-300 hover:text-red-500 transition-colors"
        >
          <Trash2 className="w-5 h-5" />
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-black pt-24 pb-32 font-sans text-white relative">
      <div className="container mx-auto px-4 max-w-6xl">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
          <div>
            <h1 className="text-4xl font-black uppercase text-[#D4AF37]">Admin Panel</h1>
            <p className="text-gray-400 mt-1">Manage dynamic content on Supabase</p>
          </div>
          <button onClick={handleLogout} className="text-gray-400 hover:text-white transition-colors">
            Logout
          </button>
        </div>

        {message && (
          <div className={`mb-6 p-4 rounded-lg font-semibold text-center border ${message.type === "success" ? "bg-green-500/20 border-green-500/50 text-green-400" : "bg-red-500/20 border-red-500/50 text-red-400"}`}>
            {message.text}
          </div>
        )}

        <div className="flex gap-4 border-b border-white/10 mb-8">
          <button
            onClick={() => setActiveTab("products")}
            className={`pb-4 px-4 font-bold transition-colors ${activeTab === "products" ? "text-[#D4AF37] border-b-2 border-[#D4AF37]" : "text-gray-500 hover:text-white"}`}
          >
            Products
          </button>
          <button
            onClick={() => setActiveTab("categories")}
            className={`pb-4 px-4 font-bold transition-colors ${activeTab === "categories" ? "text-[#D4AF37] border-b-2 border-[#D4AF37]" : "text-gray-500 hover:text-white"}`}
          >
            Categories
          </button>
        </div>

        {activeTab === "categories" && (
          <div>
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold">Categories</h2>
              <button onClick={openNewCategoryModal} className="bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded font-bold flex items-center gap-2">
                <Plus className="w-4 h-4" /> Add Category
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {sortedSections.map((section) => (
                <div key={section.id} className="bg-[#111] p-5 rounded-xl border border-white/10 flex justify-between items-center">
                  <div>
                    <h3 className="font-bold text-lg flex items-center gap-2">
                      {section.name}
                      {!section.is_active && <span className="text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded">Hidden</span>}
                    </h3>
                    <p className="text-xs text-gray-500">ID: {section.id}</p>
                    <p className="text-xs text-gray-500">Order: {section.sort_order}</p>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => { setEditingCategory(section); setIsCategoryModalOpen(true); }} className="p-2 text-gray-400 hover:text-[#D4AF37]">
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button onClick={() => deleteCategory(section.id)} className="p-2 text-gray-400 hover:text-red-500">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === "products" && (
          <div>
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-3">
              <div>
                <h2 className="text-2xl font-bold">Products</h2>
                <p className="text-sm text-gray-500">Products are grouped by category. Active products appear in both Our Products and Order Now.</p>
              </div>
              <button onClick={() => openNewProductModal()} className="bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded font-bold flex items-center gap-2">
                <Plus className="w-4 h-4" /> Add Product
              </button>
            </div>

            <div className="space-y-8">
              {groupedProducts.map(({ section, products: sectionProducts }) => (
                <section key={section.id} className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 md:p-5">
                  <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3 mb-4 border-b border-white/10 pb-4">
                    <div>
                      <h3 className="text-xl font-black text-[#D4AF37] uppercase tracking-wide">{section.name}</h3>
                      <p className="text-xs text-gray-500">{sectionProducts.length} product{sectionProducts.length === 1 ? "" : "s"}</p>
                    </div>
                    <button onClick={() => openNewProductModal(section.id)} className="bg-[#D4AF37] hover:bg-[#F3D55B] text-black px-4 py-2 rounded font-bold flex items-center gap-2 w-fit">
                      <Plus className="w-4 h-4" /> Add to {section.name}
                    </button>
                  </div>

                  {sectionProducts.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-gray-500">
                      No products in this category yet.
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {sectionProducts.map(renderProductCard)}
                    </div>
                  )}
                </section>
              ))}

              {uncategorizedProducts.length > 0 && (
                <section className="rounded-2xl border border-red-500/30 bg-red-500/[0.04] p-4 md:p-5">
                  <h3 className="text-xl font-black text-red-400 uppercase tracking-wide mb-4">Uncategorized Products</h3>
                  <div className="space-y-4">{uncategorizedProducts.map(renderProductCard)}</div>
                </section>
              )}
            </div>
          </div>
        )}
      </div>

      {isCategoryModalOpen && editingCategory && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-[#111] p-6 rounded-2xl border border-white/10 w-full max-w-md">
            <h2 className="text-2xl font-bold mb-4">{sections.some((section) => section.id === editingCategory.id) ? "Edit Category" : "Add Category"}</h2>
            <form onSubmit={saveCategory} className="space-y-4">
              <div>
                <label className="text-sm text-gray-400">ID</label>
                <input required type="text" value={editingCategory.id} onChange={(e) => setEditingCategory({ ...editingCategory, id: toSlug(e.target.value), slug: toSlug(e.target.value) })} className="w-full bg-black border border-white/20 rounded px-3 py-2 mt-1" />
              </div>
              <div>
                <label className="text-sm text-gray-400">Name</label>
                <input required type="text" value={editingCategory.name} onChange={(e) => setEditingCategory({ ...editingCategory, name: e.target.value, slug: editingCategory.slug || toSlug(e.target.value) })} className="w-full bg-black border border-white/20 rounded px-3 py-2 mt-1" />
              </div>
              <div>
                <label className="text-sm text-gray-400">Slug</label>
                <input required type="text" value={editingCategory.slug} onChange={(e) => setEditingCategory({ ...editingCategory, slug: toSlug(e.target.value) })} className="w-full bg-black border border-white/20 rounded px-3 py-2 mt-1" />
              </div>
              <div>
                <label className="text-sm text-gray-400">Sort Order</label>
                <input required type="number" value={editingCategory.sort_order} onChange={(e) => setEditingCategory({ ...editingCategory, sort_order: Number(e.target.value) })} className="w-full bg-black border border-white/20 rounded px-3 py-2 mt-1" />
              </div>
              <div className="flex items-center gap-2 mt-4">
                <input type="checkbox" id="cat-active" checked={editingCategory.is_active} onChange={(e) => setEditingCategory({ ...editingCategory, is_active: e.target.checked })} className="w-4 h-4" />
                <label htmlFor="cat-active">Is Active</label>
              </div>
              <div className="flex gap-3 pt-4">
                <button type="button" onClick={() => setIsCategoryModalOpen(false)} className="flex-1 py-2 bg-white/10 rounded font-bold">Cancel</button>
                <button type="submit" disabled={loadingAction} className="flex-1 py-2 bg-[#D4AF37] text-black rounded font-bold disabled:opacity-50">{loadingAction ? "Saving..." : "Save"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isProductModalOpen && editingProduct && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-[#111] p-6 rounded-2xl border border-white/10 w-full max-w-xl max-h-[90vh] overflow-y-auto">
            <h2 className="text-2xl font-bold mb-4">{products.some((product) => product.id === editingProduct.id) ? "Edit Product" : "Add Product"}</h2>
            {productSaveError && (
              <div className="mb-4 rounded-lg border border-red-500/50 bg-red-500/15 p-3 text-sm font-semibold text-red-300 break-words">
                {productSaveError}
              </div>
            )}
            <form onSubmit={saveProduct} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm text-gray-400">ID / Slug</label>
                  <input required type="text" value={editingProduct.id} onChange={(e) => setEditingProduct({ ...editingProduct, id: toSlug(e.target.value) })} className="w-full bg-black border border-white/20 rounded px-3 py-2 mt-1" />
                </div>
                <div>
                  <label className="text-sm text-gray-400">Name</label>
                  <input required type="text" value={editingProduct.name} onChange={(e) => setEditingProduct({ ...editingProduct, name: e.target.value })} className="w-full bg-black border border-white/20 rounded px-3 py-2 mt-1" />
                </div>
                <div>
                  <label className="text-sm text-gray-400">Price (EGP)</label>
                  <input required type="number" value={editingProduct.price} onChange={(e) => setEditingProduct({ ...editingProduct, price: Number(e.target.value) })} className="w-full bg-black border border-white/20 rounded px-3 py-2 mt-1" />
                </div>
                <div>
                  <label className="text-sm text-gray-400">Category</label>
                  <select required value={editingProduct.section_id} onChange={(e) => setEditingProduct({ ...editingProduct, section_id: e.target.value })} className="w-full bg-black border border-white/20 rounded px-3 py-2 mt-1">
                    {sortedSections.map((section) => <option key={section.id} value={section.id}>{section.name}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="text-sm text-gray-400">Description</label>
                <textarea required value={editingProduct.description} onChange={(e) => setEditingProduct({ ...editingProduct, description: e.target.value })} className="w-full bg-black border border-white/20 rounded px-3 py-2 mt-1 h-20" />
              </div>

              <div>
                <label className="text-sm text-gray-400 block mb-1">Product Image</label>
                <div className="flex items-center gap-4">
                  {(imageFile || editingProduct.image_url) && (
                    <div className="w-16 h-16 bg-black rounded border border-white/10 flex items-center justify-center p-1 overflow-hidden">
                      <img src={imageFile ? URL.createObjectURL(imageFile) : editingProduct.image_url} alt="Preview" className="max-w-full max-h-full object-contain" />
                    </div>
                  )}
                  <input type="file" accept="image/*" onChange={(e) => { setImageFile(e.target.files?.[0] || null); setProductSaveError(null); }} className="flex-1 bg-black border border-white/20 rounded px-3 py-2 text-sm" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm text-gray-400">Sort Order</label>
                  <input required type="number" value={editingProduct.sort_order} onChange={(e) => setEditingProduct({ ...editingProduct, sort_order: Number(e.target.value) })} className="w-full bg-black border border-white/20 rounded px-3 py-2 mt-1" />
                </div>
              </div>

              <div className="flex flex-wrap gap-6 mt-4 p-4 bg-white/5 rounded-lg border border-white/10">
                <div className="flex items-center gap-2">
                  <input type="checkbox" id="prod-active" checked={editingProduct.is_active} onChange={(e) => setEditingProduct({ ...editingProduct, is_active: e.target.checked })} className="w-4 h-4" />
                  <label htmlFor="prod-active">Is Active</label>
                </div>
                <div className="flex items-center gap-2">
                  <input type="checkbox" id="prod-best" checked={editingProduct.is_best_seller} onChange={(e) => setEditingProduct({ ...editingProduct, is_best_seller: e.target.checked })} className="w-4 h-4" />
                  <label htmlFor="prod-best">Best Seller</label>
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <button type="button" onClick={() => setIsProductModalOpen(false)} className="flex-1 py-3 bg-white/10 hover:bg-white/20 rounded-lg font-bold transition-colors">Cancel</button>
                <button type="submit" disabled={loadingAction} className="flex-1 py-3 bg-[#D4AF37] hover:bg-[#F3D55B] text-black rounded-lg font-bold disabled:opacity-50 transition-colors">
                  {loadingAction ? "Saving & Uploading..." : "Save Product"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
