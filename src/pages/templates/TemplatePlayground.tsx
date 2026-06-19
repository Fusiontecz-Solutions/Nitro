import { useMemo, useState } from "react";
import { TEMPLATE_REGISTRY } from "./registry";
import { TEMPLATE_CATEGORY_LABELS } from "./types";
import type { TemplateDefinition, TemplateValues } from "./types";

type ViewMode = "rendered" | "html" | "component";

/** Seed merge values from each template's `defaultValue` / placeholder. */
function buildInitialValues(template: TemplateDefinition): TemplateValues {
  return template.variables.reduce<TemplateValues>((acc, variable) => {
    acc[variable.key] = variable.defaultValue ?? "";
    return acc;
  }, {});
}

export default function TemplatePlayground() {
  const [selectedId, setSelectedId] = useState<string>(
    TEMPLATE_REGISTRY[0]?.id ?? "",
  );
  const [viewMode, setViewMode] = useState<ViewMode>("rendered");
  const [copied, setCopied] = useState(false);
  const [valuesByTemplate, setValuesByTemplate] = useState<
    Record<string, TemplateValues>
  >(() =>
    TEMPLATE_REGISTRY.reduce<Record<string, TemplateValues>>((acc, template) => {
      acc[template.id] = buildInitialValues(template);
      return acc;
    }, {}),
  );

  const selectedTemplate = useMemo(
    () => TEMPLATE_REGISTRY.find((t) => t.id === selectedId) ?? null,
    [selectedId],
  );

  const values = selectedTemplate
    ? valuesByTemplate[selectedTemplate.id] ?? {}
    : {};

  const html = useMemo(
    () => (selectedTemplate?.renderHtml ? selectedTemplate.renderHtml(values) : ""),
    [selectedTemplate, values],
  );

  const hasHtml = Boolean(selectedTemplate?.renderHtml);
  const hasComponent = Boolean(selectedTemplate?.Component);
  const effectiveView: ViewMode =
    viewMode === "rendered" && !hasHtml
      ? "component"
      : viewMode === "component" && !hasComponent
        ? "rendered"
        : viewMode === "html" && !hasHtml
          ? "component"
          : viewMode;

  const updateValue = (key: string, value: string) => {
    if (!selectedTemplate) return;
    setValuesByTemplate((prev) => ({
      ...prev,
      [selectedTemplate.id]: {
        ...prev[selectedTemplate.id],
        [key]: value,
      },
    }));
  };

  const resetValues = () => {
    if (!selectedTemplate) return;
    setValuesByTemplate((prev) => ({
      ...prev,
      [selectedTemplate.id]: buildInitialValues(selectedTemplate),
    }));
  };

  const selectTemplate = (id: string) => {
    setSelectedId(id);
    setCopied(false);
  };

  const copyHtml = async () => {
    try {
      await navigator.clipboard.writeText(html);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div style={styles.page}>
      <aside style={styles.sidebar}>
        <div style={styles.sidebarHeader}>
          <h1 style={styles.title}>Template Playground</h1>
          <p style={styles.subtitle}>
            {TEMPLATE_REGISTRY.length} template
            {TEMPLATE_REGISTRY.length === 1 ? "" : "s"} registered
          </p>
        </div>

        <nav style={styles.list}>
          {TEMPLATE_REGISTRY.map((template) => {
            const active = template.id === selectedId;
            return (
              <button
                key={template.id}
                type="button"
                onClick={() => selectTemplate(template.id)}
                style={{
                  ...styles.listItem,
                  ...(active ? styles.listItemActive : {}),
                }}
              >
                <span style={styles.listItemName}>{template.name}</span>
                <span style={styles.badge}>
                  {TEMPLATE_CATEGORY_LABELS[template.category]}
                </span>
              </button>
            );
          })}
        </nav>

        {selectedTemplate ? (
          <div style={styles.fields}>
            <div style={styles.fieldsHeader}>
              <h2 style={styles.fieldsTitle}>Merge fields</h2>
              <button type="button" onClick={resetValues} style={styles.resetBtn}>
                Reset
              </button>
            </div>
            {selectedTemplate.variables.length === 0 ? (
              <p style={styles.muted}>This template has no merge fields.</p>
            ) : (
              selectedTemplate.variables.map((variable) => (
                <label key={variable.key} style={styles.field}>
                  <span style={styles.fieldLabel}>{variable.label}</span>
                  <input
                    type="text"
                    value={values[variable.key] ?? ""}
                    placeholder={variable.placeholder ?? variable.label}
                    onChange={(e) => updateValue(variable.key, e.target.value)}
                    style={styles.input}
                  />
                  <span style={styles.fieldKey}>{variable.key}</span>
                </label>
              ))
            )}
          </div>
        ) : null}
      </aside>

      <main style={styles.preview}>
        {selectedTemplate ? (
          <>
            <div style={styles.previewHeader}>
              <div>
                <h2 style={styles.previewTitle}>{selectedTemplate.name}</h2>
                {selectedTemplate.description ? (
                  <p style={styles.muted}>{selectedTemplate.description}</p>
                ) : null}
              </div>
              <div style={styles.toolbar}>
                <div style={styles.tabs}>
                  {hasHtml ? (
                    <button
                      type="button"
                      onClick={() => setViewMode("rendered")}
                      style={{
                        ...styles.tab,
                        ...(effectiveView === "rendered" ? styles.tabActive : {}),
                      }}
                    >
                      Rendered HTML
                    </button>
                  ) : null}
                  {hasHtml ? (
                    <button
                      type="button"
                      onClick={() => setViewMode("html")}
                      style={{
                        ...styles.tab,
                        ...(effectiveView === "html" ? styles.tabActive : {}),
                      }}
                    >
                      HTML source
                    </button>
                  ) : null}
                  {hasComponent ? (
                    <button
                      type="button"
                      onClick={() => setViewMode("component")}
                      style={{
                        ...styles.tab,
                        ...(effectiveView === "component" ? styles.tabActive : {}),
                      }}
                    >
                      React component
                    </button>
                  ) : null}
                </div>
                {hasHtml ? (
                  <button type="button" onClick={copyHtml} style={styles.copyBtn}>
                    {copied ? "Copied!" : "Copy HTML"}
                  </button>
                ) : null}
              </div>
            </div>

            {effectiveView === "rendered" && hasHtml ? (
              <iframe
                title={`${selectedTemplate.name} preview`}
                srcDoc={html}
                style={styles.iframe}
              />
            ) : null}

            {effectiveView === "html" && hasHtml ? (
              <pre style={styles.code}>
                <code>{html}</code>
              </pre>
            ) : null}

            {effectiveView === "component" && selectedTemplate.Component ? (
              <div style={styles.previewCanvas}>
                <selectedTemplate.Component values={values} />
              </div>
            ) : null}
          </>
        ) : (
          <p style={styles.muted}>No templates registered.</p>
        )}
      </main>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    display: "flex",
    minHeight: "100vh",
    fontFamily: "Arial, Helvetica, sans-serif",
    background: "#f4f5f7",
    color: "#1f2937",
  },
  sidebar: {
    width: 340,
    flexShrink: 0,
    borderRight: "1px solid #e2e8f0",
    background: "#ffffff",
    padding: "20px 18px",
    display: "flex",
    flexDirection: "column",
    gap: 18,
    overflowY: "auto",
    maxHeight: "100vh",
    boxSizing: "border-box",
  },
  sidebarHeader: { display: "flex", flexDirection: "column", gap: 4 },
  title: { margin: 0, fontSize: 18, fontWeight: 700 },
  subtitle: { margin: 0, fontSize: 12, color: "#6b7280" },
  list: { display: "flex", flexDirection: "column", gap: 6 },
  listItem: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    padding: "10px 12px",
    border: "1px solid #e2e8f0",
    borderRadius: 8,
    background: "#ffffff",
    cursor: "pointer",
    textAlign: "left",
    font: "inherit",
  },
  listItemActive: {
    borderColor: "#22a1e3",
    background: "#eaf6fd",
  },
  listItemName: { fontSize: 13, fontWeight: 600 },
  badge: {
    fontSize: 10,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    color: "#22a1e3",
    background: "#e0f2fe",
    borderRadius: 999,
    padding: "2px 8px",
  },
  fields: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    borderTop: "1px solid #e2e8f0",
    paddingTop: 16,
  },
  fieldsHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  fieldsTitle: { margin: 0, fontSize: 13, fontWeight: 700 },
  resetBtn: {
    font: "inherit",
    fontSize: 11,
    fontWeight: 600,
    color: "#22a1e3",
    background: "transparent",
    border: "1px solid #22a1e3",
    borderRadius: 6,
    padding: "3px 10px",
    cursor: "pointer",
  },
  field: { display: "flex", flexDirection: "column", gap: 4 },
  fieldLabel: { fontSize: 12, fontWeight: 600 },
  input: {
    font: "inherit",
    fontSize: 13,
    padding: "8px 10px",
    border: "1px solid #cbd5e1",
    borderRadius: 6,
    outline: "none",
  },
  fieldKey: { fontSize: 10, color: "#9ca3af", fontFamily: "monospace" },
  preview: {
    flex: 1,
    padding: 24,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    maxHeight: "100vh",
    boxSizing: "border-box",
  },
  previewHeader: {
    marginBottom: 16,
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
    flexWrap: "wrap",
  },
  previewTitle: { margin: 0, fontSize: 16, fontWeight: 700 },
  toolbar: { display: "flex", alignItems: "center", gap: 10 },
  tabs: {
    display: "inline-flex",
    background: "#e5e7eb",
    borderRadius: 8,
    padding: 3,
    gap: 3,
  },
  tab: {
    font: "inherit",
    fontSize: 12,
    fontWeight: 600,
    color: "#4b5563",
    background: "transparent",
    border: "none",
    borderRadius: 6,
    padding: "6px 12px",
    cursor: "pointer",
  },
  tabActive: { background: "#ffffff", color: "#111827" },
  copyBtn: {
    font: "inherit",
    fontSize: 12,
    fontWeight: 600,
    color: "#ffffff",
    background: "#22a1e3",
    border: "none",
    borderRadius: 6,
    padding: "7px 14px",
    cursor: "pointer",
  },
  iframe: {
    flex: 1,
    width: "100%",
    border: "1px solid #e2e8f0",
    borderRadius: 8,
    background: "#ffffff",
  },
  code: {
    flex: 1,
    margin: 0,
    overflow: "auto",
    background: "#0f172a",
    color: "#e2e8f0",
    border: "1px solid #1e293b",
    borderRadius: 8,
    padding: 16,
    fontSize: 12,
    lineHeight: 1.5,
    fontFamily:
      "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },
  previewCanvas: {
    flex: 1,
    overflow: "auto",
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 8,
  },
  muted: { margin: "4px 0 0", fontSize: 12, color: "#6b7280" },
};
