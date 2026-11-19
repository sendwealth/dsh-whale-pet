# L4 调研报告:DSH SDK/RPC 接入方式与桌宠可行性

调研对象:`/home/rowan/Projects/deepseek-harness`(以下路径均相对该仓库根)。
结论先行:**Electron 桌宠作为 DSH 客户端/化身完全可行,且 DSH 官方 SDK 的设计目标就是"另一个进程驱动完整 Harness runtime"**。推荐路线是桌宠主进程通过 `@deepseek-ai/dsh-sdk-client`(或 Python SDK)以 stdio JSON-RPC 拥有自己的 runtime 子进程,并接管 `approval/request` / `user-question/ask` 回调,把"等待人类确认"变成桌宠气泡。

## 1. 连接与鉴权

DSH 对外有两种进程间接入面,鉴权模型完全不同:

### 路线 A:SDK 子进程直连(推荐,无鉴权问题)

SDK 家族(`packages/sdk/`)的契约是**客户端 spawn 并拥有 runtime 子进程**,通过 stdin/stdout 上的换行分隔 JSON-RPC 2.0 通信:

- 协议库:`packages/sdk/protocol/`(wire protocol,一帧一行,`id`+`method` 为请求、`id` 为响应、`method` 为通知)
- TS 客户端:`packages/sdk/client/`(`DeepSeekHarness` 高层 API + `HarnessClient` 协议层;spawn 逻辑在 `packages/sdk/client/src/client.ts` 与 `launch.ts`)
- 服务端插件:`packages/sdk/server/`(jsonrpc 插件,经 `dsh --profile sdk` 启动,bundle 在 `packages/bundle/sdk-app/`)

Electron 主进程接入的确切步骤(TS 客户端,摘自 `packages/sdk/client/README.md`):

1. `import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client'`(需要直依赖 `@deepseek-ai/dsh-brand` 等)
2. 构造时给出显式 launch spec:`{ profile: 'sdk', dshHome: '/绝对路径', provider, model, approvalRequests: true }`。客户端解析同版本 `@deepseek-ai/dsh` 可执行文件,或由调用方给 `dshBin`
3. 子进程惰性启动,首次使用时完成有界的 `initialize` 握手(默认 10s 超时)
4. `harness.run(prompt)` / `session.run(...)` 驱动回合;`close()`(或 `await using`)走 stdin-EOF → SIGTERM → SIGKILL 的拆除阶梯(`packages/sdk/client/src/dispose.ts`)
5. 回调注册:`harness.client.onRequest(handler)` 接收 `approval/request`;`onUserQuestion` 回调接收 `user-question/ask`

**鉴权:不需要。** stdio 通道随子进程所有权天然私有;凭证策略由调用方通过 `HarnessClientOptions.env` 控制(README 提到 `scrubbedParentEnv` 作为隔离基线)。API key(`DEEPSEEK_API_KEY`)由 runtime 照常读取。

### 路线 B:连接已在运行的 `dsh web` 实例

Web/Desktop GUI 的连接栈:

- HTTP 服务:`packages/host/webserver/`(`node:http`,`host: 127.0.0.1, port` 配置;port 0 可 OS 分配,`ctx.webServer.port` 事后可读)
- 鉴权:`packages/host/authentication-token/`。**launch token 是进程内 32 字节随机数**,存在 root context 的 `WeakMap` 里(`packages/host/authentication-token/src/browser-auth.ts:62-68` 的 `processLaunchToken`),**不落盘、无发现文件**
- token 的唯一出口是启动时打印/自动打开的签名入口 URL(`webserver/entry-url` 事件,由 WebApp 打印)
- 第三方 API 客户端的兑换流程(`packages/client/connection/README.md`):
  1. 拿到 launch token 后请求 `GET /connect?token=...&interactions=answer|none`(注意:`interactions` 默认 `none`,要替用户回答确认必须显式 `answer`)
  2. 服务端验证 token、创建 API Peer,返回 302 + mux 目标 + 签名 v2 Cookie
  3. 用该 Cookie 建立唯一一条 `/api/remote.mux` WebSocket(每 API Peer 仅一条,重复 attach 返回 409;socket 关闭即同步吊销 Cookie)
