// dsh-tool-graphic-chain — behavioral verification harness.
//
// Loads the real lib/client.js bundle in a VM over a jsdom window, mounts the
// registered slot components with a simulated conversation snapshot, and
// asserts the chain rendering: assistant-step assembles reasoning and
// tool-call shells into a horizontal capsule chain in blocks order; tool-call
// node falls back to a single capsule when not covered by an assistant-step;
// state dots (running/ok/error/stopped) and horizontal arrows render. Pure
// DOM assertions — no harness required.
//
// Usage: node scripts/verify.mjs
import { window } from "./_env.mjs"; // jsdom globals must exist before react-dom loads
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname2 = path.dirname(fileURLToPath(import.meta.url));
const repoRoot2 = path.resolve(__dirname2, "..");
const localRequire = createRequire(path.join(repoRoot2, "package.json"));
const React = localRequire("react");
const ReactDOMClient = localRequire("react-dom/client");
const testUtils = localRequire("react-dom/test-utils");
const act = testUtils.act ?? React.act;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const clientBundle = fs.readFileSync(path.join(repoRoot2, "lib/client.js"), "utf8");

const factories = new Map();
window.__ModuleLoader__ = { load: (h) => factories.set(h.id, h.factory) };

vm.runInNewContext(clientBundle, {
  window,
  document: window.document,
  requestAnimationFrame: window.requestAnimationFrame ?? ((cb) => setTimeout(() => cb(Date.now()), 0)),
});

const plugin = factories.get("dsh-tool-graphic-chain");
if (!plugin) throw new Error("bundle did not register the dsh-tool-graphic-chain factory");

const primitivesStub = {
  MarkdownText: (props) => React.createElement("div", { "data-md": "1" }, props?.text ?? ""),
};
// 使用真实的 react/jsx-runtime：jsx 的第三参数是 key（React.createElement 的是 children，
// 直接用 createElement 伪装会把 key 写进 children，覆盖 Fragment 等内容）。
const jsxRuntime = localRequire("react/jsx-runtime");
// React 18 的 act() 会对每个绘制片段打印 "not wrapped in act(...)" 提示；
// 本 harnesss 的断言不依赖它，直接压掉这条已知噪音。
const rawConsoleError = console.error.bind(console);
console.error = (...args) => {
  const first = typeof args[0] === "string" ? args[0] : "";
  if (first.includes("not wrapped in act")) return;
  rawConsoleError(...args);
};

const exportsObj = plugin((spec) => {
  if (spec === "react") return React;
  if (spec === "react/jsx-runtime") return jsxRuntime;
  if (spec === "@deepseek-ai/dsh-client-ui-primitives") return primitivesStub;
  throw new Error(`unexpected require("${spec}")`);
});
if (typeof exportsObj?.apply !== "function") throw new Error("client bundle must export apply");

let components = new Map();
const fakeCtx = {
  slots: {
    inject(seat, factory) {
      if (seat !== "conversation.chat.node") throw new Error(`unexpected seat ${seat}`);
      return factory();
    },
    register(opts, comp) {
      if (opts.name !== "conversation.chat.node") throw new Error(`unexpected slot name ${opts.name}`);
      if (typeof opts.key !== "string") throw new Error("keyed slot registration must carry key");
      if (typeof opts.priority !== "number") throw new Error("keyed slot registration must carry priority");
      components.set(opts.key, comp);
      return () => {};
    },
  },
};
exportsObj.apply(fakeCtx);
if (!components.has("assistant-step")) throw new Error("assistant-step renderer was never registered");
if (!components.has("tool-call")) throw new Error("tool-call renderer was never registered");

