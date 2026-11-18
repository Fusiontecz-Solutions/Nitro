import { pdfjs } from "react-pdf";

// Must match react-pdf's pdfjs-dist (4.8.69). Vite copies that worker to
// /pdf.worker.min.mjs. A hoisted 4.10+ worker fails with
// "API version does not match the Worker version".
pdfjs.GlobalWorkerOptions.workerSrc = `${import.meta.env.BASE_URL}pdf.worker.min.mjs`;
