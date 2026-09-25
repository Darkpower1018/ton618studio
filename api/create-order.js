const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

function json(res, status, body) {
  res.status(status).json(body);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(res, 405, { error: "Method not allowed" });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json(res, 500, { error: "Server 尚未設定 Supabase server credentials。" });
  }

  try {
    const body = req.body || {};
    const name = String(body.name || "").trim();
    const contactType = String(body.contactType || "").trim();
    const contact = String(body.contact || "").trim();
    const service = String(body.service || "").trim();
    const details = String(body.details || "").trim();
    const materials = String(body.materials || "").trim();
    const materialPath = String(body.materialPath || "").trim();

    if (!name || !contactType || !contact || !service || !details) {
      return json(res, 400, { error: "請完整填寫委託資料。" });
    }

    const headers = {
      "Content-Type": "application/json",
      "apikey": SUPABASE_SERVICE_ROLE_KEY
    };

    const servicesResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/services?active=eq.true&select=service,package,price`,
      { headers }
    );

    if (!servicesResponse.ok) {
      throw new Error("無法取得服務資料。");
    }

    const services = await servicesResponse.json();
    const selected = services.find(
      item => `${item.service}｜${item.package} HKD $${item.price}` === service
    );

    if (!selected) {
      return json(res, 400, { error: "服務套餐無效或已停用。" });
    }

    const insertResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/orders`,
      {
        method: "POST",
        headers: {
          ...headers,
          "Prefer": "return=representation"
        },
        body: JSON.stringify({
          service,
          package: selected.package,
          price: selected.price,
          customer_name: name,
          contact_type: contactType,
          contact,
          details,
          google_drive: materials,
          material_path: materialPath || null,
          status: "pending",
          payment_status: "unpaid"
        })
      }
    );

    if (!insertResponse.ok) {
      const errorText = await insertResponse.text();
      throw new Error(errorText || "訂單建立失敗。");
    }

    const rows = await insertResponse.json();
    const order = rows[0];

    if (DISCORD_WEBHOOK_URL) {
      const discordPayload = {
        username: "能量工作室",
        embeds: [{
          title: "🆕 新委託",
          color: 0x8d6be8,
          fields: [
            { name: "訂單編號", value: order.order_number || "未設定", inline: true },
            { name: "服務", value: service, inline: true },
            { name: "價格", value: `HKD $${selected.price}`, inline: true },
            { name: "客戶", value: name, inline: true },
            { name: "聯絡方式", value: `${contactType} / ${contact}`, inline: true },
            { name: "付款", value: "尚未付款", inline: true },
            { name: "需求", value: details.slice(0, 1000) }
          ],
          timestamp: new Date().toISOString()
        }]
      };

      try {
        await fetch(DISCORD_WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(discordPayload)
        });
      } catch (discordError) {
        console.error("Discord notification failed:", discordError);
      }
    }

    return json(res, 200, {
      ok: true,
      order_number: order.order_number,
      price: order.price
    });
  } catch (error) {
    console.error(error);
    return json(res, 500, {
      error: "訂單提交失敗，請稍後再試。"
    });
  }
}