- 请求信任围栏:`packages/client/connection/src/api-request-trust.ts` —— Host 必须 loopback/绑定 IP/`trustedHosts`,`Origin` 必须同源,`sec-fetch-site: cross-site` 拒绝;防 DNS rebinding

**结论:路线 B 对"附着到用户已开的 DSH 会话"很诱人,但 token 只在启动输出里出现一次,Electron 进程没有官方途径拿到它**(需要用户手动粘贴 URL,或我们在桌宠内自己启动 web 实例从而自己掌握 token)。端口也非固定(config 决定,当前 GUI 用 3080)。

### 远程 BFF(packages/api/)

`packages/api/` 是 GUI 内部的 Remote 层(Typert 类型化 RPC + Gateway mux),面向浏览器 Client,不是公开的第三方 API:session-controller(会话命令/历史流)、workspace/terminal/settings/job-controller 等,全部经 `packages/api/remote-access/` 按 Peer 权限过滤。桌宠若走路线 B,会消费这一层,但它是 pre-stable 内部面。

## 2. 关键 API 清单(SDK wire protocol,`packages/sdk/protocol/README.md`)

| 方向 | 方法 | 用途 |
|---|---|---|
| client→server | `initialize` | 握手:cwd、provider/model 路由、`approvalRequests: true`、`capabilities.userQuestions: true`、可选 `reasoningEffort`/`maxTokens` |
| client→server | `session/prompt` | 入队内容块(不走斜杠命令路由),返回 `{ messageId }` 持久入队回执 |
| client→server | `session/query` | 统一入口:普通 prompt 或受支持的 `/命令`,返回 `{kind:"prompt"\|"command"}` |
| client→server | `session/resume` | 恢复持久化会话(需原 dshHome;拒绝缺失/不兼容/占用) |
| client→server | `session/wait` | 等 root idle + 受管后代完成 |
| client→server | `session/working-directory/get/set` | 读写会话工作目录 |
| client→server | `shutdown` | 优雅关闭 |
| server→client | `approval/request` | **审批请求**:`{sessionId, toolName, callId?, reason?}`,须回 `{outcome:"allowed-once"\|"rejected"\|"cancelled"}` |
| server→client | `user-question/ask` / `user-question.cancelled` | **原生用户提问**(ask_user_question 工具、plan review),回 `{answers:[{id,selected,custom?}]}` 或 `{cancelled:true}` |
| server→client | `session.event` | 全量会话事件(每个会话,不过滤) |
| server→client | `session.status` | 整 agent `running`/`idle` 状态切换 —— **桌宠动画/气泡的直接信号源** |
| server→client | `session.query.completed` | 命令/查询完成:`{sessionId, commandId, finalResponse, finishReason}` |
| server→client | `subagent.started` / `subagent.finished` | 子代理生命周期(含 `lastAssistantMessage`) |

高层 `DeepSeekHarness.run()` 返回 `RunResult { sessionId, finalResponse, finishReason, events, notifications }`;`subscribeSessionTree(id)` 可把通知限定到一个会话树(客户端侧过滤)。

## 3. 安全边界:外部客户端能否绕过 ask/approval?

**确认不能,机制如下:**

