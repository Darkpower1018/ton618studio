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
    const couponCode = String(body.couponCode || "").trim().toUpperCase();
    const authHeader = req.headers.authorization || "";
    let userId = null;
    let discountAmount = 0;
    let appliedCoupon = null;

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
      const errorText = await servicesResponse.text();
      console.error("Supabase services request failed:", servicesResponse.status, errorText);
      throw new Error(`無法取得服務資料。 Supabase HTTP ${servicesResponse.status}: ${errorText || "no response body"}`);
    }

    const services = await servicesResponse.json();
    const selected = services.find(
      item => `${item.service}｜${item.package} HKD $${item.price}` === service
    );

    if (!selected) {
      return json(res, 400, { error: "服務套餐無效或已停用。" });
    }

    // 若客戶已登入，驗證 access token 並從資料庫取得真正可用的優惠。
    if (authHeader.startsWith("Bearer ")) {
      const userResponse = await fetch(
        `${SUPABASE_URL}/auth/v1/user`,
        { headers: { "apikey": SUPABASE_SERVICE_ROLE_KEY, "Authorization": authHeader } }
      );
      if (userResponse.ok) {
        const user = await userResponse.json();
        userId = user?.id || null;
      }
    }

    const originalPrice = Number(selected.price);
    let finalPrice = originalPrice;
    let accountDiscountAmount = 0;
    let couponDiscountAmount = 0;

    if (userId) {
      const discountResponse = await fetch(
        `${SUPABASE_URL}/rest/v1/discounts?user_id=eq.${userId}&active=eq.true&select=id,type,value,expires_at&order=created_at.desc&limit=1`,
        { headers }
      );
      if (discountResponse.ok) {
        const discounts = await discountResponse.json();
        const discount = discounts?.[0];
        if (discount && (!discount.expires_at || new Date(discount.expires_at) > new Date())) {
          const value = Math.max(0, Number(discount.value || 0));
          accountDiscountAmount = discount.type === "percent"
            ? Math.min(originalPrice, originalPrice * Math.min(value, 100) / 100)
            : Math.min(originalPrice, value);
        }
      }
    }

    if (couponCode) {
      const couponResponse = await fetch(
        `${SUPABASE_URL}/rest/v1/coupons?code=eq.${encodeURIComponent(couponCode)}&active=eq.true&select=id,code,type,value,expires_at,max_uses,one_per_user&limit=1`,
        { headers }
      );
      if (!couponResponse.ok) throw new Error("無法驗證優惠碼。");
      const coupon = (await couponResponse.json())?.[0];
      if (!coupon) return json(res, 400, { error: "優惠碼不存在或已停用。" });
      if (coupon.expires_at && new Date(coupon.expires_at) <= new Date()) {
        return json(res, 400, { error: "優惠碼已過期。" });
      }

      const usageResponse = await fetch(
        `${SUPABASE_URL}/rest/v1/coupon_redemptions?coupon_id=eq.${coupon.id}&select=id,user_id`,
        { headers }
      );
      if (!usageResponse.ok) throw new Error("無法檢查優惠碼使用次數。");
      const usages = await usageResponse.json();

      if (coupon.max_uses > 0 && usages.length >= coupon.max_uses) {
        return json(res, 400, { error: "優惠碼已達使用上限。" });
      }
      if (coupon.one_per_user && userId && usages.some(row => row.user_id === userId)) {
        return json(res, 400, { error: "你已經使用過這個優惠碼。" });
      }

      const value = Math.max(0, Number(coupon.value || 0));
      couponDiscountAmount = coupon.type === "percent"
        ? Math.min(originalPrice, originalPrice * Math.min(value, 100) / 100)
        : Math.min(originalPrice, value);

      appliedCoupon = coupon;
    }

    // 專屬帳號優惠與優惠碼不疊加，取折扣較高者。
    if (couponDiscountAmount > accountDiscountAmount) {
      discountAmount = Math.round(couponDiscountAmount * 100) / 100;
      finalPrice = Math.max(0, Math.round((originalPrice - discountAmount) * 100) / 100);
    } else if (accountDiscountAmount > 0) {
      discountAmount = Math.round(accountDiscountAmount * 100) / 100;
      finalPrice = Math.max(0, Math.round((originalPrice - discountAmount) * 100) / 100);
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
          price: finalPrice,
          original_price: selected.price,
          discount_amount: discountAmount,
          user_id: userId,
          customer_name: name,
          contact_type: contactType,
          contact,
          details,
          google_drive: materials,
          material_path: materialPath || null,
          coupon_code: appliedCoupon?.code || null,
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

    if (appliedCoupon) {
      const redemptionResponse = await fetch(
        `${SUPABASE_URL}/rest/v1/coupon_redemptions`,
        {
          method: "POST",
          headers: {
            ...headers,
            "Prefer": "return=minimal"
          },
          body: JSON.stringify({
            coupon_id: appliedCoupon.id,
            order_id: order.id,
            user_id: userId,
            discount_amount: discountAmount
          })
        }
      );

      if (!redemptionResponse.ok) {
        const errorText = await redemptionResponse.text();
        console.error("Coupon redemption recording failed:", errorText);
      }
    }

    if (DISCORD_WEBHOOK_URL) {
      const discordPayload = {
        username: "能量工作室",
        embeds: [{
          title: "🆕 新委託",
          color: 0x8d6be8,
          fields: [
            { name: "訂單編號", value: order.order_number || "未設定", inline: true },
            { name: "服務", value: service, inline: true },
            { name: "價格", value: `HKD ${finalPrice}` + (discountAmount > 0 ? `（原價 ${selected.price}，優惠 -${discountAmount}${appliedCoupon ? "｜" + appliedCoupon.code : ""}）` : ""), inline: true },
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
      price: order.price,
      original_price: selected.price,
      discount_amount: discountAmount,
      coupon_code: appliedCoupon?.code || null
    });
  } catch (error) {
    console.error(error);
    return json(res, 500, {
      error: "訂單提交失敗，請稍後再試。"
    });
  }
}
