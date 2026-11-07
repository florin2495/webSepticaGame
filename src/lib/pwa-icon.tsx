import { ImageResponse } from "next/og";

// Opaque, shapes-only icon: white playing card with a bold red 7 on a red field.
// The card sits inside the central 80% so the same artwork is safe as "maskable".
export function renderIcon(size: number) {
  return new ImageResponse(
    (
      <svg width={size} height={size} viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
        <rect width="100" height="100" fill="#b91c1c" />
        <rect x="24" y="14" width="52" height="72" rx="7" fill="#fafafa" />
        <polygon points="34,29 66,29 66,40 49,73 36,73 52,41 34,41" fill="#b91c1c" />
      </svg>
    ),
    { width: size, height: size },
  );
}
