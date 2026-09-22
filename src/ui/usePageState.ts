import {useEffect,useMemo,useState,useSyncExternalStore,type Dispatch,type SetStateAction} from 'react';
import {pageCache,readPagePreference,writePagePreference} from '../cache-runtime';
/** Session/role-scoped UI state; mismatched scopes never receive the previous user's value. */
export function usePageState<T>(name:string,initial:T|(()=>T)):[T,Dispatch<SetStateAction<T>>] {
  const scope=useSyncExternalStore(pageCache.subscribe,pageCache.getScope,()=> '');
  const key=scope+'|'+name;
  const restored=useMemo(()=>{const fallback=typeof initial==='function'?(initial as ()=>T)():initial;return readPagePreference(scope,name,fallback);},[key]);
  const [state,setState]=useState({key,value:restored});
  const value=state.key===key?state.value:restored;
  useEffect(()=>{if(state.key!==key)setState({key,value:restored});else writePagePreference(scope,name,state.value);},[key,state,restored,scope,name]);
  const set:Dispatch<SetStateAction<T>>=next=>setState(previous=>{
    const base=previous.key===key?previous.value:restored;
    return {key,value:typeof next==='function'?(next as (old:T)=>T)(base):next};
  });
  return [value,set];
}
