import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import '/src/index.css';
import {Button,FormInput,FormCheckbox} from '/src/components/shared/FormInput.tsx';
import PageHeader from '/src/components/shared/PageHeader.tsx';
import Modal from '/src/components/shared/Modal.tsx';
import ConfirmationHost from '/src/components/ConfirmationHost.tsx';
import CountBadge from '/src/components/shared/CountBadge.tsx';
import StatCard from '/src/components/shared/StatCard.tsx';
import DataTable from '/src/components/shared/DataTable.tsx';
import Trend from '/src/components/shared/Trend.tsx';
import NotificationCenter from '/src/components/NotificationCenter.tsx';
import Dashboard from '/src/components/Dashboard.tsx';
import Sidebar from '/src/components/Sidebar.tsx';
import {UserRole,VehicleStatus} from '/src/types.ts';
import {localDatePart} from '/src/utils/date.ts';
const user={id:'UI-ADMIN',firstName:'Camille',lastName:'Démonstration',role:UserRole.ADMIN,email:'ui@example.invalid'};
window.__calls=[];
window.__notifications=['normal','high','urgent'].map((priority,i)=>({id:'UI-N'+i,type:'system',priority,title:'Notification '+priority+' — destinataire et informations intégralement accessibles',message:'12 avenue des Mascareignes, résidence des Tamarins, bâtiment C, porte 207, 97400 Saint-Denis',read:false,createdAt:new Date().toISOString()}));
function Gallery(){const [open,setOpen]=useState(false),[value,setValue]=useState(''),[busy,setBusy]=useState(false),[nested,setNested]=useState(false);
return <main className="p-4 space-y-4 max-w-6xl mx-auto">
<PageHeader title="Préparer les livraisons" description="Données fictives · contrats visuels réels" actions={<Button id="open" onClick={()=>setOpen(true)}>Nouvelle expédition</Button>}/>
<section className="ui-panel p-4 flex flex-wrap gap-2"><Button id="primary">Enregistrer</Button><Button id="secondary" variant="secondary">Annuler</Button><Button id="danger" variant="danger">Supprimer</Button><Button id="large" size="lg">Action grand format</Button><Button id="disabled" disabled>Indisponible</Button><Button id="loading" loading>Envoi en cours</Button><span id="count"><CountBadge count={135} compact/></span><NotificationCenter currentUser={user} onNavigate={(...args)=>window.__calls.push(args)}/></section>
<section className="grid grid-cols-1 sm:grid-cols-2 gap-4"><StatCard title="Kilomètres parcourus" value={3200} trend={20} onClick={()=>window.__calls.push('stat')}/><StatCard title="Coût par kilomètre" value="0,38 €" trend={-10} trendMeaning="lower-is-better"/></section>
<div id="flat"><Trend value={0}/></div><div id="volume"><Trend value={-25}/></div>
<DataTable ariaLabel="Expéditions de démonstration" columns={[{key:'name',header:'Destinataire'},{key:'address',header:'Adresse'},{key:'amount',header:'Montant',align:'right'}]} data={[{id:'1',name:'Alexandra DUPONT-DE-LA-RIVIÈRE',address:'12 avenue des Mascareignes, résidence des Tamarins, bâtiment C, porte 207, 97400 Saint-Denis',amount:'1 245,50 €'}]} keyExtractor={row=>row.id}/>
<FormCheckbox label="Conserver la destination" description="Cette adresse sera disponible pour la prochaine expédition."/>
<Modal mobileFullscreen isOpen={open} onClose={()=>setOpen(false)} title="Nouvelle expédition" dirty={!!value} busy={busy} footer={<div className="flex flex-wrap justify-end gap-2"><Button variant="secondary" disabled={busy} onClick={()=>setNested(true)}>Vérifier</Button><Button id="save" loading={busy} onClick={()=>{setBusy(true);setTimeout(()=>setBusy(false),1500)}}>Enregistrer</Button></div>}>
<FormInput id="recipient" label="Destinataire" value={value} onChange={e=>setValue(e.target.value)}/>{Array.from({length:9},(_,i)=><FormInput key={i} label={'Information '+(i+1)} placeholder="Saisie de démonstration"/>)}
<Modal isOpen={nested} onClose={()=>setNested(false)} title="Vérification imbriquée"><Button id="nested-close" onClick={()=>setNested(false)}>Revenir à la saisie</Button></Modal>
</Modal></main>}
function Financial(){const params=new URLSearchParams(location.search);const due=new Date();due.setDate(due.getDate()+Number(params.get('ct-offset')||0));const vehicle={id:'UI-V',plate:'TEST-974',model:'Fourgon de test',status:VehicleStatus.ACTIVE,mileage:13000,...(params.has('ct-offset')?{technicalControlDate:localDatePart(due)}:{})};const logs=[{id:'1',date:'2026-07-31',mileage:10000,volume:10,cost:18},{id:'2',date:'2026-08-31',mileage:11000,volume:100,cost:180},{id:'3',date:'2026-09-12',mileage:13000,volume:150,cost:270}].map(l=>({...l,vehicleId:'UI-V',userId:user.id}));return <main className="p-4"><Dashboard currentUser={{...user,role:UserRole.PRESIDENT}} vehicles={[vehicle]} logs={params.has('no-baseline') ? logs.filter(l=>l.date.startsWith('2026-09')) : logs} maintenanceLogs={[]} issues={[]} users={[user]} onNavigate={(...args)=>window.__calls.push(args)}/></main>}
const screen=new URLSearchParams(location.search).get('screen');
createRoot(document.getElementById('root')).render(<><ConfirmationHost/>{screen==='dashboard'?<Financial/>:screen==='sidebar'?<Sidebar currentView="dashboard" isCollapsed={false} currentUser={user} onChangeView={v=>window.__calls.push(v)} onLogout={()=>{}} pendingDocsCount={15} pendingCounts={{leaves:5,absences:3,issues:12,maintenance:6,quotes:104}}/>:<Gallery/>}</>);
