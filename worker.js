// Python runs here, off the main thread. If a user writes `while True:` the
// page stays responsive and the step limit inside tracer.py stops the run.
//
// If this ever 404s, Pyodide has shipped a new version. Bump both the import
// URL below and PYODIDE_BASE to the version listed at pyodide.org.

import { loadPyodide } from "https://cdn.jsdelivr.net/pyodide/v314.0.4/full/pyodide.mjs";

const PYODIDE_BASE = "https://cdn.jsdelivr.net/pyodide/v314.0.4/full/";

let pyodide = null;

async function boot() {
  postMessage({ type: "status", text: "Downloading the Python runtime" });
  pyodide = await loadPyodide({ indexURL: PYODIDE_BASE });

  postMessage({ type: "status", text: "Installing the recorder" });
  const response = await fetch(new URL("./tracer.py", import.meta.url));
  if (!response.ok) throw new Error("Could not load tracer.py");
  pyodide.runPython(await response.text());

  postMessage({ type: "ready" });
}

const booted = boot().catch((err) => {
  postMessage({ type: "fatal", text: String(err) });
  throw err;
});

onmessage = async (event) => {
  if (event.data.type !== "run") return;
  try {
    await booted;
    const analyze = pyodide.globals.get("analyze");
    const json = analyze(event.data.source);
    analyze.destroy();
    postMessage({ type: "result", payload: JSON.parse(json) });
  } catch (err) {
    postMessage({ type: "fatal", text: String(err) });
  }
};
