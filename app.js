const SAMPLES = {
  leetcode: {
    code: `class Solution:
    def twoSum(self, nums: List[int], target: int) -> List[int]:
        dict_ = {}
        for i in range(len(nums)):
            reminder = target - nums[i]
            if reminder in dict_:
                return [i, dict_[reminder]]
            dict_[nums[i]] = i
        return None
`,
    driver: `print(Solution().twoSum([2, 7, 11, 15], 9))`,
  },
  fib: {
    code: `def fib(n):
    if n <= 1:
        return n
    return fib(n - 1) + fib(n - 2)
`,
    driver: `print(fib(6))`,
  },
  bubble: {
    code: `def bubble_sort(nums):
    n = len(nums)
    for i in range(n):
        swapped = False
        for j in range(n - i - 1):
            if nums[j] > nums[j + 1]:
                nums[j], nums[j + 1] = nums[j + 1], nums[j]
                swapped = True
        if not swapped:
            break
    return nums
`,
    driver: `print(bubble_sort([5, 1, 4, 2, 8]))`,
  },
  binary: {
    code: `def binary_search(nums, target):
    left, right = 0, len(nums) - 1
    while left <= right:
        mid = (left + right) // 2
        if nums[mid] == target:
            return mid
        if nums[mid] < target:
            left = mid + 1
        else:
            right = mid - 1
    return -1
`,
    driver: `print(binary_search([1, 3, 5, 7, 9, 11], 9))`,
  },
  subsets: {
    code: `class Solution:
    def subsets(self, nums: List[int]) -> List[List[int]]:
        out = []

        def backtrack(start, path):
            out.append(path[:])
            for i in range(start, len(nums)):
                path.append(nums[i])
                backtrack(i + 1, path)
                path.pop()

        backtrack(0, [])
        return out
`,
    driver: `print(Solution().subsets([1, 2, 3]))`,
  },
  linked: {
    code: `class Solution:
    def reverseList(self, head: Optional[ListNode]) -> Optional[ListNode]:
        prev = None
        while head:
            nxt = head.next
            head.next = prev
            prev = head
            head = nxt
        return prev
`,
    driver: `print(Solution().reverseList(build_list([1, 2, 3, 4, 5])))`,
  },
};

const el = (id) => document.getElementById(id);
const editor = el("editor");
const driver = el("driver");
const viewer = el("viewer");
const ribbon = el("ribbon");
const bootDot = el("boot-dot");
const runBtn = el("run");

let steps = [];
let spans = {};
let current = 0;
let timer = null;
let lineNodes = [];

loadSample("leetcode");

function loadSample(key) {
  editor.value = SAMPLES[key].code;
  driver.value = SAMPLES[key].driver;
  toEditMode();
}

el("sample").addEventListener("change", (e) => loadSample(e.target.value));

/* ---------- guessing a call for pasted LeetCode code ---------- */

function placeholderFor(name) {
  const n = name.toLowerCase();
  if (n === "head" || /^list\d?$/.test(n)) return "build_list([1, 2, 3])";
  if (n === "root") return "build_tree([3, 9, 20, None, None, 15, 7])";
  if (n.startsWith("nums") || n.startsWith("arr") || n === "prices" || n === "heights")
    return "[2, 7, 11, 15]";
  if (n === "matrix" || n === "grid" || n === "board") return "[[1, 2], [3, 4]]";
  if (["target", "k", "n", "x", "amount", "capacity"].includes(n)) return "9";
  if (["s", "t", "word", "text", "p"].includes(n) || n.includes("str")) return '"abc"';
  if (n === "words" || n === "strs") return '["ab", "cd"]';
  return "None";
}

function argsFrom(paramText) {
  return paramText
    .split(",")
    .map((p) => p.split(":")[0].split("=")[0].trim())
    .filter(Boolean)
    .map(placeholderFor)
    .join(", ");
}

function suggestDriver(source) {
  const cls = source.match(/^\s*class\s+(\w+)/m);
  if (cls) {
    const methods = [...source.matchAll(/^\s*def\s+(\w+)\s*\(\s*self\s*,?([\s\S]*?)\)\s*(->[^:]*)?:/gm)];
    const pick = methods.find((m) => !m[1].startsWith("_")) || methods[0];
    if (pick) return `print(${cls[1]}().${pick[1]}(${argsFrom(pick[2])}))`;
  }
  const fn = source.match(/^def\s+(\w+)\s*\(([\s\S]*?)\)\s*(->[^:]*)?:/m);
  if (fn) return `print(${fn[1]}(${argsFrom(fn[2])}))`;
  return "";
}

