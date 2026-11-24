import { ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react";
import * as React from "react";
import { cn } from "../lib/utils";
import { buttonVariants, type ButtonProps } from "./button";

export interface PaginationProps {
  /** Total number of pages (>= 1). */
  totalPages: number;
  /** Current page, 1-based. */
  currentPage: number;
  /** Called with the new page number when the user navigates. */
  onPageChange: (page: number) => void;
  /** How many page numbers to show around the current page. Default 1. */
  siblingCount?: number;
  className?: string;
  /** Accessible label for the nav element. */
  ariaLabel?: string;
}

function pageRange(totalPages: number, currentPage: number, siblingCount: number): (number | "…")[] {
  const pages: (number | "…")[] = [];
  const start = Math.max(1, currentPage - siblingCount);
  const end = Math.min(totalPages, currentPage + siblingCount);
  if (start > 1) {
    pages.push(1);
    if (start > 2) pages.push("…");
  }
  for (let p = start; p <= end; p++) pages.push(p);
  if (end < totalPages) {
    if (end < totalPages - 1) pages.push("…");
    pages.push(totalPages);
  }
  return pages;
}

const Pagination = ({
  totalPages,
  currentPage,
  onPageChange,
  siblingCount = 1,
  className,
  ariaLabel = "Pagination",
}: PaginationProps) => {
  if (totalPages < 1) return null;
  const safePage = Math.min(Math.max(1, currentPage), totalPages);
  const pages = pageRange(totalPages, safePage, siblingCount);

  return (
    <nav role="navigation" aria-label={ariaLabel} className={cn("mx-auto flex w-full justify-center", className)}>
      <ul className="flex flex-row items-center gap-1">
        <li>
          <PaginationPrevious
            href="#"
            aria-disabled={safePage <= 1}
            onClick={(e) => {
              e.preventDefault();
              if (safePage > 1) onPageChange(safePage - 1);
            }}
            className={safePage <= 1 ? "pointer-events-none opacity-50" : undefined}
          />
        </li>
        {pages.map((page, i) =>
          page === "…" ? (
            <li key={`ellipsis-${i}`} aria-hidden="true">
              <span className="flex h-9 w-9 items-center justify-center">
                <MoreHorizontal className="h-4 w-4" />
                <span className="sr-only">More pages</span>
              </span>
            </li>
          ) : (
            <li key={page}>
              <PaginationLink
                href="#"
                isActive={page === safePage}
                aria-current={page === safePage ? "page" : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  onPageChange(page);
                }}
              >
                {page}
              </PaginationLink>
            </li>
          ),
        )}
        <li>
          <PaginationNext
            href="#"
            aria-disabled={safePage >= totalPages}
            onClick={(e) => {
              e.preventDefault();
              if (safePage < totalPages) onPageChange(safePage + 1);
            }}
            className={safePage >= totalPages ? "pointer-events-none opacity-50" : undefined}
          />
        </li>
      </ul>
    </nav>
  );
};

const PaginationLink = ({
  className,
  isActive,
  size = "icon",
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  isActive?: boolean;
} & Pick<ButtonProps, "size">) => (
  <a
    aria-current={isActive ? "page" : undefined}
    className={cn(
      buttonVariants({ variant: isActive ? "outline" : "ghost", size }),
      className,
    )}
    {...props}
  />
);

const PaginationPrevious = ({
  className,
  ...props
}: React.ComponentProps<typeof PaginationLink>) => (
  <PaginationLink
    aria-label="Go to previous page"
    size="default"
    className={cn("gap-1 ps-2.5", className)}
    {...props}
  >
    <ChevronLeft className="h-4 w-4 rtl:rotate-180" />
    <span>Previous</span>
  </PaginationLink>
);

const PaginationNext = ({ className, ...props }: React.ComponentProps<typeof PaginationLink>) => (
  <PaginationLink
    aria-label="Go to next page"
    size="default"
    className={cn("gap-1 pe-2.5", className)}
    {...props}
  >
    <span>Next</span>
    <ChevronRight className="h-4 w-4 rtl:rotate-180" />
  </PaginationLink>
);

export { Pagination, PaginationLink, PaginationNext, PaginationPrevious };
