import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "api_key_placeholder");

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).end();
  }

  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(500).send("Webhook not configured");
  }

  try {
    const signature = req.headers["stripe-signature"];
    const rawBody = await new Promise((resolve, reject) => {
      let data = "";
      req.on("data", chunk => { data += chunk; });
      req.on("end", () => resolve(data));
      req.on("error", reject);
    });

    const event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const orderNumber = session.metadata?.order_number;

      if (orderNumber) {
        const headers = {
          "apikey": process.env.SUPABASE_SERVICE_ROLE_KEY,
          "Authorization": `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json"
        };

        await fetch(
          `${process.env.SUPABASE_URL}/rest/v1/orders?order_number=eq.${encodeURIComponent(orderNumber)}`,
          {
            method: "PATCH",
            headers,
            body: JSON.stringify({
              payment_status: "paid",
              stripe_session_id: session.id
            })
          }
        );
      }
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error(error);
    return res.status(400).send(`Webhook Error: ${error.message}`);
  }
}
