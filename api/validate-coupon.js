const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function json(res, status, body) {
  res.status(status).json(body);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(res, 405, { error: "Method not allowed" });
  }

  try {
    const body = req.body || {};
    const code = String(body.code || "").trim().toUpperCase();
    const service = String(body.service || "").trim();
    const authHeader = req.headers.authorization || "";

    if (!code || !service) return json(res, 400, { error: "請輸入優惠碼並選擇服務。" });

    const headers = {
      "Content-Type": "application/json",
      "apikey": SUPABASE_SERVICE_ROLE_KEY
    };

    const servicesResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/services?active=eq.true&select=service,package,price`,
      { headers }
    );
    if (!servicesResponse.ok) throw new Error("無法取得服務資料。");

    const services = await servicesResponse.json();
    const selected = services.find(
      item => `${item.service}｜${item.package} HKD $${item.price}` === service
    );
    if (!selected) return json(res, 400, { error: "服務套餐無效或已停用。" });

    let userId = null;
    if (authHeader.startsWith("Bearer ")) {
      const userResponse = await fetch(
        `${SUPABASE_URL}/auth/v1/user`,
        { headers: { "apikey": SUPABASE_SERVICE_ROLE_KEY, "Authorization": authHeader } }
      );
      if (userResponse.ok) userId = (await userResponse.json())?.id || null;
    }

    const couponResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/coupons?code=eq.${encodeURIComponent(code)}&active=eq.true&select=id,code,type,value,expires_at,max_uses,one_per_user&limit=1`,
      { headers }
    );
    if (!couponResponse.ok) throw new Error("無法驗證優惠碼。");

    const coupon = (await couponResponse.json())?.[0];
    if (!coupon) return json(res, 404, { error: "優惠碼不存在或已停用。" });
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

    const originalPrice = Number(selected.price);
    const value = Math.max(0, Number(coupon.value || 0));
    const discountAmount = coupon.type === "percent"
      ? Math.min(originalPrice, originalPrice * Math.min(value, 100) / 100)
      : Math.min(originalPrice, value);

    return json(res, 200, {
      ok: true,
      code: coupon.code,
      type: coupon.type,
      value,
      discount_amount: Math.round(discountAmount * 100) / 100,
      original_price: originalPrice,
      one_per_user: coupon.one_per_user
    });
  } catch (error) {
    console.error(error);
    return json(res, 500, { error: "優惠碼驗證失敗，請稍後再試。" });
  }
}
