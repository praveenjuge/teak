import type * as React from "react";

import { cn } from "../../lib/utils";

const Table = ({ className, ref, ...props }: React.ComponentProps<"table">) => (
  <div className="relative w-full overflow-auto">
    <table
      className={cn("w-full caption-bottom text-sm", className)}
      ref={ref}
      {...props}
    />
  </div>
);

const TableHeader = ({
  className,
  ref,
  ...props
}: React.ComponentProps<"thead">) => (
  <thead className={cn("[&_tr]:border-b", className)} ref={ref} {...props} />
);

const TableBody = ({
  className,
  ref,
  ...props
}: React.ComponentProps<"tbody">) => (
  <tbody
    className={cn("[&_tr:last-child]:border-0", className)}
    ref={ref}
    {...props}
  />
);

const TableFooter = ({
  className,
  ref,
  ...props
}: React.ComponentProps<"tfoot">) => (
  <tfoot
    className={cn(
      "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
      className
    )}
    ref={ref}
    {...props}
  />
);

const TableRow = ({ className, ref, ...props }: React.ComponentProps<"tr">) => (
  <tr
    className={cn(
      "border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted",
      className
    )}
    ref={ref}
    {...props}
  />
);

const TableHead = ({
  className,
  ref,
  ...props
}: React.ComponentProps<"th">) => (
  <th
    className={cn(
      "h-9 text-left align-middle font-medium text-muted-foreground",
      className
    )}
    ref={ref}
    {...props}
  />
);

const TableCell = ({
  className,
  ref,
  ...props
}: React.ComponentProps<"td">) => (
  <td
    className={cn("p-2 align-middle text-sm", className)}
    ref={ref}
    {...props}
  />
);

const TableCaption = ({
  className,
  ref,
  ...props
}: React.ComponentProps<"caption">) => (
  <caption
    className={cn("mt-4 text-muted-foreground text-sm", className)}
    ref={ref}
    {...props}
  />
);

export {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
};
