"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "./ui/button";
import { X, Search as SearchIcon, ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";

interface SearchSuggestion {
  type: "product" | "category" | "brand";
  id: string;
  name: string;
  slug: string;
}

const Search = ({
  setIsSearchOpen,
}: {
  setIsSearchOpen: React.Dispatch<React.SetStateAction<boolean>>;
}) => {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  const fetchSuggestions = useCallback(async (searchQuery: string) => {
    if (searchQuery.length < 2) {
      setSuggestions([]);
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch(`/api/search/suggestions?q=${encodeURIComponent(searchQuery)}&limit=5`);
      if (response.ok) {
        const data = await response.json();
        setSuggestions(data.suggestions ?? []);
        setSelectedIndex(-1);
      }
    } catch (error) {
      console.error("[search] failed to fetch suggestions:", error);
      setSuggestions([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleInputChange = (value: string) => {
    setQuery(value);

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      fetchSuggestions(value);
    }, 150);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setIsSearchOpen(false);
      return;
    }

    if (suggestions.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (selectedIndex >= 0 && suggestions[selectedIndex]) {
        selectSuggestion(suggestions[selectedIndex]);
      } else if (query.trim()) {
        handleSearch();
      }
    }
  };

  const selectSuggestion = (suggestion: SearchSuggestion) => {
    setIsSearchOpen(false);
    setQuery("");
    setSuggestions([]);

    if (suggestion.type === "product") {
      router.push(`/products/${suggestion.slug}`);
    } else if (suggestion.type === "category") {
      router.push(`/categories/${suggestion.slug}`);
    } else if (suggestion.type === "brand") {
      router.push(`/products?brand=${suggestion.slug}`);
    }
  };

  const handleSearch = () => {
    if (query.trim()) {
      setIsSearchOpen(false);
      setSuggestions([]);
      router.push(`/search?q=${encodeURIComponent(query.trim())}`);
    }
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    handleSearch();
  };

  useEffect(() => {
    inputRef.current?.focus();
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  const getTypeIcon = (type: SearchSuggestion["type"]) => {
    switch (type) {
      case "product":
        return <SearchIcon className="size-4" />;
      case "category":
        return <ChevronRight className="size-4" />;
      case "brand":
        return <ChevronRight className="size-4" />;
    }
  };

  const getTypeLabel = (type: SearchSuggestion["type"]) => {
    switch (type) {
      case "product":
        return "Product";
      case "category":
        return "Category";
      case "brand":
        return "Brand";
    }
  };

  return (
    <div
      className="
        fixed inset-0 z-60
        flex items-start justify-center
        bg-black/20
        p-4 pt-24
        backdrop-blur-sm
      "
      onClick={() => setIsSearchOpen(false)}
      role="dialog"
      aria-modal="true"
      aria-label="Search"
    >
      <div
        className="
          velora-glass-strong
          w-full max-w-2xl
          rounded-3xl
          p-6
        "
        onClick={(event) => event.stopPropagation()}
      >
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex items-center gap-3 relative">
            <SearchIcon className="size-5 text-muted-foreground" />

            <input
              ref={inputRef}
              autoFocus
              type="search"
              value={query}
              onChange={(e) => handleInputChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search products, categories, brands..."
              className="
                w-full
                bg-transparent
                text-lg
                outline-none
                placeholder:text-muted-foreground
                pr-12
              "
              aria-autocomplete="list"
              aria-controls="search-suggestions"
              aria-expanded={suggestions.length > 0}
              role="combobox"
            />

            {isLoading && <div className="animate-spin size-5 text-muted-foreground" />}

            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsSearchOpen(false)}
              className="rounded-full"
              aria-label="Close search"
            >
              <X className="size-5" />
            </Button>
          </div>

          {suggestions.length > 0 && (
            <ul
              id="search-suggestions"
              role="listbox"
              className="absolute top-full left-0 right-0 mt-2 velora-glass-strong rounded-2xl border border-border/50 py-2 shadow-lg max-h-96 overflow-y-auto"
            >
              {suggestions.map((suggestion, index) => (
                <li
                  key={`${suggestion.type}-${suggestion.id}`}
                  role="option"
                  aria-selected={index === selectedIndex}
                  onClick={() => selectSuggestion(suggestion)}
                  onMouseEnter={() => setSelectedIndex(index)}
                  className={`flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                    index === selectedIndex ? "bg-accent" : "hover:bg-accent/50"
                  }`}
                >
                  <span className="flex size-8 items-center justify-center text-muted-foreground">
                    {getTypeIcon(suggestion.type)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{suggestion.name}</p>
                    <p className="text-xs text-muted-foreground capitalize">{getTypeLabel(suggestion.type)}</p>
                  </div>
                  <ChevronRight className="size-4 text-muted-foreground shrink-0" />
                </li>
              ))}
            </ul>
          )}

{query.length >= 2 && suggestions.length === 0 && !isLoading && (
              <p className="text-sm text-muted-foreground text-center py-4">
                No suggestions found. Press Enter to search for &ldquo;{query}&rdquo;.
              </p>
            )}
        </form>
      </div>
    </div>
  );
};

export default Search;