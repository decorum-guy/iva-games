import { useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { DriveInput } from './types';
import type { BenchPreferences, Control } from './preferences';
export function useDrivingControls(active:boolean,preferences:BenchPreferences,input:MutableRefObject<DriveInput>,onInteract:()=>void,onRestore:()=>void) {
  const keys=useRef(new Set<string>());const touch=useRef({throttle:0,steering:0,brake:false,restore:false});
  const stopped=useRef(false);
  const actions=useRef({onInteract,onRestore});actions.current={onInteract,onRestore};
  const [hold,setHold]=useState(0);const holdStart=useRef<number|null>(null);const fired=useRef(false);
  useEffect(()=>{
    const down=(event:KeyboardEvent)=>{
      if(!active||event.ctrlKey||event.metaKey||event.altKey||event.target instanceof Element&&event.target.closest('input,select,textarea,[role=slider],dialog,[contenteditable=true]'))return;
      if((event.code==='Space'||event.code==='Enter')&&event.target instanceof Element&&event.target.closest('button,a,[role=button]'))return;
      if(Object.values(preferences.keys).includes(event.code)||event.code.startsWith('Arrow'))event.preventDefault();
      stopped.current=false;
      keys.current.add(event.code);
      if(event.code===preferences.keys.interact&&!event.repeat)actions.current.onInteract();
    };
    const up=(event:KeyboardEvent)=>{keys.current.delete(event.code);};
    const clear=()=>{keys.current.clear();touch.current={throttle:0,steering:0,brake:false,restore:false};input.current={throttle:0,steering:0,brake:true};stopped.current=true;};
    window.addEventListener('keydown',down);window.addEventListener('keyup',up);window.addEventListener('blur',clear);
    document.addEventListener('visibilitychange',clear);
    const timer=setInterval(()=>{
      const pressed=(control:Control,arrow?:string)=>keys.current.has(preferences.keys[control])||!!arrow&&keys.current.has(arrow);
      if(touch.current.throttle||touch.current.steering||touch.current.brake)stopped.current=false;
      if(active&&!stopped.current){input.current={throttle:pressed('throttle','ArrowUp')?1:pressed('reverse','ArrowDown')?-1:touch.current.throttle,steering:pressed('left','ArrowLeft')?-1:pressed('right','ArrowRight')?1:touch.current.steering,brake:pressed('brake')||touch.current.brake};}
      else input.current={throttle:0,steering:0,brake:true};
      const resetting=active&&(pressed('restore')||touch.current.restore);
      if(resetting){if(holdStart.current===null)holdStart.current=performance.now();const progress=Math.min(1,(performance.now()-holdStart.current)/600);setHold(progress);if(progress>=1&&!fired.current){fired.current=true;actions.current.onRestore();}}
      else {holdStart.current=null;fired.current=false;setHold(0);}
    },1000/30);
    return()=>{clear();clearInterval(timer);window.removeEventListener('keydown',down);window.removeEventListener('keyup',up);window.removeEventListener('blur',clear);document.removeEventListener('visibilitychange',clear);};
  },[active,preferences.keys,input]);
  return {touch,hold};
}
