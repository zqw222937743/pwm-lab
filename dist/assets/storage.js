/* Device-local configuration and theme preferences; no account or remote storage. */
(function(){
 'use strict';
 let state=null;
 try{state=JSON.parse(localStorage.getItem('pwm-lab-v2-state')||'null');}catch{}
 window.PwmLabStorage={get:()=>state,set:snapshot=>{
  state=snapshot;try{localStorage.setItem('pwm-lab-v2-state',JSON.stringify(snapshot));}catch{}
 }};
 window.PwmRcLocalExports=true;
 let theme=null;try{theme=localStorage.getItem('pwm-lab-theme');}catch{}
 document.documentElement.dataset.theme=theme==='dark'||(!theme&&matchMedia('(prefers-color-scheme:dark)').matches)?'dark':'light';
})();