1. **审批是 opt-in 服务端请求,不是客户端可拉取的状态。** SDK server 只在 `initialize.approvalRequests === true` 时注册 `approval/request` 监听(`packages/sdk/server/src/server.ts:106,123-140`),否则 `next()` 委托给运行时内既有 answerer 链;无 answerer 报 `NO_PROVIDER`。
2. **决策结果被服务端强校验。** server.ts:135-137 对客户端返回值做白名单校验,非法响应抛 TypeError;协议 README 明确"missing or malformed answers never count as approval",且只有 `allowed-once` 授权**单次**操作。
3. **失败即关闭(fail closed)。** shutdown、传输丢失使未决审批按关闭失败处理;取消丢弃迟到响应。
4. **SDK 不合成答案。** user-question 同样:无效批次 `BAD_ANSWER`,宿主故障 `PROVIDER_ERROR`,没有回调就交给进程内 answerer 或报 `NO_PROVIDER`。
5. 权限模式(`/permission` 预设)是会话级状态,SDK 命令只能按原生准入改变目标会话的策略,不能跳过审批机制本身。
6. Web 路线:Remote 方法经 `packages/api/remote-access/` 按 Peer 权限门控;API Peer 默认 `interactions: none`,不显式声明 `answer` 连转发交互事件都收不到。

对桌宠的含义:**桌宠可以是"审批的answerer",但永远无法绕过审批** —— 这正是我们想要的:桌宠气泡提示"agent 在等你确认",用户点击即回填 `allowed-once`/`rejected`。

## 4. 推荐架构

### 路线 A:SDK 直连(桌宠拥有自己的 runtime)——推荐

- 优点:零鉴权难题;完整回调面(approval + user-question 都归桌宠 UI);桌宠成为唯一交互面,产品叙事自洽("你的鲸鱼就是 agent");TS SDK 与 Electron/Node 同生态;可 `resumeSession` 保持会话连续
- 缺点:runtime 由桌宠进程拥有,桌宠退出即 agent 停(需考虑 detached/后台保活);每桌宠一份 runtime 资源;TS 客户端**无捆绑 runtime 解析**(README Known Limitations),需自行保证 `dsh` 可执行文件来源与版本对齐

### 路线 B:Web 插件形态(在 DSH GUI 内做桌宠)

- 形态:写一个 DSH client 插件(`packages/client/ui-*` 生态),在 GUI 页面内渲染桌宠/通知;或 Electron 附着到运行中的 web 实例
- 优点:复用用户的真实工作会话(桌宠反映"我正在用的 agent");不用管 runtime 生命周期
- 缺点:**token 获取无官方途径**(进程内 WeakMap,只随启动 URL 出现一次);`/api` Remote 层是 pre-stable 内部面,跨版本兼容风险最大;若做成 GUI 内插件则失去"桌面常驻宠物"形态(被浏览器标签页束缚);每 API Peer 单 WebSocket、Cookie 绑定 authority,重连体验需自己搭

**推荐:PoC 用路线 A;长期可做 A+B 混合**(桌宠默认自带 runtime,同时支持"附着模式"——用户手动粘贴 web 入口 URL)。

### Python SDK 形态

`python/sdk`(`deepseek-harness-sdk`)与 TS 客户端同协议、同分层(`run()` / `HarnessClient`),且 `python/sdk-runtime` **捆绑了匹配的 `dsh` CLI 可执行文件与 Node sidecar**,还自带下载 Node/pnpm 的能力 —— 对"分发一个不要求用户预装 DSH 的桌宠安装包"更友好。若桌宠壳用 Python 侧car 或桌宠本身想脱离 Node 生态,Python 是更完整的分发形态。Electron 主进程则自然选 TS SDK。

## 5. 风险与未决问题

- **API pre-stable**:AGENTS.md 明确公共 API pre-stable、跨版本需迁移消费者;SDK wire 协议与 `/api` Remote 层都可能变。需锁定 dsh 版本并跟进 upgrade guide
- **TS 客户端无捆绑 runtime**:需自备 `dshBin` 或 npm 依赖解析;Python 侧已解决,可作为分发兜底
- **run() 结果归属**:`finalResponse` 是"入队回执→下次 idle"区间的最后一条 root 助手文本,含 steering 等混入工作,不是严格因果对应(prompt README 明示)
- **无运行时取消请求**:RPC 超时只结束本地等待,不停 runtime 工作;要停只能 `close()`(整只 runtime)
- **路线 B 的 token 生命周期**:随进程,重启即换;Cookie 30 天但 socket 断即吊销;`interactions=answer` 的权限范围(能否代表用户回答所有审批)需要实验确认
- **dshHome 显式要求**:Python SDK 从不静读 `~/.dsh`;与用户已有 DSH 数据的隔离/共享策略要定
- `session.event` 是全 runtime 全会话推送,桌宠需自己做会话树过滤(`subscribeSessionTree` 是客户端侧过滤)

