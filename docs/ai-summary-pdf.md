# AI summary PDF export

Generate an AI health summary in Protection Lens, then choose **Export PDF** beside Refresh Insights. Choose A4 or US Letter, optionally include the expandable analysis notes, and select **Download PDF**.

The report contains every summary section, regardless of which tab is selected. It includes a cover, a linked table of contents, numbered sections, confidence labels supplied by the AI, recommendation and urgent callouts, and page numbers. Tables repeat their header across pages. Text is selectable and fonts are embedded in the file.

Export uses the completed summary already in the browser. It does not generate another analysis, call a provider, or store the report on the application server. Export is disabled during generation or after an error. The cover records the summary completion time when available; otherwise it records export time. The report reflects that point-in-time analysis.

Labels follow the selected application language. Noto Sans covers Latin and Cyrillic text, with script-specific fonts loaded only when needed for Hindi and Chinese/Japanese/Korean text. Fonts are served by the app, including in the standalone and Docker packages. Font licensing and sources are in `public/fonts/reports/`.

The PDF engine and Markdown parser load only when the user requests a download. Markdown images do not cause remote requests, raw HTML is ignored, and only HTTP, HTTPS and mail links become clickable. Download errors are shown in the export dialog with a retry action.

Run `npm run test:ai-integrations` for the shared section parsing, Markdown handling, multilingual content, real PDF rendering and existing AI request regressions. The representative layout fixture is `tests/fixtures/ai-health-summary.md` and is explicitly marked as illustrative data.
