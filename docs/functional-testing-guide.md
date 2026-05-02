# AnyPay 功能测试文档

## 1. 目标

本文档用于指导对 AnyPay 当前 MVP 的关键功能进行人工功能测试。

当前系统重点验证以下能力：

- 用户注册、登录、退出
- 用户充值 Credit
- 用户发布商品并完成站内 Credit 消费
- 用户注册为商户并创建 API Key
- 商户通过 API 创建 Hosted Checkout Session
- 消费者通过 Hosted Checkout 完成支付
- 双轨收银台：登录用户 Credit 支付 + 访客 Stripe fiat 支付
- 商户收入入账为 Credit
- 用户作为商户赚到的 Credit 可继续用于支付
- 支付完成后的跳转、Webhook、会话状态查询

本文档优先覆盖当前 MVP 已接入的 Stripe 充值/法币支付与本地 mock-fiat 测试能力。

---

## 2. 当前测试范围说明

### 2.1 已实现且应重点测试

- 平台账户体系
- 钱包余额与 Credit 账本
- 商户入驻与 API Key
- Checkout Session 创建与查询
- Hosted Checkout 页面
- 登录 Credit 支付
- 访客 Stripe fiat 支付
- 用户充值页与 Stripe 充值
- 商户收入进入用户钱包

### 2.2 当前为 mock 或未接真实支付渠道

以下功能目前不属于真实资金流测试范围：

- 微信支付 / 支付宝实际扣款
- 真实银行 / 卡组织结算
- 拒付、退款、风控
- 法币对账

因此本测试文档中的“法币支付”主要指：

- **收银台上的 Stripe fiat 流程**
- **充值页上的 Stripe Checkout 充值流程**
- **本地或显式开启时的 mock-fiat 测试流程**

---

## 3. 测试前准备

### 3.1 环境准备

确保以下条件满足：

- 本地开发服务已启动
- Supabase 环境变量已正确配置
- Stripe 环境变量已正确配置：`STRIPE_SECRET_KEY`、`STRIPE_WEBHOOK_SECRET`
- Stripe webhook 已转发到 `/api/stripe/webhook`
- 数据库迁移已执行完成
- 当前测试环境中存在基础数据：
  - `topup_packages`
  - `wallets`
  - `products`
  - `merchants`
  - `merchant_api_keys`
  - `checkout_sessions`
  - `ledger_transactions`
  - `ledger_entries`

建议本地应用地址为：

```txt
http://localhost:3000
```

### 3.2 建议准备的测试账号

建议至少准备 3 个账号：

- **用户 A**
  - 普通消费者
  - 用于充值、支付、购买

- **用户 B**
  - 同时作为普通用户 + 商户
  - 用于收款、发布商品、创建 checkout session

- **用户 C**
  - 纯访客测试辅助
  - 或者直接用未登录状态模拟 guest checkout

### 3.3 建议测试数据

建议准备：

- 至少 2 个充值包
- 至少 1 个可售商品
- 至少 1 个商户 webhook 接收地址

如果暂时没有真实 webhook 服务，可使用：

- RequestBin
- webhook.site
- 本地临时 API 端点

---

## 4. 测试执行原则

### 4.1 每条用例建议记录

每次测试建议记录：

- 用例编号
- 测试人
- 测试时间
- 前置条件
- 操作步骤
- 实际结果
- 预期结果
- 是否通过
- 备注 / 截图 / Session ID / User ID

### 4.2 重点核对维度

每完成一类支付或充值测试，建议同时核对以下几层：

- 页面 UI 是否正确
- 跳转是否正确
- API 返回是否正确
- 数据库记录是否正确
- 钱包余额是否正确
- ledger 是否正确
- webhook 是否正确

---

## 5. 核心测试场景总览

