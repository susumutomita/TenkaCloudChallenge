import { createRoot } from "react-dom/client";
import StatusPanel from "../portal/StatusPanel.tsx";
const seat=new URLSearchParams(location.hash.slice(1)).get("seat")??"";
const call=async(path:string,op?:unknown)=>{
  const response=await fetch(path,{method:op?"POST":"GET",headers:{Authorization:`Seat ${seat}`,"content-type":"application/json"},...(op?{body:JSON.stringify(op)}:{})});
  if(!response.ok)throw new Error(`HTTP ${response.status}`);return response.json();
};
const client={getProjection:()=>call("/api/projection"),submitOp:(op:unknown)=>call("/api/op",op)};
createRoot(document.getElementById("root")!).render(<StatusPanel team={{teamName:"Lab seat"}} problemId="session-defense" jobId="local" score={0} locale={new URLSearchParams(location.search).get("lang")==="en"?"en":"ja"} endpoints={[]} phases={[]} disruptions={[]} nowIso={new Date().toISOString()} coordinationClient={client}/>);
