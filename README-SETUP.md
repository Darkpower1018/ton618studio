# 能量工作室完整功能設定

## 1. Supabase SQL

在 Supabase → SQL Editor 執行：

`supabase/migrations/20260925_full_order_system.sql`

這會加入：
- 訂單編號
- 客戶訂單查詢 RPC
- 素材 Storage bucket
- 付款狀態

## 2. Vercel Environment Variables

在 Vercel → Project → Settings → Environment Variables 加入：

- `SUPABASE_URL` = 你的 Supabase Project URL
- `SUPABASE_SERVICE_ROLE_KEY` = Supabase Project Settings → API 裡的 service_role key
- `DISCORD_WEBHOOK_URL` = 你的 Discord Webhook URL
- `STRIPE_SECRET_KEY` = Stripe Secret Key
- `STRIPE_WEBHOOK_SECRET` = Stripe Webhook Signing Secret
- `PUBLIC_SITE_URL` = `https://ton618studio.vercel.app`

**所有以上 secret 都只能放 Vercel Environment Variables，不要放 GitHub。**

## 3. Discord

在你想接收新訂單通知的 Discord 頻道建立 Webhook，把 URL 放入：
`DISCORD_WEBHOOK_URL`

## 4. Stripe

建立 Stripe 帳號並取得：
- Secret Key
- Webhook endpoint：`https://ton618studio.vercel.app/api/stripe-webhook`
- 事件至少勾選：`checkout.session.completed`

付款幣別目前設定為 HKD。

## 5. 部署

Vercel 需要重新部署一次，讓新的 Environment Variables 生效。

## 6. 注意

付款 API 已經寫好，但沒有 Stripe Secret Key 時，網站會保持「付款功能尚未完成伺服器設定」，不會把任何 secret 暴露到前端。