| 编号 | 场景 | 优先级 |
|------|------|--------|
| T01 | 用户注册 | 高 |
| T02 | 用户登录 / 退出 | 高 |
| T03 | 用户 Stripe 充值 Credit | 高 |
| T04 | 用户发布商品 | 中 |
| T05 | 站内商品 Credit 购买 | 高 |
| T06 | 用户注册商户 | 高 |
| T07 | 商户生成 API Key | 高 |
| T08 | 商户更新 Guest Checkout 设置 | 中 |
| T09 | 商户创建 Checkout Session | 高 |
| T10 | Hosted Checkout - 登录用户 Credit 支付 | 高 |
| T11 | Hosted Checkout - 余额不足时跳转充值再返回支付 | 高 |
| T12 | Hosted Checkout - 未登录访客 mock fiat 支付 | 高 |
| T13 | Checkout Session 状态查询 | 高 |
| T14 | Webhook 通知校验 | 高 |
| T15 | 商户收入进入钱包 | 高 |
| T16 | 用户作为商户赚到的 Credit 再次消费 | 高 |
| T17 | Session 过期与非法访问 | 中 |
| T18 | API Key 无效时的错误处理 | 中 |

---

## 6. 详细测试用例

## T01 用户注册

### 前置条件

- 当前邮箱未注册

### 测试步骤

1. 打开 `/register`
2. 输入用户名、邮箱、密码
3. 提交注册表单

### 预期结果

- 注册成功
- 用户可进入登录态流程或被引导到后续页面
- Supabase 中生成对应用户记录
- 系统中存在该用户对应的钱包记录

---

## T02 用户登录 / 退出

### 测试步骤

1. 打开 `/login`
2. 使用 T01 创建的用户登录
3. 验证进入已登录状态页面
4. 点击退出

### 预期结果

- 登录成功
- 导航栏和受保护页面可访问
- 退出后再次访问受保护页面会被重定向

---

## T03 用户 Stripe 充值 Credit

### 前置条件

- 用户已登录
- 数据库中存在有效 `topup_packages`

### 测试步骤

1. 打开 `/topup`
2. 选择一个充值包
3. 点击 `Purchase Credits`
4. 在 Stripe Checkout 完成付款并回到 `/topup`

### 预期结果

- 支付完成后页面显示 `Credits added!`
- 稍后跳转到默认页面或 `next` 指定页面
- 钱包 `available_credit` 增加
- 钱包 `purchased_credit` 增加
- `topup_orders` 新增一条记录
- `ledger_transactions` 新增一条 `topup`
- `ledger_entries` 新增一条 `credit`

### 建议额外核对

- `topup_orders.status = completed`
- `payment_method = stripe`

---

## T04 用户发布商品

### 前置条件

- 用户已登录

### 测试步骤

1. 打开 `/sell`
2. 填写标题、描述、价格
3. 提交商品

### 预期结果

- 商品创建成功
- 商品可在市场页显示
- 价格以 Credit 计价

---

## T05 站内商品 Credit 购买

### 前置条件

- 用户 A 已充值并有余额
- 用户 B 已发布商品
- 用户 A 不是商品所有者

### 测试步骤

1. 用户 A 登录
2. 打开 `/market`
3. 进入某个商品详情页
4. 点击购买

### 预期结果

- 购买成功
- 用户 A `available_credit` 减少
- 用户 B `available_credit` 增加
- 订单记录生成
- ledger 记录生成
- 商品销量增加

### 重点验证

- 平台手续费是否按当前逻辑扣除
- 买方与卖方钱包变动是否一致

---

## T06 用户注册商户

### 前置条件

- 用户已登录
- 当前用户还不是商户

### 测试步骤

1. 打开 `/developer`
2. 填写商户名、网站地址、Webhook 地址
3. 提交注册

### 预期结果

- `merchants` 表新增记录
- 该商户绑定当前用户 `user_id`
- 页面进入商户后台视图

---

## T07 商户生成 API Key

### 前置条件

- 用户已成为商户

### 测试步骤

