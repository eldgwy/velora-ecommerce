"use client";

import { Button } from "./ui/button";
import { X, Search as SearchIcon } from "lucide-react";
import { Dispatch, SetStateAction } from "react";

const Search = ({
  setIsSearchOpen,
}: {
  setIsSearchOpen: Dispatch<SetStateAction<boolean>>;
}) => {
  return (
    <div
      className="
        fixed inset-0 z-[60]
        flex items-start justify-center
        bg-black/20
        p-4 pt-24
        backdrop-blur-sm
      "
      onClick={() => setIsSearchOpen(false)}
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
        <div className="flex items-center gap-3">
          <SearchIcon className="size-5 text-muted-foreground" />

          <input
            autoFocus
            type="search"
            placeholder="Search products..."
            className="
              w-full
              bg-transparent
              text-lg
              outline-none
              placeholder:text-muted-foreground
            "
          />

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
      </div>
    </div>
  );
};

export default Search;
