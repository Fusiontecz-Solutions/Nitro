import { useState, type ReactNode } from "react";
import { TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

type LazyTabContentProps = {
  value: string;
  activeTab: string;
  className?: string;
  children: ReactNode;
};

/**
 * Mount a tab the first time it is selected (avoids N+1 API calls on details load).
 * Keep it mounted after that so Back/Next does not remount and refetch.
 * forceMount leaves panels present, so inactive ones must be hidden via CSS.
 */
export function LazyTabContent({
  value,
  activeTab,
  className,
  children,
}: LazyTabContentProps) {
  const isActive = activeTab === value;
  const [visited, setVisited] = useState(isActive);
  if (isActive && !visited) {
    setVisited(true);
  }

  return (
    <TabsContent
      value={value}
      className={cn("data-[state=inactive]:hidden", className)}
      forceMount={visited || undefined}
    >
      {visited ? children : null}
    </TabsContent>
  );
}
