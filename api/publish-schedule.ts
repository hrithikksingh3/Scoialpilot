import pg from "pg";
import { timingSafeEqual } from "node:crypto";

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2, connectionTimeoutMillis: 8000, idleTimeoutMillis: 5000 });
type Req = { method?: string; headers: Record<string, string | string[] | undefined>; body?: unknown };
type Res = { status: (code: number) => Res; json: (body: unknown) => void; setHeader: (name: string, value: string) => void };
function authorized(req: Req): boolean {
  const expected = process.env.DASHBOARD_ACCESS_TOKEN;
  const raw = req.headers.authorization;
  const supplied = Array.isArray(raw) ? raw[0] : raw;
  if (!expected || !supplied?.startsWith("Bearer ")) return false;
  const a = Buffer.from(supplied.slice(7)), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
const CREATE_SQL = `
CREATE TABLE IF NOT EXISTS content_publish_schedule (
 id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
 posts_per_day INTEGER NOT NULL DEFAULT 1 CHECK (posts_per_day BETWEEN 1 AND 5),
 start_at_local TEXT NOT NULL DEFAULT '10:00' CHECK (start_at_local ~ '^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$'),
 interval_hours INTEGER NOT NULL DEFAULT 2 CHECK (interval_hours IN (1,2,3,4,6,8)),
 timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO content_publish_schedule (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
CREATE TABLE IF NOT EXISTS content_publish_queue (
 id BIGSERIAL PRIMARY KEY,
 draft_id TEXT NOT NULL UNIQUE REFERENCES content_drafts(id) ON DELETE CASCADE,
 scheduled_at TIMESTAMPTZ NOT NULL,
 timezone TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','published','failed','cancelled')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_content_publish_queue_scheduled ON content_publish_queue(status, scheduled_at);
`;
const CREATE_DELIVERY_SQL = `
CREATE TABLE IF NOT EXISTS content_publish_deliveries (
 id BIGSERIAL PRIMARY KEY,
 queue_id BIGINT NOT NULL REFERENCES content_publish_queue(id) ON DELETE CASCADE,
 draft_id TEXT NOT NULL REFERENCES content_drafts(id) ON DELETE CASCADE,
 platform TEXT NOT NULL CHECK (platform IN ('threads','facebook','linkedin')),
 status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','published','failed','unknown','skipped')),
 platform_post_id TEXT,
 attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
 last_error TEXT,
 published_at TIMESTAMPTZ,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(queue_id,platform)
);
CREATE INDEX IF NOT EXISTS idx_publish_deliveries_status ON content_publish_deliveries(status,updated_at);
`;
function localParts(date: Date, timezone: string) {
 const p = new Intl.DateTimeFormat("en-CA",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(date);
 const get=(type:string)=>p.find(x=>x.type===type)?.value??"";
 return {year:Number(get("year")),month:Number(get("month")),day:Number(get("day")),hour:Number(get("hour")),minute:Number(get("minute"))};
}
function localToUtc(year:number,month:number,day:number,hour:number,minute:number,timezone:string):Date {
 const target=Date.UTC(year,month-1,day,hour,minute);
 let guess=target;
 for(let i=0;i<4;i++){
  const p=localParts(new Date(guess),timezone);
  const represented=Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute);
  const delta=target-represented;
  guess+=delta;
  if(delta===0)break;
 }
 return new Date(guess);
}
function localDateParts(date:Date,timezone:string){const p=localParts(date,timezone);return {year:p.year,month:p.month,day:p.day};}
function formatLocal(date:Date,timezone:string){return new Intl.DateTimeFormat("en-IN",{timeZone:timezone,dateStyle:"medium",timeStyle:"short",hour12:true}).format(date);}
function fail(res:Res,code:number,error:string){return res.status(code).json({error});}
export default async function handler(req:Req,res:Res){
 res.setHeader("Cache-Control","no-store");
 if(!authorized(req))return fail(res,401,"Unauthorized");
 try{
  await pool.query(CREATE_SQL);
  await pool.query(CREATE_DELIVERY_SQL);
  await pool.query(`CREATE TABLE IF NOT EXISTS content_platform_settings (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    threads_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    facebook_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    linkedin_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  ); INSERT INTO content_platform_settings(id) VALUES(1) ON CONFLICT(id) DO NOTHING;`);
  if(req.method==="GET"){
   const [cfg,available,queue]=await Promise.all([
    pool.query('SELECT posts_per_day AS "postsPerDay", start_at_local AS "startAtLocal", interval_hours AS "intervalHours", timezone FROM content_publish_schedule WHERE id=1'),
    pool.query("SELECT COUNT(*)::int AS count FROM content_drafts d WHERE d.review_status='approved' AND NOT EXISTS (SELECT 1 FROM content_publish_queue q WHERE q.draft_id=d.id AND q.status IN ('scheduled','published'))"),
    pool.query(`SELECT q.draft_id AS id,d.source_title AS title,q.scheduled_at,q.timezone,q.status,
      COALESCE((SELECT json_agg(json_build_object('platform',x.platform,'status',x.status,'postId',x.platform_post_id,'error',x.last_error) ORDER BY x.platform)
        FROM content_publish_deliveries x WHERE x.queue_id=q.id),'[]'::json) AS deliveries
      FROM content_publish_queue q JOIN content_drafts d ON d.id=q.draft_id
      ORDER BY q.scheduled_at DESC LIMIT 50`)
   ]);
   return res.status(200).json({schedule:cfg.rows[0],approvedAvailable:Number(available.rows[0].count),queue:queue.rows.map(q=>({id:q.id,title:q.title,status:q.status,scheduledAt:q.scheduled_at,scheduledLocal:formatLocal(new Date(q.scheduled_at),q.timezone),deliveries:q.deliveries||[]}))});
  }
  if(req.method!=="PUT"){res.setHeader("Allow","GET, PUT");return fail(res,405,"Method not allowed");}
  if(!req.body||typeof req.body!=="object")return fail(res,400,"Invalid request body");
  const body=req.body as {postsPerDay?:unknown;startAtLocal?:unknown;intervalHours?:unknown;timezone?:unknown};
  if(!Number.isInteger(body.postsPerDay)||Number(body.postsPerDay)<1||Number(body.postsPerDay)>5||typeof body.startAtLocal!=="string"||!/^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$/.test(body.startAtLocal)||![1,2,3,4,6,8].includes(Number(body.intervalHours))||typeof body.timezone!=="string"||body.timezone.length>80)return fail(res,400,"Choose 1–5 posts, a valid start time, an interval, and a timezone.");
  try{new Intl.DateTimeFormat("en",{timeZone:body.timezone});}catch{return fail(res,400,"Invalid timezone");}
  const [startHour,startMinute]=body.startAtLocal.split(":").map(Number);
  if(startHour*60+startMinute+(Number(body.postsPerDay)-1)*Number(body.intervalHours)*60>=24*60)return fail(res,400,"These intervals would push a post into the next day. Reduce the post count or interval, or choose an earlier start time.");
  const settingsResult=await pool.query("SELECT threads_enabled,facebook_enabled,linkedin_enabled FROM content_platform_settings WHERE id=1");
  const settingRow=settingsResult.rows[0]??{};
  const activePlatforms=(["threads","facebook","linkedin"] as const).filter(p=>settingRow[({threads:"threads_enabled",facebook:"facebook_enabled",linkedin:"linkedin_enabled"} as const)[p]]===true);
  if(activePlatforms.length===0)return fail(res,409,"Select and save at least one platform in Platform auto-publishing before scheduling posts.");
  const client=await pool.connect();
  try{
   await client.query("BEGIN");
   const available=await client.query("SELECT id, source_title, platform_drafts FROM content_drafts d WHERE d.review_status='approved' AND NOT EXISTS (SELECT 1 FROM content_publish_queue q WHERE q.draft_id=d.id AND q.status IN ('scheduled','published')) ORDER BY d.created_at_db ASC LIMIT $1 FOR UPDATE OF d",[Number(body.postsPerDay)]);
   if(available.rows.length<Number(body.postsPerDay)){
    await client.query("ROLLBACK");
    return res.status(409).json({error:`Not enough approved drafts: you selected ${body.postsPerDay}, but only ${available.rows.length} unscheduled approved draft(s) are available. Approve more drafts or reduce the count.`,approvedAvailable:available.rows.length});
   }
   const now=new Date();let date=localDateParts(now,body.timezone);
   const [startH,startM]=body.startAtLocal.split(":").map(Number);
   let first=localToUtc(date.year,date.month,date.day,startH,startM,body.timezone);
   if(first.getTime()<=now.getTime()){const tomorrow=new Date(Date.UTC(date.year,date.month-1,date.day+1));date={year:tomorrow.getUTCFullYear(),month:tomorrow.getUTCMonth()+1,day:tomorrow.getUTCDate()};first=localToUtc(date.year,date.month,date.day,startH,startM,body.timezone);}
   await client.query(`INSERT INTO content_publish_schedule(id,posts_per_day,start_at_local,interval_hours,timezone,updated_at) VALUES(1,$1,$2,$3,$4,NOW()) ON CONFLICT(id) DO UPDATE SET posts_per_day=EXCLUDED.posts_per_day,start_at_local=EXCLUDED.start_at_local,interval_hours=EXCLUDED.interval_hours,timezone=EXCLUDED.timezone,updated_at=NOW()`,[Number(body.postsPerDay),body.startAtLocal,Number(body.intervalHours),body.timezone]);
   const reserved=[];
   for(let i=0;i<available.rows.length;i++){
    const scheduledAt=new Date(first.getTime()+i*Number(body.intervalHours)*60*60*1000);
    const q=await client.query(`INSERT INTO content_publish_queue(draft_id,scheduled_at,timezone,status,updated_at) VALUES($1,$2,$3,'scheduled',NOW()) ON CONFLICT(draft_id) DO UPDATE SET scheduled_at=EXCLUDED.scheduled_at,timezone=EXCLUDED.timezone,status='scheduled',updated_at=NOW() RETURNING id,draft_id,scheduled_at,timezone,status`,[available.rows[i].id,scheduledAt,body.timezone]);
    const platformDrafts=available.rows[i].platform_drafts as Array<{platform:string}>;
    for(const platform of activePlatforms){
      if(platformDrafts.some(p=>p.platform===platform)){
        await client.query("INSERT INTO content_publish_deliveries(queue_id,draft_id,platform,status) VALUES($1,$2,$3,'pending') ON CONFLICT(queue_id,platform) DO NOTHING",[q.rows[0].id,q.rows[0].draft_id,platform]);
      }
    }
    reserved.push({id:q.rows[0].draft_id,title:available.rows[i].source_title,scheduledAt:q.rows[0].scheduled_at,scheduledLocal:formatLocal(new Date(q.rows[0].scheduled_at),body.timezone),status:q.rows[0].status,platforms:activePlatforms});
   }
   await client.query("COMMIT");
   return res.status(200).json({scheduledCount:reserved.length,approvedAvailable:available.rows.length,schedule:{postsPerDay:Number(body.postsPerDay),startAtLocal:body.startAtLocal,intervalHours:Number(body.intervalHours),timezone:body.timezone},queue:reserved,note:"Queue reserved. No social platform has been published to."});
  }catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
 }catch(error){return fail(res,500,error instanceof Error?error.message:"Publishing schedule failed");}
}
