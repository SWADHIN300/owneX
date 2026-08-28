import {cookies} from "next/headers"; import {getIronSession,type SessionOptions} from "iron-session";
export type PortalSession={wallet?:string; state?:string; stateExpires?:number; role?:string; orgId?:number; profile?:Record<string,unknown>; verifiedAt?:string};
function options():SessionOptions{const password=process.env.PORTAL_SESSION_PASSWORD;if(!password||password.length<32)throw new Error("PORTAL_SESSION_PASSWORD must be at least 32 characters");return{password,cookieName:"ownex_portal",ttl:86400,cookieOptions:{httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",path:"/"}}}
export async function session(){return getIronSession<PortalSession>(await cookies(),options())}
