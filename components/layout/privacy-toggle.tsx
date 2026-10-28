"use client";

import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { usePrivacy } from "./privacy-provider";

export function PrivacyToggle({ expanded = false }: { expanded?: boolean }) {
  const { valuesHidden, toggleValues } = usePrivacy();
  const label = valuesHidden ? "Mostrar valores" : "Ocultar valores";
  const Icon = valuesHidden ? EyeOff : Eye;

  return (
    <Button
      type="button"
      variant="ghost"
      size={expanded ? "default" : "icon"}
      className={cn("shrink-0 text-[var(--foreground)]", expanded ? "min-h-12" : "w-9")}
      onClick={toggleValues}
      aria-label={label}
      aria-pressed={valuesHidden}
      title={label}
    >
      <Icon className="size-4" aria-hidden="true" />
      {expanded && "Valores"}
    </Button>
  );
}
