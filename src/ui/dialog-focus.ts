/** Keep Tab/Shift+Tab within the current native dialog, including the boundary controls. */
export function trapDialogTab(event:{key:string;shiftKey:boolean;currentTarget:HTMLDialogElement;preventDefault:()=>void}) {
  if(event.key!=='Tab')return;
  const dialog=event.currentTarget;
  const controls=Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'))
    .filter(element=>element.getClientRects().length>0&&element.getAttribute('aria-hidden')!=='true');
  if(!controls.length){event.preventDefault();dialog.focus();return;}
  const first=controls[0],last=controls[controls.length-1],active=document.activeElement;
  if(event.shiftKey&&(active===first||active===dialog)){event.preventDefault();last.focus();}
  else if(!event.shiftKey&&(active===last||active===dialog)){event.preventDefault();first.focus();}
}