## 6. 最小 PoC 计划(两周)

目标:验证"桌宠收到 agent 等待确认事件并在气泡里提示"。

**Week 1:跑通 SDK 回调链(纯 Node,无 UI)**
1. D1-2:最小 Node 脚本用 `DeepSeekHarness`(`profile: 'sdk'`,独立 dshHome,`approvalRequests: true`)+ `onUserQuestion`,跑通 `run('say hi')`;确认 `session.status` running/idle 通知
2. D3-5:给 agent 一个会触发审批的任务(如受限 shell 操作),在 `harness.client.onRequest('approval/request')` 里打印 `{sessionId, toolName, reason}`;验证 rejected/allowed-once 全链路
3. D6-7:验证 `subscribeSessionTree` + `session.status`/`subagent.started|finished` 信号完整性;记录事件→桌宠状态的映射表

**Week 2:Electron 气泡**
4. D8-10:Electron 主进程集成 SDK(子进程管理注意:SDK 自带拆除阶梯,但要挂到 app quit);renderer 显示鲸鱼 + 状态(running=idle 动画切换,数据来自 `session.status`)
5. D11-12:`approval/request` / `user-question/ask` 到达时弹气泡(渲染 toolName/question),按钮回填 outcome/answers —— 主进程↔renderer IPC 转发
6. D13-14:处理断连/关闭(`TransportClosedError`、AbortSignal 取消问题),打包冒烟(确认 `dsh` 可执行文件解析方式),写 PoC 结论与路线 B 附着模式的技术决策点

验收标准:桌宠静止时 idle、任务中 swim/思考动画;agent 请求审批时气泡显示工具名与理由,点击允许/拒绝后 agent 相应继续或失败关闭;全程无未捕获协议错误。

## W1 PoC 结果

实现:原型见本文件的历史记录（PoC 代码已随 `l4-poc/` 目录移除）；产品化实现见 `app/agent-bridge.js`,离线冒烟见 `app/agent-smoke.js`。

### 连接方式实际形态

- **SDK 实际包名**:`@deepseek-ai/dsh-sdk-client`,版本 `0.2.2-rc.3`(与 `@deepseek-ai/dsh` 同版本,launch 时强校验)。导出:`DeepSeekHarness` / `HarnessSession`(高层)、`HarnessClient`(协议层)、`TransportClosedError` / `RequestTimeoutError` / `SdkProtocolError` / `JsonRpcResponseError`。
- **引用方式**:harness 是 pnpm workspace 且 SDK client 的依赖全是 `workspace:*`,无法直接 `file:` 链接安装。PoC 采用**从 harness 检出直接 import 构建产物**:`import { HarnessClient } from '/home/rowan/Projects/deepseek-harness/packages/sdk/client/lib/index.js'`——其内部 bare import 经该包自己的 `node_modules`(pnpm 链接)解析,零安装即可用。发布形态再考虑 npm 安装或 vendoring。
- **spawn 命令**(launch.ts 解析结果):`node /home/rowan/Projects/deepseek-harness/apps/cli/lib/bin.js --profile sdk`,env 注入 `DSH_HOME=<绝对路径>`。若构建产物缺失则回退 `node --import tsx/esm apps/cli/src/bin.ts --profile sdk --patch src/sdk-source.cordis.patch.yml`。不需要 shell 包装,`pnpm dsh` 也不需要。
- **initialize 参数**:`{ cwd, provider: 'deepseek-official', model: 'deepseek-official', approvalRequests: true }`;`capabilities.userQuestions: true` 由客户端在构造 options 里给了 `onUserQuestion` 回调时自动附加。返回 `{"serverInfo":{"name":"deepseek-harness-sdk-runtime","version":"0.0.1"}}`。
- **回调注册**:`client.start()` 之后才能 `client.onRequest(handler)`(顺序错误抛 `TransportClosedError`);`user-question/ask` 走构造参数 `onUserQuestion`,不经过 `onRequest`;通知用 `client.subscribe(cb)`。

