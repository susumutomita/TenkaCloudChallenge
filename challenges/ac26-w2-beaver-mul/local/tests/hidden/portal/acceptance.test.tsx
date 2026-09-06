import { readFileSync } from 'node:fs';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AppConfigProvider } from '../config-context';
import { I18nProvider } from '../i18n';
import { ContainerWorkbenchPanel } from './ContainerWorkbenchPanel';
const mocks=vi.hoisted(()=>({getWorkbenchConfig:vi.fn(),getWorkbenchStarter:vi.fn(),prepareWorkbench:vi.fn(),submitFlag:vi.fn()}));
vi.mock('../api/portal-client',async(importOriginal)=>({...await importOriginal<any>(),...mocks}));
const root=process.env.AC26_PROBLEM_ROOT!;
const metadata=JSON.parse(readFileSync(root+'/metadata.json','utf8'));
const reader=root+'/local/tests/hidden/portal/';
const files=Object.fromEntries(['beaver.py'].map(name=>[name,readFileSync(reader+'reader-'+name,'utf8')]));
const base=process.env.AC26_WORKBENCH_URL ?? 'http://127.0.0.1:18097';
async function post(path:string,body:unknown){const response=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});return response.json();}
let config:any;
let verified:string[];
beforeEach(async()=>{
 window.localStorage.setItem('tenkacloud.portal.locale','en');
 verified=[];
 config=await (await fetch(base+'/api/config')).json();
 mocks.getWorkbenchConfig.mockResolvedValue(config);
 mocks.getWorkbenchStarter.mockResolvedValue(files);
 mocks.prepareWorkbench.mockImplementation(async(_a,_s,_p,current,manual)=>post('/api/prepare',{files:current,manual}));
 mocks.submitFlag.mockImplementation(async(_a,_s,_p,submission,checkpointId)=>{
  const verdict=await post('/verify',{checkpointId,submission});
  expect(verdict).toMatchObject({checkpointId,correct:true});
  verified.push(checkpointId);
  return {kind:'ok',scoreDelta:metadata.scoring.checks.find((c:any)=>c.id===checkpointId).points,totalScore:200};
 });
});
afterEach(()=>{vi.clearAllMocks();window.localStorage.clear();});
function show(flags:any[]){return render(<AppConfigProvider config={{apiBaseUrl:base,eventTitle:'Local acceptance',eventRegion:'ap-northeast-1',mode:'backend',cloudMode:'real'}}><I18nProvider><MemoryRouter><ContainerWorkbenchPanel apiBaseUrl={base} sessionToken="synthetic-local" problemId={metadata.id} flags={flags} onScored={async()=>undefined}/></MemoryRouter></I18nProvider></AppConfigProvider>);}
const flags=metadata.scoring.checks.map((c:any)=>({id:c.id,label:c.label,points:c.points,solved:false,input:c.input}));
it('submits all five code fields through real Portal components and local API',async()=>{
 const user=userEvent.setup();show(flags);await screen.findByLabelText('beaver.py');
 expect(screen.getAllByText('This checkpoint submits the current source from the editors above.')).toHaveLength(5);
 for(let i=0;i<flags.length;i++){
  const button=screen.getAllByRole('button',{name:/^Submit \(/})[0];expect(button).not.toBeDisabled();await user.click(button);
  await waitFor(()=>expect(verified).toEqual(flags.slice(0,i+1).map((f:any)=>f.id)),{timeout:15000});
  expect(mocks.submitFlag.mock.calls[i][4]).toBe(flags[i].id);
 }
 expect(mocks.prepareWorkbench).toHaveBeenCalledTimes(5);
 for(const call of mocks.prepareWorkbench.mock.calls){expect(call[3]).toEqual(files);expect(call[4]).toEqual({});}
 expect(screen.queryByRole('button',{name:/^Submit \(/})).not.toBeInTheDocument();
},60000);
