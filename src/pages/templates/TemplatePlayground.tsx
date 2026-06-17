import { createElement, useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

import {
  BUILTIN_FE_TEMPLATES,
  getBuiltinReactTemplateDefinition,
  previewValuesForBuiltinDefinition,
  renderBuiltinReactTemplateHtml,
} from "@/pages/templates";
import type { TemplateDefinition, TemplateValues } from "@/pages/templates";

function buildInitialValues(def: TemplateDefinition): TemplateValues {
  const base = previewValuesForBuiltinDefinition(def);
  for (const v of def.variables) {
    if (v.defaultValue) base[v.key] = v.defaultValue;
  }
  return base;
}

export default function TemplatePlayground() {
  const rows = useMemo(() => {
    const out: { id: string; name: string; def: TemplateDefinition }[] = [];
    for (const t of BUILTIN_FE_TEMPLATES) {
      const def = getBuiltinReactTemplateDefinition(t.id);
      if (def) out.push({ id: t.id, name: t.name, def });
    }
    return out;
  }, []);

  const [selectedId, setSelectedId] = useState(rows[0]?.id ?? "");
  const [values, setValues] = useState<TemplateValues>(() => {
    const first = rows[0]?.def;
    return first ? buildInitialValues(first) : {};
  });

  const selected = useMemo(
    () => rows.find((r) => r.id === selectedId),
    [rows, selectedId],
  );

  useEffect(() => {
    if (!selected) return;
    setValues(buildInitialValues(selected.def));
  }, [selected]);

  const setField = useCallback((key: string, next: string) => {
    setValues((prev) => ({ ...prev, [key]: next }));
  }, []);

  const fillPlaceholders = useCallback(() => {
    if (!selected) return;
    setValues((prev) => {
      const next = { ...prev };
      for (const v of selected.def.variables) {
        if (v.placeholder) next[v.key] = v.placeholder;
      }
      return next;
    });
  }, [selected]);

  const clearFields = useCallback(() => {
    if (!selected) return;
    setValues(previewValuesForBuiltinDefinition(selected.def));
  }, [selected]);

  const staticHtml = useMemo(() => {
    if (!selected) return "";
    return renderBuiltinReactTemplateHtml(selected.id, values);
  }, [selected, values]);

  const iframeDoc = useMemo(
    () =>
      `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head><body style="margin:0;padding:12px;background:#f8fafc;">${staticHtml}</body></html>`,
    [staticHtml],
  );

  if (rows.length === 0) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground text-sm">
          No built-in templates are registered.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-4 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Template playground
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Edit merge fields and preview built-in letter templates (React view and
          static HTML used for email where applicable).
        </p>
      </div>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <Card className="w-full shrink-0 lg:max-w-md lg:sticky lg:top-4">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Template &amp; fields</CardTitle>
            <CardDescription>
              Choose a template, then adjust values. Empty fields fall back to
              placeholders in the preview.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="space-y-2">
              <Label htmlFor="tpl-select">Template</Label>
              <Select
                value={selectedId}
                onValueChange={setSelectedId}
              >
                <SelectTrigger id="tpl-select">
                  <SelectValue placeholder="Select template" />
                </SelectTrigger>
                <SelectContent>
                  {rows.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={fillPlaceholders}>
                Fill placeholders
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={clearFields}>
                Clear values
              </Button>
            </div>

            {selected ? (
              <div className="flex max-h-[min(70vh,720px)] flex-col gap-3 overflow-y-auto pr-1">
                {selected.def.variables.map((v) => {
                  const long =
                    (v.placeholder?.length ?? 0) > 100 ||
                    /message|body|notes/i.test(v.key);
                  return (
                    <div key={v.key} className="space-y-1.5">
                      <Label htmlFor={`field-${v.key}`} className="text-xs font-medium">
                        {v.label}
                      </Label>
                      {long ? (
                        <Textarea
                          id={`field-${v.key}`}
                          rows={4}
                          value={values[v.key] ?? ""}
                          onChange={(e) => setField(v.key, e.target.value)}
                          placeholder={v.placeholder}
                          className="text-sm"
                        />
                      ) : (
                        <Input
                          id={`field-${v.key}`}
                          value={values[v.key] ?? ""}
                          onChange={(e) => setField(v.key, e.target.value)}
                          placeholder={v.placeholder}
                          className="text-sm"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="min-h-[480px] flex-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Preview</CardTitle>
            <CardDescription>
              Component preview uses your app styles; HTML preview matches email
              output (tables / inline styles).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="component" className="w-full">
              <TabsList className="mb-3">
                <TabsTrigger value="component">React component</TabsTrigger>
                <TabsTrigger value="html">Static HTML</TabsTrigger>
              </TabsList>
              <TabsContent value="component" className="mt-0">
                <div className="bg-muted/30 rounded-md border p-4">
                  {selected
                    ? createElement(selected.def.Component, { values })
                    : null}
                </div>
              </TabsContent>
              <TabsContent value="html" className="mt-0 space-y-2">
                <iframe
                  title="Static HTML preview"
                  className="bg-background h-[min(75vh,900px)] w-full rounded-md border"
                  srcDoc={iframeDoc}
                  sandbox="allow-same-origin"
                />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
