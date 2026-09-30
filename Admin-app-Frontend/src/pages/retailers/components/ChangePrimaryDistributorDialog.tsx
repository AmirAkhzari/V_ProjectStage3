import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import FormField from "@/components/shared/FormField";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAllDistributors } from "@/features/catalog";
import { useSetRetailerPrimaryDistributor } from "@/features/people";
import type { Retailer } from "@/types";

const schema = z.object({
  distributorId: z.string().min(1, "شرکت پخش را انتخاب کنید"),
});

type Values = z.infer<typeof schema>;

export default function ChangePrimaryDistributorDialog({
  open,
  onOpenChange,
  retailer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  retailer: Retailer;
}) {
  const { data: distributors } = useAllDistributors();
  const save = useSetRetailerPrimaryDistributor();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { distributorId: retailer.primaryDistributorId ?? "" },
  });

  useEffect(() => {
    if (open) form.reset({ distributorId: retailer.primaryDistributorId ?? "" });
  }, [open, retailer.primaryDistributorId, form]);

  const selected = form.watch("distributorId");
  const unchanged = selected === (retailer.primaryDistributorId ?? "");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>تغییر شرکت پخش اصلی</DialogTitle>
          <DialogDescription>
            فروشگاه در پلن رایگان فقط از شرکت پخش اصلی می‌تواند خرید کند. این تغییر فوراً روی کاتالوگ قابل‌خرید اثر
            می‌گذارد.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={form.handleSubmit(async (v) => {
            const res = await save.mutateAsync({ id: retailer.id, distributorId: v.distributorId });
            if (res.ok) onOpenChange(false);
          })}
        >
          <FormField label="شرکت پخش اصلی" error={form.formState.errors.distributorId?.message}>
            <Select value={selected} onValueChange={(v) => form.setValue("distributorId", v, { shouldValidate: true })}>
              <SelectTrigger>
                <SelectValue placeholder="انتخاب کنید" />
              </SelectTrigger>
              <SelectContent>
                {distributors?.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <DialogFooter>
            <Button type="submit" loading={save.isPending} disabled={unchanged}>
              تایید تغییر
            </Button>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              انصراف
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