el("suggest").addEventListener("click", () => {
  const guess = suggestDriver(editor.value);
  driver.value = guess || "# Could not find a function to call — write the call yourself";
  driver.focus();
});

editor.addEventListener("blur", () => {
  if (!driver.value.trim()) driver.value = suggestDriver(editor.value);
});

function fullSource() {
  const body = editor.value.replace(/\s+$/, "");
  const call = driver.value.trim();
  return call ? body + "\n\n" + call + "\n" : body + "\n";
}

/* ---------- worker ---------- */

const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });

worker.onmessage = ({ data }) => {
  if (data.type === "status") {
    runBtn.textContent = data.text + "…";
    bootDot.className = "dot busy";
  }
  if (data.type === "ready") {
    runBtn.disabled = false;
    runBtn.textContent = "Record run";
    bootDot.className = "dot ready";
  }
  if (data.type === "fatal") {
    bootDot.className = "dot failed";
    runBtn.disabled = false;
    runBtn.textContent = "Record run";
    el("now").innerHTML = `<div class="runerror">${escapeHtml(data.text)}</div>`;
  }
  if (data.type === "result") {
    runBtn.disabled = false;
    runBtn.textContent = "Record run";
    bootDot.className = "dot ready";
    consume(data.payload);
  }
};

runBtn.addEventListener("click", () => {
  stopPlaying();
  runBtn.disabled = true;
  runBtn.textContent = "Recording…";
  bootDot.className = "dot busy";
  worker.postMessage({ type: "run", source: fullSource() });
});

/* ---------- results ---------- */

function consume(result) {
  if (!result.ok) {
    el("now").innerHTML = `<div class="runerror">${escapeHtml(result.error)}${
      result.errorLine ? ` (line ${result.errorLine})` : ""
    }</div>`;
    return;
  }

  steps = result.steps;
  spans = result.spans || {};
  current = 0;

  renderSource(fullSource());
  renderMetrics(result);
  renderGraph(result);

  el("scrub").max = String(Math.max(steps.length - 1, 0));
  el("scrub").value = "0";

  toTraceMode();
  drawRibbon();
  seek(0);
}

function toTraceMode() {
  editor.hidden = true;
  el("driver-row").hidden = true;
  viewer.hidden = false;
  el("edit").hidden = false;
  el("mode-tag").textContent = "replaying";
}

function toEditMode() {
  stopPlaying();
  editor.hidden = false;
  el("driver-row").hidden = false;
  viewer.hidden = true;
  el("edit").hidden = true;
  el("mode-tag").textContent = "editing";
}

el("edit").addEventListener("click", toEditMode);

function renderSource(src) {
  viewer.innerHTML = "";
  lineNodes = [];
  src.split("\n").forEach((text, index) => {
    const row = document.createElement("div");
    row.className = "ln";
    row.dataset.line = String(index + 1);
    row.innerHTML =
      `<span class="no">${index + 1}</span><span class="src">${escapeHtml(text) || " "}</span>`;
    viewer.appendChild(row);
    lineNodes.push(row);
  });
}

/* ---------- the step player ---------- */

function previousInSameFrame(index) {
  const cur = steps[index];
  for (let j = index - 1; j >= 0; j--) {
    if (steps[j].depth < cur.depth) return null;
    if (steps[j].depth === cur.depth && steps[j].func === cur.func) return steps[j];
  }
  return null;
}

function seek(index) {
  if (!steps.length) return;
  current = Math.max(0, Math.min(index, steps.length - 1));
  const step = steps[current];

  const span = spans[step.func];
  lineNodes.forEach((node, i) => {
    const lineNo = i + 1;
    node.classList.toggle("hot", lineNo === step.line);
    node.classList.toggle("inframe", !!span && lineNo >= span[0] && lineNo <= span[1]);
  });

  const hot = lineNodes[step.line - 1];
  if (hot) {
    const box = viewer.getBoundingClientRect();
    const spot = hot.getBoundingClientRect();
    if (spot.top < box.top || spot.bottom > box.bottom) {
      hot.scrollIntoView({ block: "center", behavior: "auto" });
    }
  }

  renderMoment(step, previousInSameFrame(current));

  el("scrub").value = String(current);
  el("counter").textContent = `${current + 1} / ${steps.length}`;
  drawRibbon();
}