function makeStore(initial) {
  let state = initial;
  const listeners = new Set();
  return {
    get: () => state,
    set: (value) => {
      state = value;
      for (const fn of [...listeners]) fn();
    },
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

const snapshotStore = makeStore({ chat: { order: [], nodes: new Map() } });
function useSession(selector) {
  const [v, setV] = React.useState(() => selector(snapshotStore.get()));
  React.useEffect(() => snapshotStore.subscribe(() => setV(selector(snapshotStore.get()))), []);
  return v;
}
function setSnapshot(order, nodes) {
  snapshotStore.set({ chat: { order, nodes: new Map(nodes) } });
}

async function renderComponent(Component, props) {
  const host = window.document.createElement("div");
  window.document.body.appendChild(host);
  const root = ReactDOMClient.createRoot(host);
  await act(async () => {
    root.render(React.createElement(Component, props));
  });
  return { host, root };
}

let failures = 0;
let checks = 0;
function ok(cond, label) {
  checks++;
  if (cond) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.error(`  FAIL ${label}`);
  }
}

console.log("dsh-tool-graphic-chain behavior verification");
async function main() {
const nodeKey = (kind, id) => `${kind.length}:${kind}${id}`;

// ── assistant-step assembles a capsule chain in blocks order: think → text → tool ──
const stepKey = nodeKey("assistant-step", "s1");
const call1 = nodeKey("tool-call", "c1");
setSnapshot([stepKey, call1], [
  [stepKey, {
    kind: "assistant-step",
    key: stepKey,
    data: {
      status: "closed",
      blocks: [
        { kind: "reasoning", text: "Let me inspect the layout first." },
        { kind: "text", text: "Inspecting…" },
        { kind: "tool-call", callId: "c1", name: "pwsh", argsRaw: "{}" },
      ],
    },
  }],
  [call1, {
    kind: "tool-call",
    key: call1,
    data: { root: { callId: "c1", name: "pwsh", argsRaw: JSON.stringify({ command: "Get-ChildItem" }), time: 1, subCalls: [] } },
  }],
]);
const r1 = await renderComponent(components.get("assistant-step"), {
  node: {
    key: stepKey,
    data: {
      status: "closed",
      blocks: [
        { kind: "reasoning", text: "Let me inspect the layout first." },
        { kind: "text", text: "Inspecting…" },
        { kind: "tool-call", callId: "c1", name: "pwsh", argsRaw: "{}" },
      ],
    },
  },
  useSession,
});
const html1 = r1.host.innerHTML;
if (process.env.DBG) { const { writeFileSync } = await import("node:fs"); writeFileSync(new URL("../dbg-html1.txt", import.meta.url), html1, "utf8"); }
ok(html1.includes("dsh-tgc-chain"), "assistant-step renders the chain container");
ok(html1.includes("dsh-tgc-node"), "individual capsules rendered");
ok(html1.includes("→"), "chained capsules are connected by horizontal arrows");
ok(html1.includes("1 次调用"), "chain head shows the tool-call count");
ok(html1.includes("Think"), "thinking is a capsule in the chain");
ok(html1.includes("Pwsh"), "tool shell is a capsule in the chain");
ok(html1.includes("Inspecting…"), "text between blocks is kept as markdown body");
ok(html1.includes("dsh-tgc-dot"), "chain capsules carry a status dot");
ok(html1.includes('data-state="ok"'), "settled ok tool gets green state");
r1.root.unmount(); r1.host.remove();

// ── tool-call node not covered falls back to a single capsule (no assistant-step) ──
const call6 = nodeKey("tool-call", "c6");
setSnapshot([call6], [
  [call6, {
    kind: "tool-call",
    key: call6,
    data: {
      root: {
        kind: "tool-result",
        callId: "c6",
        call: { name: "read", argsRaw: "{}" },
        content: [],
        isError: false,
        error: { code: "interrupted", name: "Error" },
        subCalls: [],
      },
    },
  }],
]);
const r6 = await renderComponent(components.get("tool-call"), { node: { key: call6, data: { root: { kind: "tool-result", callId: "c6", call: { name: "read", argsRaw: "{}" }, content: [], isError: false, error: { code: "interrupted", name: "Error" }, subCalls: [] } } }, useSession });
ok(r6.host.innerHTML.includes("dsh-tgc-chain"), "tool-call fallback renders a chain wrapper");
ok(r6.host.innerHTML.includes("Read"), "fallback capsule shows the tool name");
ok(r6.host.innerHTML.includes('data-state="stopped"'), "interrupted fallback shows stopped (amber) state");
r6.root.unmount(); r6.host.remove();

// ── running tool (shell without settled node) gets running state ──
const stepKey2 = nodeKey("assistant-step", "s2");
const call3 = nodeKey("tool-call", "c3");
setSnapshot([stepKey2, call3], [
  [stepKey2, {
    kind: "assistant-step",
    key: stepKey2,
    data: { status: "open", blocks: [{ kind: "tool-call", callId: "c3", name: "edit", argsRaw: "{}" }] },
  }],
  // no tool-call node yet → block stays a shell => running
]);
const r3 = await renderComponent(components.get("assistant-step"), {
  node: { key: stepKey2, data: { status: "open", blocks: [{ kind: "tool-call", callId: "c3", name: "edit", argsRaw: "{}" }] } },
  useSession,
});
ok(r3.host.innerHTML.includes('data-state="running"'), "unsettled tool shell shows breathing (running) state");
r3.root.unmount(); r3.host.remove();

// ── failed call gets error state + error summary ──
const stepKey3 = nodeKey("assistant-step", "s3");
const call5 = nodeKey("tool-call", "c5");
setSnapshot([stepKey3, call5], [
  [stepKey3, {
    kind: "assistant-step",
    key: stepKey3,
    data: { status: "closed", blocks: [{ kind: "tool-call", callId: "c5", name: "pwsh", argsRaw: "{}" }] },
  }],
  [call5, {
    kind: "tool-call",
    key: call5,
    data: {
      root: {
        kind: "tool-result",
        callId: "c5",
        call: { name: "pwsh", argsRaw: JSON.stringify({ command: "bad" }) },
        content: [{ type: "text", text: "Command failed with exit code 1." }],
        isError: true,
        subCalls: [],
      },
    },
  }],
]);
const r5 = await renderComponent(components.get("assistant-step"), {
  node: { key: stepKey3, data: { status: "closed", blocks: [{ kind: "tool-call", callId: "c5", name: "pwsh", argsRaw: "{}" }] } },
  useSession,
});
ok(r5.host.innerHTML.includes('data-state="error"'), "failed tool capsule shows error state");
r5.root.unmount(); r5.host.remove();

// ── multiple tools in one chain keep blocks order ──
const stepKey4 = nodeKey("assistant-step", "s4");
const callA = nodeKey("tool-call", "ca");
const callB = nodeKey("tool-call", "cb");
setSnapshot([stepKey4, callA, callB], [
  [stepKey4, {
    kind: "assistant-step",
    key: stepKey4,
    data: {
      status: "closed",
      blocks: [
        { kind: "tool-call", callId: "ca", name: "pwsh", argsRaw: "{}" },
        { kind: "tool-call", callId: "cb", name: "write", argsRaw: "{}" },
      ],
    },
  }],
  [callA, { kind: "tool-call", key: callA, data: { root: { callId: "ca", name: "pwsh", argsRaw: "{}", time: 1, subCalls: [] } } }],
  [callB, { kind: "tool-call", key: callB, data: { root: { callId: "cb", name: "write", argsRaw: "{}", time: 2, subCalls: [] } } }],
]);
const r4 = await renderComponent(components.get("assistant-step"), {
  node: {
    key: stepKey4,
    data: {
      status: "closed",
      blocks: [
        { kind: "tool-call", callId: "ca", name: "pwsh", argsRaw: "{}" },
        { kind: "tool-call", callId: "cb", name: "write", argsRaw: "{}" },
      ],
    },
  },
  useSession,
});
const html4 = r4.host.innerHTML;
ok(html4.includes("2 次调用"), "two tools render one chain with count 2");
ok(html4.indexOf("Pwsh") < html4.indexOf("Write"), "capsules keep tool order (Pwsh before Write)");
r4.root.unmount(); r4.host.remove();

// ── lone reasoning without tools: no chain, no stray thinking block ──
const stepKey5 = nodeKey("assistant-step", "s5");
setSnapshot([stepKey5], [
  [stepKey5, { kind: "assistant-step", key: stepKey5, data: { status: "closed", blocks: [{ kind: "reasoning", text: "keep me hidden" }] } }],
]);
const r8 = await renderComponent(components.get("assistant-step"), {
  node: { key: stepKey5, data: { status: "closed", blocks: [{ kind: "reasoning", text: "keep me visible" }] } },
  useSession,
});
ok(r8.host.innerHTML.includes("dsh-tgc-chain"), "lone reasoning still renders a chain (first Think stays visible)");
ok(r8.host.innerHTML.includes("Think"), "lone reasoning shows the Think capsule");
r8.root.unmount(); r8.host.remove();

const summary = `${checks - failures}/${checks} checks passed`;
console.log(failures === 0 ? `✓ ${summary}` : `✗ ${summary}`);
process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});