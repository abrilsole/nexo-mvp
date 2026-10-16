import { PurchasingProjectsPage } from "@/components/purchasing/purchasing-projects";

export default async function Page({ searchParams }: PageProps<"/compras/proyectos">) {
  const sp = await searchParams;
  const p = Array.isArray(sp.p) ? sp.p[0] : sp.p;
  return <PurchasingProjectsPage projectId={p} />;
}
