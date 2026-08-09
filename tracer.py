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

# Executed under its own filename before the user's code, so it is invisible to
# the tracer and — critically — does not shift the user's line numbers by even
# one. LeetCode provides all of this implicitly; locally it is a NameError.
PRELUDE = '''
from typing import List, Dict, Set, Tuple, Optional, Any, Union, Deque, DefaultDict
import collections, heapq, math, bisect, itertools, functools, re, string
from collections import defaultdict, deque, Counter, OrderedDict
from functools import lru_cache

try:
    from functools import cache
except ImportError:
    cache = lru_cache(maxsize=None)


class ListNode:
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next

    def __repr__(self):
        parts, node, seen = [], self, set()
        while node is not None and len(parts) < 12:
            if id(node) in seen:
                parts.append("<cycle>")
                break
            seen.add(id(node))
            parts.append(str(node.val))
            node = node.next
        if node is not None and len(parts) >= 12:
            parts.append("...")
        return " -> ".join(parts)


class TreeNode:
    def __init__(self, val=0, left=None, right=None):
        self.val = val
        self.left = left
        self.right = right

    def __repr__(self):
        return "TreeNode(" + str(self.val) + ")"


def build_list(values):
    """build_list([1,2,3]) -> 1 -> 2 -> 3"""
    head = None
    for value in reversed(values):
        head = ListNode(value, head)
    return head


def build_tree(values):
    """build_tree([3,9,20,None,None,15,7]) from LeetCode level order."""
    if not values:
        return None
    root = TreeNode(values[0])
    queue = [root]
    index = 1
    while queue and index < len(values):
        node = queue.pop(0)
        if index < len(values) and values[index] is not None:
            node.left = TreeNode(values[index])
            queue.append(node.left)
        index += 1
        if index < len(values) and values[index] is not None:
            node.right = TreeNode(values[index])
            queue.append(node.right)
        index += 1
    return root
'''


class Tracer:
    def __init__(self, hidden=(), class_names=()):
        self.steps = []
        self.edges = {}
        self.call_counts = {}
        self.stack = []
        self.max_depth = 1
        self.overflow = False
        self.hidden = set(hidden)
        self.class_names = set(class_names)

    def _snapshot(self, frame):
        out = {}
        for name, value in frame.f_locals.items():
            if name.startswith("__") or name in self.hidden:
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
            if self.stack and func not in self.class_names:
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
                if not isinstance(sub, ast.Call):
                    continue
                target = None
                if isinstance(sub.func, ast.Name):
                    target = sub.func.id
                elif isinstance(sub.func, ast.Attribute):
                    # self.dfs(...) and Solution().twoSum(...) both land here
                    target = sub.func.attr
                if target in defined:
                    edges.add((scope, target))

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
    buffer = io.StringIO()
    error = None

    code = compile(source, FILENAME, "exec")
    globals_dict = {"__name__": "__main__"}
    exec(compile(PRELUDE, "<prelude>", "exec"), globals_dict)
    hidden = set(globals_dict.keys())

    class_names = {n.name for n in ast.walk(tree) if isinstance(n, ast.ClassDef)}
    tracer = Tracer(hidden=hidden, class_names=class_names)

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
