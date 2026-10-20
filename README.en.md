# dsh-tool-graphic-chain

English | [中文](README.md)

![license](https://img.shields.io/badge/license-MIT-green)
![dsh](https://img.shields.io/badge/dsh-plugin-4B32C3)
[![repo](https://img.shields.io/badge/repo-github-181717?logo=github)](https://github.com/NormanFxxkingRockwell/dsh-tool-graphic-chain)

**Collapse the one-row-per-tool-call wall into a single left-to-right capsule chain: reasoning and consecutive tool calls share one chain, and the model speaking out loud is what cuts it.**

## Install

```sh
dsh plugin --profile <your-profile> add dsh-tool-graphic-chain
```

Restart `dsh web` afterwards (refresh the browser once).

## What it looks like

```
› read all three insertion points first        · 3 calls
[Think] → [Grep] → [Grep] → [Read] → [Read]
```

- **One chain = one continuous stretch of work.** Reasoning (Think) and the tool calls that follow it are strung into a single chain instead of one row per call.
- **Prose cuts the chain.** When the model emits real text (e.g. "Major finding: …", "all three insertion points read, applying the edits:"), the current chain closes, the text renders as ordinary Markdown, and the next chain starts fresh.
- **State at a glance.** Running = breathing dot, success = green, failure = red (capsule border follows), interrupted = amber.
- **Tight horizontal layout.** Up to 7 capsules per row with `→` connectors, then it wraps. The chain header folds the whole chain.
- **Inspect any call.** Click a capsule to see that call's input/output.

## Also fixes a long-standing gap

DSH renders a `flowItem` shell for every conversation node. Nodes absorbed into a chain by this plugin have empty content, yet the shell still consumes its `16px` flex gap — long sessions pile up a large blank area at the bottom. The plugin hides only shells whose content is genuinely empty (via `:has()`), so the gap disappears and ordinary message nodes are untouched.

## Purity

It only takes over rendering of the `assistant-step` and `tool-call` nodes. No new tools, no model changes, no data changes; `user` / `turn-tail` / `compaction` nodes keep their stock behaviour.

## Development

```sh
npm install
npm run verify   # jsdom behavioural checks: chain assembly, arrows, state dots, cut grouping, empty-shell hiding
```

## License

MIT
