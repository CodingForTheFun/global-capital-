import { configureStore, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { useDispatch, useSelector } from 'react-redux';
import type { Selection, Receipt } from './lib/domain';
import { games,props,selectionFor,propSelection } from './data/samples';
export const STORAGE_KEY='edge-standalone-workspace-v1';
type Workspace={selections:Selection[];history:Receipt[];balance:number;name:string};
const defaults=():Workspace=>({selections:[selectionFor(games[0],games[0].markets[0]),propSelection(props[1],'OVER'),selectionFor(games[1],games[1].markets[2])],history:[],balance:250,name:'Guest'});
function load():Workspace {
 try {
  const v=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');
  if(v&&Array.isArray(v.history)&&Array.isArray(v.selections)&&Number.isFinite(v.balance)&&v.balance>=0&&typeof v.name==='string') {
   const valid=(s:Selection)=>s&&typeof s.id==='string'&&typeof s.eventId==='string'&&typeof s.label==='string'&&typeof s.matchup==='string'&&typeof s.market==='string'&&typeof s.sport==='string'&&Number.isFinite(s.price)&&Math.abs(s.price)>=100;
   return {balance:v.balance,name:v.name.slice(0,30),selections:v.selections.filter(valid).slice(0,12),history:v.history.filter((r:Receipt)=>r&&typeof r.id==='string'&&typeof r.at==='string'&&Number.isFinite(r.stake)&&Number.isFinite(r.potential)&&Array.isArray(r.selections)&&r.selections.every(valid)&&['singles','parlay'].includes(r.mode)).slice(0,100)};
  }
 } catch {}
 return defaults();
}
const slice=createSlice({name:'standaloneWorkspace',initialState:load(),reducers:{
 toggle(state,{payload}:PayloadAction<Selection>){const i=state.selections.findIndex(s=>s.id===payload.id); if(i>=0)state.selections.splice(i,1);else if(state.selections.length<12)state.selections.push(payload);},
 remove(state,{payload}:PayloadAction<string>){state.selections=state.selections.filter(s=>s.id!==payload);},
 clear(state){state.selections=[];},
 save(state,{payload}:PayloadAction<Receipt>){if(payload.stake>0&&payload.stake<=state.balance){state.history.unshift(payload);state.history=state.history.slice(0,100);state.balance=Math.round((state.balance-payload.stake)*100)/100;state.selections=[];}},
 rename(state,{payload}:PayloadAction<string>){state.name=payload.trim().slice(0,30)||'Guest';},
 reset(){return defaults();}
}});
export const {toggle,remove,clear,save,rename,reset}=slice.actions;
export const store=configureStore({reducer:slice.reducer});
store.subscribe(()=>{try{localStorage.setItem(STORAGE_KEY,JSON.stringify(store.getState()));}catch{}});
export const useAppDispatch=useDispatch.withTypes<typeof store.dispatch>();
export const useAppSelector=useSelector.withTypes<ReturnType<typeof store.getState>>();
