"use client";

import { Search } from "lucide-react";
import { searchFieldClassName } from "../components/search/SearchBar";
import { SidebarToggle } from "../components/sidebar/SidebarToggle";
import { CardsGridSkeleton } from "../feedback/CardSkeleton";
import { PageHeader, PageTitle } from "./PageHeader";

export function LibraryPageSkeleton({
  searchPlaceholder,
  title,
}: {
  searchPlaceholder?: string;
  title: string;
}) {
  return (
    <>
      <PageHeader
        leading={<SidebarToggle className="-ml-2" />}
        title={<PageTitle>{title}</PageTitle>}
      >
        {searchPlaceholder ? (
          <div
            aria-hidden="true"
            className="relative min-w-0 flex-1 max-sm:hidden sm:ml-auto sm:max-w-xl"
          >
            <div className={searchFieldClassName}>
              <Search className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate px-0.5 text-muted-foreground text-sm">
                {searchPlaceholder}
              </span>
            </div>
          </div>
        ) : null}
      </PageHeader>
      <CardsGridSkeleton />
    </>
  );
}
