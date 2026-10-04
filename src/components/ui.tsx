import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, LabelHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";

export function cn(...values: Array<string | false | null | undefined>) {
  return twMerge(clsx(values));
}

const buttonStyles = cva(
  "inline-flex items-center justify-center gap-2 rounded-full px-4 py-2.5 text-base font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 shadow-[0_1px_0_rgba(17,29,43,0.04)]",
  {
    variants: {
      variant: {
        primary: "bg-[#15212d] text-white hover:bg-[#1a2b3b]",
        quiet: "border border-line bg-panel text-ink hover:bg-[#f2eee7]",
        danger: "bg-[#8f2d3b] text-white hover:bg-[#7a2331]",
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
  return <input {...props} className={cn("w-full rounded-xl border border-line bg-[#f8f4ef] px-3.5 py-2.5 text-base text-ink placeholder:text-slate-400 shadow-[0_1px_0_rgba(17,29,43,0.02)]", props.className)} />;
}

export function MoneyInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  return <Input min="0" step="0.01" {...props} type="number" inputMode="decimal" autoComplete="off" />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn("w-full rounded-xl border border-line bg-[#f8f4ef] px-3.5 py-2.5 text-base text-ink placeholder:text-slate-400 shadow-[0_1px_0_rgba(17,29,43,0.02)]", props.className)} />;
}

export function Label(props: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label {...props} className={cn("mb-1 block text-[0.75rem] font-medium uppercase tracking-[0.14em] text-slate-500", props.className)} />;
}

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cn("rounded-2xl border border-line bg-panel p-4 shadow-[0_1px_0_rgba(17,29,43,0.03)]", className)} />;
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "good" | "warn" | "bad" }) {
  const tones = { neutral: "bg-stone-100 text-stone-800", good: "bg-green-100 text-green-900", warn: "bg-amber-100 text-amber-950", bad: "bg-rose-100 text-rose-900" };
  return <span className={cn("inline-flex rounded-full px-2 py-0.5 text-sm font-medium", tones[tone])}>{children}</span>;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block text-sm font-medium">{label}<div className="mt-1 font-normal">{children}</div></label>;
}
