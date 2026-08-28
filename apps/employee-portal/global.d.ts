declare module "cookie" { export interface CookieSerializeOptions {domain?:string;path?:string;expires?:Date;maxAge?:number;httpOnly?:boolean;secure?:boolean;sameSite?:boolean|"lax"|"strict"|"none";priority?:"low"|"medium"|"high";} }
type URLPatternInput = unknown;
type URLPatternOptions = Record<string, unknown>;
declare class URLPattern { constructor(input?: URLPatternInput, baseURL?: string); }
