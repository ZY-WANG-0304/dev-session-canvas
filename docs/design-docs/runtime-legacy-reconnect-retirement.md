---
title: 旧协议重连与退役语义统一
decision_status: 已选定
validation_status: 已验证
domains:
  - 执行编排域
  - VSCode 集成域
architecture_layers:
  - 宿主集成层
  - 适配与基础设施层
related_specs:
  - docs/product-specs/runtime-persistence-modes.md
related_plans:
  - docs/exec-plans/completed/runtime-legacy-reconnect-retirement.md
updated_at: 2026-10-09
---

# 旧协议重连与退役语义统一

## 背景与范围

以 PR #309 合并后的 `origin/main@2b0a7e26` 为基线。新 root 已禁止普通重连启动替身，但无 owner、无 executionProfile 的旧 client 仍默认允许重启。Host 先连接时传 false，普通 RPC 再次连接却不传参数，存在外层连接成功到 RPC 之间断连后启动旧 Supervisor 的路径。旧 Agent reattach 失败还会清空 runtimeSessionId、写 pendingLaunch=resume，进而由 Webview 自动发起新 CLI。它不能证明原执行已消失。

本轮统一授权和身份语义，不把旧协议升级成分页、重做 root 归属或清理共享历史目录。旧会话按原能力继续服务，未知结果、尾部和退出资源责任不放宽。

## 正式方案

### 重连不等于创建

`panel/runtimeSupervisorClient.ts` 的 `ensureConnected()` 默认只连接原端点，不因缺 owner/profile 就获得启动权限。新执行的 Host 创建路径在 `CanvasPanelManager.startAgentSessionWithSupervisorCore()` 与 `startTerminalSessionWithSupervisorCore()` 显式授权准备 Supervisor；root 路径仍只通过原协调准备 API，不允许 client 直接启动 root owner。授权只属于一次准备操作，不在 client 上持续保存。普通 hello/RPC、原绑定 attach/subscribe/delete 均不隐式启动。

并发调用仍复用一个 connectPromise。已有创建动作明确授权的准备可以被共同等待，普通调用不新增启动授权、不重发原 RPC；本轮不建立通用权限调度器。旧绑定入口和删除入口始终连接已有端点，不能因调用者传入历史 allowRestart:true 就为旧记录创建服务。

### Runtime 失败不转为自动 provider resume

`CanvasPanelManager` 的初次恢复连接失败、attach 失败和非分页已附着会话断连，统一使用既有 history-restored 路径。保留 backend/storage/session/kind 及 owner、原错误和 provider resume 上下文，清除待自动启动意图；不推断原执行退出，不把历史态作为删除成功证据。删除 `maybeFallbackAgentLiveRuntimeToResume()` 的自动转换，正常分页重连和 snapshot-only 的既有恢复语义不变。

加载旧 live-runtime 的 history-restored + pendingLaunch=resume 记录时取消该旧自动降级意图，包括旧版本已丢失 runtimeSessionId 的记录；缺 ID 的 live/reattaching 也不能落入 snapshot-only 自动恢复。不能猜回原 binding。取消旧意图时同步移除 summary 中的旧自动 resume 承诺，优先保留已有 Runtime 错误。provider identity 保留供用户显式 resume/fork。用户显式操作仍受已有旧绑定结算保护，未知旧执行不能直接覆盖；本次不增加新的 resume 消息或启动方式。

### 退役只释放已无本地责任的 client

`retireLegacyRuntimeSupervisorClientIfUnused()` 继续按 backend/storage 检查已附着会话、reattaching 节点、请求和读者；不以某个 root 清空为由杀共享 Supervisor。错误降级必须先解除本 Host 的附着并保留持久绑定；退休连接不改旧 registry，不证明 session 已退出。旧 Supervisor 的实际 idle/退出由它自己按实际能力负责，Host 不新增 service stop 或全目录删除。

仅补核实的退役缺口，不能为及时释放 client 提前取消尾部消费、final application、reader close、严格删除观察或已发送但未知的创建。历史节点清理仍沿用现有逐目标新鲜证据检查，不要求重启旧 Supervisor。

client 的 hasPendingRequests 同时覆盖 connectPromise 和 strictDeleteConnection。Host 在失败恢复/非分页断连及 stock 删除完成或失败后重检；生产 strict delete 使用专用 onSettled 通知，首次 deadline 不发通知、也不改原 unconfirmed，实际尝试结算后再等既有 Host finalization。通知仅重检本 Host 缓存，reader、其他会话或连接仍持有责任时继续保留。

同一个 socket data 可以同步排空多条 RPC 响应，但各条 strict delete 的异步结算尚未完成。因此 hasPendingRequests 还必须覆盖 strictDeletes 中 attemptSettled=false 的观察，最后一条实际尝试结算后才允许退役。已结算但结果仍未知的记录继续防止重发，却不单独长期持有 client；不能用 strictDeletes 非空代替未结算判断。

## 验收

以真实 client 方法及 Host 方法的受控 fixture 验证：旧连接成功后断连、普通 hello/读写/attach/delete 不启动 backend；显式创建仍可以准备 stock/candidate，root 协调不变。健康旧协议可附着，Agent 有 resume identity 但重连失败仍保留 binding、不排队新 CLI；历史自动 fallback 记录重开不自动启动，snapshot-only 与用户显式 resume 不被禁用。

退役测试保留共享存储 A/B、其他 root、reattaching、reader/close RPC 的隔离；已无本地责任才 dispose client，不向 backend 发停止命令。不重跑未受影响的原生/真实 Agent/容量矩阵。类型检查、正常构建及受影响协议/Host 回归是本次交付门禁；具体结果由 ExecPlan 回填。

## 验证记录

2026-10-09：有限契约已验证。client 35/35、timeout 37/37（完成通知后另补迟到证据 1/1）、新 Host 恢复回归、Host deactivation/completed、分页投影（实际 writer 50/50、Host batch 10/10）、协议、root 握手 46 项及 startup 29 项通过；Host wiring 定向 127/127，不是全文件 336 项。类型检查、默认构建、语法及 diff check 通过，独立复核无新确定性 blocker。

Linux / VS Code 1.117.0 的 `runtime-legacy-reconnect` 两场景通过：默认 native 构建中显式创建一个 Terminal 端点，缺失原会话的 Agent/Terminal 保留绑定，旧 pending resume 记录不自动启动。此处验证实际 Host/Webview 接线，旧传输竞态由受控 client 与 Host 用例覆盖，不把它写成历史二进制升级、真实 Codex/Claude 或跨平台验收。前三轮目录权限/夹具启动前置失败、第四轮通过和清理记录见 completed ExecPlan；历史失败保留，不用本轮结果追认旧平台通过。

2026-10-09（PR #312 review 修复）：同 data 并行严格删除先红后绿。真实 Host 批量入口及真实 client 覆盖两条 success/sessionNotFound 的四种组合，最后观察结算后才退役；再次整批操作不重发。client 36/36、timeout 37/37、Host legacy reconnect/deactivation/completed、Host wiring 定向 15/15（选自 336 项）、类型、默认构建及 diff check 通过。独立复核通过；已结算未知记录不持有 client，deadline、迟到证据与 finalization 不变，未重复无影响的原生、Agent 或页面矩阵。
