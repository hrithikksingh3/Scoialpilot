import pg from "pg";
import { timingSafeEqual } from "node:crypto";

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2, connectionTimeoutMillis: 8000, idleTimeoutMillis: 5000 });
type Req = { method?: string; headers: Record<string, string | string[] | undefined>; body?: unknown };
type Res = { status: (code: number) => Res; json: (body: unknown) => void; setHeader: (name: string, value: string) => void };
const platformNames = ["threads", "facebook", "linkedin"] as const;
type Platform = typeof platformNames[number];
function authorized(req: Req): boolean { const expected=process.env.DASHBOARD_ACCESS_TOKEN; const raw=req.headers.authorization; const supplied=Array.isArray(raw)?raw[0]:raw; if(!expected||!supplied?.startsWith("Bearer "))return false; const a=Buffer.from(supplied.slice(7)),b=Buffer.from(expected); return a.length===b.length&&timingSafeEqual(a,b); }
function fail(res:Res,code:number,error:string){return res.status(code).json({error});}
const CREATE_SQL=`
CREATE TABLE IF NOT EXISTS content_platform_settings(id INTEGER PRIMARY KEY DEFAULT 1 CHECK(id=1),threads_enabled BOOLEAN NOT NULL DEFAULT FALSE,facebook_enabled BOOLEAN NOT NULL DEFAULT FALSE,linkedin_enabled BOOLEAN NOT NULL DEFAULT FALSE,auto_approve_before_publish BOOLEAN NOT NULL DEFAULT FALSE,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
ALTER TABLE content_platform_settings ADD COLUMN IF NOT EXISTS auto_approve_before_publish BOOLEAN NOT NULL DEFAULT FALSE;
INSERT INTO content_platform_settings(id) VALUES(1) ON CONFLICT(id) DO NOTHING;`;
function normalize(row?:Record<string,unknown>){return{threads:row?.threads_enabled===true,facebook:row?.facebook_enabled===true,linkedin:row?.linkedin_enabled===true};}
export default async function handler(req:Req,res:Res){
 res.setHeader("Cache-Control","no-store"); if(!authorized(req))return fail(res,401,"Unauthorized");
 try{
  await pool.query(CREATE_SQL);
  if(req.method==="GET"){
   const result=await pool.query("SELECT threads_enabled,facebook_enabled,linkedin_enabled,auto_approve_before_publish,updated_at FROM content_platform_settings WHERE id=1");
   const settings=normalize(result.rows[0]);
   return res.status(200).json({platforms:settings,settings:{...settings,autoApproveBeforePublish:result.rows[0]?.auto_approve_before_publish===true},updatedAt:result.rows[0]?.updated_at??null,note:"Generated content is automatic. Approval is checked only when a scheduled post reaches publishing time unless Auto-approve before publish is enabled."});
  }
  if(req.method!=="PUT"){res.setHeader("Allow","GET, PUT");return fail(res,405,"Method not allowed");}
  if(!req.body||typeof req.body!=="object")return fail(res,400,"Invalid request body");
  const body=req.body as Record<string,unknown>;
  if(platformNames.some(p=>typeof body[p]!=="boolean"))return fail(res,400,"Provide true or false for threads, facebook, and linkedin.");
  const current=await pool.query("SELECT auto_approve_before_publish FROM content_platform_settings WHERE id=1");
  const autoApprove=typeof body.autoApproveBeforePublish==="boolean"?body.autoApproveBeforePublish:current.rows[0]?.auto_approve_before_publish===true;
  const result=await pool.query(`INSERT INTO content_platform_settings(id,threads_enabled,facebook_enabled,linkedin_enabled,auto_approve_before_publish,updated_at) VALUES(1,$1,$2,$3,$4,NOW()) ON CONFLICT(id) DO UPDATE SET threads_enabled=EXCLUDED.threads_enabled,facebook_enabled=EXCLUDED.facebook_enabled,linkedin_enabled=EXCLUDED.linkedin_enabled,auto_approve_before_publish=EXCLUDED.auto_approve_before_publish,updated_at=NOW() RETURNING threads_enabled,facebook_enabled,linkedin_enabled,auto_approve_before_publish,updated_at`,[body.threads,body.facebook,body.linkedin,autoApprove]);
  const settings=normalize(result.rows[0]);
  return res.status(200).json({platforms:settings,settings:{...settings,autoApproveBeforePublish:result.rows[0].auto_approve_before_publish===true},updatedAt:result.rows[0].updated_at,note:autoApprove?"Saved. Final publish approval is automatic.":"Saved. Final publish approval is requested only when a scheduled post reaches publishing time."});
 }catch(error){return fail(res,500,error instanceof Error?error.message:"Platform settings failed");}
}
