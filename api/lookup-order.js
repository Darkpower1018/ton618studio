const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
function json(res,status,body){res.status(status).json(body);}
export default async function handler(req,res){
 if(req.method!=="POST"){res.setHeader("Allow","POST");return json(res,405,{error:"Method not allowed"});}
 if(!SUPABASE_URL||!SUPABASE_SERVICE_ROLE_KEY)return json(res,500,{error:"Server 尚未設定 Supabase server credentials。"});
 try{
  const body=req.body||{}; const orderNumber=String(body.orderNumber||"").trim(); const identifier=String(body.identifier||"").trim();
  if(!orderNumber||!identifier)return json(res,400,{error:"請輸入訂單編號與 Email / 暱稱。"});
  const headers={"Content-Type":"application/json","apikey":SUPABASE_SERVICE_ROLE_KEY};
  const orderResponse=await fetch(SUPABASE_URL+"/rest/v1/orders?order_number=eq."+encodeURIComponent(orderNumber)+"&select=*&limit=1",{headers});
  if(!orderResponse.ok)throw new Error("無法取得訂單資料。");
  const order=(await orderResponse.json())?.[0];
  if(!order)return json(res,404,{error:"找不到訂單，請確認訂單編號。"});
  const value=identifier.toLowerCase(); let matched=String(order.contact||"").toLowerCase()===value;
  if(order.user_id){
   const profileResponse=await fetch(SUPABASE_URL+"/rest/v1/profiles?id=eq."+encodeURIComponent(order.user_id)+"&select=id,email,display_name&limit=1",{headers});
   if(profileResponse.ok){const profile=(await profileResponse.json())?.[0]; matched=matched||String(profile?.email||"").toLowerCase()===value||String(profile?.display_name||"").toLowerCase()===value;}
  }
  if(!matched)return json(res,404,{error:"找不到符合的訂單，請確認 Email / 暱稱。"});
  return json(res,200,{ok:true,order});
 }catch(error){console.error(error);return json(res,500,{error:"查詢失敗，請稍後再試。"});}
}