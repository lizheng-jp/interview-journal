'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {ArrowRight, AudioLines, FolderOpen, Mic2, Search, Play, Clock3} from 'lucide-react';
import {api,CATEGORY_EMOJI,clock,dateText,LABELS,type Category,type Recording} from '@/lib/api';
const filters: Array<{id:Category|'all';name:string}>=[{id:'all',name:'All sessions'},...Object.entries(LABELS).map(([id,name])=>({id:id as Category,name}))];
export default function Library(){
 const [items,setItems]=useState<Recording[]>([]),[filter,setFilter]=useState<Category|'all'>('all'),[query,setQuery]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 useEffect(()=>{
  let alive=true;const timer=setTimeout(()=>{
   setLoading(true);
   api<Recording[]>(`/recordings?q=${encodeURIComponent(query)}&category=${encodeURIComponent(filter)}`)
     .then(data=>{if(alive)setItems(data)}).catch(e=>{if(alive)setError(e.message)})
     .finally(()=>{if(alive)setLoading(false)});
  },180);
  return ()=>{alive=false;clearTimeout(timer)};
 },[query,filter]);
 const results=items;
 return <><div className="page-head"><div><div className="eyebrow"><span className="eyebrow-line"/> PERSONAL ARCHIVE</div><h1>Every practice <em>matters.</em></h1><p>A home for every answer, every attempt, and every moment of growth.</p></div><Link href="/record" className="button primary"><Mic2 size={17}/> New recording <ArrowRight size={16}/></Link></div>
 <div className="glass-panel library-panel"><div className="library-toolbar"><div className="search-wrap"><Search size={17}/><input aria-label="Search recordings" placeholder="Search your sessions..." value={query} onChange={e=>setQuery(e.target.value)}/></div><span className="soft-chip"><FolderOpen size={15}/>{results.length} recordings</span></div><div className="filter-row">{filters.map(x=><button key={x.id} className={`filter-chip ${filter===x.id?'selected':''}`} onClick={()=>setFilter(x.id)}>{x.name}</button>)}</div>
 {error?<p className="error-banner">{error}</p>:loading?<div className="empty-library">Loading your sessions…</div>:results.length===0?<div className="empty-library"><div className="empty-icon"><AudioLines size={28}/></div><h3>{items.length?'Nothing matches your filters':'Your library is waiting'}</h3><p>{items.length?'Try another keyword or category.':'Capture your first interview practice to begin building your story.'}</p><Link className="button primary" href="/record"><Mic2 size={16}/> Start recording</Link></div>:<div className="library-list"><div className="list-header"><span>SESSION</span><span>CATEGORY</span><span>DURATION</span><span>DATE</span><span/></div>{results.map(x=><Link href={`/recordings/${x.id}`} className="library-item" key={x.id}><div className="record-name"><span className="category-icon">{CATEGORY_EMOJI[x.category]}</span><div><b>{x.title}</b><small>{x.tags.length?x.tags.slice(0,3).join(' · '):x.language.toUpperCase()} · {x.transcription_status==='completed'?'Transcribed':x.transcription_status==='processing'?'Transcribing':x.transcription_status==='failed'?'Transcription failed':'Queued for transcription'}</small></div></div><div className="record-category">{LABELS[x.category]}</div><span className="record-meta"><Clock3 size={14}/>{clock(x.duration_seconds)}</span><span className="record-meta">{dateText(x.created_at)}</span><span className="play-tiny"><Play size={13} fill="currentColor"/></span></Link>)}</div>}
 </div></>
}
