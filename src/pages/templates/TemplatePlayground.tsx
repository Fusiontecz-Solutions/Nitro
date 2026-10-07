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

import { useFunderProfiles } from "@/hooks/useFunderProfiles";

import { resolveLetterEmailBranding } from "./letterEmailBranding";
import {
  TEMPLATE_REGISTRY,
  previewValuesForBuiltinDefinition,
  renderBuiltinReactTemplateHtml,
} from "./registry";
import { TEMPLATE_CATEGORY_LABELS } from "./types";
import type { TemplateDefinition, TemplateValues } from "./types";

/** Empty values, then each variable's `defaultValue` (mirrors Katan playground). */
function buildInitialValues(def: TemplateDefinition): TemplateValues {
  const base = previewValuesForBuiltinDefinition(def);
  for (const v of def.variables) {
    if (v.defaultValue) base[v.key] = v.defaultValue;
  }
  return base;
}

/**
 * `/template/playground` — preview every built-in email and letter template
 * (approval, offer updated, rejection, document request, contract sent,
 * signed contract, payoff, zero balance)
 * as the React component and as the exact static HTML that is emailed.
 */
export default function TemplatePlayground() {
  const [selectedId, setSelectedId] = useState(TEMPLATE_REGISTRY[0]?.id ?? "");
  const [values, setValues] = useState<TemplateValues>(() => {
    const first = TEMPLATE_REGISTRY[0];
    return first ? buildInitialValues(first) : {};
  });
  const [copied, setCopied] = useState(false);
  const [funderId, setFunderId] = useState("");

  const selected = useMemo(
    () => TEMPLATE_REGISTRY.find((t) => t.id === selectedId),
    [selectedId],
  );

  /** Templates with a logo merge field are branded per funder (book). */
  const funderBranded = Boolean(
    selected?.variables.some((v) => v.key === "logo_url"),
  );
  const { funders } = useFunderProfiles(null, { enabled: funderBranded });

  useEffect(() => {
    if (!selected) return;
    setValues(buildInitialValues(selected));
    setCopied(false);
    setFunderId("");
  }, [selected]);

  /** Fill book name, logo and colors from the funder's Letter Info (same as Letters). */
  const applyFunder = useCallback(
    (id: string) => {
      setFunderId(id);
      const funder = funders.find((f) => f.id === id);
      if (!funder) return;
      const branding = resolveLetterEmailBranding(funder);
      setValues((prev) => ({
        ...prev,
        book_name: String(funder.displayName || funder.name || "").trim(),
        company_name: branding.companyName,
        logo_url: branding.logoSrc,
        brand_primary: branding.accentStripDark,
        brand_accent: branding.accentStripLight,
      }));
    },
    [funders],
  );

  const setField = useCallback((key: string, next: string) => {
    setValues((prev) => ({ ...prev, [key]: next }));
  }, []);

  const fillPlaceholders = useCallback(() => {
    if (!selected) return;
    setValues((prev) => {
      const next = { ...prev };
      for (const v of selected.variables) {
        if (v.placeholder) next[v.key] = v.placeholder;
      }
      return next;
    });
  }, [selected]);

  const clearFields = useCallback(() => {
    if (!selected) return;
    setValues(previewValuesForBuiltinDefinition(selected));
  }, [selected]);

  const staticHtml = useMemo(() => {
    if (!selected) return "";
    return renderBuiltinReactTemplateHtml(selected.id, values);
  }, [selected, values]);

  const iframeDoc = useMemo(
    () =>
      /^\s*<!doctype/i.test(staticHtml)
        ? staticHtml
        : `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head><body style="margin:0;padding:12px;background:#f8fafc;">${staticHtml}</body></html>`,
    [staticHtml],
  );

  const copyHtml = async () => {
    try {
      await navigator.clipboard.writeText(staticHtml);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  if (TEMPLATE_REGISTRY.length === 0) {
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
          Preview all built-in email and letter templates — approval, offer
          updated, rejection, document request, contract sent, signed contract,
          payoff letter, and zero balance letter.
        </p>
      </div>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <Card className="w-full shrink-0 lg:sticky lg:top-4 lg:max-w-md">
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
              <Select value={selectedId} onValueChange={setSelectedId}>
                <SelectTrigger id="tpl-select">
                  <SelectValue placeholder="Select template" />
                </SelectTrigger>
                <SelectContent>
                  {TEMPLATE_REGISTRY.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                      <span className="text-muted-foreground ml-1 text-xs">
                        ({TEMPLATE_CATEGORY_LABELS[t.category].toLowerCase()})
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selected?.description ? (
                <p className="text-muted-foreground text-xs">
                  {selected.description}
                </p>
              ) : null}
            </div>

            {funderBranded ? (
              <div className="space-y-2">
                <Label htmlFor="tpl-funder">Funder (book)</Label>
                <Select value={funderId} onValueChange={applyFunder}>
                  <SelectTrigger id="tpl-funder">
                    <SelectValue placeholder="Nitro Advance (default branding)" />
                  </SelectTrigger>
                  <SelectContent>
                    {funders.map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.displayName || f.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-muted-foreground text-xs">
                  Uses the funder&apos;s Letter Info logo and colors, as the sent email does.
                </p>
              </div>
            ) : null}

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
                {selected.variables.length === 0 ? (
                  <p className="text-muted-foreground text-sm">
                    This template has no merge fields.
                  </p>
                ) : null}
                {selected.variables.map((v) => {
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

        <Card className="min-h-[480px] min-w-0 flex-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Preview</CardTitle>
            <CardDescription>
              Component preview uses your app styles; HTML preview matches email
              output (tables / inline styles).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue={selected?.Component ? "component" : "html"} className="w-full">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <TabsList>
                  <TabsTrigger value="component" disabled={!selected?.Component}>
                    React component
                  </TabsTrigger>
                  <TabsTrigger value="html">Static HTML</TabsTrigger>
                  <TabsTrigger value="source">HTML source</TabsTrigger>
                </TabsList>
                <Button type="button" variant="outline" size="sm" onClick={copyHtml}>
                  {copied ? "Copied!" : "Copy HTML"}
                </Button>
              </div>
              {selected?.renderSubject ? (
                <p className="mb-3 rounded-md border bg-muted/30 px-3 py-2 text-sm">
                  <span className="text-muted-foreground">Subject: </span>
                  <span className="font-medium">{selected.renderSubject(values)}</span>
                </p>
              ) : null}
              <TabsContent value="component" className="mt-0">
                <div className="bg-muted/30 rounded-md border p-4">
                  {selected?.Component
                    ? createElement(selected.Component, { values })
                    : null}
                </div>
              </TabsContent>
              <TabsContent value="html" className="mt-0">
                <iframe
                  title="Static HTML preview"
                  className="bg-background h-[min(75vh,900px)] w-full rounded-md border"
                  srcDoc={iframeDoc}
                  sandbox="allow-same-origin"
                />
              </TabsContent>
              <TabsContent value="source" className="mt-0">
                <pre className="h-[min(75vh,900px)] overflow-auto whitespace-pre-wrap break-words rounded-md border bg-slate-950 p-4 font-mono text-xs leading-relaxed text-slate-200">
                  <code>{staticHtml}</code>
                </pre>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
