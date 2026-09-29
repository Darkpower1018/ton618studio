function getOrigin(req) {
  return process.env.PUBLIC_SITE_URL ||
    `${req.headers["x-forwarded-proto"] || "https"}://${req.headers.host}`;
}

async function getPayPalAccessToken() {
  const credentials = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`
  ).toString("base64");

  const response = await fetch("https://api-m.paypal.com/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`PayPal 認證失敗：${response.status} ${errorText}`);
  }

  return (await response.json()).access_token;
}

async function supabaseRequest(path, options = {}) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return fetch(`${process.env.SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      ...(options.headers || {})
    }
  });
}

async function createPayPalOrder(order, accessToken, origin, paymentSource = null) {
  const response = await fetch("https://api-m.paypal.com/v2/checkout/orders", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "PayPal-Request-Id": `ton618-${order.order_number}`
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [{
        reference_id: order.order_number,
        custom_id: order.order_number,
        description: `${order.service}｜${order.package}`,
        amount: {
          currency_code: "HKD",
          value: Number(order.price).toFixed(2)
        }
      }],
      ...(paymentSource ? { payment_source: paymentSource } : {}),
      application_context: {
        brand_name: "能量工作室",
        user_action: "PAY_NOW",
        return_url: `${origin}/order.html?order=${encodeURIComponent(order.order_number)}&paypal_return=1`,
        cancel_url: `${origin}/order.html?order=${encodeURIComponent(order.order_number)}`
      }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`建立 PayPal 訂單失敗：${response.status} ${errorText}`);
  }

  return response.json();
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (
    !process.env.PAYPAL_CLIENT_ID ||
    !process.env.PAYPAL_CLIENT_SECRET ||
    !process.env.SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    return res.status(500).json({ error: "付款功能尚未完成伺服器設定。" });
  }

  try {
    const { order_number, payment_source } = req.body || {};

    if (!order_number) {
      return res.status(400).json({ error: "缺少訂單編號。" });
    }

    const response = await supabaseRequest(
      `/rest/v1/orders?order_number=eq.${encodeURIComponent(order_number)}&select=order_number,service,package,price,customer_name,payment_status`
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`無法取得訂單：${response.status} ${errorText}`);
    }

    const rows = await response.json();
    const order = rows[0];

    if (!order) return res.status(404).json({ error: "找不到訂單。" });
    if (order.payment_status === "paid") {
      return res.status(400).json({ error: "這張訂單已付款。" });
    }

    const accessToken = await getPayPalAccessToken();
    const origin = getOrigin(req);
    const paypalOrder = await createPayPalOrder(order, accessToken, origin, payment_source);
    const approvalLink = paypalOrder.links?.find(link => link.rel === "approve")?.href;

    if (!payment_source && !approvalLink) {
      throw new Error("PayPal 沒有返回付款連結。");
    }

    await supabaseRequest(
      `/rest/v1/orders?order_number=eq.${encodeURIComponent(order.order_number)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stripe_session_id: paypalOrder.id })
      }
    );

    return res.status(200).json({
      url: approvalLink || null,
      paypal_order_id: paypalOrder.id
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "建立 PayPal 付款頁面失敗。" });
  }
}
