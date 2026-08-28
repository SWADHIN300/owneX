import {cookies} from "next/headers"; import {getIronSession,type SessionOptions} from "iron-session";
export type PortalSession={wallet?:string; state?:string; stateExpires?:number; role?:string; orgId?:number; profile?:Record<string,unknown>; verifiedAt?:string};
const options:SessionOptions={password:process.env.PORTAL_SESSION_PASSWORD??"phase6-local-secret-change-me-32-chars!!",cookieName:"ownex_portal",ttl:86400,cookieOptions:{httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",path:"/"}};
export async function session(){return getIronSession<PortalSession>(await cookies(),options)}
