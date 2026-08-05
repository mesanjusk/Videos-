import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

interface StatCardProps {
  icon: LucideIcon;
  label: string;
  value: string | number;
  hint?: string;
  href?: string;
}

export function StatCard({ icon: Icon, label, value, hint, href }: StatCardProps) {
  const inner = (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </div>
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="h-[18px] w-[18px]" />
      </div>
    </div>
  );

  if (href) {
    return (
      <Card className="transition-colors hover:bg-accent">
        <Link href={href} className="block p-5">
          {inner}
        </Link>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-5">{inner}</CardContent>
    </Card>
  );
}
