import type { LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

interface SyndicatorAdminStatCardProps {
  label: string;
  value: string;
  icon: LucideIcon;
}

export default function SyndicatorAdminStatCard({ label, value, icon: Icon }: SyndicatorAdminStatCardProps) {
  return (
    <Card className="gap-0 py-0 shadow-sm">
      <CardContent className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="text-lg font-semibold tabular-nums truncate">{value}</p>
        </div>
        <Icon className="size-8 shrink-0 text-muted-foreground opacity-75" aria-hidden />
      </CardContent>
    </Card>
  );
}
