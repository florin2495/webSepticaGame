import { renderIcon } from "@/lib/pwa-icon";

export function generateStaticParams() {
  return [{ size: "192" }, { size: "512" }];
}

export async function GET(_req: Request, ctx: { params: Promise<{ size: string }> }) {
  const { size } = await ctx.params;
  const n = Number(size);
  if (n !== 192 && n !== 512) return new Response("Not found", { status: 404 });
  return renderIcon(n);
}
