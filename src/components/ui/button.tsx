import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default:
          "text-primary-foreground bg-[image:var(--brand-gradient)] hover:opacity-90",
        destructive:
          "bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",
        success:
          "bg-green-600 text-white hover:bg-green-700 focus-visible:ring-green-600/20 dark:focus-visible:ring-green-600/40",
        outline:
          "border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost:
          "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function nodeHasSpinner(node: React.ReactNode): boolean {
  if (node == null || typeof node === "boolean") return false
  if (Array.isArray(node)) return node.some(nodeHasSpinner)
  if (!React.isValidElement(node)) return false
  const className = String(
    (node.props as { className?: unknown }).className ?? "",
  )
  if (className.includes("animate-spin")) return true
  return nodeHasSpinner((node.props as { children?: React.ReactNode }).children)
}

function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  disabled,
  children,
  onClick,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
    /** Shows a spinner and disables the control while work is in progress. */
    loading?: boolean
  }) {
  const Comp = asChild ? Slot : "button"
  const [pending, setPending] = React.useState(false)
  const isLoading = Boolean(loading || pending)
  const isIconOnly =
    size === "icon" || size === "icon-sm" || size === "icon-lg"

  // Keep primary CTAs on the platform gradient even when callers pass solid brand bg overrides.
  const normalizedClassName =
    typeof className === "string"
      ? className
          .replace(/\bbg-\[var\(--brand\)\](?!\/)/g, "bg-[image:var(--brand-gradient)]")
          .replace(/\bhover:bg-\[var\(--brand\)\]\/90\b/g, "hover:opacity-90")
          .replace(/\bhover:bg-\[var\(--brand-hover\)\]\b/g, "hover:opacity-90")
      : className

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (isLoading || disabled) {
      event.preventDefault()
      return
    }
    const result = onClick?.(event)
    if (asChild) return
    if (result != null && typeof (result as Promise<unknown>).then === "function") {
      setPending(true)
      void Promise.resolve(result).finally(() => setPending(false))
    }
  }

  const spinner = <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
  const childrenAlreadySpin = nodeHasSpinner(children)

  return (
    <Comp
      data-slot="button"
      data-loading={isLoading ? "true" : undefined}
      aria-busy={isLoading || undefined}
      disabled={disabled || isLoading}
      className={cn(buttonVariants({ variant, size }), normalizedClassName)}
      onClick={handleClick}
      {...props}
    >
      {asChild ? (
        children
      ) : isLoading ? (
        <>
          {!childrenAlreadySpin && spinner}
          {isIconOnly && !childrenAlreadySpin ? null : children}
        </>
      ) : (
        children
      )}
    </Comp>
  )
}

export { Button, buttonVariants }
