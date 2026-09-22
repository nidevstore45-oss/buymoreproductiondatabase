import {trapDialogTab} from './dialog-focus';
import React,{useEffect,useRef,useState,type ReactNode} from 'react';
import {usePageState} from './usePageState';
export interface NavigationItem {id:string;label:string;children?:NavigationItem[]}
interface Props {
  brand:string;userName:string;roleLabel:string;language:'id'|'cn';items:NavigationItem[];
  active:string;subActive?:string;onNavigate:(id:string,subId?:string)=>void;
  onLanguage:(language:'id'|'cn')=>void;onLogout:()=>void;children:ReactNode;
}
export function AppShell({brand,userName,roleLabel,language,items,active,subActive,onNavigate,onLanguage,onLogout,children}:Props){
  const [collapsed,setCollapsed]=usePageState('shell.sidebar-hidden',false);
  const [mobileOpen,setMobileOpen]=useState(false);
  const drawer=useRef<HTMLDialogElement>(null),menuButton=useRef<HTMLButtonElement>(null),main=useRef<HTMLElement>(null);
  const focusContent=useRef(false);
  const cn=language==='cn',label=(id:string,zh:string)=>cn?zh:id;
  const current=items.find(item=>item.id===active);
  const navigate=(id:string,subId?:string)=>{focusContent.current=mobileOpen;onNavigate(id,subId);setMobileOpen(false);window.setTimeout(()=>main.current?.focus({preventScroll:true}),0);};
  useEffect(()=>{
    const dialog=drawer.current;if(!dialog)return;
    if(mobileOpen&&!dialog.open)dialog.showModal();else if(!mobileOpen&&dialog.open)dialog.close();
    if(!mobileOpen)return;
    const previous=document.body.style.overflow;document.body.style.overflow='hidden';
    const media=window.matchMedia('(min-width: 1024px)');
    const resized=()=>{if(media.matches)setMobileOpen(false);};media.addEventListener('change',resized);
    return()=>{document.body.style.overflow=previous;media.removeEventListener('change',resized);};
  },[mobileOpen]);
  const navigation=(mobile=false)=><nav aria-label={label('Navigasi utama','主导航')} className="buymore-navigation">
    {items.map(item=><div key={item.id} className="buymore-nav-group">
      <button type="button" className={`buymore-nav-link ${active===item.id?'is-active':''}`} aria-current={active===item.id?'page':undefined} onClick={()=>navigate(item.id)}>{item.label}</button>
      {active===item.id&&item.children?.length? <div className="buymore-subnav">{item.children.map(child=><button type="button" key={child.id} aria-current={subActive===child.id?'page':undefined} className={`buymore-nav-link ${subActive===child.id?'is-selected':''}`} onClick={()=>navigate(item.id,child.id)}>{child.label}</button>)}</div>:null}
    </div>)}
    {mobile&&<div className="buymore-drawer-account"><p>{userName}</p><p>{roleLabel}</p><button type="button" className="buymore-text-button" onClick={onLogout}>{label('Keluar','退出登录')}</button></div>}
  </nav>;
  const branding=<div className="buymore-brand" data-brand="true"><span className="buymore-brand-mark">B</span><span className="buymore-brand-name">{brand}</span></div>;
  return <div className={`buymore-shell ${collapsed?'sidebar-hidden':''}`}>
    <a className="buymore-skip" href="#buymore-main">{label('Lewati ke konten','跳转至内容')}</a>
    {!collapsed&&<aside className="buymore-sidebar" aria-label={label('Menu samping','侧边菜单')}>
      <div className="buymore-sidebar-brand">{branding}</div>
      {navigation()}
      <div className="buymore-sidebar-footer"><button type="button" className="buymore-text-button" onClick={()=>setCollapsed(true)}>{label('Sembunyikan menu','隐藏菜单')}</button></div>
    </aside>}
    <div className="buymore-workspace">
      <header className="buymore-topbar">
        <div className="buymore-topbar-start">
          <button ref={menuButton} type="button" className="buymore-text-button buymore-mobile-menu" aria-haspopup="dialog" aria-expanded={mobileOpen} aria-controls="buymore-mobile-drawer" onClick={()=>{focusContent.current=false;setMobileOpen(true);}}>{label('Menu','菜单')}</button>
          {collapsed&&<button type="button" className="buymore-text-button buymore-desktop-menu" onClick={()=>setCollapsed(false)}>{label('Tampilkan menu','显示菜单')}</button>}
          <span className="buymore-page-name">{current?.children?.find(item=>item.id===subActive)?.label||current?.label||brand}</span>
        </div>
        <div className="buymore-account">
          <div className="buymore-account-name"><span title={userName}>{userName}</span><span className="buymore-role">{roleLabel}</span></div>
          <select aria-label={label('Bahasa','语言')} value={language} onChange={e=>onLanguage(e.target.value==='cn'?'cn':'id')}><option value="id">Indonesia</option><option value="cn">中文</option></select>
          <button type="button" className="buymore-text-button buymore-logout" onClick={onLogout}>{label('Keluar','退出登录')}</button>
        </div>
      </header>
      <main ref={main} id="buymore-main" tabIndex={-1} className="buymore-main">{children}</main>
    </div>
    <dialog onKeyDown={trapDialogTab} id="buymore-mobile-drawer" ref={drawer} className="buymore-mobile-drawer" aria-label={label('Menu navigasi','导航菜单')} onCancel={e=>{e.preventDefault();setMobileOpen(false);}} onClose={()=>{setMobileOpen(false);if(focusContent.current){main.current?.focus({preventScroll:true});focusContent.current=false;}else menuButton.current?.focus();}} onClick={e=>{if(e.target===e.currentTarget){const r=e.currentTarget.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)setMobileOpen(false);}}}>
      <div className="buymore-drawer-header">{branding}<button type="button" className="buymore-text-button" onClick={()=>setMobileOpen(false)}>{label('Tutup','关闭')}</button></div>
      {navigation(true)}
    </dialog>
  </div>;
}
