import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "api_key_placeholder");

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!process.env.STRIPE_SECRET_KEY || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "付款功能尚未完成伺服器設定。" });
  }

  try {
    const { order_number } = req.body || {};

    if (!order_number) {
      return res.status(400).json({ error: "缺少訂單編號。" });
    }

    const headers = {
      "apikey": process.env.SUPABASE_SERVICE_ROLE_KEY,
      "Authorization": `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
    };

    const response = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/orders?order_number=eq.${encodeURIComponent(order_number)}&select=order_number,service,package,price,customer_name,payment_status`,
      { headers }
    );

    if (!response.ok) throw new Error("無法取得訂單。");

    const rows = await response.json();
    const order = rows[0];

    if (!order) return res.status(404).json({ error: "找不到訂單。" });
    if (order.payment_status === "paid") {
      return res.status(400).json({ error: "這張訂單已付款。" });
    }

    const origin = process.env.PUBLIC_SITE_URL || `${req.headers["x-forwarded-proto"] || "https"}://${req.headers.host}`;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{
        price_data: {
          currency: "hkd",
          product_data: {
            name: `${order.service}｜${order.package}`
          },
          unit_amount: Math.round(Number(order.price) * 100)
        },
        quantity: 1
      }],
      customer_creation: "always",
      metadata: {
        order_number: order.order_number
      },
      success_url: `${origin}/order.html?order=${encodeURIComponent(order.order_number)}&paid=1`,
      cancel_url: `${origin}/order.html?order=${encodeURIComponent(order.order_number)}`,
      submit_type: "pay"
    });

    await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/orders?order_number=eq.${encodeURIComponent(order.order_number)}`,
      {
        method: "PATCH",
        headers: {
          ...headers,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ stripe_session_id: session.id })
      }
    );

    return res.status(200).json({ url: session.url });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "建立付款頁面失敗。" });
  }
}
