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

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) {
    return res.status(500).json({ error: "PayPal 尚未完成伺服器設定。" });
  }

  try {
    const accessToken = await getPayPalAccessToken();
    const response = await fetch("https://api-m.paypal.com/v1/identity/generate-token", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Accept-Language": "en_US",
        "Content-Type": "application/json"
      }
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("PayPal client token failed:", response.status, data);
      return res.status(500).json({ error: "無法取得 PayPal 付款元件。" });
    }

    return res.status(200).json({
      client_token: data.client_token,
      client_id: process.env.PAYPAL_CLIENT_ID
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "無法初始化 PayPal 付款元件。" });
  }
}
