import {useEffect,useRef,type ReactNode} from 'react';
import {X,Radio,ArrowUpRight} from 'lucide-react';
import {cn} from '../lib/utils';
export function TeamMark({code,small=false}:{code:string;small?:boolean}){return <span aria-hidden="true" className={cn('team-mark',`team-${code.toLowerCase()}`,small&&'small')}>{code}</span>;}
export function Modal({open,onClose,title,children,wide=false}:{open:boolean;onClose:()=>void;title:string;children:ReactNode;wide?:boolean}){
 const ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const d=ref.current;if(open){d?.showModal();const before=document.body.style.overflow;document.body.style.overflow='hidden';return()=>{document.body.style.overflow=before;d?.close();};}d?.close();},[open]);
 return <dialog ref={ref} className={cn('modal',wide&&'wide')} aria-label={title} onCancel={e=>{e.preventDefault();onClose();}} onClick={e=>{if(e.target===e.currentTarget)onClose();}}><div className="modal-inner"><header className="flex items-center justify-between gap-4"><h2 className="text-lg font-bold">{title}</h2><button className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={19}/></button></header>{open&&children}</div></dialog>;
}
export function Empty({title,body,action,onAction}:{title:string;body:string;action?:string;onAction?:()=>void}){return <div className="empty-state"><span className="empty-icon"><Radio size={26}/></span><h2>{title}</h2><p>{body}</p>{action&&<button className="button outline mt-5" onClick={onAction}>{action}<ArrowUpRight size={15}/></button>}</div>;}