1. 在 `/developer` 页面点击 `+ New Key`
2. 复制生成的 API Key

### 预期结果

- 成功生成 API Key
- 页面显示一次性明文 key
- `merchant_api_keys` 表新增记录
- 后续列表展示 key prefix 和创建时间

### 风险点

- 明文 key 只显示一次，测试时需要保存

---

## T08 商户更新 Guest Checkout 设置

### 前置条件

- 商户已存在

### 测试步骤

1. 进入 `/developer`
2. 修改以下配置：
   - `Enable guest checkout`
   - `Enable mock fiat checkout for tests`
   - `Guest checkout minimum (credits)`
3. 点击保存

### 预期结果

- 设置保存成功
- 页面刷新后值保持不变
- `merchants` 表中对应字段更新成功

### 建议测试组合

- 组合 A：全部开启，最低门槛 0
- 组合 B：开启 guest，但最低门槛高于测试订单金额
- 组合 C：关闭 mock fiat，确认真实 Stripe fiat 仍由 guest checkout 设置控制

---

## T09 商户创建 Checkout Session

### 前置条件

- 商户存在有效 API Key

### 测试步骤

使用商户自己的服务端或 curl 调用：

```bash
curl -X POST http://localhost:3000/api/v1/checkout/create \
  -H "Authorization: Bearer sk_live_xxx" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 100,
    "description": "Premium Plan",
    "return_url": "http://localhost:3000/test-success",
    "cancel_url": "http://localhost:3000/test-cancel",
    "external_id": "order_001",
    "metadata": { "plan": "premium" }
  }'
```

### 预期结果

- 返回 `session.id`
- 返回 hosted checkout `url`
- 返回 `payment_methods`
- 返回 `fiat_amount_usd`
- 如运行时开启 mock 支付，则返回 `mock_fiat_amount_usd`
- `checkout_sessions` 表新增记录

### 重点验证

- 当订单金额低于商户设置门槛时：
  - `payment_methods.fiat` 应为 `false`
  - `payment_methods.mock_fiat` 应为 `false`
- 当 `ENABLE_MOCK_FIAT_CHECKOUT` 未开启且不是本地开发环境时：
  - `payment_methods.mock_fiat` 应为 `false`

---

## T10 Hosted Checkout - 登录用户 Credit 支付

### 前置条件

- 已存在待支付 checkout session
- 用户 A 已登录
- 用户 A 钱包余额足够

### 测试步骤

1. 打开商户创建返回的 `url`
2. 确认页面显示：
   - 商户名称
   - Credit 金额
   - 当前余额
3. 点击 `Pay xxx credits`

### 预期结果

- 支付成功
- 页面显示成功状态
- 若存在 `return_url`，则自动跳回
- `checkout_sessions.status = completed`
- `payment_method = credit`
- `payer_id = 当前用户`
- 商户钱包增加收入 Credit
- 用户钱包减少对应 Credit
- ledger 记录生成

---

## T11 Hosted Checkout - 余额不足时跳转充值再返回支付

### 前置条件

- 用户已登录
- 当前 checkout 金额大于用户余额

### 测试步骤

1. 访问 checkout 页面
2. 点击 `Top up credits`
3. 进入 `/topup?next=/checkout/{sessionId}`
4. 完成一次 Stripe 充值
5. 观察是否返回 checkout 页面，且 linked checkout 已自动完成

### 预期结果

- 首次进入 checkout 时提示余额不足
- 可跳转到充值页
- 充值成功后返回原 checkout
- `topup_orders.checkout_session_id` 绑定原 checkout session
- 原 checkout session 自动完成，`payment_method = credit`

---

## T12 Hosted Checkout - 未登录访客 mock fiat 支付

### 前置条件

- 商户已开启 guest checkout
- 商户已开启 mock fiat
- 运行时允许 mock 支付：本地开发默认开启，其他环境需显式设置 `ENABLE_MOCK_FIAT_CHECKOUT=true`
- 订单金额满足 `guest_checkout_min_credit`
- 当前浏览器处于未登录状态

