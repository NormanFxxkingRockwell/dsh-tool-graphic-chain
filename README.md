# dsh-tool-graphic-chain

[English](README.en.md) | 中文

![license](https://img.shields.io/badge/license-MIT-green)
![dsh](https://img.shields.io/badge/dsh-plugin-4B32C3)
[![repo](https://img.shields.io/badge/repo-github-181717?logo=github)](https://github.com/NormanFxxkingRockwell/dsh-tool-graphic-chain)

**把会话里一行一个的工具调用，压成一条从左往右的胶囊工具链：思考与连续调用串在同一条链上，模型中途说话才截断。**

## 安装

```sh
dsh plugin --profile <你的profile名> add dsh-tool-graphic-chain
```

装好后重启 `dsh web` 即可生效（浏览器需要刷新一次）。

## 效果

```
› 读清楚三处插入点才动手                    · 3 次调用
[Think] → [Grep] → [Grep] → [Read] → [Read]
```

- **一条链 = 一段连续动作**：思考（Think）与会话里连续发生的工具调用按发生顺序串成同一条链，不再一行一个占满屏幕。
- **模型说话就截断**：中间输出正文（比如「重大发现：原来……」「三处插入点都读到了」）时当前链收尾，正文以正常 Markdown 显示，之后继续开新链。
- **状态一目了然**：运行中呼吸灯、成功绿点、失败红点（胶囊边框同步变红）、中断黄点。
- **紧凑横排**：每行 7 颗胶囊自动换行，胶囊之间用 `→` 连接，间距紧凑；链头一行可点击折叠/展开整条链。
- **点开看细节**：点击胶囊弹出该次调用的入参/结果。

## 顺带修掉的老问题

DSH 会为每个会话节点渲染一个 `flowItem` 外壳；被本插件合并进链的 `tool-call` 节点内容为空，外壳仍占一个 `16px` 的 flex 间距，长会话底部会堆出大片空白。插件用 `:has()` 只隐藏「内容确实为空」的外壳，空白随之消失，正常的消息节点不受影响。

## 纯净

只接管 `assistant-step` 与 `tool-call` 两个节点的渲染，不注册新工具、不改模型、不改数据，`user` / `turn-tail` / `compaction` 等节点一切照旧。

## 开发

```sh
npm install
npm run verify   # jsdom 行为验证：链组装、箭头、状态灯、截断分组、空外壳隐藏
```

## License

MIT
