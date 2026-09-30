"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

export const VISITOR_TAGLINE_WORDS = ["ساده‌تر", "سریع‌تر", "هوشمندتر", "مطمئن‌تر"] as const;

export interface ContainerTextFlipProps {
  /** Array of words to cycle through in the animation */
  words?: string[];
  /** Time in milliseconds between word transitions */
  interval?: number;
  /** Additional CSS classes to apply to the container */
  className?: string;
  /** Additional CSS classes to apply to the text */
  textClassName?: string;
  /** Duration of the transition animation in milliseconds */
  animationDuration?: number;
}

const appleEase = [0.22, 1, 0.36, 1] as const;

export function ContainerTextFlip({
  words = ["better", "modern", "beautiful", "awesome"],
  interval = 3000,
  className,
  textClassName,
  animationDuration = 700,
}: ContainerTextFlipProps) {
  const id = useId();
  const [currentWordIndex, setCurrentWordIndex] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [width, setWidth] = useState<number | "auto">("auto");
  const textRef = useRef<HTMLSpanElement>(null);
  const word = words[currentWordIndex] ?? "";
  const duration = reduceMotion ? 0 : animationDuration / 1000;

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduceMotion(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useLayoutEffect(() => {
    const node = textRef.current;
    if (!node) return;
    setWidth(node.scrollWidth);
  }, [word]);

  useEffect(() => {
    if (words.length < 2) return;
    const intervalId = setInterval(() => {
      setCurrentWordIndex((prevIndex) => (prevIndex + 1) % words.length);
    }, interval);
    return () => clearInterval(intervalId);
  }, [words, interval]);

  return (
    <motion.span
      layout
      layoutId={`words-here-${id}`}
      animate={{ width }}
      initial={false}
      transition={{ duration, ease: appleEase }}
      className={cn(
        "relative inline-block align-bottom text-[40px] font-black leading-tight text-accent",
        className,
      )}
      aria-live="polite"
    >
      <motion.span
        ref={textRef}
        key={word}
        layoutId={`word-div-${word}-${id}`}
        className={cn("inline-block whitespace-nowrap", textClassName)}
        initial={reduceMotion ? { opacity: 1, filter: "blur(0px)", y: 0 } : { opacity: 0, filter: "blur(10px)", y: 8 }}
        animate={{ opacity: 1, filter: "blur(0px)", y: 0 }}
        transition={{ duration, ease: appleEase }}
      >
        {word}
      </motion.span>
    </motion.span>
  );
}
