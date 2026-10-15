"use client";
// Jefe de planta (Lote 5A, vista mínima): operarios y proyectos con asignaciones y horas. Ningún importe.
import { useMemo } from "react";
import { formatDate, formatNumber } from "@/lib/formatting";
import { plantView } from "@/lib/role-views";
import { useAppStore } from "@/store/use-app-store";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/badges";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export function PlantPage() {
  const projects = useAppStore((s) => s.projects);
  const operators = useAppStore((s) => s.operators);
  const view = useMemo(() => plantView(projects, operators), [projects, operators]);

  return (
    <div className="space-y-6">
      <PageHeader title="Operarios y proyectos" subtitle="Quién está en cada proyecto abierto y cuántas horas se cargaron." />
      <Card>
        <CardHeader>
          <CardTitle>Operarios</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <THead>
              <TR>
                <TH>Nombre</TH>
                <TH>Especialidad</TH>
                <TH>Estado</TH>
                <TH>Proyectos abiertos</TH>
                <TH className="text-right">Horas cargadas</TH>
              </TR>
            </THead>
            <TBody>
              {view.operators.map((o) => (
                <TR key={o.id}>
                  <TD className="font-medium text-slate-900">{o.name}</TD>
                  <TD>{o.role}</TD>
                  <TD>{o.active ? <Badge tone="green">Activo</Badge> : <Badge tone="gray">De baja</Badge>}</TD>
                  <TD>{o.projects.length ? o.projects.join(", ") : "—"}</TD>
                  <TD className="text-right tabular">{formatNumber(o.hours)} h</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Proyectos abiertos</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <THead>
              <TR>
                <TH>Proyecto</TH>
                <TH>Etapa</TH>
                <TH>Entrega</TH>
                <TH>Operarios</TH>
                <TH className="text-right">Horas cargadas</TH>
              </TR>
            </THead>
            <TBody>
              {view.projects.map((p) => (
                <TR key={p.id}>
                  <TD className="font-medium text-slate-900">
                    <span className="text-slate-500">{p.code}</span> {p.name}
                    <span className="block text-xs font-normal text-slate-500">{p.client}</span>
                  </TD>
                  <TD><StatusBadge status={p.status} /></TD>
                  <TD className="whitespace-nowrap">{formatDate(p.dueDate)}</TD>
                  <TD>{p.operators.length ? p.operators.join(", ") : "Sin asignar"}</TD>
                  <TD className="text-right tabular">{formatNumber(p.hours)} h</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
