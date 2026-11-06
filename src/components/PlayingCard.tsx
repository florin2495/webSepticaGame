import { type Card, isRed, rankOf, SUIT_SYMBOL, suitOf } from "@/lib/septica";

const SIZES = {
  sm: "h-14 w-10 text-sm",
  md: "h-20 w-14 text-lg",
  lg: "h-28 w-20 text-2xl",
};

/** A face-up playing card drawn with CSS (no images). */
export function PlayingCard({
  card,
  size = "md",
  className = "",
}: {
  card: Card;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const rank = rankOf(card);
  const suit = SUIT_SYMBOL[suitOf(card)];
  return (
    <span
      className={`relative inline-flex shrink-0 select-none flex-col justify-between rounded-lg border border-zinc-300 bg-white p-1 font-bold leading-none shadow-sm ${
        isRed(card) ? "text-rose-600" : "text-zinc-900"
      } ${SIZES[size]} ${className}`}
      aria-label={`${rank} ${suit}`}
    >
      <span className="text-left">
        {rank}
        <span className="block text-[0.8em]">{suit}</span>
      </span>
      <span className="absolute inset-0 flex items-center justify-center text-[1.6em] opacity-90">{suit}</span>
      <span className="rotate-180 text-left">{rank}</span>
    </span>
  );
}

/** Face-down card (other players' hands, the stock). */
export function CardBack({ size = "sm", className = "" }: { size?: keyof typeof SIZES; className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block shrink-0 rounded-lg border-2 border-white bg-indigo-700 bg-[repeating-linear-gradient(45deg,transparent_0_4px,rgba(255,255,255,0.15)_4px_8px)] shadow-sm dark:border-zinc-300 ${SIZES[size]} ${className}`}
    />
  );
}
