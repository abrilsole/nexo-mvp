import { StockPage } from "@/components/stock/stock-page";

export default async function Page({ searchParams }: PageProps<"/compras/stock">) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  return <StockPage material={one(sp.material)} lot={one(sp.lot)} tab={one(sp.tab)} basePath="/compras/stock" />;
}
