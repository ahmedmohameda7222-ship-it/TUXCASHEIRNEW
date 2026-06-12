import { ProductSection } from "@/context/MenuContext";
import { cn } from "@/lib/utils";

interface CategoryTabsProps {
  categories: ProductSection[];
  activeCategory: string;
  onSelectCategory: (categoryId: string) => void;
}

export function CategoryTabs({
  categories,
  activeCategory,
  onSelectCategory,
}: CategoryTabsProps) {
  return (
    <div className="sticky top-[64px] z-40 w-full bg-black/95 backdrop-blur-sm border-b border-white/10 shadow-lg">
      <div className="overflow-x-auto no-scrollbar flex items-center px-4 py-3 gap-2">
        {categories.map((category) => {
          const unavailable = !category.is_active;
          return (
            <button
              key={category.id}
              onClick={() => onSelectCategory(category.id)}
              className={cn(
                "whitespace-nowrap px-4 py-2 rounded-full text-sm font-semibold transition-all duration-300 border",
                activeCategory === category.id && !unavailable
                  ? "bg-[#D4AF37] text-black border-[#D4AF37] shadow-[0_0_15px_rgba(212,175,55,0.4)]"
                  : activeCategory === category.id && unavailable
                  ? "bg-gray-700 text-gray-200 border-gray-500"
                  : unavailable
                  ? "bg-gray-900/80 text-gray-500 border-gray-700 hover:bg-gray-800"
                  : "bg-white/5 text-gray-300 border-transparent hover:bg-white/10"
              )}
            >
              {category.name}
              {unavailable && <span className="ml-2 text-[10px] uppercase">Unavailable</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
