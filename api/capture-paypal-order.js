async function getPayPalAccessToken() {
  const credentials = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`
  ).toString("base64");

  const response = await fetch("https://api-m.paypal.com/v1/oauth2/token", {
    method: "POST",
    headers: {
      "Authorization": `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`PayPal 認證失敗：${response.status} ${errorText}`);
  }

  const data = await response.json();
  return data.access_token;
}

async function supabaseRequest(path, options = {}) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return fetch(`${process.env.SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      "apikey": key,
      "Authorization": `Bearer ${key}`,
      ...(options.headers || {})
    }
  });
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
    const { order_number, paypal_order_id } = req.body || {};

    if (!order_number || !paypal_order_id) {
      return res.status(400).json({ error: "缺少付款資料。" });
    }

    const orderResponse = await supabaseRequest(
      `/rest/v1/orders?order_number=eq.${encodeURIComponent(order_number)}&select=order_number,payment_status,stripe_session_id`
    );

    if (!orderResponse.ok) {
      const errorText = await orderResponse.text();
      throw new Error(`無法取得訂單：${orderResponse.status} ${errorText}`);
    }

    const rows = await orderResponse.json();
    const order = rows[0];

    if (!order) return res.status(404).json({ error: "找不到訂單。" });
    if (order.payment_status === "paid") {
      return res.status(200).json({ paid: true });
    }
    if (order.stripe_session_id !== paypal_order_id) {
      return res.status(400).json({ error: "付款資料與訂單不符。" });
    }

    const accessToken = await getPayPalAccessToken();
    const captureResponse = await fetch(
      `https://api-m.paypal.com/v2/checkout/orders/${encodeURIComponent(paypal_order_id)}/capture`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        }
      }
    );

    const captureData = await captureResponse.json();

    if (!captureResponse.ok) {
      console.error("PayPal capture failed:", captureResponse.status, captureData);
      return res.status(400).json({ error: "PayPal 付款確認失敗，請稍後再試。" });
    }

    if (captureData.status !== "COMPLETED") {
      return res.status(400).json({ error: "PayPal 尚未完成付款。" });
    }

    const updateResponse = await supabaseRequest(
      `/rest/v1/orders?order_number=eq.${encodeURIComponent(order_number)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payment_status: "paid",
          stripe_session_id: paypal_order_id
        })
      }
    );

    if (!updateResponse.ok) {
      const errorText = await updateResponse.text();
      throw new Error(`付款已完成，但更新訂單失敗：${updateResponse.status} ${errorText}`);
    }

    return res.status(200).json({ paid: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "確認 PayPal 付款失敗。" });
  }
}