### 测试步骤

1. 打开 checkout `url`
2. 验证页面显示 guest checkout 区域
3. 输入邮箱
4. 点击 `Pay xx.xx (mock)`

### 预期结果

- 支付成功
- 页面显示成功提示
- 自动跳转回 `return_url`
- `checkout_sessions.status = completed`
- `payment_method = mock_fiat`
- `payer_email` 被记录
- 商户钱包收到 Credit 收入
- Webhook 被触发

### 额外验证

- 未登录时仍然可以看到登录支付入口
- 但不要求登录即可走 guest mock fiat

---

## T13 Checkout Session 状态查询

### 前置条件

- 商户持有有效 API Key
- 已存在某个 session

### 测试步骤

调用：

```bash
curl -X GET http://localhost:3000/api/v1/checkout/{session_id} \
  -H "Authorization: Bearer sk_live_xxx"
```

### 预期结果

- 返回 session 状态
- 返回 `payment_method`
- 返回 `payer_id` 或 `payer_email`
- 返回 `payment_methods`
- 返回 `mock_fiat_amount_usd`

---

## T14 Webhook 通知校验

### 前置条件

- 商户已配置 webhook_url
- 可查看 webhook 接收结果

### 测试步骤

1. 完成一次 checkout 支付
2. 查看 webhook 接收端内容
3. 核对 Header 与 Body
4. 使用 `webhook_secret` 本地按 v1 规则重新计算签名：
   `{X-AnyPay-Timestamp}.{raw_body}`

### 预期结果

- 收到 `checkout.completed`
- Header 中含：
  - `X-AnyPay-Signature`
  - `X-AnyPay-Signature-Version: v1`
  - `X-AnyPay-Timestamp`
- Payload 包含：
  - `id`
  - `external_id`
  - `amount_credit`
  - `metadata`
  - `payer_id`
  - `payer_email`
  - `payment_method`
  - `completed_at`
- 验签通过

---

## T15 商户收入进入钱包

### 前置条件

- 至少完成一次商户收款

### 测试步骤

1. 找到商户 owner 用户的钱包记录
2. 对比支付前后余额
3. 检查 `earned_credit` 与 `total_earned`

### 预期结果

- 商户 owner 的钱包余额增加
- 增加值等于订单净收入 Credit
- ledger 中存在对应收入流水

---

## T16 用户作为商户赚到的 Credit 再次消费

### 目标

验证“商户可以是用户，用户作为商户赚到的 Credit 可以继续支付”。

### 前置条件

- 用户 B 作为商户完成至少一次收款
- 用户 B 钱包已有 `earned_credit`
- 系统中存在另一个可支付商品或 checkout

### 测试步骤

1. 使用用户 B 登录
2. 检查钱包余额已增加
3. 使用用户 B 发起一次新的消费：
   - 购买商品，或
   - 支付另一个 hosted checkout

### 预期结果

- 用户 B 可以直接支付成功
- 支付时不会限制必须使用充值得来的 Credit
- 实际扣减来源统一体现在 `available_credit`

---

## T17 Session 过期与非法访问

### 测试子场景 A：非法 session id

#### 步骤

1. 打开不存在的 `/checkout/{id}`

#### 预期结果

- 页面提示 `Checkout session not found`

### 测试子场景 B：过期 session

#### 步骤

1. 构造一个已过期 session
2. 打开对应 checkout 页

#### 预期结果

- 页面提示 session expired
- 若存在 `cancel_url`，可返回商户页面
- API 不允许再次完成支付

---

## T18 API Key 无效时的错误处理

### 测试步骤

1. 使用错误 API Key 调用 `POST /api/v1/checkout/create`
2. 使用错误 API Key 调用 `GET /api/v1/checkout/{id}`
3. 使用缺失 Authorization Header 的请求再次测试

### 预期结果

