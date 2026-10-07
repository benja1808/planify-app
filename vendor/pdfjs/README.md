PDF.js 4.10.38 — Mozilla, Apache-2.0 (see LICENSE).

Source: the pinned `pdfjs-dist` npm dependency, `legacy/build/pdf.mjs` and
`legacy/build/pdf.worker.mjs`. The vendored copies use the `.js` extension so
the existing static server serves the correct JavaScript MIME type. Both are
ES modules; they are loaded on demand by `vib-daily-import.js`.

The legacy build includes compatibility polyfills. PDF text extraction runs
in the browser with `isEvalSupported: false`; no PDF is uploaded to a service.
Keep both files on the same version when updating, and rerun the import tests.
