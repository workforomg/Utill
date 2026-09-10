import { createTransport, unwrapData } from "./http.js";

/** Small shared wiring only. Feature routes live in their own modules. No eager requests. */
export function createEndpointModule(definitions, options = {}) {
  const request = options.request ?? createTransport(options);
  if (typeof request !== "function") throw new TypeError("request must be a function");
  const metadata = Object.freeze(Object.fromEntries(Object.entries(definitions).map(([name,d]) => [name,Object.freeze({...d})])));
  function describe(name, params = {}) {
    if (!Object.hasOwn(metadata,name)) throw new TypeError(`Unknown endpoint: ${name}`);
    if (!params || typeof params !== "object" || Array.isArray(params)) throw new TypeError("Expected parameter object");
    const d=metadata[name], ids=[...d.path.matchAll(/:([A-Za-z][A-Za-z0-9]*)/g)].map(m=>m[1]);
    for(const key of Object.keys(params)) if(!ids.includes(key) && !["query","body"].includes(key)) throw new TypeError(`Unexpected parameter: ${key}; use query or body`);
    const path=d.path.replace(/:([A-Za-z][A-Za-z0-9]*)/g,(_,key)=>{
      const value=params[key];
      if(typeof value!=="string" || !value.trim() || value==="." || value==="..") throw new TypeError(`Nonempty ${key} required`);
      return encodeURIComponent(value);
    });
    if(params.query!==undefined && (!params.query || typeof params.query!=="object" || Array.isArray(params.query)))throw new TypeError("query must be an object");
    if(d.method==="GET" && params.body!==undefined)throw new TypeError("GET does not accept body");
    return {name,method:d.method,path,query:params.query?{...params.query}:undefined,body:params.body,effect:d.effect,evidence:d.evidence,source:d.source};
  }
  const api={metadata,describe};
  for(const name of Object.keys(metadata))api[name]=async(params={}, {signal}={})=>{
    const d=describe(name,params);
    return unwrapData(await request(d.path,{method:d.method,query:d.query,body:d.body,signal}));
  };
  return Object.freeze(api);
}
