import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, LabelHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";

export function cn(...values: Array<string | false | null | undefined>) {
  return twMerge(clsx(values));
}

const buttonStyles = cva(
  "inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-base font-medium disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "bg-blue text-white hover:bg-blue-800",
        quiet: "border border-line bg-panel text-ink hover:bg-stone-50",
        danger: "bg-rose-800 text-white hover:bg-rose-900",
      },
    },
    defaultVariants: { variant: "primary" },
  },
);

export function Button({ className, variant, asChild, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonStyles> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonStyles({ variant }), className)} {...props} />;
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn("w-full rounded-md border border-line bg-panel px-3 py-2 text-base", props.className)} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn("w-full rounded-md border border-line bg-panel px-3 py-2 text-base", props.className)} />;
}

export function Label(props: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label {...props} className={cn("mb-1 block text-sm font-medium", props.className)} />;
}

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cn("rounded-lg border border-line bg-panel p-4 shadow-sm", className)} />;
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "good" | "warn" | "bad" }) {
  const tones = { neutral: "bg-stone-100 text-stone-800", good: "bg-green-100 text-green-900", warn: "bg-amber-100 text-amber-950", bad: "bg-rose-100 text-rose-900" };
  return <span className={cn("inline-flex rounded-full px-2 py-0.5 text-sm font-medium", tones[tone])}>{children}</span>;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block text-sm font-medium">{label}<div className="mt-1 font-normal">{children}</div></label>;
}
