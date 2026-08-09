# Flight recorder

Paste Python, record the run, then scrub through every line it executed.

No backend. CPython runs in the browser via Pyodide (WebAssembly), so the whole
thing is static files on GitHub Pages and your code never leaves your machine.

## What it does

- **Records, then replays.** `sys.settrace` captures one entry per executed line
  into an array. Because the run finishes before playback starts, you can step
  backwards and drag a scrubber — impossible with live stepping.
- **Depth ribbon.** Call-stack depth plotted across the whole run. On a recursive
  function you see the shape of the recursion tree and can click into any moment.
- **Per-step contribution.** Diffs local variables against the previous step *in
  the same frame*, so `left: 0 → 4` appears next to the line that caused it.
- **Call graph.** Solid amber edges ran (labelled with call counts), dashed grey
  edges exist in the source but never fired.
- **Measured metrics.** Lines executed, deepest stack, calls per function. Plus a
  clearly-labelled static Big-O *guess* you are meant to argue with.

## Run locally

The app uses ES modules and a Web Worker, so `file://` will not work. Serve it:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Deploy to GitHub Pages

```bash
git init
git add .
git commit -m "Flight recorder: browser-based Python execution tracer"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/flight-recorder.git
git push -u origin main
```

Then in the repo: **Settings → Pages → Source: Deploy from a branch → `main` / `/ (root)` → Save.**

Live in a minute or two at `https://YOUR-USERNAME.github.io/flight-recorder/`.
No build step, so there is no base-path configuration to get wrong.

## Layout

| File | Role |
|---|---|
| `src/tracer.py` | The recorder. `sys.settrace` hook, AST call graph, metrics. |
| `src/worker.js` | Boots Pyodide off the main thread, runs `analyze()`. |
| `src/app.js` | Step player, depth ribbon canvas, call graph, metrics. |
| `index.html` | Page shell. |
| `styles.css` | Styling. |

## Known limits

- First load downloads roughly 10 MB of WebAssembly. Cached afterwards.
- Runs stop at 20,000 steps (`MAX_STEPS` in `tracer.py`) so infinite loops end.
- Values are frozen with `repr()` at capture time and truncated to 160 chars.
- The complexity guess reads loop nesting and self-calls. It does not detect
  logarithmic behaviour, memoisation, or amortised cost. Treat it as a prompt.
- Pyodide version is pinned in `src/worker.js`. If the CDN 404s, bump it to the
  current version listed at pyodide.org.

## Ideas worth building next

- Detect halving loops to catch `O(log n)`.
- Run the snippet at several input sizes and plot measured steps against `n`.
- Click a call-graph node to jump to that function's first invocation.