### 通知的实际 JSON 形状(run.log 实测)

- `session.status`:`{"sessionId":"w1-poc","status":"running"}` → `{"sessionId":"w1-poc","status":"idle"}`(桌宠动画的直接信号源,确认可用)
- `session.event`:信封 `{"sessionId","event":{type,seq,time,data}}`,实测类型含 `permission/preset`、`sandbox/mode`、`approval/policy`(policy:"ask")、`agent/inbox/spliced`、`turn/start`、`step/start`、`system/message`、`user/message`、`request/header`(含全部工具 schema)、`request/context`、`session/title`、`assistant/attempt`、`step/end`、`turn/end`。注意单个事件可达数十 KB(request/header 含工具定义),UI 侧需过滤再渲染。
- `session/prompt` 返回 `{"messageId":"<uuid>"}`;`session/wait` 在 root idle 后 resolve(即使 turn 以 error 结束也 resolve,不抛)。
- 无 key 时 turn 诚实失败关闭:`assistant/attempt` 内 `finish.reason.kind:"error"`,code `MISSING_CREDENTIAL`(提示导出 `DEEPSEEK_API_KEY` 或经 credentials service 存储),随后 `turn/end` error + `session.status idle`。

### 回调链逐项结论

| 项 | 状态 | 说明 |
|---|---|---|
| spawn + initialize(approvalRequests:true) | ✅ | ~0.6s 完成握手,返回 serverInfo |
| session/prompt 入队 + messageId 回执 | ✅ | |
| session.status running/idle | ✅ | 无 key 也完整观测到(失败关闭路径) |
| session.event 全量事件流 | ✅ | 见上,含失败错误事件 |
| shutdown + close 拆除阶梯 | ✅ | `client.close()` 优雅退出,进程 exit 0 |
| approval/request 服务端请求 → 回填 allowed-once | ⏳ TODO | 需真实 LLM 触发工具调用;环境无 `DEEPSEEK_API_KEY`(两个仓库及 `~/.dsh` 均无),未伪造。handler 已挂好,`onRequest` 路径经源码确认 |
| user-question/ask | ⏳ TODO | 同上,`onUserQuestion` 回调已挂,`capabilities.userQuestions` 声明逻辑经源码确认 |

### 遇到的问题与解法

1. **workspace 依赖无法 file: 安装**:SDK client 依赖全是 `workspace:*`,pnpm/npm 装不进独立目录 → 直接 import harness 检出的 `packages/sdk/client/lib/index.js`,借 checkout 的 pnpm node_modules 解析,免安装。
2. **无 API key**:demo 对 LLM 回合不伪造成功;真实 turn 失败关闭并原样记录 `MISSING_CREDENTIAL`,offline 最小链路(spawn → initialize → status/event → shutdown)完整跑通。带 key 复跑 `node demo.mjs` 即可补 approval/user-question 两项。
3. **`onRequest` 必须在 `start()` 之后安装**:源码显式检查;demo 已按 start → onRequest 顺序。
4. `session.event` 单事件体积大(工具 schema),桌宠侧消费必须先按 `event.type` 过滤。

---
*调研来源:packages/sdk/{client,protocol,server}/README.md 与 src、packages/host/{webserver,authentication-token}/、packages/client/connection/、packages/api/README.md、python/README.md 与 python/sdk/README.md,均在 deepseek-harness 检出内。*
