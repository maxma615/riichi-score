import {createContext,useCallback,useContext,useEffect,useState,type ReactNode} from 'react';
import {apiRequest,errorMessage} from './api-client';
type Session={user:{id:string;displayName:string;role:'member'}};
const Context=createContext<{session:Session|null;loading:boolean;error:string|null;refreshSession:()=>Promise<boolean>}|null>(null);
export function SessionProvider({children}:{children:ReactNode;requireHome?:boolean}){
 const [session,setSession]=useState<Session|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState<string|null>(null);
 const refreshSession=useCallback(async()=>{try{const p=await apiRequest<{id:string;name:string}>('/api/profile');setSession({user:{id:p.id,displayName:p.name,role:'member'}});setError(null);return true;}catch(e){setSession(null);setError(errorMessage(e));return false;}finally{setLoading(false);}},[]);
 useEffect(()=>{void refreshSession();},[refreshSession]);return <Context.Provider value={{session,loading,error,refreshSession}}>{children}</Context.Provider>;
}
export function useSession(){const s=useContext(Context);if(!s)throw Error('Session context missing');return s;}
