const fs=require('node:fs');const assert=require('node:assert/strict');const {createRequire}=require('node:module');const {createHash,randomBytes}=require('node:crypto');
const root=require('node:path').resolve(__dirname, '../../..');const requireProject=createRequire(root+'/package.json');const ts=requireProject('typescript');
const source=fs.readFileSync(root+'/functions/src/index.ts','utf8');const ast=ts.createSourceFile('index.ts',source,ts.ScriptTarget.Latest,true);
function handler(name,context){let callback;for(const statement of ast.statements){if(!ts.isVariableStatement(statement))continue;for(const node of statement.declarationList.declarations){if(node.name.getText(ast)===name)callback=node.initializer.arguments[0].getText(ast);}}assert(callback,name);const text=ts.transpileModule('return '+callback,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;return new Function(...Object.keys(context),text)(...Object.values(context));}
class HttpsError extends Error{constructor(code,message){super(message);this.code=code;}}
const caller={id:'client-a',role:'Client',companyName:'Demo'};const base={functions:{https:{HttpsError}},requireActiveCaller:async()=>caller,isAdminCaller:()=>false,normalizeRole:s=>s.toLowerCase()};
(async()=>{
 const records=new Map([['quotes/quote-a',{status:'Offre envoyée',clientId:caller.id,clientName:'Demo',priceOffer:150,adminNotes:'Conditions updated',destinationAddress:'1 rue Test',destination:'97400 Saint-Denis',destinationContact:{name:'Pharmacie',phone:'0692000000'}}]]);
 const writes=[];const db={collection:collection=>({doc:id=>({path:collection+'/'+id,id})}),runTransaction:async callback=>callback({get:async ref=>({id:ref.id,exists:records.has(ref.path),data:()=>records.get(ref.path)}),create:(ref,data)=>{records.set(ref.path,data);writes.push(ref.path);},update:(ref,patch)=>records.set(ref.path,{...records.get(ref.path),...patch})})};
 const accept=handler('acceptQuote',{...base,db,createHash,readIndividualReferenceReservations:async()=>[],writeIndividualReferenceReservations:()=>{},parcelScanCodes:()=>['Qquote-a']});
 // Frontend payload is precisely the one in deliveryService.ts:212, after opening confirmation at price 50.
 const originallyDisplayedPrice=50;const response=await accept({quoteId:'quote-a'},{auth:{uid:caller.id}});
 assert.equal(records.get('quotes/quote-a').status,'Accepté (Commande)');assert.equal(records.get('quotes/quote-a').priceOffer,150);assert.equal(writes.length,1);
 const results=[{case:'offer_changed_while_confirmation_open',originallyDisplayedPrice,acceptedPrice:records.get('quotes/quote-a').priceOffer,payload:{quoteId:'quote-a'},response,defectConfirmed:true}];
 const profiles=[{id:'pending-a',data:()=>({email:'same@example.invalid',role:'Client',companyName:'Demo'})},{id:'pending-b',data:()=>({email:'same@example.invalid',role:'Client',companyName:'Demo'})}];const queued=[];
 const inviteDb={collection:name=>({where:()=>({get:async()=>({docs:profiles})}),doc:id=>({set:async record=>queued.push({collection:name,id,record})}),add:async record=>queued.push({collection:name,record})})};
 const invite=handler('createInvitation',{...base,db:inviteDb,randomBytes,APP_URL:'https://example.invalid'});
 await invite({email:'same@example.invalid',userId:'pending-b'},{auth:{uid:caller.id}});
 let error;try{await invite({email:'same@example.invalid'},{auth:{uid:caller.id}});}catch(e){error=e;}
 assert.equal(error?.code,'not-found');assert.equal(queued.length,2);
 results.push({case:'duplicate_pending_team_profiles',initialInvite:'accepted using userId',resendPayload:{email:'same@example.invalid'},resendError:error.message,defectConfirmed:true});
 fs.writeFileSync('/private/tmp/fleet-client-quote-audit.json',JSON.stringify({method:'Current main acceptQuote/createInvitation callback AST extracted unchanged, dependencies replaced by in-memory transactional db and synthetic caller; no network or production writes',results},null,2)+'\n');console.log(JSON.stringify(results,null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