function renderMoment(step, prior) {
  const changed = [];
  for (const [name, value] of Object.entries(step.locals)) {
    if (!prior || prior.locals[name] !== value) changed.push([name, value, prior ? prior.locals[name] : undefined]);
  }

  let headline;
  if (step.event === "call") {
    headline = `entered <span class="k">${escapeHtml(step.func)}</span>`;
  } else if (step.event === "return") {
    headline = `<span class="k">${escapeHtml(step.func)}</span> returns ${escapeHtml(step.ret ?? "None")}`;
  } else if (step.event === "exception") {
    headline = `exception raised in <span class="k">${escapeHtml(step.func)}</span>`;
  } else {
    headline = `about to run line <span class="k">${step.line}</span> in ${escapeHtml(step.func)}`;
  }

  let contribution;
  if (step.event === "return") {
    contribution = `Hands <code>${escapeHtml(step.ret ?? "None")}</code> back to the caller and drops this frame.`;
  } else if (step.event === "call" && Object.keys(step.locals).length) {
    contribution = "Opens a new frame with " +
      Object.entries(step.locals).map(([k, v]) => `<code>${escapeHtml(k)} = ${escapeHtml(v)}</code>`).join(", ") + ".";
  } else if (changed.length) {
    contribution = changed.map(([k, v, was]) =>
      was === undefined
        ? `<code>${escapeHtml(k)}</code> appears as <code>${escapeHtml(v)}</code>`
        : `<code>${escapeHtml(k)}</code> goes <code>${escapeHtml(was)}</code> &rarr; <code>${escapeHtml(v)}</code>`
    ).join("<br>");
  } else {
    contribution = `<span class="none">No variable changed. This line only decided where to go next.</span>`;
  }

  const rows = Object.entries(step.locals).map(([name, value]) => {
    const isChanged = changed.some(([c]) => c === name);
    return `<tr class="${isChanged ? "changed" : ""}"><td class="name">${escapeHtml(name)}</td><td class="val">${escapeHtml(value)}</td></tr>`;
  }).join("");

  el("now").innerHTML = `
    <p class="event-line">${headline}</p>
    <p class="stackline">depth <b>${step.depth}</b> &middot; step ${current + 1} of ${steps.length}</p>
    <div class="sub">What this step contributes</div>
    <div class="contrib">${contribution}</div>
    <div class="sub">Local variables</div>
    ${rows ? `<table class="vars">${rows}</table>` : `<p class="empty">No locals in this frame yet.</p>`}
  `;
}

/* ---------- depth ribbon ---------- */

function drawRibbon() {
  const dpr = window.devicePixelRatio || 1;
  const width = ribbon.clientWidth || 600;
  const height = 120;
  ribbon.width = Math.floor(width * dpr);
  ribbon.height = Math.floor(height * dpr);

  const ctx = ribbon.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  if (!steps.length) return;

  let maxDepth = 1;
  for (const s of steps) if (s.depth > maxDepth) maxDepth = s.depth;

  const pad = 12;
  const usable = height - pad * 2;

  ctx.fillStyle = "#31556b";
  for (let x = 0; x < width; x++) {
    const from = Math.floor((x / width) * steps.length);
    const to = Math.max(from + 1, Math.floor(((x + 1) / width) * steps.length));
    let depth = 0;
    for (let k = from; k < to && k < steps.length; k++) {
      if (steps[k].depth > depth) depth = steps[k].depth;
    }
    if (!depth) continue;
    const barHeight = (depth / maxDepth) * usable;
    ctx.fillRect(x, height - pad - barHeight, 1, barHeight);
  }

  const headX = (current / Math.max(steps.length - 1, 1)) * width;
  ctx.fillStyle = "#e8a33d";
  ctx.fillRect(Math.min(headX, width - 2), 0, 2, height);
}

function seekFromPointer(event) {
  const rect = ribbon.getBoundingClientRect();
  const ratio = (event.clientX - rect.left) / rect.width;
  seek(Math.round(ratio * (steps.length - 1)));
}

let dragging = false;
ribbon.addEventListener("pointerdown", (e) => {
  if (!steps.length) return;
  dragging = true;
  ribbon.setPointerCapture(e.pointerId);
  stopPlaying();
  seekFromPointer(e);
});
ribbon.addEventListener("pointermove", (e) => { if (dragging) seekFromPointer(e); });
ribbon.addEventListener("pointerup", () => { dragging = false; });
window.addEventListener("resize", drawRibbon);

/* ---------- transport ---------- */

el("scrub").addEventListener("input", (e) => { stopPlaying(); seek(Number(e.target.value)); });
el("first").addEventListener("click", () => { stopPlaying(); seek(0); });
el("last").addEventListener("click", () => { stopPlaying(); seek(steps.length - 1); });
el("prev").addEventListener("click", () => { stopPlaying(); seek(current - 1); });
el("next").addEventListener("click", () => { stopPlaying(); seek(current + 1); });
el("play").addEventListener("click", () => (timer ? stopPlaying() : startPlaying()));

