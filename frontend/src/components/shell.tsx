'use client';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {AudioLines, ChartNoAxesCombined, CircleHelp, Library, Mic2, Sparkles, ArrowUpRight, Settings2} from 'lucide-react';
import type {ReactNode} from 'react';

const nav = [
  {href:'/', label:'Overview', Icon:ChartNoAxesCombined},
  {href:'/record', label:'Practice studio', Icon:Mic2},
  {href:'/library',label:'My recordings',Icon:Library},
];
export function Shell({children}: {children:ReactNode}) {
  const pathname=usePathname();
  return <div className="app-shell">
    <div className="ambient ambient-one"/><div className="ambient ambient-two"/><div className="ambient ambient-three"/>
    <aside className="sidebar glass-panel">
      <Link href="/" className="brand"><span className="brand-icon"><AudioLines size={20}/></span><span>interview<span className="brand-light">.journal</span></span></Link>
      <div className="sidebar-label">WORKSPACE</div>
      <nav className="nav-list">{nav.map(({href,label,Icon})=><Link className={`nav-link ${pathname===href || (href==='/library' && pathname.startsWith('/recordings/'))?'active':''}`} href={href} key={href}><Icon size={18}/><span>{label}</span></Link>)}</nav>
      <div className="sidebar-label sidebar-second">COMING LATER</div>
      <div className="nav-link inactive"><Sparkles size={18}/><span>AI interview coach</span><span className="soon">Soon</span></div>
      <div className="nav-link inactive"><Settings2 size={18}/><span>Career memory</span><span className="soon">Soon</span></div>
      <div className="sidebar-spacer"/>
      <div className="side-note"><span className="note-orb"><Sparkles size={16}/></span><b>Small steps, real progress.</b><p>Your practice stays yours. Every session is a step forward.</p></div>
      <div className="sidebar-footer"><CircleHelp size={17}/><span>Private workspace</span><span className="private-dot"/></div>
    </aside>
    <div className="main-wrap">
      <header className="topbar"><div className="breadcrumb">PERSONAL DEVELOPMENT <span>/</span> INTERVIEW PRACTICE</div><div className="topright"><span className="status-dot"/> All systems ready <div className="avatar">IJ</div></div></header>
      <main className="content">{children}</main>
      <footer className="footer">Designed for the journey, not just the destination. <ArrowUpRight size={14}/></footer>
    </div>
  </div>
}
