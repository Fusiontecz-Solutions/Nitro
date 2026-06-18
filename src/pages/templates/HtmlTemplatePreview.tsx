import { LetterHtmlPreviewFrame } from "./LetterHtmlPreviewFrame";
import type { TemplateComponentProps, TemplateValues } from "./types";

/** React preview tab for templates whose production output is inline HTML email. */
export function createHtmlTemplatePreview(
  renderHtml: (values: TemplateValues) => string,
  title = "Email HTML preview",
) {
  return function HtmlTemplatePreview({ values }: TemplateComponentProps) {
    return (
      <LetterHtmlPreviewFrame
        html={renderHtml(values)}
        title={title}
        className="h-[min(75vh,900px)] w-full rounded-md border bg-white"
      />
    );
  };
}
