import type { Table } from "@tanstack/react-table";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toFaNum } from "@/lib/format";

export default function DataTablePagination<T>({ table }: { table: Table<T> }) {
  const { pageIndex, pageSize } = table.getState().pagination;
  const total = table.getFilteredRowModel().rows.length;
  const from = pageIndex * pageSize + 1;
  const to = Math.min(total, (pageIndex + 1) * pageSize);
  return (
    <div className="flex items-center justify-between px-1 text-[12px] text-label-secondary">
      <span className="tabular-nums">
        {toFaNum(from)}–{toFaNum(to)} از {toFaNum(total)}
      </span>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => table.previousPage()}
          disabled={!table.getCanPreviousPage()}
          aria-label="صفحه قبل"
        >
          <ChevronRight />
        </Button>
        <span className="min-w-8 text-center text-foreground tabular-nums">{toFaNum(pageIndex + 1)}</span>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => table.nextPage()}
          disabled={!table.getCanNextPage()}
          aria-label="صفحه بعد"
        >
          <ChevronLeft />
        </Button>
      </div>
    </div>
  );
}
