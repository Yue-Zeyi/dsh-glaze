window.__ModuleLoader__.load({
	id: "dsh-glaze-smoke-fixture",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const CSS = `
			html { --skin-fixture: 1; }
			body::before {
				content: "SMOKE SKIN ACTIVE";
				position: fixed; z-index: 2147483647; top: 8px; left: 50%;
				transform: translateX(-50%);
				background: #16a34a; color: #fff;
				font: 600 12px/1.6 system-ui, sans-serif;
				padding: 2px 12px; border-radius: 999px;
				letter-spacing: .08em; pointer-events: none;
			}
			body::after {
				content: ""; position: fixed; inset: 0; z-index: 2147483646;
				border: 6px solid #16a34a; pointer-events: none;
			}
		`;
		const tagId = "dsh-glaze-smoke-fixture/skin.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-glaze-smoke-fixture";
			tag.dataset.pluginCss = tagId;
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}

		exports.name = "dsh-glaze-smoke-fixture";
		exports.inject = [];
		exports.apply = function apply() {};
		return module.exports;
	}
});