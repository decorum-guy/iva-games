import { useEffect,useRef } from 'react';
import type { ReactNode } from 'react';
export function Modal({title,onClose,children,className='',dismissible=true}:{title:string;onClose:()=>void;children:ReactNode;className?:string;dismissible?:boolean}){
 const ref=useRef<HTMLDivElement>(null);
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null;ref.current?.querySelector<HTMLElement>('button,input,select')?.focus();return()=>previous?.focus();},[]);
 return <div className="modal-backdrop" onMouseDown={e=>{if(dismissible&&e.target===e.currentTarget)onClose();}}><div className={'colossus-modal '+className} role="dialog" aria-modal="true" aria-label={title} ref={ref} onKeyDown={e=>{
 if(e.key==='Escape'&&dismissible)onClose();
 if(e.key==='Tab'){const items=Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')??[]);const first=items[0],last=items.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}
 }}><header><h2>{title}</h2>{dismissible&&<button type="button" className="icon-button" onClick={onClose} aria-label="Close / Закрыть">×</button>}</header><div className="modal-body">{children}</div></div></div>
}
