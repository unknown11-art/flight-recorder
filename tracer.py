"""Execution recorder.

Runs a snippet of user code under sys.settrace and records one entry per
executed line. The recording is replayed in the browser, which is why every
value is frozen to a string at capture time rather than stored by reference.
"""

import sys
import ast
import io
import json
import contextlib

FILENAME = "<user>"
MAX_STEPS = 20000
MAX_REPR = 160


class Tracer:
    def __init__(self):
        self.steps = []
        self.edges = {}
        self.call_counts = {}
        self.stack = []
        self.max_depth = 1
        self.overflow = False

    def _snapshot(self, frame):
        out = {}
        for name, value in frame.f_locals.items():
            if name.startswith("__"):
                continue
            try:
                text = repr(value)
            except Exception:
                text = "<unrepresentable>"
            if len(text) > MAX_REPR:
                text = text[:MAX_REPR] + " ..."
            out[name] = text
        return out

    def trace(self, frame, event, arg):
        if frame.f_code.co_filename != FILENAME:
            return None

        if len(self.steps) >= MAX_STEPS:
            self.overflow = True
            raise RuntimeError("step limit reached")

        func = frame.f_code.co_name

        if event == "call":
            if self.stack:
                key = self.stack[-1] + "|" + func
                self.edges[key] = self.edges.get(key, 0) + 1
                self.call_counts[func] = self.call_counts.get(func, 0) + 1
            self.stack.append(func)
            if len(self.stack) > self.max_depth:
                self.max_depth = len(self.stack)

        returned = None
        if event == "return":
            try:
                returned = repr(arg)[:MAX_REPR]
            except Exception:
                returned = "<unrepresentable>"

        self.steps.append({
            "line": frame.f_lineno,
            "event": event,
            "func": func,
            "depth": len(self.stack),
            "locals": self._snapshot(frame),
            "ret": returned,
        })

        if event == "return" and self.stack:
            self.stack.pop()

        return self.trace


def _function_spans(tree):
    spans = {}
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            end = getattr(node, "end_lineno", node.lineno)
            spans[node.name] = [node.lineno, end]
    return spans


def _static_edges(tree):
    defined = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            defined.add(node.name)

    edges = set()

    def scan(scope, body):
        for stmt in body:
            for sub in ast.walk(stmt):
                if isinstance(sub, ast.Call) and isinstance(sub.func, ast.Name):
                    if sub.func.id in defined:
                        edges.add((scope, sub.func.id))

    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            scan(node.name, node.body)

    top = [n for n in tree.body
           if not isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))]
    scan("<module>", top)

    return [list(e) for e in sorted(edges)]


def _loop_depth(node, current=0):
    deepest = current
    for child in ast.iter_child_nodes(node):
        step = 1 if isinstance(child, (ast.For, ast.While, ast.AsyncFor)) else 0
        deepest = max(deepest, _loop_depth(child, current + step))
    return deepest


def _guess_complexity(tree, static_edges):
    """A deliberately crude heuristic. It reports its own reasoning so the
    user can disagree with it — that is the point, not the verdict."""
    self_calls = {}
    for caller, callee in static_edges:
        if caller == callee:
            self_calls[caller] = self_calls.get(caller, 0) + 1

    depth = 0
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            depth = max(depth, _loop_depth(node))
    depth = max(depth, _loop_depth(ast.Module(body=[
        n for n in tree.body
        if not isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
    ], type_ignores=[])))

    if self_calls:
        name = sorted(self_calls)[0]
        return {
            "guess": "exponential or tree-shaped",
            "why": name + " calls itself, so cost depends on how the "
                   "recursion branches. Read the depth ribbon, not this box.",
            "confident": False,
        }

    labels = {0: "O(1)", 1: "O(n)", 2: "O(n^2)", 3: "O(n^3)"}
    return {
        "guess": labels.get(depth, "O(n^" + str(depth) + ")"),
        "why": "Deepest loop nesting is " + str(depth) +
               ". Ignores what happens inside each iteration.",
        "confident": depth <= 1,
    }


def analyze(source):
    try:
        tree = ast.parse(source)
    except SyntaxError as exc:
        return json.dumps({
            "ok": False,
            "error": "SyntaxError: " + str(exc.msg),
            "errorLine": exc.lineno,
        })

    static_edges = _static_edges(tree)
    spans = _function_spans(tree)
    tracer = Tracer()
    buffer = io.StringIO()
    error = None

    code = compile(source, FILENAME, "exec")
    globals_dict = {"__name__": "__main__"}

    sys.settrace(tracer.trace)
    try:
        with contextlib.redirect_stdout(buffer):
            exec(code, globals_dict)
    except RuntimeError as exc:
        if not tracer.overflow:
            error = "RuntimeError: " + str(exc)
    except Exception as exc:
        error = type(exc).__name__ + ": " + str(exc)
    finally:
        sys.settrace(None)

    if tracer.overflow:
        error = ("Stopped after " + str(MAX_STEPS) +
                 " steps. Either the input is large or a loop never ends.")

    runtime_edges = [
        {"from": k.split("|")[0], "to": k.split("|")[1], "count": v}
        for k, v in tracer.edges.items()
    ]

    line_events = sum(1 for s in tracer.steps if s["event"] == "line")

    return json.dumps({
        "ok": True,
        "steps": tracer.steps,
        "runtimeEdges": runtime_edges,
        "staticEdges": static_edges,
        "spans": spans,
        "stdout": buffer.getvalue(),
        "error": error,
        "metrics": {
            "lineEvents": line_events,
            "totalSteps": len(tracer.steps),
            "maxDepth": tracer.max_depth,
            "callCounts": tracer.call_counts,
        },
        "complexity": _guess_complexity(tree, static_edges),
    })
