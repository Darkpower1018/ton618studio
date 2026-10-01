const {createClient}=require("@supabase/supabase-js");

const required=["DISCORD_TOKEN","SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","ORDERS_CHANNEL_ID"];
for(const key of required){
  if(!process.env[key]) throw new Error(`Missing environment variable: ${key}`);
}

const supabase=createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {auth:{persistSession:false}}
);

const DISCORD_API="https://discord.com/api/v10";
const STATUS={
  pending:{label:"待處理",emoji:"🟡"},
  in_progress:{label:"製作中",emoji:"🔵"},
  completed:{label:"已完成",emoji:"🟢"},
  cancelled:{label:"已取消",emoji:"🔴"}
};

function statusText(value){
  const s=STATUS[value]||{label:value||"未知",emoji:"⚪"};
  return `${s.emoji} ${s.label}`;
}

function money(value){
  const n=Number(value);
  return Number.isFinite(n)?`HKD $${n}`:"未設定";
}

function orderLine(o){
  return [
    `**#${o.order_number||o.id}**`,
    statusText(o.status||"pending"),
    o.service||"未指定服務",
    o.package||"未指定套餐",
    money(o.price)
  ].join(" · ");
}

async function fetchOrders(){
  const {data,error}=await supabase
    .from("orders")
    .select("id,order_number,customer_name,service,package,price,status,payment_status,created_at")
    .order("created_at",{ascending:false});

  if(error) throw error;
  return data||[];
}

function buildEmbed(orders){
  const lines=orders.length
    ? orders.map(orderLine)
    : ["目前沒有訂單。"];

  return {
    title:"TON618｜訂單列表",
    description:lines.join("\n\n").slice(0,4000),
    timestamp:new Date().toISOString(),
    footer:{text:`共 ${orders.length} 張訂單 · 狀態同步 Supabase`}
  };
}

async function discord(path,options={}){
  const response=await fetch(`${DISCORD_API}${path}`,{
    ...options,
    headers:{
      Authorization:`Bot ${process.env.DISCORD_TOKEN}`,
      "Content-Type":"application/json",
      ...(options.headers||{})
    }
  });

  const text=await response.text();
  if(!response.ok){
    throw new Error(`Discord API ${response.status}: ${text}`);
  }

  return text?JSON.parse(text):null;
}

async function main(){
  const orders=await fetchOrders();
  const channelId=process.env.ORDERS_CHANNEL_ID;

  const messages=await discord(`/channels/${channelId}/messages?limit=50`);
  const existing=messages.find(message =>
    message.author?.bot &&
    message.embeds?.some(embed=>embed.title==="TON618｜訂單列表")
  );

  const body={embeds:[buildEmbed(orders)]};

  if(existing){
    await discord(`/channels/${channelId}/messages/${existing.id}`,{
      method:"PATCH",
      body:JSON.stringify(body)
    });
    console.log(`Updated Discord order list: ${orders.length} orders.`);
  }else{
    const created=await discord(`/channels/${channelId}/messages`,{
      method:"POST",
      body:JSON.stringify(body)
    });
    console.log(`Created Discord order list message ${created.id}: ${orders.length} orders.`);
  }
}

main().catch(error=>{
  console.error(error);
  process.exit(1);
});
