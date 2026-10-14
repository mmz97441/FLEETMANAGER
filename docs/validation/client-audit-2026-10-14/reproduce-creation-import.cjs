const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const repo = require('node:path').resolve(__dirname, '../../..');
const req = createRequire(repo + '/package.json');
const ts = req('typescript'), XLSX = req('xlsx');
const read = file => fs.readFileSync(repo + '/' + file, 'utf8');
function evaluate(source, globals = {}) {
  const module = { exports: {} };
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(js, { exports: module.exports, module, require: req, console, Error, Map, Set, Date, crypto: require('node:crypto').webcrypto, TextDecoder, ...globals });
  return module.exports;
}
const form = evaluate(read('src/utils/clientShipmentForm.ts'));
const address = evaluate(read('functions/src/deliveryAddress.ts'));
const scan = evaluate(read('functions/src/scanCode.ts'));
const decode = evaluate(read('src/utils/clientImportFile.ts'));
const manifest = evaluate(read('functions/src/importManifest.ts'), { require: p => p === './scanCode' ? scan : req(p) });
const fields = { contactName: 'Client Test', address: '10 rue Test', postalCode: '97400', city: '', contactPhone: '0262000000', contactEmail: '', packageCount: 1, weight: '', requestedDeliveryDate: '2026-10-20' };
assert.deepEqual(JSON.parse(JSON.stringify(form.validateClientShipment(fields, '2026-10-14'))), {});
assert.equal(address.sameDeliveryRecipient(fields, fields), false);
console.log('PASS incomplete address: client validation accepts city=""; delivery identity rejects even the same parcel.');
const modal = read('src/components/ImportShipmentsModal.tsx');
const parserSource = modal.slice(modal.indexOf('interface ParsedRow'), modal.indexOf('const ImportShipmentsModal:')) + '\n' + modal.slice(modal.indexOf('  const handleFile ='), modal.indexOf('  const downloadTemplate =')) + '\nexports.handleFile=handleFile;';
let parsed, parseError;
const parser = evaluate(parserSource, { XLSX, carrierBarcodeError: scan.carrierBarcodeValidationError, individualReferenceError: scan.individualReferenceError, decodeClientCsv: decode.decodeClientCsv, busy: false, attempted: false, setRows: v => parsed=v, setDisplayLimit: () => {}, setError: v=>parseError=v, setFileName: () => {} });
const service = read('src/services/missionService.ts');
const serviceSource = service.slice(service.indexOf('export const addPackagesBatch ='), service.indexOf('// Code de suivi généré')) + '\n' + service.slice(service.indexOf('export const createClientShipment ='), service.indexOf('// ============================================================================', service.indexOf('export const createClientShipment =')));
let callCount=0, failOnCall=0;
const recorded = new Map();
const serviceExports = evaluate(serviceSource, { cleanUndefined: value=>JSON.parse(JSON.stringify(value)), importReference: manifest.importReference, trackingCodeForRequest: (id,i)=>`CL-${id}-${i}`, getFunctions:()=>({}), app:{}, Zone:{NORD:'Nord'}, PackageStatus:{PENDING:'En attente'}, httpsCallable:()=>async({packages})=>{
  callCount++;
  if(callCount === failOnCall) throw new Error('SIMULATED_NETWORK_FAILURE');
  const ids=packages.map(p=>{ const id='synthetic-'+p.externalId; recorded.set(id,p); return id; });
  return {data:{ids}};
}});
async function parse(rows) {
 const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rows),'Synthetic');
 const buf=XLSX.write(wb,{type:'buffer',bookType:'xlsx'});
 await parser.handleFile({name:'synthetic.xlsx',size:buf.length,arrayBuffer:async()=>buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength)});
 assert.equal(parseError,''); return parsed;
}
(async()=>{
 const base={'Numéro de colis':'GEN-0001','Destinataire':'Client Test','Adresse':'10 rue Test','Code postal':'97400','Ville':'Saint-Denis','Téléphone':'0262000000'};
 const row=(await parse([{...base,Ville:''}]))[0];
 assert.equal(row.errors.length,0);
 const saved=(await serviceExports.createClientShipmentsBatch({client:{id:'synthetic',companyName:'Synthetic'},deliveryDate:'2026-10-20',rows:[row]}))[0];
 assert.equal(saved.city,''); assert.equal(address.sameDeliveryRecipient(saved,saved),false);
 console.log('PASS incomplete client XLSX row: 0 validation errors, city remains empty in actual service payload.');
 const timedRows=await parse([
  {...base,'Numéro de colis':'GEN-0002',Time_Window_Start:'08:00',Time_Window_End:'09:00',Service_Time:'20',Requested_Delivery_Date:'2026-10-21'},
  {...base,'Numéro de colis':'GEN-0003',Time_Window_Start:'14:00',Time_Window_End:'15:00',Service_Time:'15',Requested_Delivery_Date:'2026-10-22'}
 ]);
 assert.ok(timedRows.every(r=>r.errors.length===0));
 const timed=await serviceExports.createClientShipmentsBatch({client:{id:'synthetic',companyName:'Synthetic'},deliveryDate:'2026-10-20',rows:timedRows});
 assert.ok(timed.every(p=>p.serviceTime===5 && p.timeWindowStart===undefined && p.timeWindowEnd===undefined && p.requestedDeliveryDate==='2026-10-20'));
 assert.equal(address.sameDeliveryRecipient(timed[0],timed[1]),true);
 assert.notEqual(address.intersectDeliveryWindows(timed),null);
 console.log('PASS client XLSX silently drops windows 08–09/14–15, service 20/15, and row dates21/22: both become unbounded, 5min, global date20.');
 const normalRows=await parse([{...base,'Numéro de colis':'0000123','Code transporteur':'000000987654321'},{...base,'Numéro de colis':'AbC-123'},{...base,'Numéro de colis':'abc-123'}]);
 assert.equal(normalRows[0].errors.length,0); assert.equal(normalRows[0].colisNumber,'0000123'); assert.equal(normalRows[0].carrierBarcode,'000000987654321');
 assert.ok(normalRows.slice(1).every(r=>r.errors.some(e=>e.includes('double'))));
 console.log('PASS expected behavior: generic text references retain leading zeros; case-insensitive duplicates detected.');
 const many=Array.from({length:150},(_,i)=>({...timedRows[0],line:i+2,colisNumber:`BATCH-${i}`}));
 const confirmedRef={current:new Map()}; let uiError='', completed=false;
 const handleSource=modal.slice(modal.indexOf('  const handleImport ='),modal.indexOf('\n  return (',modal.indexOf('  const handleImport =')))+'\nexports.handleImport=handleImport;';
 const oldCount=recorded.size; failOnCall=callCount+2;
 const importer=evaluate(handleSource,{access:{readOnly:false,runMutation:async(_name,fn)=>fn()},validCount:150,validRows:many,invalidRows:[],importingRef:{current:false},complete:false,deliveryDate:'2026-10-20',todayISOLocal:'2026-10-14',attempted:false,setBusy:()=>{},setAttempted:()=>{},setError:v=>uiError=v,confirmedRef,estimateZoneFromAddress:async()=>({zone:'Nord'}),createClientShipmentsBatch:serviceExports.createClientShipmentsBatch,currentUser:{id:'synthetic',companyName:'Synthetic'},importReference:manifest.importReference,getPackagesByIds:async ids=>ids.map(id=>({...recorded.get(id),id})),setConfirmed:()=>{},setComplete:v=>completed=v,onImported:()=>{}});
 await importer.handleImport();
 assert.equal(recorded.size-oldCount,75); assert.equal(confirmedRef.current.size,0); assert.equal(completed,false); assert.match(uiError,/^0 ligne confirmée/); assert.match(uiError,/75 ligne\(s\) déjà confirmée/);
 console.log('PASS partial import mismatch:', JSON.stringify({actuallyStored:75,modalConfirmed:0,message:uiError}));
 failOnCall=0; await importer.handleImport();
 assert.equal(recorded.size-oldCount,150); assert.equal(confirmedRef.current.size,150); assert.equal(completed,true);
 console.log('PASS expected retry UI: same references replayed; all150 eventually confirmed without new identities. Mock server is keyed by reference; server idempotency separately covered by existing tests.');
 const index=read('functions/src/index.ts');
 const createStart=index.indexOf('tx.create(packageRef, {',index.indexOf(".doc('quote-'"));
 const createEnd=index.indexOf('\n        });',createStart);
 const quoteSource=index.slice(createStart,createEnd+12);
 let converted;
 const quote={clientId:'synthetic',clientName:'Synthetic',deliveryDate:'2026-10-20T10:30',destinationContact:{name:'Client Test',phone:'0262000000'}};
 evaluate(quoteSource,{tx:{create:(_ref,p)=>converted=p},packageRef:{},parcelScanCodes:scan.parcelScanCodes,quoteCodes:{externalId:'syntheticQuote',orderNumber:'QsyntheticQuote',barcode:'QsyntheticQuote'},quote,id:'syntheticQuote',parts:['10 rue Test','97400 Saint-Denis'],destination:'10 rue Test, 97400 Saint-Denis',postalCode:'97400',zone:'Nord',now:'2026-10-14T10:00:00Z',caller:{id:'synthetic'}});
 assert.equal(converted.requestedDeliveryDate,'2026-10-20T10:30');
 const selectedDate='2026-10-20',allowDifferentDate=false;
 const dm=read('src/components/DispatchManager.tsx');
 const match=dm.match(/\(allowDifferentDate \|\| !p\.requestedDeliveryDate \|\| p\.requestedDeliveryDate === selectedDate\)/);
 assert.ok(match); assert.equal(vm.runInNewContext(match[0],{allowDifferentDate,selectedDate,p:converted}),false);
 assert.equal(Number.isNaN(new Date(converted.requestedDeliveryDate+'T00:00:00').getTime()),true);
 console.log('PASS quote conversion + dispatch actual expressions:',JSON.stringify({quoteDate:quote.deliveryDate,parcelDate:converted.requestedDeliveryDate,selectedDate,includedInDispatch:false,formattedDateInvalid:true}));
 console.log('All audit reproductions passed; synthetic fixtures and in-memory callable mocks only.');
})().catch(error=>{console.error(error);process.exitCode=1});
