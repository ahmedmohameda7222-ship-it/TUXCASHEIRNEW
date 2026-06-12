import { Category } from "@/lib/menu-data";
import { cn } from "@/lib/utils";

interface CategoryTabsProps {
  categories: Category[];
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
        {categories.map((category) => (
          <button
            key={category.id}
            onClick={() => onSelectCategory(category.id)}
            className={cn(
              "whitespace-nowrap px-4 py-2 rounded-full text-sm font-semibold transition-all duration-300",
              activeCategory === category.id
                ? "bg-[#D4AF37] text-black shadow-[0_0_15px_rgba(212,175,55,0.4)]"
                : "bg-white/5 text-gray-300 hover:bg-white/10"
            )}
          >
            {category.name}
          </button>
        ))}
      </div>
    </div>
  );
}
