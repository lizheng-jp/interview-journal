'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {ArrowRight, AudioLines, CalendarDays, Clock3, Mic2, Play, Sparkles, TrendingUp} from 'lucide-react';
import {api,CATEGORY_EMOJI,clock,dateText,LABELS, type Recording,type Stats,type Category} from '@/lib/api';

const fallback:Stats={total_sessions:0,total_seconds:0,by_category:[]};
export default function Overview(){
  const [stats,setStats]=useState<Stats>(fallback),[items,setItems]=useState<Recording[]>([]),[error,setError]=useState('');
  useEffect(()=>{Promise.all([api<Stats>('/stats'),api<Recording[]>('/recordings')]).then(([s,r])=>{setStats(s);setItems(r)}).catch(e=>setError(e.message))},[]);
  const hours=(stats.total_seconds/3600).toFixed(1);
  return <>
    <div className="eyebrow"><span className="eyebrow-line"/> YOUR PERSONAL GROWTH SPACE</div>
    <section className="hero glass-panel"><div className="hero-content"><span className="hero-badge"><Sparkles size={13}/> GROW WITH EVERY SESSION</span><h1>Your next chapter<br/>starts with <em>practice.</em></h1><p>Capture every answer, revisit every insight, and turn preparation into progress. Your journey, beautifully documented.</p><Link href="/record" className="button primary"><Mic2 size={18}/> Start practicing <ArrowRight size={17}/></Link></div><div className="hero-visual"><div className="orbit orbit-1"/><div className="orbit orbit-2"/><div className="orbit orbit-3"/><div className="hero-mic"><AudioLines size={58} strokeWidth={1.15}/></div><div className="float-label label-one">✦ Keep growing</div><div className="float-label label-two"><span className="status-dot"/> One session at a time</div></div></section>
    <div className="section-heading"><div><div className="eyebrow tiny">AT A GLANCE</div><h2>Your progress, in focus</h2></div><span className="subtle">Every minute counts</span></div>
    <div className="stats-grid">
      <div className="stat glass-panel"><div className="stat-top"><span>Total sessions</span><span className="stat-icon violet"><Mic2 size={18}/></span></div><div className="stat-number">{stats.total_sessions.toString().padStart(2,'0')}</div><div className="stat-bottom">Recordings in your library</div></div>
      <div className="stat glass-panel"><div className="stat-top"><span>Practice hours</span><span className="stat-icon blue"><Clock3 size={18}/></span></div><div className="stat-number">{hours}<span className="stat-unit"> hrs</span></div><div className="stat-bottom">Focused time invested</div></div>
      <div className="stat glass-panel"><div className="stat-top"><span>Practice areas</span><span className="stat-icon pink"><TrendingUp size={18}/></span></div><div className="stat-number">{stats.by_category.length.toString().padStart(2,'0')}</div><div className="stat-bottom">Topics explored so far</div></div>
    </div>
    <div className="two-col"><section className="glass-panel panel-padding"><div className="panel-header"><div><div className="eyebrow tiny">YOUR HISTORY</div><h3>Recent sessions</h3></div><Link href="/library" className="text-link">View all <ArrowRight size={16}/></Link></div>
      {error&&<p className="error-text">Could not load recordings: {error}</p>}
      {items.length===0?<div className="empty-small"><div className="empty-icon"><AudioLines size={26}/></div><b>Your story starts here</b><p>No recordings yet. Your first practice session is just one click away.</p><Link className="text-link" href="/record">Record your first session <ArrowRight size={15}/></Link></div>:<div className="recent-list">{items.slice(0,4).map(x=><Link href={`/recordings/${x.id}`} className="recent-item" key={x.id}><div className="category-icon">{CATEGORY_EMOJI[x.category]}</div><div className="recent-main"><b>{x.title}</b><span>{LABELS[x.category]} · {dateText(x.created_at)}</span></div><span className="recent-duration">{clock(x.duration_seconds)}</span><span className="play-tiny"><Play size={13} fill="currentColor"/></span></Link>)}</div>}
    </section><section className="glass-panel panel-padding"><div className="panel-header"><div><div className="eyebrow tiny">PRACTICE MIX</div><h3>By category</h3></div><CalendarDays size={19} className="muted-icon"/></div>
      {stats.by_category.length===0?<div className="empty-small"><div className="category-bars preview-bars"><div style={{width:'78%'}}/><div style={{width:'56%'}}/><div style={{width:'37%'}}/></div><b>Make room for progress</b><p>Your practice breakdown will appear here as you record.</p></div>:<div className="category-breakdown">{stats.by_category.map((x,i)=><div className="category-row" key={x.category}><div className="category-row-label"><span>{LABELS[x.category as Category]}</span><b>{x.count} sessions</b></div><div className="bar-track"><div className={`bar-fill bar-${i%4}`} style={{width:`${Math.max(5,100*x.seconds/(stats.total_seconds||1))}%`}}/></div></div>)}</div>}
    </section></div>
  </>
}
