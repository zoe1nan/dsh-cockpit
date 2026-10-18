# dsh-cockpit-example-git

一个可直接安装的 Cockpit 扩展卡片示例：在工作区里显示实时 Git 状态。

- 卡片内容：当前分支、领先/落后、改动文件（最多 5 个）、是否暂存
- 一个动作：**刷新**（`onAction` 里重新读一次 `git status`）
- 只读操作：不执行 `git add/commit/push`，只读 `git status --porcelain -b`

## 装到 DSH

```bash
# 和 dsh-cockpit 装进同一个 profile
dsh plugin --profile <profile> add /path/to/examples/git-card
```

或者在 profile 的 `package.json` 里加 link 依赖，并把 `dsh-cockpit-example-git` 加入
`dsh.profile.bundles`，重启 DSH 后打开 Cockpit，右栏「扩展」里就会出现这张卡。

> 卡片读取的是 DSH 进程的当前工作目录；在非 Git 仓库启动时会显示「不是 Git 仓库」。

## 作为模板

整个插件只有 `index.js` 一个文件、约 100 行，适合作为新卡片的起点：

```js
import { apply as plugin } from './index.js'
```

要点：

1. `export const inject = ['cockpit']` — 等 Cockpit 出现再注册
2. `ctx.cockpit.registerCard({ ... })` — 描述卡片和动作
3. `load()` 返回纯 JSON payload（`list` / `metrics` / `status` / `text`）
4. `ctx.effect(() => () => dispose())` — 插件卸载时把卡摘掉
5. 不在卡片里写 HTML/CSS；渲染由 Cockpit 负责

完整契约见 [../../docs/STATE.md](../../docs/STATE.md#extension-cards-v06)。
