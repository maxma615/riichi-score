export const base=document.querySelector<HTMLMetaElement>('meta[name=app-base]')?.content||'';
export const asset=(path:string)=>base+path;
export async function apiRequest<T>(path:string,init:RequestInit={}):Promise<T>{
 const headers=new Headers(init.headers);if(init.body&&!headers.has('Content-Type'))headers.set('Content-Type','application/json');
 const response=await fetch(asset(path==='/api/mahjong'?'/api/online':path),{...init,headers,credentials:'same-origin',cache:'no-store'});
 const body=await response.json();if(!response.ok){const e=new Error(typeof body.error==='string'?body.error:body.error?.message||'操作失败') as Error&{status:number};e.status=response.status;throw e;}return body;
}
export const errorMessage=(e:unknown)=>e instanceof Error?e.message:'操作失败';