function startPlaying() {
  if (!steps.length) return;
  if (current >= steps.length - 1) seek(0);
  el("play").textContent = "Pause";
  const interval = 1000 / Number(el("speed").value);
  timer = setInterval(() => {
    if (current >= steps.length - 1) return stopPlaying();
    seek(current + 1);
  }, interval);
}

function stopPlaying() {
  if (timer) clearInterval(timer);
  timer = null;
  el("play").textContent = "Play";
}

el("speed").addEventListener("input", () => { if (timer) { stopPlaying(); startPlaying(); } });

document.addEventListener("keydown", (e) => {
  const typing = document.activeElement === editor || document.activeElement === driver;
  if (typing || !steps.length) return;
  if (e.key === "ArrowRight") { stopPlaying(); seek(current + 1); e.preventDefault(); }
  if (e.key === "ArrowLeft") { stopPlaying(); seek(current - 1); e.preventDefault(); }
  if (e.key === " ") { timer ? stopPlaying() : startPlaying(); e.preventDefault(); }
});

/* ---------- call graph ---------- */

function renderGraph(result) {
  const names = new Set(["<module>", ...Object.keys(result.spans || {})]);
  result.runtimeEdges.forEach((e) => { names.add(e.from); names.add(e.to); });
  result.staticEdges.forEach(([a, b]) => { names.add(a); names.add(b); });

  const ran = new Map();
  result.runtimeEdges.forEach((e) => ran.set(e.from + "|" + e.to, e.count));

  const elements = [];
  names.forEach((n) => elements.push({ data: { id: n, label: n } }));

  ran.forEach((count, key) => {
    const [from, to] = key.split("|");
    elements.push({
      data: { id: "r" + key, source: from, target: to, label: "x" + count, weight: 1 + Math.log2(count + 1) },
      classes: "ran",
    });
  });

  result.staticEdges.forEach(([from, to]) => {
    if (ran.has(from + "|" + to)) return;
    elements.push({ data: { id: "s" + from + to, source: from, target: to, label: "never", weight: 1 }, classes: "cold" });
  });

  cytoscape({
    container: el("graph"),
    elements,
    style: [
      { selector: "node", style: {
        "background-color": "#1e2531", "border-width": 1, "border-color": "#3d4a5c",
        label: "data(label)", color: "#ccd3de", "font-family": "IBM Plex Mono, monospace",
        "font-size": 11, "text-valign": "center", shape: "round-rectangle",
        width: "label", height: 26, "padding": 8,
      }},
      { selector: "edge", style: {
        "curve-style": "bezier", "target-arrow-shape": "triangle",
        label: "data(label)", "font-family": "IBM Plex Mono, monospace",
        "font-size": 9, color: "#7f8b9d", "text-background-color": "#171d26",
        "text-background-opacity": 1, "text-background-padding": 2,
        "loop-direction": "0deg", "loop-sweep": "-40deg",
      }},
      { selector: ".ran", style: {
        "line-color": "#e8a33d", "target-arrow-color": "#e8a33d", width: "data(weight)",
      }},
      { selector: ".cold", style: {
        "line-color": "#3d4a5c", "target-arrow-color": "#3d4a5c",
        "line-style": "dashed", width: 1,
      }},
    ],
    layout: { name: "breadthfirst", directed: true, padding: 18, spacingFactor: 1.1 },
  });
}

/* ---------- metrics ---------- */

function renderMetrics(result) {
  const m = result.metrics;
  const calls = Object.entries(m.callCounts).sort((a, b) => b[1] - a[1]);

  el("metrics").innerHTML = `
    <div class="stat"><span>Lines executed</span><span>${m.lineEvents.toLocaleString()}</span></div>
    <div class="stat"><span>Recorded steps</span><span>${m.totalSteps.toLocaleString()}</span></div>
    <div class="stat"><span>Deepest stack</span><span>${m.maxDepth}</span></div>
    ${calls.map(([name, count]) =>
      `<div class="stat"><span>${escapeHtml(name)} called</span><span>${count.toLocaleString()}x</span></div>`).join("")}
    <div class="guess">
      <div class="big">${escapeHtml(result.complexity.guess)}</div>
      <div class="why">${escapeHtml(result.complexity.why)} This is a static guess, not a proof &mdash; derive it yourself and check.</div>
    </div>
    ${result.stdout ? `<div class="stdout">${escapeHtml(result.stdout)}</div>` : ""}
    ${result.error ? `<div class="runerror">${escapeHtml(result.error)}</div>` : ""}
  `;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
