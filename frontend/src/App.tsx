import {useEffect,useState} from 'react';
import {Routes,Route,useLocation} from 'react-router-dom';
import {Ticket,ArrowUpRight} from 'lucide-react';
import {Toaster} from 'sonner';
import Navbar from './components/Navbar';
import SportsBoard from './components/SportsBoard';
import Betslip from './components/Betslip';
import ResearchModal from './components/ResearchModal';
import {History,Account,Analytics,Tools,Unavailable,About} from './components/Pages';
import {Modal} from './components/UI';
import type {PlayerProp} from './data/samples';
import {useAppSelector} from './store';
export default function App(){const [research,setResearch]=useState<PlayerProp|null>(null);const [mobileSlip,setMobileSlip]=useState(false);const [about,setAbout]=useState(false);const count=useAppSelector(s=>s.selections.length);const location=useLocation();useEffect(()=>{setMobileSlip(false);setResearch(null);window.scrollTo({top:0,behavior:'instant'});},[location.pathname]);const board=<SportsBoard onResearch={setResearch}/>;return <><Navbar/><div className="workspace"><main id="main-content" tabIndex={-1}><Routes><Route path="/" element={board}/><Route path="/nba" element={board}/><Route path="/nfl" element={board}/><Route path="/bets" element={<History/>}/><Route path="/account" element={<Account/>}/><Route path="/analytics" element={<Analytics/>}/><Route path="/tools" element={<Tools/>}/><Route path="/live" element={<Unavailable kind="live"/>}/><Route path="/login" element={<Unavailable kind="auth"/>}/><Route path="/signup" element={<Unavailable kind="auth"/>}/><Route path="*" element={<Unavailable kind="404"/>}/></Routes><footer className="site-footer"><span>ObligePay Edge <b>STANDALONE</b></span><button onClick={()=>setAbout(true)}>About this preview<ArrowUpRight size={13}/></button></footer></main><aside className="desktop-slip"><Betslip onAbout={()=>setAbout(true)}/></aside></div><button className="mobile-slip-trigger" onClick={()=>setMobileSlip(true)}><Ticket size={19}/>Open demo betslip<span>{count}</span></button><Modal open={mobileSlip} onClose={()=>setMobileSlip(false)} title="Demo betslip"><Betslip onSaved={()=>setMobileSlip(false)} onAbout={()=>{setMobileSlip(false);setAbout(true);}}/></Modal>{research&&<ResearchModal key={research.id} prop={research} onClose={()=>setResearch(null)}/>}<About open={about} onClose={()=>setAbout(false)}/><Toaster position="bottom-right" theme="dark" richColors closeButton/></>;}
