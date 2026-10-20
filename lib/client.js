// dsh-tool-graphic-chain — browser half.
//
// 把一轮用户请求里「思考（Think）与工具调用」按真实出现顺序，串成一条
// 可折叠的横向流水线（A → B → C → …）。每行固定容纳 CHAIN_PER_ROW 颗胶囊；
// 一行放不下的部分 ↓ 折回下一行，下一行从右往左（视觉箭头 ←），隔行换向
// （蛇形折返 / boustrophedon）。中间夹着的正文 text 独立显示在链下方。
//
// 状态灯：运行中 = 呼吸灯 / 成功 = 绿 / 失败 = 红 / 中断 = 黄。
// 点击任意胶囊展开详情（Think 原文 / 工具 IN/OUT），链头可折叠整条链。
// 收到消息后的第一个 Think 胶囊始终显示在链内（不因没有工具而消失）。
//
// 纯净原则：只接管 tool-call 与 assistant-step 两个 node 渲染，其余节点
// （user / turn-tail / compaction 等）、模型、工具一概不动。
window.__ModuleLoader__.load({
	id: "dsh-tool-graphic-chain",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		var react = require("react");
		var jsxRuntime = require("react/jsx-runtime");
		var primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		//#region constants
		/** 每行固定容纳的胶囊数量（蛇形折返的列数）。 */
		var CHAIN_PER_ROW = 7;
		//#endregion
		//#region helpers
		/** 从冻结的调用切片取 wire 工具名（running 与 settled 两种形态兼容）。 */
		function callNameOf(node) {
			return "kind" in node ? node.call?.name ?? "" : node.name ?? "";
		}
		/** 取调用参数原文（running / settled 两形态兼容）。 */
		function argsRawOf(block) {
			return "kind" in block ? block.call?.argsRaw ?? "" : block.argsRaw ?? "";
		}
		/** 由冻结切片推导运行状态：无 kind 字段 = 运行中；interrupted = 中断；isError = 失败；否则成功。 */
		function stateOf(block) {
			if (!("kind" in block)) return "running";
			if (block.error?.code === "interrupted") return "stopped";
			return block.isError ? "error" : "ok";
		}
		/** 扁平化结果文本（text 块直取，其他形状 JSON 化；空结果兜底错误行）。 */
		function resultTextOf(node) {
			if (!("kind" in node)) return "";
			const parts = [];
			for (const block of node.content || []) {
				if (block.type === "text") parts.push(block.text);
				else parts.push(JSON.stringify(block, null, 2));
			}
			if (parts.length === 0 && node.error !== undefined) {
				parts.push(`${node.error.name}: ${node.error.code}`);
			}
			return parts.join("\n");
		}
		function firstLine(text) {
			const s = String(text);
			const nl = s.indexOf("\n");
			return nl === -1 ? s : s.slice(0, nl);
		}
		function parseArgs(raw) {
			try {
				return JSON.parse(raw);
			} catch {
				return undefined;
			}
		}
		function pickString(args, keys) {
			for (const key of keys) {
				const v = args[key];
				if (typeof v === "string" && v !== "") return v;
			}
		}
		/** 工具显示名白名单（未知工具显示原始 wire 名）。 */
		const TITLES = {
			bash: "Bash",
			pwsh: "Pwsh",
			read: "Read",
			web_fetch: "Read",
			web_search: "Web Search",
			grep: "Grep",
			glob: "Glob",
			write: "Write",
			edit: "Edit",
			run_code: "Code",
			todo_write: "Todo",
			vision: "Vision"
		};
		/** 每类工具的摘要素材偏好顺序。 */
		const SUMMARY_KEYS = {
			bash: ["description", "command"],
			pwsh: ["description", "command"],
			read: ["path", "file_path", "url"],
			web_fetch: ["path", "file_path", "url"],
			web_search: ["query", "pattern", "url"],
			grep: ["query", "pattern", "url"],
			glob: ["query", "pattern", "path"],
			write: ["path", "file_path"],
			edit: ["path", "file_path"],
			run_code: ["description", "code"],
			todo_write: ["description", "content"],
			vision: ["instruction", "file_path"]
		};
		const SEARCH_VARIANTS = { web_search: true, grep: true, glob: true };
		function variantOf(toolName) {
			if (toolName === "bash" || toolName === "pwsh") return "bash";
			if (toolName === "read" || toolName === "web_fetch") return "read";
			if (SEARCH_VARIANTS[toolName]) return "search";
			if (toolName === "write") return "write";
			if (toolName === "edit") return "edit";
			if (toolName === "run_code") return "code";
			if (toolName === "vision") return "vision";
			return "others";
		}
		/** 从参数推导一行摘要（与官方 ToolRow 摘要同思路，纯函数无副作用）。 */
		function summaryOf(toolName, block) {
			const variant = variantOf(toolName);
			const argsRaw = argsRawOf(block);
			let base = argsRaw === "" ? block.callId : argsRaw;
			const parsed = parseArgs(argsRaw);
			if (typeof parsed === "object" && parsed !== null) {
				if (variant === "search" && Array.isArray(parsed.queries)) {
					const queries = parsed.queries.filter((q) => typeof q === "string" && q !== "");
					base = queries.length > 0 ? queries.map(firstLine).join(", ") : firstLine(argsRaw);
				} else {
					const picked = pickString(parsed, SUMMARY_KEYS[variant] ?? []);
					base = picked !== undefined ? picked : parsed.command ?? parsed.description ?? firstLine(argsRaw);
				}
			} else {
				base = firstLine(argsRaw);
			}
			if (variant === "others" && toolName !== "") return `${toolName} · ${base}`;
			return base;
		}
		/** 错误摘要：失败时用结果首行代替正常摘要。 */
		function errorSummaryOf(block) {
			if (stateOf(block) !== "error") return null;
			const output = "kind" in block ? resultTextOf(block) : "";
			return output === "" ? null : firstLine(output);
		}
		//#endregion
		//#region css
		var css =
				// 官方为每个 chat 节点渲染 flowItem 外壳；被插件合并吸收进链的
				// tool-call 节点 slot 为空，外壳会占一个 flex 槽位产生大段空白。
				// 用 :has() 把 slot 为空的 flowItem 彻底隐藏（display:none 不占 gap）。
				"[data-chat-flow-kind]:has(> [data-slot=\"conversation.chat.node\"]:empty){display:none}" +
				// 链容器与折叠头
				".dsh-tgc-chain{flex-direction:column;display:flex;gap:0;margin:2px 0 6px}" +
				".dsh-tgc-header{flex:none;user-select:none;cursor:pointer;align-items:center;gap:8px;padding:3px 4px;display:flex;min-width:0;border-radius:8px}" +
				".dsh-tgc-header:hover{background:var(--dsw-alias-interactive-bg-hover)}" +
				".dsh-tgc-chevron{flex:none;color:var(--dsw-alias-label-secondary);width:14px;height:14px;transition:transform .15s ease;display:inline-flex;align-items:center;justify-content:center}" +
				".dsh-tgc-header[data-open=true] .dsh-tgc-chevron{transform:rotate(90deg)}" +
				".dsh-tgc-head-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}" +
				".dsh-tgc-count{flex:none;margin-left:auto;color:var(--dsw-alias-label-caption);font-size:12px;line-height:18px}" +
				// 链体行容器（flex 紧凑流式，不用 Grid 均分）
				".dsh-tgc-rows{flex-direction:column;gap:3px;margin-top:2px;display:flex;min-width:0}" +
				".dsh-tgc-row{flex:none;align-items:center;gap:2px;flex-wrap:wrap;display:flex;min-width:0}" +
				// 连接箭头（→，紧凑）
				".dsh-tgc-arrow{flex:none;color:var(--dsw-alias-label-caption);font-size:13px;line-height:18px;padding:0 1px;display:inline-flex;align-items:center}" +
				// 工具小胶囊：原尺寸（padding 2px 10px、圆角胶囊、12px 字号）
				".dsh-tgc-node{flex:none;user-select:none;cursor:pointer;align-items:center;gap:6px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-l2);border-radius:999px;padding:2px 10px 2px 8px;display:flex;min-width:0;max-width:220px;transition:border-color .12s ease, background-color .12s ease}" +
				".dsh-tgc-node:hover{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l2)}" +
				".dsh-tgc-node[data-selected=true]{border-color:var(--dsw-alias-label-primary)}" +
				".dsh-tgc-node[data-state=error],.dsh-tgc-node[data-state=error]:hover{border-color:var(--dsw-alias-state-error-primary)}" +
				// 状态灯（原尺寸 7px）
				".dsh-tgc-dot{flex:none;border-radius:50%;width:7px;height:7px;background:currentColor;position:relative}" +
				".dsh-tgc-dot[data-state=ok]{color:var(--dsw-alias-state-success-primary)}" +
				".dsh-tgc-dot[data-state=error]{color:var(--dsw-alias-state-error-primary)}" +
				".dsh-tgc-dot[data-state=stopped]{color:var(--dsw-alias-state-warn-primary)}" +
				".dsh-tgc-dot[data-state=running]{color:var(--dsh-state-ongoing);animation:1.5s ease-in-out infinite dsh-tgc-breathe}" +
				".dsh-tgc-dot[data-state=running]::after{content:\"\";position:absolute;inset:-3px;border-radius:50%;border:1px solid currentColor;opacity:.5;animation:1.5s ease-in-out infinite dsh-tgc-halo}" +
				"@keyframes dsh-tgc-breathe{0%,100%{opacity:.35;transform:scale(.8)}50%{opacity:1;transform:scale(1.15)}}" +
				"@keyframes dsh-tgc-halo{0%{opacity:.5;transform:scale(.85)}50%{opacity:0;transform:scale(1.5)}100%{opacity:.5;transform:scale(.85)}}" +
				"@media (prefers-reduced-motion:reduce){.dsh-tgc-dot[data-state=running]{animation:none}.dsh-tgc-dot[data-state=running]::after{animation:none}}" +
				// 胶囊内文字（原尺寸 12px）
				".dsh-tgc-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500;color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px}" +
				".dsh-tgc-name[data-error]{color:var(--dsw-alias-state-error-primary)}" +
				// 点击展开的详情区（链下方全宽）
				".dsh-tgc-detail{flex-direction:column;gap:2px;margin-top:6px;display:flex;min-width:0}" +
				".dsh-tgc-detail-row{min-width:0;overflow:hidden;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;white-space:nowrap;text-overflow:ellipsis}" +
				".dsh-tgc-detail-row:first-child{color:var(--dsw-alias-label-secondary)}" +
				".dsh-tgc-detail-row[data-error]{color:var(--dsw-alias-state-error-primary)}" +
				".dsh-tgc-detail-pre{font-family:var(--ds-font-family-code);color:var(--dsw-alias-label-secondary);white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere;font-size:12px;line-height:18px;max-height:200px;overflow:auto;background:var(--dsw-alias-markdown-code-block);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;margin:0;padding:6px 8px}";
		var tagId = "dsh-tool-graphic-chain/styles";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			var tag = document.createElement("style");
			tag.dataset.plugin = "dsh-tool-graphic-chain";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		//#endregion
		//#region components
		/** 链中一个成员的小胶囊：状态灯 + 短名；点击展开/收起详情。 */
		function ChainNode({ toolName, block, selected, onToggle }) {
			const state = stateOf(block);
			const summary = summaryOf(toolName, block);
			const title = toolName === "Think" ? "Think" : TITLES[toolName] ?? toolName;
			return jsxRuntime.jsxs("div", {
				className: "dsh-tgc-node",
				"data-tool": toolName,
				"data-state": state,
				"data-selected": selected || undefined,
				role: "button",
				tabIndex: 0,
				"aria-expanded": selected,
				title: summary,
				onClick: onToggle,
				onKeyDown: (e) => {
					if (e.key === "Enter" || e.key === " ") {
						e.preventDefault();
						onToggle();
					}
				},
				children: [
					jsxRuntime.jsx("span", { className: "dsh-tgc-dot", "data-state": state, "aria-hidden": true }),
					jsxRuntime.jsx("span", { className: "dsh-tgc-name", "data-error": state === "error" || undefined, children: title })
				]
			});
		}
		/** 链中两个相邻成员之间的连接箭头（反向行显示 ←）。 */
		function ChainArrow({ reverse }) {
			return jsxRuntime.jsx("span", { className: "dsh-tgc-arrow", "aria-hidden": true, children: reverse ? "←" : "→" });
		}
		/** 选中成员的详情区（Think 原文 / 工具摘要 + IN/OUT）。 */
		function ChainDetail({ member }) {
			if (!member || typeof member !== "object") return null;
			if (member.kind === "think") {
				return jsxRuntime.jsxs("div", { className: "dsh-tgc-detail", children: [
					jsxRuntime.jsx("div", { className: "dsh-tgc-detail-row", children: "Think" }),
					jsxRuntime.jsx("pre", { className: "dsh-tgc-detail-pre", children: member.text })
				] });
			}
			const state = stateOf(member.block);
			const failure = errorSummaryOf(member.block);
			const summary = failure ?? summaryOf(member.toolName, member.block);
			const argsRaw = argsRawOf(member.block);
			const output = "kind" in member.block ? resultTextOf(member.block) : "";
			return jsxRuntime.jsxs("div", {
				className: "dsh-tgc-detail",
				children: [
					jsxRuntime.jsx("div", {
						className: "dsh-tgc-detail-row",
						"data-error": state === "error" || undefined,
						children: summary
					}),
					argsRaw !== "" && jsxRuntime.jsx("pre", { className: "dsh-tgc-detail-pre", children: argsRaw }),
					output !== "" && jsxRuntime.jsx("pre", { className: "dsh-tgc-detail-pre", children: output }),
					argsRaw === "" && output === "" && jsxRuntime.jsx("div", {
						className: "dsh-tgc-detail-row",
						children: state === "running" ? "运行中…" : "（无输出）"
					})
				]
			});
		}
		/** 渲染一个成员胶囊（think → Think 胶囊；tool → 工具胶囊）。 */
		function MemberNode({ m, selected, onSelect }) {
			if (m.kind === "think") {
				return jsxRuntime.jsx(ChainNode, {
					toolName: "Think",
					block: { kind: "tool-result", callId: "think:" + m.text.length, call: { name: "Think", argsRaw: m.text }, content: [], isError: false, subCalls: [] },
					selected: selected === m.id,
					onToggle: () => onSelect(selected === m.id ? null : m.id)
				}, m.id);
			}
			return jsxRuntime.jsx(ChainNode, {
				toolName: m.toolName,
				block: m.block,
				selected: selected === m.id,
				onToggle: () => onSelect(selected === m.id ? null : m.id)
			}, m.id);
		}
		/**
		 * 链体：把 members 从左往右排列，每行固定 CHAIN_PER_ROW 颗，放满自动
		 * 换到下一行。胶囊与箭头用 flex 流式紧密排列（不拉伸均分，间距由 gap
		 * 控制，避免 Grid 1fr 把胶囊拉开导致箭头过长）。
		 */
		function ChainBody({ members, selected, onSelect }) {
			if (members.length === 0) return null;
			const rowCount = Math.ceil(members.length / CHAIN_PER_ROW);
			const rowsEl = [];
			for (let ri = 0; ri < rowCount; ri++) {
				const slice = members.slice(ri * CHAIN_PER_ROW, (ri + 1) * CHAIN_PER_ROW);
				const cells = [];
				for (let ci = 0; ci < slice.length; ci++) {
					const m = slice[ci];
					if (ci > 0) {
						cells.push(jsxRuntime.jsx(ChainArrow, { reverse: false, key: "arrow" + ri + "-" + ci }));
					}
					cells.push(jsxRuntime.jsx(MemberNode, { m, selected, onSelect }, "cell" + ri + "-" + ci));
				}
				rowsEl.push(jsxRuntime.jsx("div", { className: "dsh-tgc-row", children: cells }, "row" + ri));
			}
			return jsxRuntime.jsx("div", { className: "dsh-tgc-rows", children: rowsEl });
		}
		/**
		 * 一条完整链：折叠头 + 紧凑链体 + 选中详情。每条链自管折叠/选中状态。
		 * @param members - [{ kind:"think", text }  |  { kind:"tool", toolName, block, id }]
		 */
		function ChainView({ members }) {
			const [open, setOpen] = react.useState(true);
			const [selected, setSelected] = react.useState(null);
			if (members == null || members.length === 0) return null;
			const selectedMember = selected === null ? null : members.find((m) => m.id === selected) ?? null;
			const toolCount = members.filter((m) => m.kind === "tool").length;
			// 链头左侧摘要：优先用首个思考的首行做链标题，纯工具链才退回「工具链」。
			const firstThink = members.find((m) => m.kind === "think");
			const rawLabel = firstThink != null && typeof firstThink.text === "string"
				? firstLine(firstThink.text)
				: "工具链";
			const headLabel = rawLabel.length > 48 ? `${rawLabel.slice(0, 48)}…` : rawLabel;
			return jsxRuntime.jsxs("div", {
				className: "dsh-tgc-chain",
				"data-chain-count": toolCount,
				children: [
					jsxRuntime.jsx("div", {
						className: "dsh-tgc-header",
						"data-open": open,
						role: "button",
						tabIndex: 0,
						"aria-expanded": open,
						onClick: () => setOpen((v) => !v),
						onKeyDown: (e) => {
							if (e.key === "Enter" || e.key === " ") {
								e.preventDefault();
								setOpen((v) => !v);
							}
						},
						children: [
							jsxRuntime.jsx("span", { className: "dsh-tgc-chevron", "aria-hidden": true, children: "›" }),
							jsxRuntime.jsx("span", {
								className: "dsh-tgc-head-label",
								children: headLabel
							}),
							jsxRuntime.jsx("span", { className: "dsh-tgc-count", children: `${toolCount} 次调用` })
						]
					}),
					open && jsxRuntime.jsx(ChainBody, { members, selected, onSelect: setSelected }),
					open && selectedMember != null && jsxRuntime.jsx(ChainDetail, { member: selectedMember })
				]
			});
		}
		/**
		 * 按「模型说话的 text」截断分组：
		 * 从段首向后遍历 assistant-step 与 tool-call 节点 ——
		 *   reasoning（思考）与 tool-call（连续工具调用）**持续累积进同一条链**；
		 *   一个 assistant-step 收齐思考+工具后，若该 step 附带了 text/image
		 *   （模型中途输出的话，如"重大发现…"），就**封掉当前链**并输出这段
		 *   正文字段，之后继续组新链 —— 也就是：
		 *     思考→工具→工具→【模型说话】→思考→工具→【模型说话】→…
		 *   每条链 = 两次说话之间连续的动作。
		 * @returns {{ isFirst:boolean, segments:[], headText:string }}
		 *   segments: [{ kind:"chain", members:[...] } | { kind:"body", block }]
		 */
		function collectSegments(snapshot, nodeKey) {
			const out = { isFirst: false, segments: [], headText: "" };
			if (nodeKey === undefined || snapshot == null || snapshot.chat == null) return out;
			const order = snapshot.chat.order;
			const nodes = snapshot.chat.nodes;
			if (!Array.isArray(order) || nodes == null) return out;
			const index = order.indexOf(nodeKey);
			if (index === -1) return out;
			const isAction = (n) => n != null && (n.kind === "assistant-step" || n.kind === "tool-call");
			const prevNode = index > 0 ? nodes.get(order[index - 1]) : undefined;
			if (prevNode != null && isAction(prevNode)) return out; // 非段首
			out.isFirst = true;
			let seq = 0;
			const keyOf = (callId) => `9:tool-call${callId}`;
			// 当前正在累积的链成员；textQueue 是本链尾部的正文（模型中途说的话）。
			let members = [];
			let textQueue = [];
			/** 封掉当前链：先输出链段，再输出它带的正文段；然后清空开始新链。 */
			const conclude = () => {
				if (members.length > 0) {
					out.segments.push({ id: "s" + (seq++), kind: "chain", members });
				}
				for (const b of textQueue) {
					out.segments.push({ id: "s" + (seq++), kind: "body", block: b });
				}
				members = [];
				textQueue = [];
			};
			const seenCallIds = new Set();
			for (let i = index; i < order.length; i++) {
				const n = nodes.get(order[i]);
				if (n == null) break;
				if (n.kind === "assistant-step") {
					const blocks = n.data && Array.isArray(n.data.blocks) ? n.data.blocks : [];
					// 1) 先收齐本 step 的全部动作与正文，出厂顺序 text 在中间也不拆散链：
					//    reasoning/tool-call 一律进链，text/image 进本 step 的正文队列。
					const stepTexts = [];
					for (const b of blocks) {
						if (b == null) continue;
						if (b.kind === "reasoning" && typeof b.text === "string" && b.text.trim() !== "") {
							members.push({ id: "m" + (seq++), kind: "think", text: b.text });
							if (out.headText === "") out.headText = firstLine(b.text);
						} else if (b.kind === "text" && typeof b.text === "string") {
							stepTexts.push(b);
						} else if (b.kind === "image") {
							stepTexts.push(b);
						} else if (b.kind === "tool-call" && typeof b.callId === "string") {
							if (seenCallIds.has(b.callId)) continue;
							seenCallIds.add(b.callId);
							const fullNode = nodes != null && typeof nodes.get === "function" ? nodes.get(keyOf(b.callId)) : undefined;
							const full = fullNode && fullNode.data ? fullNode.data.root : undefined;
							if (full != null) {
								members.push({ id: "m" + (seq++), kind: "tool", toolName: callNameOf(full), block: full });
							} else {
								members.push({
									id: "m" + (seq++),
									kind: "tool",
									toolName: b.name ?? "",
									block: { callId: b.callId, name: b.name, argsRaw: b.argsRaw, time: 0, subCalls: [] }
								});
							}
						}
					}
					// 2) 该 step 若带了模型的话 → 封链：链段 + 正文段，然后开新链。
					if (stepTexts.length > 0) {
						for (const b of stepTexts) {
							textQueue.push(b);
						}
						conclude();
					}
					// 否则（纯动作 step）继续累积，与后续动作合并成同一条链。
				} else if (n.kind === "tool-call") {
					// 独立 tool-call 节点：并入当前链（脱敏去重）。
					const root = n.data && n.data.root;
					const cid = root != null ? (root.callId ?? "") : ((n.data || {}).callId ?? "");
					if (cid !== "" && seenCallIds.has(cid)) continue;
					if (cid !== "") seenCallIds.add(cid);
					if (root != null) {
						members.push({ id: "m" + (seq++), kind: "tool", toolName: callNameOf(root), block: root });
					}
				} else {
					break; // user / turn-tail / compaction 等 → 段尾
				}
			}
			// 尾部：剩余链 + 正文封掉。
			conclude();
			return out;
		}
		/** 段落正文渲染：支持 { kind:"body", block } 与裸块两种形态。 */
		function renderBodyItem(item, opts) {
			if (item == null) return null;
			const block = item.kind === "body" ? item.block : item;
			if (block == null) return null;
			if (block.kind === "text") {
				return jsxRuntime.jsx(primitives.MarkdownText, {
					text: block.text,
					streaming: opts.streaming,
					codeLabels: opts.codeLabels
				}, item.id);
			}
			if (block.kind === "image" && typeof opts.renderMessageImages === "function") {
				return jsxRuntime.jsx(react.Fragment, {
					children: opts.renderMessageImages({
						images: [{ attachment: block.attachment }],
						align: "start"
					})
				}, item.id);
			}
			return null;
		}
		/** assistant-step 渲染接管：按正文分段渲染链与正文。 */
		function AssistantStepView(props) {
			const useSession = props.useSession;
			const node = props.node;
			const renderMessageImages = props.renderMessageImages;
			const t = props.t;
			const nodeKey = node && node.key;
			const streaming = node && node.data ? node.data.status === "running" : false;
			const interrupted = node && node.data ? node.data.status === "interrupted" : false;
			const codeLabels = react.useMemo(
				() => ({
					copyLabel: t && typeof t === "function" ? t("copy") : "复制",
					copiedLabel: t && typeof t === "function" ? t("copied") : "已复制"
				}),
				[t]
			);
			const segs = useSession((s) => collectSegments(s, nodeKey));
			if (!segs.isFirst) return null;
			const hasContent = segs.segments.some((seg) => seg.kind === "chain" || seg.kind === "body");
			if (!hasContent && !interrupted) return null;
			// 按出现顺序渲染：链段（ChainView）与正文段（MarkdownText/image）交替。
			const rendered = [];
			for (const seg of segs.segments) {
				if (seg.kind === "chain") {
					rendered.push(jsxRuntime.jsx(ChainView, { members: seg.members }, seg.id));
				} else if (seg.kind === "body") {
					rendered.push(renderBodyItem(seg, { streaming, codeLabels, renderMessageImages }));
				}
			}
			return jsxRuntime.jsxs("div", {
				"data-streaming": streaming || undefined,
				children: [
					jsxRuntime.jsx("div", {
						style: { display: "flex", flexDirection: "column", gap: "16px" },
						children: rendered
					}),
					interrupted && jsxRuntime.jsx("span", {
						style: {
							background: "var(--dsw-alias-interactive-bg-hover)",
							color: "var(--dsw-alias-label-tertiary)",
							borderRadius: "6px",
							alignSelf: "flex-start",
							padding: "0 6px",
							fontSize: "11px",
							lineHeight: "18px"
						},
						children: t && typeof t === "function" ? t("message.stopped") : "已停止"
					})
				]
			});
		}
		/**
		 * tool-call 节点接管：独立 tool-call 节点通常已通过所在 assistant-step
		 * 的 blocks 渲染进链。此处作为兜底：仅当该调用未被任何 assistant-step
		 * 收录（游离调用/异常窗口）时渲染单颗胶囊，避免调用完全不可见。
		 */
		function ToolCallView(props) {
			const useSession = props.useSession;
			const node = props.node;
			const t = props.t;
			const data = node && node.data;
			const root = data && data.root;
			const callId = root ? (root.callId ?? "") : ((data || {}).callId ?? "");
			const [open, setOpen] = react.useState(true);
			const [selected, setSelected] = react.useState(null);
			// 该调用是否已被某个 assistant-step 的 blocks 收录。
			const covered = useSession((s) => {
				if (callId === "" || !s || !s.chat || !s.chat.nodes) return true; // 无法判定 → 保守置空
				let found = false;
				for (const n of s.chat.nodes.values()) {
					if (n == null || n.kind !== "assistant-step") continue;
					const blocks = n.data && Array.isArray(n.data.blocks) ? n.data.blocks : [];
					if (blocks.some((b) => b != null && b.kind === "tool-call" && b.callId === callId)) {
						found = true;
						break;
					}
				}
				return found;
			});
			if (covered || root == null) return null;
			const id = "f:" + (callId || "x");
			const members = [{ id, kind: "tool", toolName: callNameOf(root), block: root }];
			return jsxRuntime.jsx(ChainView, {
				members,
				open,
				onToggleOpen: () => setOpen((v) => !v),
				selected,
				onSelect: setSelected
			}, id);
		}
		//#endregion
		//#region plugin
		function apply(ctx) {
			// 接管 assistant-step 渲染：一键串整段动作链（主渲染）。
			ctx.slots.inject("conversation.chat.node", () => ctx.slots.register({
				name: "conversation.chat.node",
				key: "assistant-step",
				priority: -100,
				locale: "conversation"
			}, AssistantStepView));
			// 接管 tool-call 渲染：段首为工具时也整段成链；段内其余置空。
			ctx.slots.inject("conversation.chat.node", () => ctx.slots.register({
				name: "conversation.chat.node",
				key: "tool-call",
				priority: -100,
				locale: "conversation"
			}, ToolCallView));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = ["slots"];
		return module.exports;
	}
});