- 返回 401
- 错误信息明确
- 不创建任何 session
- 不泄漏其他商户数据

---

## 7. 建议核对的数据库表

建议在测试过程中重点查看以下表：

- `wallets`
- `topup_packages`
- `topup_orders`
- `products`
- `orders`
- `merchants`
- `merchant_api_keys`
- `checkout_sessions`
- `ledger_transactions`
- `ledger_entries`

建议重点核对字段：

- 钱包：
  - `available_credit`
  - `purchased_credit`
  - `earned_credit`
  - `total_spent`
  - `total_earned`

- Checkout：
  - `status`
  - `payment_method`
  - `payer_id`
  - `payer_email`
  - `payer_name`
  - `completed_at`

- Topup：
  - `status`
  - `payment_method`
  - `paid_at`

- Ledger：
  - `type`
  - `entry_type`
  - `amount`
  - `balance_after`
  - `reference_type`
  - `reference_id`

---

## 8. 推荐测试顺序

建议按下面顺序测试，最容易发现主链路问题：

1. T01 用户注册
2. T02 用户登录
3. T03 Stripe 充值
4. T04 发布商品
5. T05 站内商品购买
6. T06 注册商户
7. T07 生成 API Key
8. T08 设置 guest checkout 策略
9. T09 创建 checkout session
10. T10 登录用户 Credit 支付
11. T11 余额不足 -> 充值 -> 返回支付
12. T12 未登录 guest mock fiat 支付
13. T13 查询 session 状态
14. T14 验证 webhook
15. T15 验证商户收入入账
16. T16 验证赚到的 Credit 再消费
17. T17 异常路径
18. T18 错误鉴权

---

## 9. 当前版本已知限制

测试时需要明确以下限制，避免误判为缺陷：

- `/api/topup` 目前使用 Stripe Checkout 下单和 webhook/状态轮询入账
- Guest fiat 使用 Stripe Checkout；mock-fiat 仅用于本地或显式开启的测试环境
- 当前没有完整退款流
- 当前没有真实拒付 / 风控流程
- 当前没有商户提现能力
- Credit 是平台内部消费资产，不支持站外流转

---

## 10. 回归测试建议

每次改动以下模块后，应至少回归这些场景：

### 10.1 改动钱包 / 账本时

至少回归：

- T03
- T05
- T10
- T12
- T15
- T16

### 10.2 改动商户 / API 接口时

至少回归：

- T06
- T07
- T08
- T09
- T13
- T14
- T18

### 10.3 改动 checkout 前端时

至少回归：

- T10
- T11
- T12
- T17

### 10.4 改动真实 Stripe / 其他支付渠道后

需要新增专项测试：

- 第三方支付下单成功
- 第三方支付取消
- 第三方支付回调幂等
- 重复回调
- 支付成功但前端断网
- webhook 延迟到达
- 对账一致性

---

## 11. 测试结果模板

可复制以下模板用于记录：

```md
### 用例编号
TXX

### 测试标题

### 测试环境
- 分支：
- URL：
- 测试时间：
- 测试人：

### 前置条件

### 操作步骤
1.
2.
3.

### 预期结果
1.
2.
3.

### 实际结果

### 数据核对
- wallets:
- checkout_sessions:
- ledger_transactions:
- ledger_entries:

### 结论
- [ ] Pass
- [ ] Fail

### 备注
```

---

## 12. 最终验收标准

如果以下关键链路全部通过，则可认为当前 MVP 的主要功能可用：

- 用户可注册、登录、充值
- 用户可购买商品
- 用户可注册为商户并生成 API Key
- 商户可成功创建 checkout session
- 登录用户可使用 Credit 完成支付
- 未登录用户可使用 Stripe fiat 完成 guest checkout
- 商户可收到 webhook
- 商户收入可进入钱包
- 商户赚到的 Credit 可再次用于消费
- 关键异常路径能正确报错且不会污染数据
