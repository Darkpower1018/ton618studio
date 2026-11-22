export default async function handler(req, res) {
  const country = String(req.headers["x-vercel-ip-country"] || "").toUpperCase();
  const currencyByCountry = {
    CA:"CAD",US:"USD",GB:"GBP",TW:"TWD",HK:"HKD",MO:"MOP",JP:"JPY",KR:"KRW",CN:"CNY",
    AU:"AUD",NZ:"NZD",SG:"SGD",MY:"MYR",TH:"THB",PH:"PHP",ID:"IDR",VN:"VND",IN:"INR",
    DE:"EUR",FR:"EUR",IT:"EUR",ES:"EUR",NL:"EUR",BE:"EUR",AT:"EUR",IE:"EUR",PT:"EUR",
    FI:"EUR",GR:"EUR",CH:"CHF",NO:"NOK",SE:"SEK",DK:"DKK",PL:"PLN",CZ:"CZK",HU:"HUF",
    BR:"BRL",MX:"MXN",AR:"ARS",CL:"CLP",CO:"COP",ZA:"ZAR",TR:"TRY",AE:"AED",SA:"SAR",IL:"ILS"
  };
  const currency = currencyByCountry[country] || "HKD";
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Vary", "x-vercel-ip-country");
  if (currency === "HKD") return res.status(200).json({ country, currency, rate: 1 });
  try {
    const response = await fetch("https://api.frankfurter.app/latest?from=HKD&to=" + encodeURIComponent(currency));
    if (!response.ok) throw new Error("Exchange-rate service returned " + response.status);
    const data = await response.json();
    const rate = Number(data.rates && data.rates[currency]);
    if (!Number.isFinite(rate) || rate <= 0) throw new Error("Invalid exchange rate");
    return res.status(200).json({ country, currency, rate, date: data.date });
  } catch (error) {
    console.error("Visitor currency lookup failed:", error);
    return res.status(200).json({ country, currency: "HKD", rate: 1, fallback: true });
  }
}