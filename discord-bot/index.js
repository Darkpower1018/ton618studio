const {Client,GatewayIntentBits,EmbedBuilder,REST,Routes,SlashCommandBuilder}=require("discord.js");
const {createClient}=require("@supabase/supabase-js");

const required=["DISCORD_TOKEN","DISCORD_CLIENT_ID","DISCORD_GUILD_ID","SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","ORDERS_CHANNEL_ID"];
for(const key of required){if(!process.env[key]){console.error("Missing environment variable:",key);process.exit(1)}}

const supabase=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const client=new Client({intents:[GatewayIntentBits.Guilds]});

const STATUS={
  pending:{label:"待處理",emoji:"🟡"},
  in_progress:{label:"製作中",emoji:"🔵"},
  completed:{label:"已完成",emoji:"🟢"},
  cancelled:{label:"已取消",emoji:"🔴"}
};

function statusText(value){const s=STATUS[value]||{label:value||"未知",emoji:"⚪"};return `${s.emoji} ${s.label}`;}
function money(value){const n=Number(value);return Number.isFinite(n)?`HKD $${n}`:"未設定";}
function orderLine(o){return [`**#${o.order_number||o.id}**`,statusText(o.status||"pending"),o.service||"未指定服務",o.package||"未指定套餐",money(o.price)].join(" · ");}

async function fetchOrders(){
  const {data,error}=await supabase.from("orders").select("id,order_number,customer_name,service,package,price,status,payment_status,created_at").order("created_at",{ascending:false});
  if(error) throw error;
  return data||[];
}

function buildEmbed(orders){
  const lines=orders.length?orders.map(orderLine):["目前沒有訂單。"];
  return new EmbedBuilder().setTitle("TON618｜訂單列表").setDescription(lines.join("\n\n").slice(0,4000)).setTimestamp().setFooter({text:`共 ${orders.length} 張訂單 · 狀態同步 Supabase`});
}

async function refreshOrdersMessage(){
  const channel=await client.channels.fetch(process.env.ORDERS_CHANNEL_ID);
  if(!channel||!channel.isTextBased()) throw new Error("ORDERS_CHANNEL_ID 不是可發送訊息的文字頻道");
  const orders=await fetchOrders();
  const messages=await channel.messages.fetch({limit:50});
  const existing=messages.find(m=>m.author.id===client.user.id&&m.embeds.some(e=>e.title==="TON618｜訂單列表"));
  const payload={embeds:[buildEmbed(orders)]};
  if(existing) await existing.edit(payload); else await channel.send(payload);
  return orders.length;
}

const commands=[
  new SlashCommandBuilder().setName("orders").setDescription("顯示目前所有訂單及狀態"),
  new SlashCommandBuilder().setName("refresh-orders").setDescription("立即更新 Discord 訂單列表")
].map(c=>c.toJSON());

client.once("ready",async()=>{
  console.log(`Logged in as ${client.user.tag}`);
  const rest=new REST({version:"10"}).setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID,process.env.DISCORD_GUILD_ID),{body:commands});
  try{await refreshOrdersMessage();console.log("Initial orders list synced.")}catch(e){console.error("Initial sync failed:",e)}
  setInterval(async()=>{try{await refreshOrdersMessage()}catch(e){console.error("Scheduled sync failed:",e)}},60000);
});

client.on("interactionCreate",async interaction=>{
  if(!interaction.isChatInputCommand()||!["orders","refresh-orders"].includes(interaction.commandName)) return;
  await interaction.deferReply({ephemeral:true});
  try{const count=await refreshOrdersMessage();await interaction.editReply(`✅ 訂單列表已更新，共 ${count} 張訂單。`)}
  catch(e){console.error(e);await interaction.editReply("❌ 更新失敗，請檢查 Bot 的 Supabase / Discord 設定。")}
});

client.login(process.env.DISCORD_TOKEN);
